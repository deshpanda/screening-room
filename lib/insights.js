// The insights engine. Pure: normalized Letterboxd-export rows + an
// enrichment map in, one self-contained insights object out. Runs at build
// time (tools/build-vault.mjs); the browser only ever renders its output.
//
// Composition stats (genres, directors, decades, countries…) count each
// UNIQUE film once. Time stats (per-year, heatmap, streaks…) use diary
// entries, so rewatches count as watches.

const FALLBACK_RUNTIME = 110; // used only for films TMDB couldn't enrich

export const filmKey = (name, year) => `${name}|${year}`;

function top(counter, n, extra = () => ({})) {
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count, ...extra(name) }));
}

function inc(map, key, by = 1) {
  if (key === undefined || key === null || key === '') return;
  map.set(key, (map.get(key) || 0) + by);
}

function round1(x) { return Math.round(x * 10) / 10; }
function round2(x) { return Math.round(x * 100) / 100; }

/**
 * @param {object} data
 *   diary          [{name, year, rating|null, watchedDate 'YYYY-MM-DD', rewatch}]
 *   watched        [{name, year}]
 *   ratings        [{name, year, rating}]
 *   watchlistCount number
 *   films          { key → {genres[], runtime, director, cast[], countries[],
 *                   language, tmdbRating, popularity} } (may be sparse/empty)
 *   displayName    shown in the dashboard greeting
 */
export function computeInsights(data) {
  const diary = [...(data.diary || [])].sort((a, b) => a.watchedDate < b.watchedDate ? -1 : 1);
  const watched = data.watched || [];
  const ratings = data.ratings || [];
  const films = data.films || {};
  const ratingByKey = new Map(ratings.map((r) => [filmKey(r.name, r.year), r.rating]));

  // ---- totals -------------------------------------------------------------
  const uniqueKeys = new Set(watched.map((w) => filmKey(w.name, w.year)));
  for (const d of diary) uniqueKeys.add(filmKey(d.name, d.year));
  const rewatches = diary.filter((d) => d.rewatch).length;

  let minutes = 0;
  let estimatedRuntimes = 0;
  for (const d of diary) {
    const f = films[filmKey(d.name, d.year)];
    if (f && f.runtime > 0) minutes += f.runtime;
    else { minutes += FALLBACK_RUNTIME; estimatedRuntimes++; }
  }

  const ratedValues = ratings.map((r) => r.rating).filter((x) => x > 0);
  const avgRating = ratedValues.length
    ? round2(ratedValues.reduce((s, x) => s + x, 0) / ratedValues.length)
    : null;

  // ---- time-based ---------------------------------------------------------
  const perYearMap = new Map();
  const dayOfWeek = Array(7).fill(0); // 0 = Monday
  const monthCounts = Array(12).fill(0);
  const byDate = new Map();
  for (const d of diary) {
    const y = d.watchedDate.slice(0, 4);
    if (!perYearMap.has(y)) perYearMap.set(y, { count: 0, ratingSum: 0, rated: 0, minutes: 0 });
    const py = perYearMap.get(y);
    py.count++;
    if (d.rating > 0) { py.ratingSum += d.rating; py.rated++; }
    const f = films[filmKey(d.name, d.year)];
    py.minutes += f && f.runtime > 0 ? f.runtime : FALLBACK_RUNTIME;

    const dt = new Date(d.watchedDate + 'T12:00:00Z');
    dayOfWeek[(dt.getUTCDay() + 6) % 7]++;
    monthCounts[dt.getUTCMonth()]++;
    inc(byDate, d.watchedDate);
  }
  const perYear = [...perYearMap.entries()]
    .sort((a, b) => a[0] < b[0] ? -1 : 1)
    .map(([year, v]) => ({
      year,
      count: v.count,
      hours: Math.round(v.minutes / 60),
      avgRating: v.rated ? round2(v.ratingSum / v.rated) : null,
    }));

  // Heatmap: last 53 weeks of daily counts.
  const heatmap = {};
  if (diary.length) {
    const last = diary[diary.length - 1].watchedDate;
    const end = new Date(last + 'T12:00:00Z');
    for (let i = 0; i < 371; i++) {
      const d = new Date(end);
      d.setUTCDate(end.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      heatmap[key] = byDate.get(key) || 0;
    }
  }

  // Streaks.
  const dates = [...byDate.keys()].sort();
  let longestStreak = 0, streakEnd = null, cur = 0, prev = null;
  for (const ds of dates) {
    const t = Date.parse(ds + 'T12:00:00Z');
    cur = prev !== null && t - prev === 86400000 ? cur + 1 : 1;
    if (cur > longestStreak) { longestStreak = cur; streakEnd = ds; }
    prev = t;
  }
  let busiestDay = null;
  for (const [ds, n] of byDate) if (!busiestDay || n > busiestDay.count) busiestDay = { date: ds, count: n };
  const byMonth = new Map();
  for (const d of diary) inc(byMonth, d.watchedDate.slice(0, 7));
  let busiestMonth = null;
  for (const [m, n] of byMonth) if (!busiestMonth || n > busiestMonth.count) busiestMonth = { month: m, count: n };

  // ---- ratings histogram ---------------------------------------------------
  const ratingsHist = {};
  for (let r = 0.5; r <= 5; r += 0.5) ratingsHist[r] = 0;
  for (const v of ratedValues) if (ratingsHist[v] !== undefined) ratingsHist[v]++;

  // ---- composition over unique films ---------------------------------------
  const genreCount = new Map(); const genreRating = new Map();
  const directorCount = new Map(); const directorRating = new Map();
  const actorCount = new Map();
  const decadeCount = new Map(); const decadeRating = new Map();
  const countryCount = new Map(); const languageCount = new Map();
  let enriched = 0;
  let longest = null, shortest = null;
  let deltaSum = 0, deltaN = 0, mostOver = null, mostUnder = null;
  let deepCuts = 0, popularityN = 0;

  for (const key of uniqueKeys) {
    const [name, year] = key.split('|');
    const rating = ratingByKey.get(key);
    const decade = year && year.length === 4 ? `${year.slice(0, 3)}0s` : null;
    inc(decadeCount, decade);
    if (rating > 0 && decade) {
      if (!decadeRating.has(decade)) decadeRating.set(decade, []);
      decadeRating.get(decade).push(rating);
    }

    const f = films[key];
    if (!f) continue;
    enriched++;
    for (const g of f.genres || []) {
      inc(genreCount, g);
      if (rating > 0) {
        if (!genreRating.has(g)) genreRating.set(g, []);
        genreRating.get(g).push(rating);
      }
    }
    if (f.director) {
      inc(directorCount, f.director);
      if (rating > 0) {
        if (!directorRating.has(f.director)) directorRating.set(f.director, []);
        directorRating.get(f.director).push(rating);
      }
    }
    for (const a of (f.cast || []).slice(0, 4)) inc(actorCount, a);
    for (const c of f.countries || []) inc(countryCount, c);
    inc(languageCount, f.language);

    if (f.runtime > 0) {
      if (!longest || f.runtime > longest.minutes) longest = { title: name, year, minutes: f.runtime };
      if (!shortest || f.runtime < shortest.minutes) shortest = { title: name, year, minutes: f.runtime };
    }
    if (f.tmdbRating > 0 && rating > 0) {
      const delta = round2(rating - f.tmdbRating / 2);
      deltaSum += delta; deltaN++;
      if (!mostOver || delta > mostOver.delta) mostOver = { title: name, year, delta, mine: rating, tmdb: round1(f.tmdbRating / 2) };
      if (!mostUnder || delta < mostUnder.delta) mostUnder = { title: name, year, delta, mine: rating, tmdb: round1(f.tmdbRating / 2) };
    }
    if (typeof f.popularity === 'number') {
      popularityN++;
      if (f.popularity < 10) deepCuts++;
    }
  }

  const avgOf = (m) => (name) => {
    const arr = m.get(name);
    return { avgRating: arr && arr.length ? round2(arr.reduce((s, x) => s + x, 0) / arr.length) : null };
  };

  // ---- milestones + recents -------------------------------------------------
  const milestones = [];
  for (const n of [1, 50, 100, 250, 500, 750, 1000, 1500, 2000]) {
    if (diary.length >= n) {
      const e = diary[n - 1];
      milestones.push({ n, title: e.name, year: e.year, date: e.watchedDate });
    }
  }
  const recent = [...diary].reverse().slice(0, 15).map((d) => ({
    title: d.name, year: d.year, date: d.watchedDate,
    rating: d.rating || null, rewatch: !!d.rewatch,
  }));
  const fiveStar = ratings.filter((r) => r.rating === 5).map((r) => ({ title: r.name, year: r.year }));

  return {
    displayName: data.displayName || '',
    generatedAt: data.generatedAt || null,
    totals: {
      uniqueFilms: uniqueKeys.size,
      diaryEntries: diary.length,
      rewatches,
      hours: Math.round(minutes / 60),
      avgRating,
      ratedCount: ratedValues.length,
      estimatedRuntimes,
      watchlistCount: data.watchlistCount || 0,
      enrichedFilms: enriched,
    },
    perYear,
    heatmap,
    dayOfWeek,
    monthCounts,
    streaks: { longestDays: longestStreak, streakEnd, busiestDay, busiestMonth },
    ratingsHist,
    genres: top(genreCount, 12, avgOf(genreRating)),
    directors: top(directorCount, 12, avgOf(directorRating)),
    actors: top(actorCount, 12),
    decades: [...decadeCount.entries()].sort().map(([name, count]) => ({ name, count, ...avgOf(decadeRating)(name) })),
    countries: top(countryCount, 10),
    languages: top(languageCount, 8),
    runtime: { longest, shortest },
    contrarian: deltaN
      ? { avgDelta: round2(deltaSum / deltaN), rated: deltaN, mostOver, mostUnder }
      : null,
    deepCuts: popularityN ? { pct: Math.round((deepCuts / popularityN) * 100), of: popularityN } : null,
    milestones,
    recent,
    fiveStar: fiveStar.slice(0, 12),
  };
}
