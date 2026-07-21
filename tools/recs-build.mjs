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
import { seedWeight, aggregate, genreAffinity, normTitle, CANON_DIRECTORS, TMDB_GENRES, SYLLABUS, SYLLABUS_EXTRAS } from '../lib/recs.js';
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
async function toCards(items, key, whyOf = () => null) {
  const cards = [];
  for (const it of items) {
    const d = await tmdb(`/movie/${it.id}`, { append_to_response: 'external_ids' }, key);
    await sleep(90);
    if (!d) continue;
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

  // over-fetch a shared pool: the floor + runtime shelves carve it up later
  const forYouTop = aggregate(allLists, { exclude: shelfExclude, excludeTitles, limit: 40 });
  const becauseTop = aggregate(recentLists, { exclude: shelfExclude, excludeTitles, limit: 24 })
    .filter((c) => !forYouTop.slice(0, 14).some((f) => f.id === c.id)); // don't repeat across shelves

  // ---- the user's genre profile (for director affinity) ---------------------
  const genreCount = new Map();
  for (const f of Object.values(films)) {
    for (const g of f.genres || []) genreCount.set(g, (genreCount.get(g) || 0) + 1);
  }
  const topGenres = [...genreCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g);

  // ---- canon directors ------------------------------------------------------
  async function directorFilms(name, excludeSet, n = 1) {
    const p = await tmdb('/search/person', { query: name }, key);
    await sleep(90);
    const person = p?.results?.[0];
    if (!person) return [];
    const credits = await tmdb(`/person/${person.id}/movie_credits`, {}, key);
    await sleep(90);
    return (credits?.crew || [])
      .filter((c) => c.job === 'Director' && (c.vote_count || 0) >= 400)
      .filter((c) => !excludeSet.has(c.id) && !excludeSet.has(`${normTitle(c.title)} ${yearOf(c.release_date)}`))
      .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))
      .slice(0, n)
      .map((c) => ({ id: c.id, title: c.title, year: yearOf(c.release_date), vote_average: c.vote_average, vote_count: c.vote_count, poster_path: c.poster_path, genre_ids: c.genre_ids }));
  }

  async function directorBest(name, excludeSet) {
    const [best] = await directorFilms(name, excludeSet, 1);
    if (!best) return null;
    const genreNames = (best.genre_ids || []).map((g) => TMDB_GENRES[g]).filter(Boolean);
    return {
      film: best,
      affinity: genreAffinity(topGenres, genreNames) * ((best.vote_average || 0) / 10),
    };
  }

  // The masters program — the owner's favourite shelf, expanded.
  // 1. Masters never met: probe widely, keep the best-fitting eight.
  const unmet = CANON_DIRECTORS.filter((d) => !watchedDirectorsCount.has(d));
  const probes = [];
  for (const name of unmet.slice(0, 18)) {
    const r = await directorBest(name, exclude);
    if (r) probes.push({ name, ...r });
  }
  const meet = probes.sort((a, b) => b.affinity - a.affinity).slice(0, 8);

  // 2. Masters in progress: canon directors already started — their next film.
  const startedMasters = CANON_DIRECTORS
    .filter((d) => watchedDirectorsCount.has(d))
    .sort((a, b) => watchedDirectorsCount.get(b) - watchedDirectorsCount.get(a))
    .slice(0, 8);
  const mastersProgress = [];
  for (const name of startedMasters) {
    const r = await directorBest(name, exclude);
    if (r && (r.film.vote_average || 0) >= 7.0) {
      mastersProgress.push({ name, seen: watchedDirectorsCount.get(name), ...r });
    }
  }

  // 3. Non-canon directors the owner loves (2+ films, avg >= 3.8) — next film.
  const dirRatings = new Map();
  for (const [k, f] of Object.entries(films)) {
    if (!f.director) continue;
    const r = ratingByKey.get(k);
    if (!r) continue;
    if (!dirRatings.has(f.director)) dirRatings.set(f.director, []);
    dirRatings.get(f.director).push(r);
  }
  const loved = [...dirRatings.entries()]
    .filter(([d, rs]) => !CANON_DIRECTORS.includes(d)
      && rs.length >= 2 && rs.reduce((s, x) => s + x, 0) / rs.length >= 3.8)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5)
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

  // ---- master spotlight: one rotating retrospective per refresh -----------------
  // Deterministic rotation by build week, so every Mon/Thu print can feature
  // someone new without any stored state.
  let spotlight = null;
  {
    const week = Math.floor(Date.now() / (7 * 86400000));
    for (let probe = 0; probe < 6 && !spotlight; probe++) {
      const name = CANON_DIRECTORS[(week + probe) % CANON_DIRECTORS.length];
      const filmsTop = (await directorFilms(name, exclude, 5)).filter((f) => (f.vote_average || 0) >= 7.0);
      if (filmsTop.length >= 2) spotlight = { name, films: filmsTop };
    }
  }

  // ---- terra incognita: fill the emptiest genre × decade cells -------------------
  const GENRE_IDS = Object.fromEntries(Object.entries(TMDB_GENRES).map(([id, name]) => [name, +id]));
  const decCount = new Map();
  const gdCount = new Map();
  for (const [k, f] of Object.entries(films)) {
    const year = k.split('|')[1];
    const dec = year && year.length === 4 ? Math.floor(+year / 10) * 10 : null;
    if (!dec) continue;
    decCount.set(dec, (decCount.get(dec) || 0) + 1);
    for (const g of f.genres || []) gdCount.set(`${g}|${dec}`, (gdCount.get(`${g}|${dec}`) || 0) + 1);
  }
  const gapPicks = [];
  {
    const gaps = [];
    for (const g of topGenres.slice(0, 6)) {
      for (let dec = 1950; dec <= 2010; dec += 10) {
        const n = gdCount.get(`${g}|${dec}`) || 0;
        if (n === 0) gaps.push({ g, dec });
      }
    }
    // prefer the owner's stronger genres and the great middle decades
    gaps.sort((a, b) => topGenres.indexOf(a.g) - topGenres.indexOf(b.g)
      || Math.abs(1975 - a.dec) - Math.abs(1975 - b.dec));
    for (const gap of gaps.slice(0, 4)) {
      const d = await tmdb('/discover/movie', {
        with_genres: GENRE_IDS[gap.g], sort_by: 'vote_average.desc',
        'vote_count.gte': gap.dec < 1970 ? 300 : 500,
        'primary_release_date.gte': `${gap.dec}-01-01`,
        'primary_release_date.lte': `${gap.dec + 9}-12-31`,
      }, key);
      await sleep(90);
      const hit = (d?.results || []).find((r) =>
        !exclude.has(r.id) && !exclude.has(`${normTitle(r.title)} ${yearOf(r.release_date)}`));
      if (hit) {
        gapPicks.push({
          id: hit.id, title: hit.title, year: yearOf(hit.release_date),
          vote_average: hit.vote_average, vote_count: hit.vote_count, poster_path: hit.poster_path,
          gapLabel: `${gap.g}, the ${gap.dec}s — unexplored`,
        });
      }
    }
  }

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
  const pool = await toCards(forYouTop, key, whyFromSeeds);
  const shelves = {
    because: await toCards(becauseTop.slice(0, 12), key, (it) => (it.seeds?.length ? `↳ ${it.seeds[0]}` : null)),
    meet: await toCards(meet.map((m) => ({ ...m.film, director: m.name })), key, (it) => `meet ${it.director}`),
    mastersProgress: await toCards(
      mastersProgress.map((m) => ({ ...m.film, director: m.name, seen: m.seen })), key,
      (it) => `${it.director} — you’ve seen ${it.seen}`,
    ),
    moreFrom: await toCards(moreFrom.map((m) => ({ ...m.film, director: m.name })), key, (it) => `more ${it.director}`),
    faces: await toCards(faces.map((f) => ({ ...f, id: f.id })), key, (it) => `more ${it.actor}`),
    gapFillers: await toCards(gapPicks, key, (it) => it.gapLabel),
    watchlistFirst: await toCards(watchlistCards.slice(0, 10), key, () => 'already on your list'),
  };
  if (spotlight) {
    shelves.spotlight = {
      name: spotlight.name,
      films: await toCards(spotlight.films, key, () => `a ${spotlight.name} picture`),
    };
  }

  const joinGroups = [pool];
  for (const g of Object.values(shelves)) {
    if (Array.isArray(g)) joinGroups.push(g);
    else if (g?.films) joinGroups.push(g.films); // the spotlight
  }
  const need = new Set();
  for (const group of joinGroups) for (const c of group) if (c.imdbId) need.add(c.imdbId);
  const ratingsMap = await imdbRatings(need);
  for (const group of joinGroups) {
    for (const c of group) {
      if (c.imdbId && ratingsMap.has(c.imdbId)) c.imdb = ratingsMap.get(c.imdbId);
      delete c.imdbId;
    }
  }

  // The floor: a recommendation shelf earns trust by what it refuses to show.
  const floor = (c) => (c.imdb?.rating ? c.imdb.rating >= 6.8 : (c.tmdb?.rating || 0) >= 7.2);
  shelves.because = shelves.because.filter(floor).slice(0, 12);

  // Carve the shared pool: the main shelf first, then the runtime shelves
  // take what's left so nothing repeats.
  const poolOk = pool.filter(floor);
  shelves.forYou = poolOk.slice(0, 12);
  const used = new Set([...shelves.forYou, ...shelves.because].map((c) => c.tmdbId));
  shelves.shortReel = poolOk.filter((c) => !used.has(c.tmdbId) && c.runtime > 0 && c.runtime <= 105).slice(0, 8);
  shelves.shortReel.forEach((c) => used.add(c.tmdbId));
  shelves.longHaul = poolOk.filter((c) => !used.has(c.tmdbId) && c.runtime >= 150).slice(0, 8);

  shelves.franchises = franchises.slice(0, 8);

  // The canon board: every master, with how far in the owner is.
  shelves.canon = CANON_DIRECTORS
    .map((name) => ({ name, seen: watchedDirectorsCount.get(name) || 0 }))
    .sort((a, b) => b.seen - a.seen || a.name.localeCompare(b.name));

  // Film school: resolve the syllabus against TMDB, grade the transcript.
  console.log('  recs: grading the film-school transcript…');
  // the owner's rating per film, reachable by TMDB id or normalized title
  const ratingByTmdbId = new Map();
  const ratingByNorm = new Map();
  for (const [k, f] of Object.entries(films)) {
    const [name, year] = k.split('|');
    const r = ratingByKey.get(k);
    if (!r) continue;
    if (f.tmdbId) ratingByTmdbId.set(f.tmdbId, r);
    ratingByNorm.set(normTitle(name), r);
  }
  const letterOf = (gpa) => (gpa >= 3.7 ? 'A' : gpa >= 3.3 ? 'A-' : gpa >= 3.0 ? 'B+' : gpa >= 2.7 ? 'B' : gpa >= 2.3 ? 'B-' : 'C');

  // Long comma-laden titles (Jeanne Dielman…) defeat TMDB search outright;
  // retry on the pre-comma stem but accept only an exact normalized-title match,
  // so a making-of documentary can't stand in for the film.
  const searchSyllabusFilm = async (title, year) => {
    let s = await tmdb('/search/movie', { query: title, primary_release_year: year }, key);
    if (!s?.results?.length) s = await tmdb('/search/movie', { query: title }, key);
    if (!s?.results?.length && title.includes(',')) {
      const stem = await tmdb('/search/movie', { query: title.split(',')[0] }, key);
      const want = normTitle(title);
      s = { results: (stem?.results || []).filter((r) => normTitle(r.title) === want) };
    }
    await sleep(80);
    return s?.results?.[0];
  };

  const school = { courses: [], done: 0, total: 0 };
  const allGrades = [];
  for (const course of SYLLABUS) {
    const courseFilms = [];
    const courseGrades = [];
    for (const [title, year, why] of course.films) {
      const hit = await searchSyllabusFilm(title, year);
      const watched = (hit && exclude.has(hit.id)) || exclude.has(`${normTitle(title)} ${year}`);
      const userRating = watched
        ? (hit && ratingByTmdbId.get(hit.id)) || ratingByNorm.get(normTitle(title)) || null
        : null;
      if (userRating) { courseGrades.push(userRating); allGrades.push(userRating); }
      courseFilms.push({
        title, year, why, watched, userRating,
        tmdbId: hit?.id || null,
        poster: hit?.poster_path || null,
        tmdb: hit?.vote_average ? Math.round(hit.vote_average * 10) / 10 : null,
      });
      school.total++;
      if (watched) school.done++;
    }
    // further screening — the alternate, not counted toward credit
    let extra = null;
    if (SYLLABUS_EXTRAS[course.code]) {
      const [xt, xy, xwhy] = SYLLABUS_EXTRAS[course.code];
      const xhit = await searchSyllabusFilm(xt, xy);
      extra = {
        title: xt, year: xy, why: xwhy,
        tmdbId: xhit?.id || null,
        watched: (xhit && exclude.has(xhit.id)) || exclude.has(`${normTitle(xt)} ${xy}`),
      };
    }

    const avg = courseGrades.length ? courseGrades.reduce((a, b) => a + b, 0) / courseGrades.length : null;
    school.courses.push({
      code: course.code, title: course.title, year: course.year,
      level: course.year <= 4 ? 'BA' : 'MFA',
      extra,
      desc: course.desc, assignment: course.assignment,
      grade: avg !== null ? letterOf((avg / 5) * 4) : null,
      honors: avg !== null && avg >= 4.5,           // dean's list
      complete: courseFilms.every((f) => f.watched),
      films: courseFilms,
    });
  }
  if (allGrades.length) {
    const g = (allGrades.reduce((a, b) => a + b, 0) / allGrades.length / 5) * 4;
    school.gpa = Math.round(g * 100) / 100;
    school.gpaLetter = letterOf(g);
  }
  // two-tier standing: the BA years first, then the graduate school
  const tally = (level) => {
    const fs = school.courses.filter((c) => c.level === level).flatMap((c) => c.films);
    return { done: fs.filter((f) => f.watched).length, total: fs.length };
  };
  school.ba = tally('BA');
  school.mfa = tally('MFA');
  school.deansList = school.courses.filter((c) => c.honors).length;
  if (school.ba.done < school.ba.total) {
    const pct = school.ba.done / school.ba.total;
    school.standing = pct >= 0.75 ? 'Senior' : pct >= 0.5 ? 'Junior' : pct >= 0.25 ? 'Sophomore' : 'Freshman';
  } else if (school.mfa.done < school.mfa.total) {
    school.standing = 'MFA candidate';
  } else {
    school.standing = 'Doctor of Cinema';
  }
  // office hours: the course currently in session (first with an unwatched film)
  const current = school.courses.find((c) => !c.complete);
  if (current) {
    const next = current.films.find((f) => !f.watched && f.tmdbId);
    school.semester = { code: current.code, title: current.title, desc: current.desc, next: next || null };
  }
  shelves.school = school;

  // Season pass: the four-week term plan, cut fresh with every print.
  const seasonPass = [];
  const addWeek = (label, card) => {
    if (card && !seasonPass.some((w) => w.card.tmdbId === card.tmdbId)) {
      seasonPass.push({ week: seasonPass.length + 1, label, card });
    }
  };
  if (shelves.spotlight?.films?.[0]) {
    addWeek(`the spotlight — ${shelves.spotlight.name}`, shelves.spotlight.films[0]);
  }
  for (const course of school.courses) {
    const next = course.films.find((f) => !f.watched && f.tmdbId);
    if (next) {
      addWeek(`film school, ${course.code}`, {
        tmdbId: next.tmdbId, title: next.title, year: next.year, poster: next.poster,
        tmdb: next.tmdb ? { rating: next.tmdb } : null, runtime: null, genres: [],
        imdb: null, why: next.why,
      });
      break;
    }
  }
  addWeek('off your watchlist', shelves.watchlistFirst[0]);
  addWeek('terra incognita', shelves.gapFillers[0]);
  addWeek('for you', shelves.forYou[0]);
  shelves.seasonPass = seasonPass.slice(0, 4);

  const total = Object.values(shelves)
    .reduce((s, x) => s + (Array.isArray(x) ? x.length : (x?.films?.length || 0)), 0);
  buildRecs._lastKey = key; // reused by the optional two-seater pass
  console.log(`  recs: ${total} cards+rows across ${Object.keys(shelves).length} groups (IMDb joined for ${ratingsMap.size}, ${franchises.length} unfinished franchises${shelves.spotlight ? `, spotlight: ${shelves.spotlight.name}` : ''}).`);
  return shelves;
}

// ---------------------------------------------------------------------------
// Two-seater (dormant until used): build a joint shelf from a second person's
// export. `node tools/build-vault.mjs ./export --second ./export-them
// --second-name "R"` — films neither has seen, seeded by what BOTH loved,
// plus overlap stats. Renders on the Next page only when present.
// ---------------------------------------------------------------------------
export async function buildTwoSeater(src1, src2, name2, key) {
  const { seedWeight, aggregate, normTitle } = await import('../lib/recs.js');
  const { filmKey } = await import('../lib/insights.js');

  const norm = (w) => `${normTitle(w.name)} ${w.year}`;
  const aWatched = new Set([...(src1.watched || []), ...(src1.diary || [])].map(norm));
  const bWatched = new Set([...(src2.watched || []), ...(src2.diary || [])].map(norm));

  // overlap stats
  let common = 0;
  for (const k of bWatched) if (aWatched.has(k)) common++;
  const aR = new Map((src1.ratings || []).map((r) => [norm(r), r.rating]));
  const shared = (src2.ratings || []).filter((r) => aR.has(norm(r)));
  let corr = null;
  if (shared.length >= 8) {
    const xs = shared.map((r) => aR.get(norm(r)));
    const ys = shared.map((r) => r.rating);
    const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    const mx = mean(xs); const my = mean(ys);
    let num = 0; let dx = 0; let dy = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      dx += (xs[i] - mx) ** 2;
      dy += (ys[i] - my) ** 2;
    }
    corr = dx && dy ? Math.round((num / Math.sqrt(dx * dy)) * 100) / 100 : null;
  }

  // seeds loved by either (shared loves weigh double via both entries)
  const films1 = src1.films || {};
  const seeds = [];
  for (const r of (src1.ratings || [])) {
    const f = films1[filmKey(r.name, r.year)];
    if (f?.tmdbId && seedWeight(r.rating) >= 1) seeds.push({ name: r.name, tmdbId: f.tmdbId, weight: seedWeight(r.rating) });
  }
  let searched = 0;
  for (const r of (src2.ratings || [])) {
    if (seedWeight(r.rating) < 1.5 || searched >= 15) continue;
    const k = filmKey(r.name, r.year);
    const f = films1[k];
    if (f?.tmdbId) { seeds.push({ name: r.name, tmdbId: f.tmdbId, weight: seedWeight(r.rating) }); continue; }
    const s = await tmdb('/search/movie', { query: r.name, primary_release_year: r.year || '' }, key);
    await sleep(90);
    searched++;
    if (s?.results?.[0]) seeds.push({ name: r.name, tmdbId: s.results[0].id, weight: seedWeight(r.rating) });
  }
  seeds.sort((a, b) => b.weight - a.weight);

  const exclude = new Set([...aWatched, ...bWatched,
    ...(src1.watchlist || []).map(norm), ...(src2.watchlist || []).map(norm)]);
  const lists = [];
  for (const s of seeds.slice(0, 40)) {
    const r = await tmdb(`/movie/${s.tmdbId}/recommendations`, {}, key);
    await sleep(90);
    lists.push({
      seed: { title: s.name, weight: s.weight },
      items: (r?.results || []).map((it) => ({
        id: it.id, title: it.title, year: (it.release_date || '').slice(0, 4),
        vote_average: it.vote_average, vote_count: it.vote_count, poster_path: it.poster_path,
      })),
    });
  }
  const top = aggregate(lists, { exclude, limit: 16 })
    .filter((c) => (c.vote_average || 0) >= 7.2)
    .slice(0, 12);
  const cards = await toCards(top, key, (it) => (it.seeds?.length ? `for both of you · via ${it.seeds[0]}` : 'for both of you'));
  cards.forEach((c) => delete c.imdbId);
  return { name2, stats: { common, corr }, cards };
}
