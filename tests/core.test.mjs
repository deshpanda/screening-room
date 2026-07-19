import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseCsvObjects } from '../lib/csv.js';
import { encryptVault, decryptVault, envelopeSalt, deriveKeyBytes, decryptWithKeyBytes } from '../lib/vaultcrypto.js';
import { computeInsights, filmKey } from '../lib/insights.js';

// ---------- CSV ----------

test('csv: quoted fields with commas, escaped quotes, CRLF', () => {
  const text = 'Name,Year\r\n"Love, Actually",2003\r\n"He said ""hi""",1999\r\n';
  const rows = parseCsv(text);
  assert.deepEqual(rows[1], ['Love, Actually', '2003']);
  assert.deepEqual(rows[2], ['He said "hi"', '1999']);
});

test('csv: newline inside a quoted field', () => {
  const rows = parseCsv('A,B\n"line1\nline2",x\n');
  assert.equal(rows[1][0], 'line1\nline2');
});

test('csv: objects keyed by header', () => {
  const objs = parseCsvObjects('Date,Name,Year\n2026-01-02,Heat,1995\n');
  assert.deepEqual(objs[0], { Date: '2026-01-02', Name: 'Heat', Year: '1995' });
});

// ---------- vault crypto ----------

test('vault: encrypt/decrypt round-trip', async () => {
  const secret = { films: 1234, note: 'नमस्ते — फ़िल्में' };
  const env = await encryptVault(secret, 'correct horse battery staple');
  const back = await decryptVault(env, 'correct horse battery staple');
  assert.deepEqual(back, secret);
});

test('vault: wrong passphrase throws', async () => {
  const env = await encryptVault({ a: 1 }, 'right');
  await assert.rejects(() => decryptVault(env, 'wrong'));
});

test('vault: tampered ciphertext throws (GCM auth)', async () => {
  const env = await encryptVault({ a: 1 }, 'pw');
  const bytes = Buffer.from(env, 'base64');
  bytes[bytes.length - 1] ^= 0xff;
  await assert.rejects(() => decryptVault(bytes.toString('base64'), 'pw'));
});

test('vault: session-restore path via derived key bytes', async () => {
  const env = await encryptVault({ ok: true }, 'pw');
  const key = await deriveKeyBytes('pw', envelopeSalt(env));
  const back = await decryptWithKeyBytes(env, key);
  assert.deepEqual(back, { ok: true });
});

// ---------- insights ----------

function fixture() {
  const diary = [
    { name: 'Heat', year: '1995', rating: 5, watchedDate: '2026-01-01', rewatch: false },
    { name: 'Drive', year: '2011', rating: 4.5, watchedDate: '2026-01-02', rewatch: false },
    { name: 'Heat', year: '1995', rating: 5, watchedDate: '2026-01-03', rewatch: true },
    { name: 'Ratatouille', year: '2007', rating: 4, watchedDate: '2026-01-03', rewatch: false },
    { name: 'Stalker', year: '1979', rating: 4.5, watchedDate: '2026-02-10', rewatch: false },
  ];
  const watched = [
    { name: 'Heat', year: '1995' },
    { name: 'Drive', year: '2011' },
    { name: 'Ratatouille', year: '2007' },
    { name: 'Stalker', year: '1979' },
    { name: 'Old Unlogged Film', year: '1960' },
  ];
  const ratings = [
    { name: 'Heat', year: '1995', rating: 5 },
    { name: 'Drive', year: '2011', rating: 4.5 },
    { name: 'Ratatouille', year: '2007', rating: 4 },
    { name: 'Stalker', year: '1979', rating: 4.5 },
  ];
  const films = {
    [filmKey('Heat', '1995')]: { genres: ['Crime', 'Drama'], runtime: 170, director: 'Michael Mann', cast: ['Al Pacino', 'Robert De Niro'], countries: ['United States'], language: 'en', tmdbRating: 8.0, popularity: 60 },
    [filmKey('Drive', '2011')]: { genres: ['Crime', 'Drama'], runtime: 100, director: 'Nicolas Winding Refn', cast: ['Ryan Gosling'], countries: ['United States'], language: 'en', tmdbRating: 7.6, popularity: 45 },
    [filmKey('Ratatouille', '2007')]: { genres: ['Animation', 'Comedy'], runtime: 111, director: 'Brad Bird', cast: [], countries: ['United States'], language: 'en', tmdbRating: 7.8, popularity: 80 },
    [filmKey('Stalker', '1979')]: { genres: ['Drama', 'Science Fiction'], runtime: 162, director: 'Andrei Tarkovsky', cast: [], countries: ['Soviet Union'], language: 'ru', tmdbRating: 8.1, popularity: 6 },
  };
  return { diary, watched, ratings, films, watchlistCount: 42, displayName: 'S' };
}

test('insights: totals count unique films, rewatches and exact minutes', () => {
  const r = computeInsights(fixture());
  assert.equal(r.totals.uniqueFilms, 5);
  assert.equal(r.totals.diaryEntries, 5);
  assert.equal(r.totals.rewatches, 1);
  // minutes: 170+100+170+111+162 = 713 → 12h (rounded)
  assert.equal(r.totals.hours, Math.round(713 / 60));
  assert.equal(r.totals.avgRating, 4.5);
  assert.equal(r.totals.watchlistCount, 42);
});

test('insights: composition counts each unique film once', () => {
  const r = computeInsights(fixture());
  const crime = r.genres.find((g) => g.name === 'Crime');
  assert.equal(crime.count, 2); // Heat once (despite rewatch) + Drive
  assert.equal(crime.avgRating, 4.75);
  const mann = r.directors.find((d) => d.name === 'Michael Mann');
  assert.equal(mann.count, 1);
});

test('insights: streaks and busiest day', () => {
  const r = computeInsights(fixture());
  assert.equal(r.streaks.longestDays, 3); // Jan 1-2-3
  assert.deepEqual(r.streaks.busiestDay, { date: '2026-01-03', count: 2 });
  assert.equal(r.streaks.busiestMonth.month, '2026-01');
});

test('insights: contrarian index against TMDB', () => {
  const r = computeInsights(fixture());
  // deltas: Heat 5−4=+1, Drive 4.5−3.8=+0.7, Ratatouille 4−3.9=+0.1, Stalker 4.5−4.05=+0.45
  assert.equal(r.contrarian.rated, 4);
  assert.ok(Math.abs(r.contrarian.avgDelta - 0.56) < 0.011, String(r.contrarian.avgDelta));
  assert.equal(r.contrarian.mostOver.title, 'Heat');
});

test('insights: decades, deep cuts and milestones', () => {
  const r = computeInsights(fixture());
  assert.deepEqual(r.decades.map((d) => d.name), ['1960s', '1970s', '1990s', '2000s', '2010s']);
  assert.equal(r.deepCuts.pct, 25); // Stalker of the 4 enriched
  assert.equal(r.milestones[0].n, 1);
  assert.equal(r.milestones[0].title, 'Heat');
});

test('insights: ratings histogram buckets', () => {
  const r = computeInsights(fixture());
  assert.equal(r.ratingsHist[5], 1);
  assert.equal(r.ratingsHist[4.5], 2);
  assert.equal(r.ratingsHist[4], 1);
});

test('insights: heatmapYears covers each calendar year, clipped to the last watch', () => {
  const r = computeInsights(fixture());
  assert.equal(r.heatmapYears.length, 1);
  const y = r.heatmapYears[0];
  assert.equal(y.year, '2026');
  assert.equal(y.count, 5);
  // Jan 1 .. Feb 10 = 41 days
  assert.equal(Object.keys(y.byDate).length, 41);
  assert.equal(y.byDate['2026-01-03'], 2);
  assert.equal(y.byDate['2026-01-04'], 0);
});

test('insights: comfort reels count multiple watches of the same film', () => {
  const r = computeInsights(fixture());
  assert.deepEqual(r.rewatchTop, [{ name: 'Heat', year: '1995', count: 2 }]);
});

test('insights: runtime buckets over unique enriched films', () => {
  const r = computeInsights(fixture());
  const by = Object.fromEntries(r.runtimeBuckets.map((b) => [b.label, b.count]));
  assert.equal(by['90–120m'], 2);  // Drive 100, Ratatouille 111
  assert.equal(by['150–180m'], 2); // Heat 170, Stalker 162
  assert.equal(by['Under 90m'], 0);
});

test('insights: the great drought is the longest gap between watch dates', () => {
  const r = computeInsights(fixture());
  assert.equal(r.drought.days, 37); // Jan 3 → Feb 10
  assert.equal(r.drought.from, '2026-01-03');
});

test('insights: pace exists with a next-milestone estimate', () => {
  const r = computeInsights(fixture());
  assert.equal(r.pace.perWeek, 0.1);
  assert.equal(r.pace.nextMilestone.n, 100);
});

test('insights: ledger is the full diary, newest first', () => {
  const r = computeInsights(fixture());
  assert.equal(r.ledger.length, 5);
  assert.equal(r.ledger[0].t, 'Stalker');
  assert.equal(r.ledger[4].t, 'Heat');
  assert.equal(r.ledger[2].w, true); // the Heat rewatch on Jan 3
});

test('insights: median release year and film age', () => {
  const data = { ...fixture(), generatedAt: '2026-07-20' };
  const r = computeInsights(data);
  assert.equal(r.medianReleaseYear, 1995); // 1960,1979,[1995],2007,2011
  assert.equal(r.avgFilmAge, Math.round(2026 - (1960 + 1979 + 1995 + 2007 + 2011) / 5));
});

test('insights: empty input does not crash', () => {
  const r = computeInsights({ diary: [], watched: [], ratings: [], films: {} });
  assert.equal(r.totals.uniqueFilms, 0);
  assert.equal(r.contrarian, null);
  assert.deepEqual(r.heatmapYears, []);
  assert.equal(r.pace, null);
  assert.equal(r.drought, null);
});
