// Builds the recommendation shelves at vault-build time. Candidate lists come
// from TMDB's own per-film recommendations (item-based collaborative
// filtering over its user base); lib/recs.js weights and merges them with the
// owner's ratings. IMDb scores come from IMDb's official daily dataset
// (datasets.imdbws.com — free, keyless). Everything runs again on each
// scheduled refresh, so the shelves follow the owner's taste.

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { seedWeight, aggregate, genreAffinity, normTitle, CANON_DIRECTORS, TMDB_GENRES } from '../lib/recs.js';
import { filmKey } from '../lib/insights.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMDB_CACHE = join(ROOT, 'tools', '.imdb-ratings.tsv');

async function tmdb(path, params, key) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  url.searchParams.set('api_key', key);
  const res = await fetch(url).catch(() => null);
  if (res?.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    return tmdb(path, params, key);
  }
  if (!res?.ok) return null;
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const yearOf = (d) => (d || '').slice(0, 4);

// ---- IMDb ratings dataset (cached for 3 days locally; fresh in CI) ----------
async function imdbRatings(neededIds) {
  let tsv = null;
  try {
    const fresh = existsSync(IMDB_CACHE)
      && Date.now() - statSync(IMDB_CACHE).mtimeMs < 3 * 86400000;
    if (fresh) tsv = readFileSync(IMDB_CACHE, 'utf8');
    else {
      const res = await fetch('https://datasets.imdbws.com/title.ratings.tsv.gz');
      if (res.ok) {
        tsv = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
        writeFileSync(IMDB_CACHE, tsv);
      }
    }
  } catch { /* recommendations still work without IMDb scores */ }
  const map = new Map();
  if (!tsv) return map;
  for (const line of tsv.split('\n')) {
    const ttEnd = line.indexOf('\t');
    if (ttEnd < 0) continue;
    const id = line.slice(0, ttEnd);
    if (!neededIds.has(id)) continue;
    const [rating, votes] = line.slice(ttEnd + 1).split('\t');
    map.set(id, { rating: +rating, votes: +votes });
  }
  return map;
}

// ---- card assembly ----------------------------------------------------------
// Providers come from TMDB's JustWatch feed for region IN — the FREE and
// ad-supported services surface first, subscriptions second. Legal only.
async function toCards(items, key, whyOf = () => null) {
  const cards = [];
  for (const it of items) {
    const d = await tmdb(`/movie/${it.id}`, { append_to_response: 'external_ids,watch/providers' }, key);
    await sleep(90);
    if (!d) continue;
    const IN = d['watch/providers']?.results?.IN || {};
    const names = (arr) => (arr || []).map((p) => p.provider_name);
    const free = [...new Set([...names(IN.free), ...names(IN.ads)])].slice(0, 3);
    const sub = names(IN.flatrate).filter((n) => !free.includes(n)).slice(0, 2);
    cards.push({
      tmdbId: it.id,
      title: d.title,
      year: yearOf(d.release_date),
      poster: d.poster_path || null,
      runtime: d.runtime || null,
      genres: (d.genres || []).slice(0, 2).map((g) => g.name),
      tmdb: { rating: Math.round((d.vote_average || 0) * 10) / 10, votes: d.vote_count || 0 },
      imdbId: d.external_ids?.imdb_id || null,
      imdb: null, // joined later from the dataset
      watch: free.length || sub.length ? { free, sub } : null,
      why: whyOf(it),
    });
  }
  return cards;
}

/**
 * @param {object} src decrypted source: {diary, watched, ratings, watchlist, films}
 * @param {string} key TMDB v3 key
 */
export async function buildRecs(src, key) {
  const films = src.films || {};
  const ratings = src.ratings || [];
  const diary = [...(src.diary || [])].sort((a, b) => (a.watchedDate < b.watchedDate ? -1 : 1));
  const ratingByKey = new Map(ratings.map((r) => [filmKey(r.name, r.year), r.rating]));

  // Exclusion set: everything watched, by TMDB id and by normalized title+year.
  const exclude = new Set();
  const watchedDirectorsCount = new Map();
  for (const [k, f] of Object.entries(films)) {
    if (f.tmdbId) exclude.add(f.tmdbId);
    if (f.director) watchedDirectorsCount.set(f.director, (watchedDirectorsCount.get(f.director) || 0) + 1);
  }
  for (const w of [...(src.watched || []), ...diary]) {
    exclude.add(`${normTitle(w.name)} ${w.year}`);
  }
  const watchlist = src.watchlist || [];
  const watchlistNorm = new Set(watchlist.map((w) => `${normTitle(w.name)} ${w.year}`));
  const excludeTitles = new Set([...(src.watched || []), ...diary].map((w) => normTitle(w.name)));

  const shelfExclude = new Set(exclude);
  for (const n of watchlistNorm) shelfExclude.add(n); // watchlist gets its own shelf

  // ---- seeds ---------------------------------------------------------------
  const seedPool = Object.entries(films)
    .map(([k, f]) => {
      const [name, year] = k.split('|');
      return { name, year, tmdbId: f.tmdbId, rating: ratingByKey.get(k) || 0 };
    })
    .filter((s) => s.tmdbId && seedWeight(s.rating) > 0);

  const allTimeSeeds = [...seedPool]
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 50);

  const recentKeys = [...diary].reverse().slice(0, 12).map((d) => filmKey(d.name, d.year));
  const recentSeeds = seedPool
    .filter((s) => recentKeys.includes(filmKey(s.name, s.year)))
    .slice(0, 8);

  const recCache = new Map();
  async function recsFor(seed) {
    if (!recCache.has(seed.tmdbId)) {
      const r = await tmdb(`/movie/${seed.tmdbId}/recommendations`, {}, key);
      await sleep(90);
      recCache.set(seed.tmdbId, (r?.results || []).map((it) => ({
        id: it.id, title: it.title, year: yearOf(it.release_date),
        vote_average: it.vote_average, vote_count: it.vote_count, poster_path: it.poster_path,
      })));
    }
    return { seed: { title: seed.name, weight: seedWeight(seed.rating) }, items: recCache.get(seed.tmdbId) };
  }

  console.log(`  recs: ${allTimeSeeds.length} all-time seeds, ${recentSeeds.length} recent seeds…`);
  const allLists = [];
  for (const s of allTimeSeeds) allLists.push(await recsFor(s));
  const recentLists = [];
  for (const s of recentSeeds) recentLists.push(await recsFor(s));

  // over-fetch, then an IMDb floor after the join trims to the final dozen
  const forYouTop = aggregate(allLists, { exclude: shelfExclude, excludeTitles, limit: 24 });
  const becauseTop = aggregate(recentLists, { exclude: shelfExclude, excludeTitles, limit: 24 })
    .filter((c) => !forYouTop.some((f) => f.id === c.id)); // don't repeat across shelves

  // ---- the user's genre profile (for director affinity) ---------------------
  const genreCount = new Map();
  for (const f of Object.values(films)) {
    for (const g of f.genres || []) genreCount.set(g, (genreCount.get(g) || 0) + 1);
  }
  const topGenres = [...genreCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g);

  // ---- canon directors ------------------------------------------------------
  async function directorBest(name, excludeSet) {
    const p = await tmdb('/search/person', { query: name }, key);
    await sleep(90);
    const person = p?.results?.[0];
    if (!person) return null;
    const credits = await tmdb(`/person/${person.id}/movie_credits`, {}, key);
    await sleep(90);
    const directed = (credits?.crew || [])
      .filter((c) => c.job === 'Director' && (c.vote_count || 0) >= 400)
      .filter((c) => !excludeSet.has(c.id) && !excludeSet.has(`${normTitle(c.title)} ${yearOf(c.release_date)}`))
      .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
    if (!directed.length) return null;
    const best = directed[0];
    const genreNames = (best.genre_ids || []).map((g) => TMDB_GENRES[g]).filter(Boolean);
    return {
      film: { id: best.id, title: best.title, year: yearOf(best.release_date), vote_average: best.vote_average, vote_count: best.vote_count, poster_path: best.poster_path },
      affinity: genreAffinity(topGenres, genreNames) * ((best.vote_average || 0) / 10),
    };
  }

  const unmet = CANON_DIRECTORS.filter((d) => !watchedDirectorsCount.has(d));
  // sample broadly but bound the calls: probe up to 12 unmet masters
  const probes = [];
  for (const name of unmet.slice(0, 12)) {
    const r = await directorBest(name, exclude);
    if (r) probes.push({ name, ...r });
  }
  const meet = probes.sort((a, b) => b.affinity - a.affinity).slice(0, 5);

  // directors the owner already loves (2+ films, avg >= 3.8) — next film from each
  const dirRatings = new Map();
  for (const [k, f] of Object.entries(films)) {
    if (!f.director) continue;
    const r = ratingByKey.get(k);
    if (!r) continue;
    if (!dirRatings.has(f.director)) dirRatings.set(f.director, []);
    dirRatings.get(f.director).push(r);
  }
  const loved = [...dirRatings.entries()]
    .filter(([d, rs]) => rs.length >= 2 && rs.reduce((s, x) => s + x, 0) / rs.length >= 3.8)
    .sort((a, b) => {
      // canon first, then by how much of them the owner has watched
      const ca = CANON_DIRECTORS.includes(a[0]) ? 1 : 0;
      const cb = CANON_DIRECTORS.includes(b[0]) ? 1 : 0;
      return cb - ca || b[1].length - a[1].length;
    })
    .slice(0, 6)
    .map(([d]) => d);
  const moreFrom = [];
  for (const name of loved) {
    const r = await directorBest(name, exclude);
    // only send someone deeper into a filmography for a genuinely great film
    if (r && (r.film.vote_average || 0) >= 7.2) moreFrom.push({ name, ...r });
  }

  // ---- follow the faces: most-seen actors → their best unwatched film ----------
  const actorCount = new Map();
  for (const f of Object.values(films)) {
    for (const a of (f.cast || []).slice(0, 4)) actorCount.set(a, (actorCount.get(a) || 0) + 1);
  }
  const topActors = [...actorCount.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([a]) => a);
  const faces = [];
  for (const name of topActors) {
    const p = await tmdb('/search/person', { query: name }, key);
    await sleep(90);
    const person = p?.results?.[0];
    if (!person) continue;
    const credits = await tmdb(`/person/${person.id}/movie_credits`, {}, key);
    await sleep(90);
    const acted = (credits?.cast || [])
      .filter((c) => (c.vote_count || 0) >= 500 && (c.order ?? 99) <= 6) // real roles, not cameos
      .filter((c) => !exclude.has(c.id) && !exclude.has(`${normTitle(c.title)} ${yearOf(c.release_date)}`))
      .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
    if (acted.length && (acted[0].vote_average || 0) >= 7.0) {
      faces.push({ ...acted[0], actor: name });
    }
  }

  // ---- unfinished business: franchises started but not completed -----------------
  const collections = new Map();
  for (const f of Object.values(films)) {
    if (f.collection?.id) collections.set(f.collection.id, f.collection.name);
  }
  const today = new Date().toISOString().slice(0, 10);
  const franchises = [];
  for (const [cid, cname] of [...collections.entries()].slice(0, 30)) {
    const col = await tmdb(`/collection/${cid}`, {}, key);
    await sleep(90);
    if (!col?.parts) continue;
    const released = col.parts.filter((p) => p.release_date && p.release_date <= today && (p.vote_count || 0) > 20);
    const seen = released.filter((p) => exclude.has(p.id) || exclude.has(`${normTitle(p.title)} ${yearOf(p.release_date)}`));
    const missing = released
      .filter((p) => !seen.includes(p))
      .sort((a, b) => (a.release_date < b.release_date ? -1 : 1));
    if (released.length >= 2 && seen.length >= 1 && missing.length >= 1) {
      franchises.push({
        name: cname.replace(/ Collection$/i, ''),
        seen: seen.length,
        total: released.length,
        missing: missing.slice(0, 2).map((p) => ({
          title: p.title, year: yearOf(p.release_date), tmdbId: p.id,
        })),
      });
    }
  }
  franchises.sort((a, b) => (b.seen / b.total) - (a.seen / a.total) || b.seen - a.seen);

  // ---- watchlist, ranked ------------------------------------------------------
  const watchlistCards = [];
  for (const w of watchlist.slice(0, 12)) {
    let s = await tmdb('/search/movie', { query: w.name, primary_release_year: w.year || '' }, key);
    if (!s?.results?.length) s = await tmdb('/search/movie', { query: w.name }, key);
    await sleep(90);
    const hit = s?.results?.[0];
    if (hit) watchlistCards.push({ id: hit.id, title: hit.title, year: yearOf(hit.release_date), vote_average: hit.vote_average, vote_count: hit.vote_count, poster_path: hit.poster_path });
  }
  watchlistCards.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));

  // ---- assemble cards + IMDb join ---------------------------------------------
  console.log('  recs: assembling cards…');
  const whyFromSeeds = (it) => (it.seeds?.length ? `because you loved ${it.seeds.slice(0, 2).join(' & ')}` : null);
  const shelves = {
    because: await toCards(becauseTop.slice(0, 12), key, (it) => (it.seeds?.length ? `↳ ${it.seeds[0]}` : null)),
    forYou: await toCards(forYouTop, key, whyFromSeeds),
    meet: await toCards(meet.map((m) => ({ ...m.film, director: m.name })), key, (it) => `meet ${it.director}`),
    moreFrom: await toCards(moreFrom.map((m) => ({ ...m.film, director: m.name })), key, (it) => `more ${it.director}`),
    faces: await toCards(faces.map((f) => ({ ...f, id: f.id })), key, (it) => `more ${it.actor}`),
    watchlistFirst: await toCards(watchlistCards.slice(0, 10), key, () => 'already on your list'),
  };

  const need = new Set();
  for (const shelf of Object.values(shelves)) for (const c of shelf) if (c.imdbId) need.add(c.imdbId);
  const ratingsMap = await imdbRatings(need);
  for (const shelf of Object.values(shelves)) {
    for (const c of shelf) {
      if (c.imdbId && ratingsMap.has(c.imdbId)) c.imdb = ratingsMap.get(c.imdbId);
      delete c.imdbId;
    }
  }

  // The floor: a recommendation shelf earns trust by what it refuses to show.
  const floor = (c) => (c.imdb?.rating ? c.imdb.rating >= 6.8 : (c.tmdb?.rating || 0) >= 7.2);
  shelves.because = shelves.because.filter(floor).slice(0, 12);
  shelves.forYou = shelves.forYou.filter(floor).slice(0, 12);

  shelves.franchises = franchises.slice(0, 8);

  const total = Object.values(shelves).reduce((s, x) => s + x.length, 0);
  console.log(`  recs: ${total} cards+rows across ${Object.keys(shelves).length} groups (IMDb joined for ${ratingsMap.size}, ${franchises.length} unfinished franchises).`);
  return shelves;
}
