#!/usr/bin/env node
// Incremental refresh from the Letterboxd RSS feed (last ~50 diary entries).
// Designed to run unattended in GitHub Actions on a schedule:
//
//   LB_USER=<username> VAULT_PASS=<passphrase> TMDB_KEY=<key> \
//     node tools/update-from-rss.mjs
//
// Decrypts data/source.enc, merges any diary entries it doesn't have yet,
// enriches new films via their TMDB id (carried in the feed), recomputes
// insights and re-encrypts both files. Prints CHANGED or NO-CHANGE.
//
// All three values come from Actions secrets — masked in logs, absent from
// the repo. The feed itself is public; this only reads it.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeInsights, filmKey } from '../lib/insights.js';
import { encryptVault, decryptVault } from '../lib/vaultcrypto.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = join(ROOT, 'data', 'vault.enc');
const SRC_PATH = join(ROOT, 'data', 'source.enc');

const { LB_USER, VAULT_PASS, TMDB_KEY } = process.env;
if (!LB_USER || !VAULT_PASS) {
  console.error('LB_USER and VAULT_PASS are required (TMDB_KEY optional but recommended).');
  process.exit(1);
}

// ---- fetch + parse the feed --------------------------------------------------

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'");
}

function tag(item, name) {
  const m = item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? decodeEntities(m[1].trim()) : '';
}

async function fetchFeed(user) {
  const res = await fetch(`https://letterboxd.com/${user}/rss/`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
  return res.text();
}

function parseWatches(xml) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  const watches = [];
  for (const item of items) {
    const title = tag(item, 'letterboxd:filmTitle');
    const watchedDate = tag(item, 'letterboxd:watchedDate');
    if (!title || !watchedDate) continue; // list items etc.
    watches.push({
      name: title,
      year: tag(item, 'letterboxd:filmYear'),
      watchedDate,
      rewatch: /^yes$/i.test(tag(item, 'letterboxd:rewatch')),
      rating: parseFloat(tag(item, 'letterboxd:memberRating')) || null,
      tmdbId: tag(item, 'tmdb:movieId') || null,
    });
  }
  // oldest first so diary order stays chronological
  return watches.sort((a, b) => (a.watchedDate < b.watchedDate ? -1 : 1));
}

// ---- TMDB by id (no search needed — the feed carries the id) -----------------

async function enrichById(tmdbId, key) {
  const url = `https://api.themoviedb.org/3/movie/${tmdbId}?append_to_response=credits&api_key=${key}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const d = await res.json();
  return {
    tmdbId: Number(tmdbId),
    genres: (d.genres || []).map((g) => g.name),
    runtime: d.runtime || 0,
    director: d.credits?.crew?.find((c) => c.job === 'Director')?.name || null,
    cast: (d.credits?.cast || []).slice(0, 4).map((c) => c.name),
    countries: (d.production_countries || []).map((c) => c.name),
    language: d.original_language || null,
    tmdbRating: d.vote_average || null,
    popularity: d.popularity ?? null,
  };
}

// ---- merge --------------------------------------------------------------------

const src = await decryptVault(readFileSync(SRC_PATH, 'utf8'), VAULT_PASS);
const feed = parseWatches(await fetchFeed(LB_USER));

const haveEntry = new Set(src.diary.map((d) => `${d.name}|${d.year}|${d.watchedDate}`));
const haveFilm = new Set(src.watched.map((w) => filmKey(w.name, w.year)));
const ratingIdx = new Map(src.ratings.map((r, i) => [filmKey(r.name, r.year), i]));

let added = 0;
let enriched = 0;
for (const w of feed) {
  const entryKey = `${w.name}|${w.year}|${w.watchedDate}`;
  if (haveEntry.has(entryKey)) continue;
  haveEntry.add(entryKey);
  src.diary.push({ name: w.name, year: w.year, rating: w.rating, watchedDate: w.watchedDate, rewatch: w.rewatch });
  added++;

  const key = filmKey(w.name, w.year);
  if (!haveFilm.has(key)) {
    haveFilm.add(key);
    src.watched.push({ name: w.name, year: w.year });
  }
  if (w.rating) {
    if (ratingIdx.has(key)) src.ratings[ratingIdx.get(key)].rating = w.rating;
    else { ratingIdx.set(key, src.ratings.length); src.ratings.push({ name: w.name, year: w.year, rating: w.rating }); }
  }
  if (!src.films[key] && w.tmdbId && TMDB_KEY) {
    const f = await enrichById(w.tmdbId, TMDB_KEY);
    if (f) { src.films[key] = f; enriched++; }
    await new Promise((r) => setTimeout(r, 150));
  }
}

if (!added) {
  console.log('NO-CHANGE — feed has nothing new.');
  process.exit(0);
}

src.diary.sort((a, b) => (a.watchedDate < b.watchedDate ? -1 : 1));
src.generatedAt = new Date().toISOString().slice(0, 10);
const insights = computeInsights(src);

if (TMDB_KEY) {
  console.log('Rebuilding recommendation shelves…');
  const { buildRecs } = await import('./recs-build.mjs');
  insights.recs = await buildRecs(src, TMDB_KEY);
}

writeFileSync(OUT_PATH, await encryptVault(insights, VAULT_PASS));
writeFileSync(SRC_PATH, await encryptVault({
  diary: src.diary, watched: src.watched, ratings: src.ratings,
  watchlist: src.watchlist || [], watchlistCount: src.watchlistCount,
  films: src.films, displayName: src.displayName,
}, VAULT_PASS));
console.log(`CHANGED — merged ${added} new diary entr${added === 1 ? 'y' : 'ies'} (${enriched} newly enriched). Now ${insights.totals.diaryEntries} entries, ${insights.totals.uniqueFilms} films.`);
