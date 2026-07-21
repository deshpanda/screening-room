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

  // Heatmaps: one full calendar year per strip, since the first logged film.
  const heatmapYears = [];
  if (diary.length) {
    const firstYear = +diary[0].watchedDate.slice(0, 4);
    const lastDate = diary[diary.length - 1].watchedDate;
    const lastYear = +lastDate.slice(0, 4);
    for (let y = lastYear; y >= firstYear; y--) {
      const byD = {};
      const endT = Date.parse((y === lastYear ? lastDate : `${y}-12-31`) + 'T12:00:00Z');
      const d = new Date(`${y}-01-01T12:00:00Z`);
      while (d.getTime() <= endT) {
        const key = d.toISOString().slice(0, 10);
        byD[key] = byDate.get(key) || 0;
        d.setUTCDate(d.getUTCDate() + 1);
      }
      heatmapYears.push({ year: String(y), byDate: byD, count: perYearMap.get(String(y))?.count || 0 });
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
  const countryFilms = {};
  const releaseYears = new Map();

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
    for (const c of f.countries || []) {
      inc(countryCount, c);
      if (!countryFilms[c]) countryFilms[c] = [];
      countryFilms[c].push({ t: name, y: year, r: rating || null });
    }
    inc(languageCount, f.language);

    // release-year census for the century strip
    const ry = Number(year);
    if (ry >= 1895) {
      if (!releaseYears.has(ry)) releaseYears.set(ry, { y: ry, n: 0, top: null, topR: -1 });
      const bucket = releaseYears.get(ry);
      bucket.n++;
      if ((rating || 0) > bucket.topR) { bucket.topR = rating || 0; bucket.top = name; }
    }

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

  // TMDB id lookup (powers Letterboxd links: letterboxd.com/tmdb/<id>)
  const tidOf = (name, year) => films[filmKey(name, year)]?.tmdbId || null;

  // ---- comfort reels: most-rewatched films -----------------------------------
  const watchCounts = new Map();
  for (const d of diary) inc(watchCounts, filmKey(d.name, d.year));
  const rewatchTop = [...watchCounts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, count]) => {
      const [name, year] = k.split('|');
      return { name, year, count, tid: tidOf(name, year) };
    });

  // ---- attention span: runtime buckets over unique enriched films ------------
  const bucketDefs = [
    ['Under 90m', 90], ['90–120m', 120], ['120–150m', 150], ['150–180m', 180], ['180m+', Infinity],
  ];
  const runtimeBuckets = bucketDefs.map(([label]) => ({ label, count: 0 }));
  for (const key of uniqueKeys) {
    const f = films[key];
    if (!f || !(f.runtime > 0)) continue;
    const i = bucketDefs.findIndex(([, cap]) => f.runtime < cap);
    runtimeBuckets[i].count++;
  }

  // ---- pace: films/week, projection, next milestone ---------------------------
  let pace = null;
  if (diary.length >= 5) {
    const lastT = Date.parse(diary[diary.length - 1].watchedDate + 'T12:00:00Z');
    const cutoff = lastT - 365 * 86400000;
    const recentCount = diary.filter((d) => Date.parse(d.watchedDate + 'T12:00:00Z') > cutoff).length;
    const perWeek = recentCount / 52.14;
    const curYear = diary[diary.length - 1].watchedDate.slice(0, 4);
    const weeksElapsed = (lastT - Date.parse(`${curYear}-01-01T12:00:00Z`)) / (7 * 86400000) + 0.01;
    const thisYearCount = perYearMap.get(curYear)?.count || 0;
    const projected = weeksElapsed > 1 ? Math.round((thisYearCount / weeksElapsed) * 52.14) : null;
    let nextMilestone = null;
    const nextN = [100, 250, 500, 750, 1000, 1500, 2000, 3000, 5000].find((m) => m > diary.length);
    if (nextN && perWeek > 0) {
      const eta = new Date(lastT + ((nextN - diary.length) / perWeek) * 7 * 86400000);
      nextMilestone = { n: nextN, eta: eta.toISOString().slice(0, 7) };
    }
    pace = { perWeek: round1(perWeek), projectedThisYear: projected, year: curYear, nextMilestone };
  }

  // ---- the great drought: longest gap between watch dates ---------------------
  let drought = null;
  for (let i = 1; i < dates.length; i++) {
    const gap = Math.round((Date.parse(dates[i] + 'T12:00:00Z') - Date.parse(dates[i - 1] + 'T12:00:00Z')) / 86400000) - 1;
    if (!drought || gap > drought.days) drought = { days: gap, from: dates[i - 1], to: dates[i] };
  }
  if (drought && drought.days < 3) drought = null;

  // ---- ratings drift: this year vs lifetime ------------------------------------
  let ratingsDrift = null;
  if (avgRating && diary.length) {
    const curYear = diary[diary.length - 1].watchedDate.slice(0, 4);
    const py = perYearMap.get(curYear);
    if (py && py.rated >= 10) {
      const yearAvg = round2(py.ratingSum / py.rated);
      ratingsDrift = { year: curYear, yearAvg, overall: avgRating, delta: round2(yearAvg - avgRating) };
    }
  }

  // ---- same week, other years ---------------------------------------------------
  const thisWeek = [];
  if (data.generatedAt) {
    const ref = new Date(data.generatedAt + 'T12:00:00Z');
    const refYear = ref.getUTCFullYear();
    for (const d of diary) {
      if (+d.watchedDate.slice(0, 4) >= refYear) continue;
      const dd = new Date(d.watchedDate + 'T12:00:00Z');
      const a = Date.UTC(2000, ref.getUTCMonth(), ref.getUTCDate());
      const b = Date.UTC(2000, dd.getUTCMonth(), dd.getUTCDate());
      let diff = Math.abs(a - b) / 86400000;
      diff = Math.min(diff, 366 - diff);
      if (diff <= 3) thisWeek.push({ title: d.name, year: d.year, date: d.watchedDate, rating: d.rating || null });
    }
    thisWeek.reverse();
  }

  // ---- film age -------------------------------------------------------------------
  const relYears = [...uniqueKeys].map((k) => +k.split('|')[1]).filter((y) => y > 1880).sort((a, b) => a - b);
  const medianReleaseYear = relYears.length ? relYears[Math.floor(relYears.length / 2)] : null;
  const nowYear = data.generatedAt ? +data.generatedAt.slice(0, 4)
    : (diary.length ? +diary[diary.length - 1].watchedDate.slice(0, 4) : null);
  const avgFilmAge = relYears.length && nowYear
    ? Math.round(nowYear - relYears.reduce((s, y) => s + y, 0) / relYears.length)
    : null;

  // ---- year in review (one wrapped card per year) -----------------------------------
  const yearReviews = [];
  for (const [year, py] of perYearMap) {
    const yearDiary = diary.filter((d) => d.watchedDate.startsWith(year));
    const gCount = new Map();
    const dCount = new Map();
    const seenK = new Set();
    let best = null;
    let harshest = null;
    for (const d of yearDiary) {
      const k = filmKey(d.name, d.year);
      const f = films[k];
      if (f && !seenK.has(k)) {
        seenK.add(k);
        for (const g of f.genres || []) inc(gCount, g);
        if (f.director) inc(dCount, f.director);
      }
      if (d.rating > 0) {
        if (!best || d.rating > best.r) best = { t: d.name, y: d.year, r: d.rating, tid: tidOf(d.name, d.year) };
        if (!harshest || d.rating < harshest.r) harshest = { t: d.name, y: d.year, r: d.rating, tid: tidOf(d.name, d.year) };
      }
    }
    const topOf = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    yearReviews.push({
      year,
      films: py.count,
      hours: Math.round(py.minutes / 60),
      avgRating: py.rated ? round2(py.ratingSum / py.rated) : null,
      rewatches: yearDiary.filter((d) => d.rewatch).length,
      topGenre: topOf(gCount),
      topDirector: topOf(dCount),
      bestFilm: best,
      harshest,
    });
  }
  yearReviews.sort((a, b) => (a.year < b.year ? 1 : -1));

  // ---- calibration: your rating vs the crowd's, per film ------------------------------
  const calibration = [];
  for (const key of uniqueKeys) {
    const f = films[key];
    const r = ratingByKey.get(key);
    if (f?.tmdbRating > 0 && r > 0) {
      const [name, year] = key.split('|');
      calibration.push({ t: name, y: year, mine: r, crowd: round1(f.tmdbRating / 2), tid: f.tmdbId || null });
    }
  }

  // ---- terra incognita: genre × decade coverage matrix -------------------------------
  let genreDecadeMatrix = null;
  {
    const topGenres = [...genreCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([g]) => g);
    const decadesAll = [...decadeCount.keys()].filter(Boolean).sort();
    if (topGenres.length && decadesAll.length) {
      const dMin = parseInt(decadesAll[0]);
      const dMax = parseInt(decadesAll[decadesAll.length - 1]);
      const decades = [];
      for (let d = dMin; d <= dMax; d += 10) decades.push(`${d}s`);
      const idxG = new Map(topGenres.map((g, i) => [g, i]));
      const idxD = new Map(decades.map((d, i) => [d, i]));
      const cells = topGenres.map(() => decades.map(() => 0));
      for (const key of uniqueKeys) {
        const [, year] = key.split('|');
        const dec = year && year.length === 4 ? `${year.slice(0, 3)}0s` : null;
        const f = films[key];
        if (!f || !idxD.has(dec)) continue;
        for (const g of f.genres || []) {
          if (idxG.has(g)) cells[idxG.get(g)][idxD.get(dec)]++;
        }
      }
      genreDecadeMatrix = { genres: topGenres, decades, cells };
    }
  }

  // ---- the archive: the full diary, newest first -----------------------------------
  const ledger = [...diary].reverse().map((d) => ({
    t: d.name, y: d.year, d: d.watchedDate, r: d.rating || null, w: !!d.rewatch,
    id: tidOf(d.name, d.year),
  }));

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
    rating: d.rating || null, rewatch: !!d.rewatch, tid: tidOf(d.name, d.year),
  }));
  const fiveStar = ratings.filter((r) => r.rating === 5)
    .map((r) => ({
      title: r.name, year: r.year, tid: tidOf(r.name, r.year),
      poster: films[filmKey(r.name, r.year)]?.poster || null,
    }));

  // poster walls by rating tier (only tiers with enough art to hang)
  const wallTiers = [];
  for (const tier of [5, 4.5, 4]) {
    const tierFilms = ratings.filter((x) => x.rating === tier)
      .map((x) => ({
        title: x.name, year: x.year, tid: tidOf(x.name, x.year),
        poster: films[filmKey(x.name, x.year)]?.poster || null,
      }))
      .filter((f) => f.poster);
    if (tierFilms.length >= 3) wallTiers.push({ r: tier, films: tierFilms });
  }

  // ---- the margins: the owner's own reviews, newest first -----------------------
  const reviews = [...(data.reviews || [])]
    .sort((a, b) => (a.watchedDate < b.watchedDate ? 1 : -1))
    .map((r) => ({
      t: r.name, y: r.year, d: r.watchedDate, r: r.rating || null,
      tid: tidOf(r.name, r.year), text: r.text,
    }));

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
    heatmapYears,
    dayOfWeek,
    monthCounts,
    streaks: { longestDays: longestStreak, streakEnd, busiestDay, busiestMonth },
    ratingsHist,
    genres: top(genreCount, 12, avgOf(genreRating)),
    directors: top(directorCount, 12, avgOf(directorRating)),
    actors: top(actorCount, 12),
    decades: [...decadeCount.entries()].sort().map(([name, count]) => ({ name, count, ...avgOf(decadeRating)(name) })),
    countries: top(countryCount, 10),
    countryFilms: Object.fromEntries(Object.entries(countryFilms).map(
      ([c, list]) => [c, list.sort((a, b) => (b.r || 0) - (a.r || 0))],
    )),
    releaseYears: [...releaseYears.values()].sort((a, b) => a.y - b.y)
      .map(({ y, n, top: t }) => ({ y, n, top: t })),
    languages: top(languageCount, 8),
    runtime: { longest, shortest },
    contrarian: deltaN
      ? { avgDelta: round2(deltaSum / deltaN), rated: deltaN, mostOver, mostUnder }
      : null,
    deepCuts: popularityN ? { pct: Math.round((deepCuts / popularityN) * 100), of: popularityN } : null,
    milestones,
    recent,
    fiveStar: fiveStar.slice(0, 12),
    rewatchTop,
    runtimeBuckets,
    pace,
    drought,
    ratingsDrift,
    thisWeek,
    medianReleaseYear,
    avgFilmAge,
    ledger,
    yearReviews,
    calibration,
    genreDecadeMatrix,
    reviews,
    wallTiers,
  };
}
