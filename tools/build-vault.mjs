#!/usr/bin/env node
// Build the encrypted vault from a Letterboxd export.
//
//   1. Download your export: letterboxd.com → Settings → Data → Export
//   2. unzip letterboxd-*.zip -d export/          (folder is gitignored)
//   3. TMDB_KEY=<your v3 key> node tools/build-vault.mjs ./export
//      (You'll be prompted for a passphrase — twice. It is never stored.)
//   4. Commit the updated data/vault.enc and push.
//
// Flags:
//   --demo        build from a synthetic sample instead of an export
//   --no-enrich   skip TMDB (no genres/directors/runtimes; totals still work)
//   --name "S"    display name shown inside the dashboard (encrypted too)
//
// Privacy: your Letterboxd username never enters this repo. The export
// folder, the TMDB key and the enrichment cache all stay local (gitignored).
// Only data/vault.enc — ciphertext — is committed.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { parseCsvObjects } from '../lib/csv.js';
import { computeInsights, filmKey } from '../lib/insights.js';
import { encryptVault } from '../lib/vaultcrypto.js';
import { demoData } from './demo-data.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_PATH = join(ROOT, 'tools', '.tmdb-cache.json');
const OUT_PATH = join(ROOT, 'data', 'vault.enc');
const SRC_PATH = join(ROOT, 'data', 'source.enc');

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, dflt) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

// Column lookup tolerant of header capitalization drift.
function col(row, name) {
  if (row[name] !== undefined) return row[name];
  const k = Object.keys(row).find((x) => x.toLowerCase() === name.toLowerCase());
  return k ? row[k] : '';
}

function readCsv(dir, file) {
  const p = join(dir, file);
  if (!existsSync(p)) return [];
  return parseCsvObjects(readFileSync(p, 'utf8'));
}

function loadExport(dir) {
  const diaryRows = readCsv(dir, 'diary.csv');
  if (!diaryRows.length) {
    console.error(`No diary.csv found in ${dir} — point me at the unzipped Letterboxd export folder.`);
    process.exit(1);
  }
  const diary = diaryRows.map((r) => ({
    name: col(r, 'Name'),
    year: col(r, 'Year'),
    rating: parseFloat(col(r, 'Rating')) || null,
    watchedDate: col(r, 'Watched Date') || col(r, 'Date'),
    rewatch: /^yes$/i.test(col(r, 'Rewatch')),
  })).filter((d) => d.name && d.watchedDate);

  const watched = readCsv(dir, 'watched.csv').map((r) => ({ name: col(r, 'Name'), year: col(r, 'Year') }));
  const ratings = readCsv(dir, 'ratings.csv').map((r) => ({
    name: col(r, 'Name'), year: col(r, 'Year'), rating: parseFloat(col(r, 'Rating')) || null,
  })).filter((r) => r.rating);
  const watchlist = readCsv(dir, 'watchlist.csv')
    .map((r) => ({ name: col(r, 'Name'), year: col(r, 'Year') }))
    .filter((w) => w.name);
  const reviews = readCsv(dir, 'reviews.csv')
    .map((r) => ({
      name: col(r, 'Name'), year: col(r, 'Year'),
      watchedDate: col(r, 'Watched Date') || col(r, 'Date'),
      rating: parseFloat(col(r, 'Rating')) || null,
      text: col(r, 'Review'),
    }))
    .filter((r) => r.name && r.text);
  return { diary, watched, ratings, watchlist, watchlistCount: watchlist.length, reviews };
}

// ---- TMDB enrichment (cached, throttled) -----------------------------------

async function tmdb(path, params, key) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('api_key', key);
  const res = await fetch(url);
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    return tmdb(path, params, key);
  }
  if (!res.ok) return null;
  return res.json();
}

async function enrich(uniqueFilms, key) {
  const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, 'utf8')) : {};
  const films = {};
  let done = 0, misses = 0;
  for (const { name, year } of uniqueFilms) {
    const k = filmKey(name, year);
    if (cache[k] !== undefined) {
      if (cache[k]) films[k] = cache[k];
      done++;
      continue;
    }
    let search = await tmdb('/search/movie', { query: name, primary_release_year: year || '' }, key);
    if (!search?.results?.length && year) {
      // release-year mismatches happen (festival vs wide release) — retry loose
      search = await tmdb('/search/movie', { query: name }, key);
    }
    const hit = search?.results?.[0];
    if (!hit) {
      cache[k] = null; misses++;
    } else {
      const detail = await tmdb(`/movie/${hit.id}`, { append_to_response: 'credits' }, key);
      if (detail) {
        const director = detail.credits?.crew?.find((c) => c.job === 'Director')?.name || null;
        cache[k] = {
          tmdbId: hit.id,
          poster: detail.poster_path || null,
          collection: detail.belongs_to_collection
            ? { id: detail.belongs_to_collection.id, name: detail.belongs_to_collection.name }
            : null,
          genres: (detail.genres || []).map((g) => g.name),
          runtime: detail.runtime || 0,
          director,
          cast: (detail.credits?.cast || []).slice(0, 4).map((c) => c.name),
          countries: (detail.production_countries || []).map((c) => c.name),
          language: detail.original_language || null,
          tmdbRating: detail.vote_average || null,
          popularity: detail.popularity ?? null,
        };
        films[k] = cache[k];
      } else { cache[k] = null; misses++; }
    }
    done++;
    if (done % 25 === 0) {
      writeFileSync(CACHE_PATH, JSON.stringify(cache));
      process.stdout.write(`\r  enriched ${done}/${uniqueFilms.length} (${misses} not found)`);
    }
    await new Promise((r) => setTimeout(r, 120)); // stay well under TMDB limits
  }
  writeFileSync(CACHE_PATH, JSON.stringify(cache));
  console.log(`\r  enriched ${done}/${uniqueFilms.length} (${misses} not found on TMDB)`);
  return films;
}

// ---- passphrase prompt (no echo, never stored) ------------------------------

async function askPassphrases() {
  const isTTY = !!process.stdin.isTTY;
  if (!isTTY) {
    // piped input (scripted builds): first line = passphrase, second = repeat
    const rl = createInterface({ input: process.stdin });
    const lines = [];
    for await (const line of rl) { lines.push(line); if (lines.length >= 2) break; }
    rl.close();
    return [(lines[0] || '').trim(), (lines[1] ?? lines[0] ?? '').trim()];
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: isTTY });
  if (isTTY) {
    // echo * instead of the typed characters
    rl._writeToOutput = function (s) {
      if (s.includes(':')) this.output.write(s);        // the prompt itself
      else if (s === '\r\n' || s === '\n') this.output.write(s);
      else this.output.write('*');
    };
  }
  const q = (s) => new Promise((res) => rl.question(s, res));
  const p1 = await q('Choose a vault passphrase: ');
  if (isTTY) process.stdout.write('\n');
  const p2 = await q('Repeat it: ');
  if (isTTY) process.stdout.write('\n');
  rl.close();
  return [p1.trim(), p2.trim()];
}

// ---- main -------------------------------------------------------------------

const displayName = opt('--name', '');

let data;
if (flag('--demo')) {
  console.log('Building the DEMO vault (synthetic data, passphrase of your choice).');
  data = demoData();
} else {
  const dir = args.find((a) => !a.startsWith('--') && a !== opt('--name', null));
  if (!dir) {
    console.error('Usage: TMDB_KEY=xxx node tools/build-vault.mjs <export-folder> [--name "S"] [--no-enrich] | --demo');
    process.exit(1);
  }
  data = loadExport(dir);
  console.log(`Export loaded: ${data.diary.length} diary entries, ${data.watched.length} watched, ${data.ratings.length} ratings, ${data.watchlistCount} watchlisted.`);

  const uniq = new Map();
  for (const w of [...data.watched, ...data.diary]) uniq.set(filmKey(w.name, w.year), { name: w.name, year: w.year });

  if (flag('--no-enrich')) {
    console.log('Skipping TMDB enrichment (--no-enrich): no genres/directors/runtimes.');
    data.films = {};
  } else {
    const key = process.env.TMDB_KEY;
    if (!key) {
      console.error('Set TMDB_KEY (free key from themoviedb.org → Settings → API), or pass --no-enrich.');
      process.exit(1);
    }
    console.log(`Enriching ${uniq.size} unique films via TMDB (cached in tools/.tmdb-cache.json)…`);
    data.films = await enrich([...uniq.values()], key);
  }
}

data.displayName = displayName || data.displayName || '';
data.generatedAt = new Date().toISOString().slice(0, 10);

const insights = computeInsights(data);
console.log(`Insights computed: ${insights.totals.uniqueFilms} films, ${insights.totals.hours} hours, ${insights.genres.length} genres.`);

if (!flag('--demo') && !flag('--no-recs') && process.env.TMDB_KEY) {
  console.log('Building recommendation shelves…');
  const { buildRecs, buildTwoSeater } = await import('./recs-build.mjs');
  insights.recs = await buildRecs(data, process.env.TMDB_KEY);

  // Optional second seat: --second <their-export-dir> --second-name "R"
  const secondDir = opt('--second', null);
  if (secondDir) {
    console.log('Building the two-seater shelf…');
    insights.recs.twoSeater = await buildTwoSeater(
      data, loadExport(secondDir), opt('--second-name', 'the second seat'), process.env.TMDB_KEY,
    );
  }
} else if (!flag('--demo')) {
  console.log('Skipping recommendations (no TMDB_KEY or --no-recs).');
}

const [p1, p2] = await askPassphrases();
if (!p1 || p1 !== p2) {
  console.error('Passphrases empty or mismatched — nothing written.');
  process.exit(1);
}

// Carry the projectionist's log across full rebuilds: if the old source.enc
// opens with this passphrase, keep its print history and add a line for this cut.
let printHistory = [];
try {
  const { decryptVault } = await import('../lib/vaultcrypto.js');
  const prev = await decryptVault(readFileSync(SRC_PATH, 'utf8'), p1);
  printHistory = prev.printHistory || [];
} catch { /* fresh vault or re-key — the log starts over */ }
const printLine = {
  d: data.generatedAt,
  n: `full print — ${insights.totals.diaryEntries} entries, ${insights.totals.uniqueFilms} films`,
};
// same-day rebuilds collapse into one line
while (printHistory.length
  && printHistory[printHistory.length - 1].d === printLine.d
  && printHistory[printHistory.length - 1].n.startsWith('full print')) printHistory.pop();
printHistory = [...printHistory, printLine].slice(-80);
insights.printHistory = printHistory;
data.printHistory = printHistory;

writeFileSync(OUT_PATH, await encryptVault(insights, p1));
// The raw rows + enrichment, same passphrase — lets the scheduled RSS
// updater merge new watches without ever needing the export again.
writeFileSync(SRC_PATH, await encryptVault({
  diary: data.diary, watched: data.watched, ratings: data.ratings,
  watchlist: data.watchlist || [], watchlistCount: data.watchlistCount,
  reviews: data.reviews || [], films: data.films, displayName: data.displayName,
  printHistory: data.printHistory,
}, p1));
console.log(`\nWrote ${OUT_PATH} (${Math.round(readFileSync(OUT_PATH).length / 1024)} KB) and ${SRC_PATH} (${Math.round(readFileSync(SRC_PATH).length / 1024)} KB), both AES-256-GCM.`);
console.log('Commit data/ and push. The passphrase itself is stored nowhere.');
