// Gate + page orchestration. The vault is fetched as ciphertext and decrypted
// only here, in the visitor's browser. The derived key (not the passphrase)
// sits in sessionStorage, so the unlock carries across the site's pages in
// the same tab; Lock clears it everywhere.
//
// The dashboard is four pages, each rendering a slice of the same decrypted
// vault: overview (this file's home), stats/, next/, archive/.

import { decryptWithKeyBytes, deriveKeyBytes, envelopeSalt, b64 } from '../lib/vaultcrypto.js';
import {
  h, initTip, stars, vBars, hBars, heatmap, ranked, callout, tile, block,
  resetBlockCounter, scatterChart, worldMap, centuryStrip,
} from '../lib/render.js';
import { READING_SHELF, THEORY_SHELF, LEXICON, METHOD } from '../lib/recs.js';

const PAGE = document.body.dataset.page || 'overview';
const BASE = PAGE === 'overview' ? '' : '../';
const KEY_SLOT = 'sr-key';
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
const YEAR_WEEKS = 54; // one shared grid for every year strip

// Letterboxd's stable per-TMDB-id redirect — links a film without knowing its slug.
const lbUrl = (tid) => `https://letterboxd.com/tmdb/${tid}`;
// Director pages use diacritic-stripped kebab slugs (verified: kieślowski→kieslowski, ozu, wong-kar-wai).
const dirUrl = (name) => 'https://letterboxd.com/director/'
  + name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '/';
function filmLink(tid, text, cls) {
  if (!tid) return h('span', cls, text);
  const a = h('a', cls ? cls + ' film-link' : 'film-link', text);
  a.href = lbUrl(tid);
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

const root = document.getElementById('root');
let envelope = null;

async function main() {
  initTip();
  const res = await fetch(BASE + 'data/vault.enc', { cache: 'no-store' });
  envelope = (await res.text()).trim();

  const cached = sessionStorage.getItem(KEY_SLOT);
  if (cached) {
    try {
      const insights = await decryptWithKeyBytes(envelope, b64.from(cached));
      return renderPage(insights);
    } catch { sessionStorage.removeItem(KEY_SLOT); }
  }
  renderGate();
}

// ---------- gate ----------
function renderGate(message = '') {
  root.innerHTML = '';
  const gate = h('div', 'gate');
  const card = h('div', 'gate-card');
  card.appendChild(h('div', 'reel', '● ● ●'));
  card.appendChild(h('h1', null, 'The Screening Room'));
  card.appendChild(h('p', 'tag', 'Private screening · members only'));

  const form = h('form', 'gate-form');
  const input = h('input');
  input.type = 'password';
  input.placeholder = 'passphrase';
  input.autocomplete = 'current-password';
  input.setAttribute('aria-label', 'Vault passphrase');
  const btn = h('button', null, 'Roll film');
  const err = h('p', 'gate-error', message);
  form.appendChild(input);
  form.appendChild(btn);
  form.appendChild(err);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.textContent = 'Unlocking…';
    btn.disabled = true;
    try {
      const key = await deriveKeyBytes(input.value, envelopeSalt(envelope));
      const insights = await decryptWithKeyBytes(envelope, key);
      sessionStorage.setItem(KEY_SLOT, b64.to(key));
      renderPage(insights);
    } catch {
      btn.textContent = 'Roll film';
      btn.disabled = false;
      err.textContent = 'Wrong passphrase.';
      card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
      input.select();
    }
  });

  card.appendChild(form);
  card.appendChild(h('p', 'gate-note',
    'Everything on this page is encrypted at rest and decrypted only in your browser. No passphrase, no picture.'));
  gate.appendChild(card);
  root.appendChild(gate);
  input.focus();
}

// ---------- shared chrome ----------
const NAV = [
  ['overview', 'Overview', ''],
  ['stats', 'Stats', 'stats/'],
  ['next', 'Next', 'next/'],
  ['school', 'School', 'school/'],
  ['archive', 'Archive', 'archive/'],
];

function masthead(v) {
  const mast = h('header', 'masthead');
  const title = h('div', 'title');
  title.innerHTML = 'The <span>Screening</span> Room';
  mast.appendChild(title);
  const nav = h('nav', 'site-nav');
  for (const [key, label, path] of NAV) {
    const a = h('a', null, label);
    a.href = BASE + path;
    if (key === PAGE) a.setAttribute('aria-current', 'page');
    nav.appendChild(a);
  }
  mast.appendChild(nav);
  const right = h('div', 'mast-right');
  right.appendChild(h('span', 'meta',
    (v.generatedAt ? `print of ${v.generatedAt}` : 'private print') + (v.printNote ? ` · ${v.printNote}` : '')));
  const lock = h('button', null, 'Lock');
  lock.addEventListener('click', () => { sessionStorage.removeItem(KEY_SLOT); location.href = BASE || './'; });
  right.appendChild(lock);
  mast.appendChild(right);
  return mast;
}

function credits() {
  const foot = h('footer', 'credits');
  foot.innerHTML =
    'A private print · encrypted at rest, decrypted in this browser only<br>' +
    'Film metadata: this product uses the TMDB API but is not endorsed or certified by TMDB';
  return foot;
}

// ---------- sections: overview ----------
function secHero(v, wrap) {
  const hero = h('div', 'hero');
  const hh = h('h2');
  const nFilms = h('span');
  nFilms.dataset.count = v.totals.uniqueFilms;
  nFilms.textContent = v.totals.uniqueFilms.toLocaleString();
  const em = document.createElement('em');
  const nHours = h('span');
  nHours.dataset.count = v.totals.hours;
  nHours.textContent = v.totals.hours.toLocaleString();
  em.append(nHours, ' hours');
  hh.append(nFilms, ' films.', document.createElement('br'), em, ' in the dark.');
  hero.appendChild(hh);
  hero.appendChild(h('p', null,
    `${v.totals.diaryEntries.toLocaleString()} logged watches, ${v.totals.rewatches.toLocaleString()} of them rewatches. ` +
    `Average rating ${v.totals.avgRating ?? '—'}. ${v.totals.watchlistCount.toLocaleString()} still on the watchlist.`));
  wrap.appendChild(hero);
}

function secTiles(v, wrap) {
  const tiles = h('div', 'tiles');
  const thisYear = v.perYear[v.perYear.length - 1];
  tiles.appendChild(tile('Films', v.totals.uniqueFilms.toLocaleString()));
  tiles.appendChild(tile('Hours', v.totals.hours.toLocaleString(), v.totals.estimatedRuntimes ? `${v.totals.estimatedRuntimes} runtimes estimated` : null));
  tiles.appendChild(tile('Avg rating', v.totals.avgRating ? `${v.totals.avgRating}★` : '—', `${v.totals.ratedCount} rated`));
  tiles.appendChild(tile('Rewatches', v.totals.rewatches.toLocaleString()));
  if (thisYear) tiles.appendChild(tile(`In ${thisYear.year}`, String(thisYear.count), `${thisYear.hours} hours`));
  if (v.medianReleaseYear) tiles.appendChild(tile('Median release', String(v.medianReleaseYear), v.avgFilmAge ? `avg film is ${v.avgFilmAge} yrs old` : null, { animate: false }));
  tiles.appendChild(tile('Watchlist', v.totals.watchlistCount.toLocaleString(), 'unwatched debts'));
  wrap.appendChild(tiles);
}

function secReel(v, wrap) {
  const hm = block('The reel — year by year', 'one cell per day, one scale');
  // titles per day, so a cell can name its films on hover
  const titles = new Map();
  for (const r of v.ledger || []) {
    if (!titles.has(r.d)) titles.set(r.d, []);
    titles.get(r.d).push(r.t);
  }
  for (const yr of v.heatmapYears || []) {
    const strip = h('div', 'yearstrip');
    strip.appendChild(h('div', 'yearlabel', `${yr.year} — ${yr.count} film${yr.count === 1 ? '' : 's'}`));
    strip.appendChild(heatmap(yr.byDate, { weeks: YEAR_WEEKS, titles }));
    hm.appendChild(strip);
  }
  wrap.appendChild(hm);
}

function secWall(v, wrap) {
  const tiers = v.wallTiers && v.wallTiers.length
    ? v.wallTiers
    : ((v.fiveStar || []).filter((f) => f.poster).length >= 3
      ? [{ r: 5, films: v.fiveStar.filter((f) => f.poster) }] : []);
  if (!tiers.length) return;
  const wall = block('The wall', 'hang a rating');
  const chipsRow = h('div', 'yr-chips');
  const grid = h('div', 'wall');
  const show = (tier) => {
    grid.innerHTML = '';
    for (const f of tier.films) {
      const a = h('a', 'wall-card');
      a.href = lbUrl(f.tid);
      a.target = '_blank';
      a.rel = 'noopener';
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = `${f.title} poster`;
      img.src = `https://image.tmdb.org/t/p/w342${f.poster}`;
      img.title = `${f.title} (${f.year})`;
      a.appendChild(img);
      grid.appendChild(a);
    }
  };
  tiers.forEach((tier, i) => {
    const c = h('button', 'chip' + (i === 0 ? ' chip-on' : ''), `${stars(tier.r)} · ${tier.films.length}`);
    c.type = 'button';
    c.addEventListener('click', () => {
      chipsRow.querySelectorAll('.chip').forEach((x) => x.classList.remove('chip-on'));
      c.classList.add('chip-on');
      show(tier);
    });
    chipsRow.appendChild(c);
  });
  wall.appendChild(chipsRow);
  wall.appendChild(grid);
  show(tiers[0]);
  wrap.appendChild(wall);
}

function secRecent(v, wrap) {
  const last = block('Last reels', 'recent diary');
  const g6 = h('div', 'grid2');
  const pr = h('div', 'panel');
  pr.appendChild(h('h4', null, 'Recently logged'));
  const ul = h('ul', 'diary');
  for (const r of v.recent) {
    const li = h('li');
    li.appendChild(h('span', 'd', r.date));
    const t = h('span', 't');
    t.appendChild(filmLink(r.tid, r.title));
    t.appendChild(document.createTextNode(' '));
    t.appendChild(h('span', 'y', `(${r.year})`));
    li.appendChild(t);
    if (r.rewatch) li.appendChild(h('span', 'rw', 'RW'));
    li.appendChild(h('span', 'stars', stars(r.rating)));
    ul.appendChild(li);
  }
  pr.appendChild(ul);
  g6.appendChild(pr);
  if (v.fiveStar.length) {
    const pf = h('div', 'panel');
    pf.appendChild(h('h4', null, 'The five-star shelf'));
    const chips = h('div', 'chips');
    for (const f of v.fiveStar) {
      const c = f.tid ? h('a', 'chip') : h('span', 'chip');
      if (f.tid) { c.href = lbUrl(f.tid); c.target = '_blank'; c.rel = 'noopener'; }
      c.appendChild(document.createTextNode(f.title + ' '));
      c.appendChild(h('span', 'y', f.year));
      chips.appendChild(c);
    }
    pf.appendChild(chips);
    g6.appendChild(pf);
  }
  last.appendChild(g6);
  wrap.appendChild(last);
}

// ---------- sections: stats ----------
function secYears(v, wrap) {
  const yr = block('Films per year');
  const g1 = h('div', 'grid2');
  const p1 = h('div', 'panel');
  p1.appendChild(h('h4', null, 'Logged watches by year'));
  p1.appendChild(vBars(v.perYear.map((y) => ({
    label: y.year, value: y.count,
    tipText: `${y.year} — ${y.count} films · ${y.hours} h · avg ${y.avgRating ?? '—'}★`,
  }))));
  const p2 = h('div', 'panel');
  p2.appendChild(h('h4', null, `How hard a grader you are${v.totals.avgRating ? ` — lifetime ${v.totals.avgRating}★` : ''}`));
  p2.appendChild(vBars(Object.entries(v.ratingsHist).sort((a, b) => a[0] - b[0]).map(([r, n]) => ({
    label: (+r) % 1 ? '' : r + '★', value: n,
    tipText: `${stars(+r) || r} — ${n} films`, valueLabel: n > 0 ? String(n) : '',
  })), { height: 190 }));
  g1.appendChild(p1); g1.appendChild(p2);
  yr.appendChild(g1);
  wrap.appendChild(yr);
}

function secHabits(v, wrap) {
  const habits = block('Habits', 'diary entries');
  const g2 = h('div', 'grid2');
  const pd = h('div', 'panel');
  pd.appendChild(h('h4', null, 'Day of the week'));
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  pd.appendChild(vBars(v.dayOfWeek.map((n, i) => ({ label: DOW[i], value: n }))));
  const pm = h('div', 'panel');
  pm.appendChild(h('h4', null, 'Month of the year'));
  const MON = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  pm.appendChild(vBars(v.monthCounts.map((n, i) => ({ label: MON[i], value: n }))));
  g2.appendChild(pd); g2.appendChild(pm);
  habits.appendChild(g2);

  const cs = h('div', 'callouts');
  cs.style.marginTop = '14px';
  if (v.streaks.longestDays) cs.appendChild(callout('Longest streak', `${v.streaks.longestDays} days straight`, v.streaks.streakEnd ? `ended ${v.streaks.streakEnd}` : ''));
  if (v.streaks.busiestDay) cs.appendChild(callout('Biggest single day', `${v.streaks.busiestDay.count} films`, v.streaks.busiestDay.date));
  if (v.streaks.busiestMonth) cs.appendChild(callout('Heaviest month', `${v.streaks.busiestMonth.count} films`, v.streaks.busiestMonth.month));
  if (v.runtime.longest) cs.appendChild(callout('Longest sit', `${v.runtime.longest.title}`, `${v.runtime.longest.minutes} minutes, and you lived`));
  if (v.drought) cs.appendChild(callout('The great drought', `${v.drought.days} days without a film`, `${v.drought.from} → ${v.drought.to}`, true));
  if (v.pace) {
    cs.appendChild(callout('Current pace', `${v.pace.perWeek} films/week`,
      v.pace.projectedThisYear ? `on course for ~${v.pace.projectedThisYear} in ${v.pace.year}` : ''));
    if (v.pace.nextMilestone) cs.appendChild(callout(`Watch #${v.pace.nextMilestone.n} incoming`, v.pace.nextMilestone.eta, 'at the current pace'));
  }
  if (v.ratingsDrift && Math.abs(v.ratingsDrift.delta) >= 0.05) {
    const softer = v.ratingsDrift.delta > 0;
    cs.appendChild(callout('Ratings drift', `${softer ? '+' : ''}${v.ratingsDrift.delta}★ in ${v.ratingsDrift.year}`,
      `you're grading ${softer ? 'softer' : 'harsher'} than your lifetime ${v.ratingsDrift.overall}★`, !softer));
  }
  habits.appendChild(cs);
  wrap.appendChild(habits);
}

function secTaste(v, wrap) {
  if (!v.genres.length) return;
  const taste = block('Taste', 'each film counted once');
  const g3 = h('div', 'grid2');
  const pg = h('div', 'panel');
  pg.appendChild(h('h4', null, 'Genres'));
  pg.appendChild(hBars(v.genres.slice(0, 10).map((g) => ({
    label: g.name, value: g.count,
    valueLabel: `${g.count}${g.avgRating ? ' · ' + g.avgRating + '★' : ''}`,
    tipText: `${g.name} — ${g.count} films${g.avgRating ? ` · you average ${g.avgRating}★` : ''}`,
  }))));
  const pdec = h('div', 'panel');
  pdec.appendChild(h('h4', null, 'Release decades'));
  pdec.appendChild(vBars(v.decades.map((d) => ({
    label: d.name.slice(2), value: d.count,
    tipText: `${d.name} — ${d.count} films${d.avgRating ? ` · avg ${d.avgRating}★` : ''}`,
  })), { height: 220 }));
  g3.appendChild(pg); g3.appendChild(pdec);

  if (v.runtimeBuckets && v.runtimeBuckets.some((b) => b.count)) {
    const pr2 = h('div', 'panel');
    pr2.appendChild(h('h4', null, 'Attention span — runtimes'));
    pr2.appendChild(vBars(v.runtimeBuckets.map((b) => ({
      label: b.label.replace('Under ', '<'), value: b.count,
      tipText: `${b.label} — ${b.count} films`,
    }))));
    g3.appendChild(pr2);
  }
  if (v.rewatchTop && v.rewatchTop.length) {
    const pc2 = h('div', 'panel');
    pc2.appendChild(h('h4', null, 'Comfort reels — most rewatched'));
    const list = ranked(v.rewatchTop, (d) => `(${d.year})`);
    [...list.querySelectorAll('.name')].forEach((el, i) => {
      const d = v.rewatchTop[i];
      if (d.tid) el.replaceWith(filmLink(d.tid, d.name, 'name'));
    });
    pc2.appendChild(list);
    g3.appendChild(pc2);
  }
  taste.appendChild(g3);
  wrap.appendChild(taste);
}

function secGaps(v, wrap) {
  const m = v.genreDecadeMatrix;
  if (!m) return;
  const gaps = block('Terra incognita', 'genre × decade — the blanks are the point');
  const panel = h('div', 'panel matrix-panel');
  const grid = h('div', 'matrix');
  grid.style.gridTemplateColumns = `minmax(96px, auto) repeat(${m.decades.length}, 1fr)`;
  grid.appendChild(h('span', 'mx-head', ''));
  for (const d of m.decades) grid.appendChild(h('span', 'mx-head', d.slice(2)));
  const max = Math.max(1, ...m.cells.flat());
  m.genres.forEach((g, gi) => {
    grid.appendChild(h('span', 'mx-label', g));
    m.decades.forEach((d, di) => {
      const n = m.cells[gi][di];
      const cell = h('span', 'mx-cell' + (n ? '' : ' zero'), n ? String(n) : '·');
      if (n) cell.style.background = `rgba(230, 166, 72, ${0.12 + 0.5 * (n / max)})`;
      cell.title = `${g}, the ${d} — ${n} film${n === 1 ? '' : 's'}`;
      grid.appendChild(cell);
    });
  });
  panel.appendChild(grid);
  panel.appendChild(h('p', 'hint-line', 'the emptiest cells feed the terra incognita shelf on the next page'));
  gaps.appendChild(panel);
  wrap.appendChild(gaps);
}

function secPeople(v, wrap) {
  if (!v.directors.length && !v.actors.length) return;
  const people = block('The men behind the camera', 'and in front of it');
  const g4 = h('div', 'grid2');
  if (v.directors.length) {
    const pd2 = h('div', 'panel');
    pd2.appendChild(h('h4', null, 'Most-watched directors'));
    pd2.appendChild(ranked(v.directors.slice(0, 10), (d) => d.avgRating ? `${d.avgRating}★` : ''));
    g4.appendChild(pd2);
  }
  if (v.actors.length) {
    const pa = h('div', 'panel');
    pa.appendChild(h('h4', null, 'Most-seen faces'));
    pa.appendChild(ranked(v.actors.slice(0, 10)));
    g4.appendChild(pa);
  }
  people.appendChild(g4);
  wrap.appendChild(people);
}

// ---------- sections: the map & the century ----------
function secMap(v, wrap) {
  if (!v.countryFilms || !Object.keys(v.countryFilms).length) return;
  const mp = block('The map of world cinema', 'shaded by how much of each country you have screened');
  const panel = h('div', 'panel');
  mp.appendChild(panel);
  wrap.appendChild(mp);
  // the map paths are heavy — loaded only when this section renders
  import('./worldmap.js').then(({ WORLD, WORLD_VIEW }) => {
    const detail = h('div', 'map-detail');
    const { node, lit, unmapped } = worldMap(WORLD, WORLD_VIEW, v.countryFilms, (name, films) => {
      detail.innerHTML = '';
      detail.appendChild(h('h4', null, `${name} — ${films.length} film${films.length === 1 ? '' : 's'}`));
      const ul = h('ul', 'diary');
      for (const f of films.slice(0, 14)) {
        const li = h('li');
        const t = h('span', 't', f.t + ' ');
        t.appendChild(h('span', 'y', `(${f.y})`));
        li.appendChild(t);
        li.appendChild(h('span', 'stars', stars(f.r)));
        ul.appendChild(li);
      }
      if (films.length > 14) {
        const li = h('li');
        li.appendChild(h('span', 'y', `…and ${films.length - 14} more`));
        ul.appendChild(li);
      }
      detail.appendChild(ul);
    });
    panel.appendChild(node);
    const bits = [`${lit} countries lit — click one`];
    if (unmapped.length) {
      bits.push(`off the map: ${unmapped.map((c) => `${c} ×${v.countryFilms[c].length}`).join(', ')}`);
    }
    panel.appendChild(h('p', 'map-caption', bits.join(' · ')));
    panel.appendChild(detail);
  });
}

function secCentury(v, wrap) {
  if (!v.releaseYears || !v.releaseYears.length) return;
  const cy = block('The century', 'a dot for every film, on the year it was made');
  const panel = h('div', 'panel');
  const endYear = Math.max(...v.releaseYears.map((r) => r.y), Number(v.generatedAt?.slice(0, 4)) || 2026);
  const { node, gap } = centuryStrip(v.releaseYears, endYear);
  panel.appendChild(node);
  let cap = `${v.releaseYears.length} of ${endYear - 1895 + 1} release years visited`;
  if (gap && gap.len >= 3) {
    cap += ` · biggest blind spot: ${gap.from}–${gap.to}, ${gap.len} straight years without a single film`;
  }
  panel.appendChild(h('p', 'map-caption', cap));
  cy.appendChild(panel);
  wrap.appendChild(cy);
  // arrive on the present, let the gaps pull you back
  requestAnimationFrame(() => { node.scrollLeft = node.scrollWidth; });
}

function secRange(v, wrap) {
  if (!v.countries.length && !v.languages.length) return;
  const world = block('Range', 'countries & languages');
  const g5 = h('div', 'grid2');
  if (v.countries.length) {
    const pc = h('div', 'panel');
    pc.appendChild(h('h4', null, 'Countries'));
    pc.appendChild(ranked(v.countries.slice(0, 8)));
    g5.appendChild(pc);
  }
  if (v.languages.length) {
    const pl = h('div', 'panel');
    pl.appendChild(h('h4', null, 'Languages'));
    pl.appendChild(ranked(v.languages.slice(0, 8)));
    g5.appendChild(pl);
  }
  world.appendChild(g5);
  wrap.appendChild(world);
}

function secVerdicts(v, wrap) {
  const verdicts = block('The verdicts');
  const vc = h('div', 'callouts');
  if (v.contrarian) {
    const sign = v.contrarian.avgDelta > 0 ? '+' : '';
    vc.appendChild(callout('Contrarian index', `${sign}${v.contrarian.avgDelta}★ vs the crowd`,
      v.contrarian.avgDelta >= 0 ? 'you rate kinder than TMDB' : 'you rate harsher than TMDB', v.contrarian.avgDelta < 0));
    if (v.contrarian.mostOver) vc.appendChild(callout('Your hill to die on', v.contrarian.mostOver.title,
      `you: ${v.contrarian.mostOver.mine}★ · them: ${v.contrarian.mostOver.tmdb}★`));
    if (v.contrarian.mostUnder) vc.appendChild(callout('Everyone else is wrong about', v.contrarian.mostUnder.title,
      `you: ${v.contrarian.mostUnder.mine}★ · them: ${v.contrarian.mostUnder.tmdb}★`, true));
  }
  if (v.deepCuts) vc.appendChild(callout('Deep cuts', `${v.deepCuts.pct}% of your films`, 'barely on TMDB’s radar'));
  const ms = v.milestones[v.milestones.length - 1];
  if (ms && ms.n >= 50) vc.appendChild(callout(`Watch #${ms.n}`, ms.title, ms.date));
  verdicts.appendChild(vc);

  if (v.calibration && v.calibration.length >= 10) {
    const ps = h('div', 'panel');
    ps.style.marginTop = '14px';
    ps.appendChild(h('h4', null, 'You vs the crowd — every rated film'));
    ps.appendChild(scatterChart(v.calibration, { href: (p) => (p.tid ? lbUrl(p.tid) : null) }));
    ps.appendChild(h('p', 'hint-line', 'above the line: you liked it more than the crowd · below: less'));
    verdicts.appendChild(ps);
  }
  wrap.appendChild(verdicts);
}

function secYearReview(v, wrap) {
  if (!v.yearReviews || !v.yearReviews.length) return;
  const yrb = block('The year in review', 'pick a year');
  const chipsRow = h('div', 'yr-chips');
  const slot = h('div');
  const show = (r) => {
    slot.innerHTML = '';
    const card = h('div', 'panel yr-card');
    const bignums = h('div', 'yr-nums');
    const num = (v2, k) => {
      const d = h('div', 'yr-num');
      d.appendChild(h('p', 'v', String(v2)));
      d.appendChild(h('p', 'k', k));
      return d;
    };
    bignums.appendChild(num(r.films, 'films'));
    bignums.appendChild(num(r.hours, 'hours'));
    bignums.appendChild(num(r.avgRating ? r.avgRating + '★' : '—', 'avg rating'));
    bignums.appendChild(num(r.rewatches, 'rewatches'));
    card.appendChild(bignums);
    const rows = h('ul', 'diary');
    const row = (k, node) => {
      const li = h('li');
      li.appendChild(h('span', 'd', k));
      const t = h('span', 't');
      t.appendChild(node);
      li.appendChild(t);
      rows.appendChild(li);
    };
    if (r.topGenre) row('top genre', document.createTextNode(r.topGenre));
    if (r.topDirector) row('top director', document.createTextNode(r.topDirector));
    if (r.bestFilm) {
      const wrap2 = h('span');
      wrap2.appendChild(filmLink(r.bestFilm.tid, `${r.bestFilm.t} (${r.bestFilm.y})`));
      wrap2.appendChild(h('span', 'stars', ' ' + stars(r.bestFilm.r)));
      row('the peak', wrap2);
    }
    if (r.harshest && r.harshest.t !== r.bestFilm?.t) {
      const wrap3 = h('span');
      wrap3.appendChild(filmLink(r.harshest.tid, `${r.harshest.t} (${r.harshest.y})`));
      wrap3.appendChild(h('span', 'stars', ' ' + stars(r.harshest.r)));
      row('the walkout', wrap3);
    }
    card.appendChild(rows);
    slot.appendChild(card);
  };
  v.yearReviews.forEach((r, i) => {
    const c = h('button', 'chip' + (i === 0 ? ' chip-on' : ''), r.year);
    c.type = 'button';
    c.addEventListener('click', () => {
      chipsRow.querySelectorAll('.chip').forEach((x) => x.classList.remove('chip-on'));
      c.classList.add('chip-on');
      show(r);
    });
    chipsRow.appendChild(c);
  });
  yrb.appendChild(chipsRow);
  yrb.appendChild(slot);
  show(v.yearReviews[0]);
  wrap.appendChild(yrb);
}

// ---------- sections: next (recommendations) ----------
const SHELVES = [
  ['because', 'Because you just watched'],
  ['forYou', 'From everything you’ve loved'],
  ['shortReel', 'Short reels — 105 minutes or less'],
  ['longHaul', 'The long haul — 150 and up'],
  ['meet', 'Masters you haven’t met'],
  ['mastersProgress', 'Masters in progress'],
  ['moreFrom', 'More from directors you love'],
  ['faces', 'Follow the faces'],
  ['gapFillers', 'Terra incognita — where you’ve never been'],
  ['watchlistFirst', 'Off your watchlist first'],
];

function buildCard(c, eager = false, big = false) {
  const card = c.tmdbId ? h('a', 'pcard' + (big ? ' pcard-big' : '')) : h('div', 'pcard');
  if (c.tmdbId) { card.href = lbUrl(c.tmdbId); card.target = '_blank'; card.rel = 'noopener'; }
  if (c.poster) {
    const img = document.createElement('img');
    if (!eager) img.loading = 'lazy';
    img.alt = `${c.title} poster`;
    img.src = `https://image.tmdb.org/t/p/w342${c.poster}`;
    card.appendChild(img);
  } else {
    card.appendChild(h('div', 'noposter', c.title));
  }
  const t = h('p', 't', c.title + ' ');
  t.appendChild(h('span', 'y', `(${c.year})`));
  card.appendChild(t);
  const bits = [];
  if (c.tmdb?.rating) bits.push(`${c.tmdb.rating} tmdb`);
  if (c.imdb?.rating) bits.push(`${c.imdb.rating} imdb`);
  if (c.runtime) bits.push(`${c.runtime}m`);
  if (bits.length) card.appendChild(h('p', 'm', bits.join(' · ')));
  if (c.genres?.length) card.appendChild(h('p', 'm g', c.genres.join(' / ')));
  if (c.why) card.appendChild(h('p', 'why', c.why));
  return card;
}

function secNext(v, wrap) {
  if (!v.recs) return;
  const rx = block('The next pictures', 'TMDB’s engine, weighted by your ratings');

  // master spotlight — this refresh's retrospective
  if (v.recs.spotlight?.films?.length) {
    const sp = h('div', 'spotlight');
    sp.appendChild(h('p', 'spot-k', 'Master spotlight · this print'));
    const nameLink = h('a', 'spot-name', v.recs.spotlight.name);
    nameLink.href = dirUrl(v.recs.spotlight.name);
    nameLink.target = '_blank';
    nameLink.rel = 'noopener';
    sp.appendChild(nameLink);
    const row = h('div', 'shelf');
    v.recs.spotlight.films.forEach((c) => row.appendChild(buildCard(c, true)));
    sp.appendChild(row);
    rx.appendChild(sp);
  }

  // tonight's pick — one film, no scrolling, no debate
  const allCards = [];
  for (const [key] of SHELVES) {
    for (const c of v.recs[key] || []) {
      if (!allCards.some((x) => x.tmdbId === c.tmdbId)) allCards.push({ ...c });
    }
  }
  if (allCards.length) {
    const bar = h('div', 'tonight');
    const sel = h('select');
    for (const [val, label] of [['any', 'any length'], ['100', 'under 100m'], ['130', 'under 130m'], ['150+', '150m and up']]) {
      const o = h('option', null, label);
      o.value = val;
      sel.appendChild(o);
    }
    const dec = h('select');
    {
      const o = h('option', null, 'any decade');
      o.value = 'any';
      dec.appendChild(o);
      const decades = [...new Set(allCards.map((c) => c.year && `${String(c.year).slice(0, 3)}0s`).filter(Boolean))].sort();
      for (const d of decades) {
        const od = h('option', null, d);
        od.value = d.slice(0, 3);
        dec.appendChild(od);
      }
    }
    const filterPool = () => {
      let pool = allCards;
      if (sel.value === '150+') pool = pool.filter((c) => c.runtime >= 150);
      else if (sel.value !== 'any') pool = pool.filter((c) => c.runtime > 0 && c.runtime <= +sel.value);
      if (dec.value !== 'any') pool = pool.filter((c) => String(c.year).slice(0, 3) === dec.value);
      return pool;
    };
    const btn = h('button', 'btn', 'Roll the projector');
    btn.type = 'button';
    btn.id = 'roll-btn';
    const dfBtn = h('button', 'btn', 'Double feature');
    dfBtn.type = 'button';
    const hrs = h('select');
    for (const [val, label] of [['4', '4 hours'], ['6', '6 hours'], ['8', '8 hours'], ['10', '10 hours']]) {
      const o = h('option', null, label);
      o.value = val;
      if (val === '6') o.selected = true;
      hrs.appendChild(o);
    }
    const wkBtn = h('button', 'btn', 'Programme my weekend');
    wkBtn.type = 'button';
    const slot = h('div', 'tonight-slot');

    btn.addEventListener('click', () => {
      const pool = filterPool();
      slot.innerHTML = '';
      if (!pool.length) { slot.appendChild(h('p', 'why', 'nothing on the shelves for that mood — loosen a filter')); return; }
      const pick = pool[Math.floor(Math.random() * pool.length)];
      slot.appendChild(buildCard(pick, true, true));
    });

    // the double feature: an anchor, then the partner it pairs best with
    const pairScore = (a, b) => {
      let s = 0;
      const shared = (a.genres || []).filter((g) => (b.genres || []).includes(g));
      s += shared.length * 2;
      const da = Math.floor(+a.year / 10);
      const db = Math.floor(+b.year / 10);
      if (da === db) s += 2;
      else if (Math.abs(da - db) === 1) s += 1;
      if (a.why && a.why === b.why) s += 3; // same director/actor thread
      return s;
    };
    dfBtn.addEventListener('click', () => {
      const pool = filterPool();
      slot.innerHTML = '';
      if (pool.length < 2) { slot.appendChild(h('p', 'why', 'a double feature needs two — loosen a filter')); return; }
      const first = pool[Math.floor(Math.random() * pool.length)];
      const rest = pool.filter((c) => c.tmdbId !== first.tmdbId);
      const best = Math.max(...rest.map((c) => pairScore(first, c)));
      const partners = rest.filter((c) => pairScore(first, c) === best);
      const second = partners[Math.floor(Math.random() * partners.length)];
      const total = (first.runtime || 0) + (second.runtime || 0);
      const shared = (first.genres || []).filter((g) => (second.genres || []).includes(g));
      const personThread = first.why && first.why === second.why && /^(more|↳)/.test(first.why);
      const thread = personThread ? first.why.replace(/^(more|↳)\s*/, '')
        : shared.length ? shared.join(' / ')
        : `${String(first.year).slice(0, 3)}0s`;
      const df = h('div', 'df');
      const pair = h('div', 'df-pair');
      pair.appendChild(buildCard(first, true, true));
      pair.appendChild(buildCard(second, true, true));
      df.appendChild(pair);
      df.appendChild(h('p', 'df-note',
        `tonight’s programme — paired on ${thread} · ${Math.floor(total / 60)}h ${total % 60}m total` +
        (total >= 240 ? ' · intermission advised' : '')));
      slot.appendChild(df);
    });

    // the weekend programme: chain films by pairing affinity into a time budget
    wkBtn.addEventListener('click', () => {
      const budget = +hrs.value * 60;
      const pool = filterPool().filter((c) => c.runtime > 0);
      slot.innerHTML = '';
      if (!pool.length) { slot.appendChild(h('p', 'why', 'nothing on the shelves for that mood — loosen a filter')); return; }
      const programme = [];
      let remaining = budget;
      let current = pool[Math.floor(Math.random() * pool.length)];
      while (current && programme.length < 4) {
        programme.push(current);
        remaining -= current.runtime;
        const rest = pool.filter((c) => c.runtime <= remaining && !programme.some((p) => p.tmdbId === c.tmdbId));
        if (!rest.length) break;
        const last = programme[programme.length - 1];
        const best = Math.max(...rest.map((c) => pairScore(last, c)));
        const cands = rest.filter((c) => pairScore(last, c) === best);
        current = cands[Math.floor(Math.random() * cands.length)];
      }
      const total = programme.reduce((s, c) => s + c.runtime, 0);
      const df = h('div', 'df');
      const pair = h('div', 'df-pair');
      programme.forEach((c) => pair.appendChild(buildCard(c, true, true)));
      df.appendChild(pair);
      df.appendChild(h('p', 'df-note',
        `the ${hrs.value}-hour programme — ${programme.length} film${programme.length === 1 ? '' : 's'} · ` +
        `${Math.floor(total / 60)}h ${total % 60}m of the ${hrs.value}h budget`));
      slot.appendChild(df);
    });

    bar.appendChild(h('span', 'tonight-label', 'What do I watch tonight?'));
    bar.appendChild(sel);
    bar.appendChild(dec);
    bar.appendChild(btn);
    bar.appendChild(dfBtn);
    bar.appendChild(hrs);
    bar.appendChild(wkBtn);
    rx.appendChild(bar);
    rx.appendChild(slot);
  }

  for (const [key, label] of SHELVES) {
    const cards = v.recs[key];
    if (!cards || !cards.length) continue;
    const head = h('div', 'shelf-head');
    head.appendChild(h('h4', 'shelf-label', label));
    const dl = h('button', 'csv-btn', '↓ csv for letterboxd');
    dl.type = 'button';
    dl.title = 'Download this shelf as a CSV you can import as a Letterboxd list';
    dl.addEventListener('click', () => {
      const rows = [['Title', 'Year', 'tmdbID'], ...cards.map((c) => [c.title, c.year, c.tmdbId])];
      const csv = rows.map((r) => r.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = `${key}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    head.appendChild(dl);
    rx.appendChild(head);
    const shelf = h('div', 'shelf');
    cards.forEach((c, ci) => shelf.appendChild(buildCard(c, ci < 4)));
    rx.appendChild(shelf);
  }

  // two-seater — appears only when a vault was built with a second export
  if (v.recs.twoSeater?.cards?.length) {
    const ts = v.recs.twoSeater;
    rx.appendChild(h('h4', 'shelf-label', `Two-seater — with ${ts.name2}`));
    if (ts.stats) {
      rx.appendChild(h('p', 'hint-line',
        `${ts.stats.common} films in common · ${ts.stats.corr !== null ? `taste correlation ${ts.stats.corr}` : 'not enough shared ratings yet'}`));
    }
    const shelf = h('div', 'shelf');
    ts.cards.forEach((c, ci) => shelf.appendChild(buildCard(c, ci < 4)));
    rx.appendChild(shelf);
  }

  // the canon board — every master, and how far in you are
  if (v.recs.canon?.length) {
    const started = v.recs.canon.filter((c) => c.seen > 0).length;
    rx.appendChild(h('h4', 'shelf-label', `The canon — ${started} of ${v.recs.canon.length} masters started`));
    const cb = h('div', 'panel canon-board');
    for (const c of v.recs.canon) {
      const cell = h('span', 'canon-cell' + (c.seen ? ' on' : ''));
      const link = h('a', 'cn', c.name);
      link.href = dirUrl(c.name);
      link.target = '_blank';
      link.rel = 'noopener';
      cell.appendChild(link);
      cell.appendChild(h('span', 'cc', c.seen ? `×${c.seen}` : '—'));
      cb.appendChild(cell);
    }
    rx.appendChild(cb);
  }

  // unfinished business — franchises started but not completed
  if (v.recs.franchises?.length) {
    rx.appendChild(h('h4', 'shelf-label', 'Unfinished business'));
    const fr = h('div', 'panel');
    const ol = h('ol', 'ranked');
    for (const f of v.recs.franchises) {
      const li = h('li');
      li.appendChild(h('span', 'n', `${f.seen}/${f.total}`));
      li.appendChild(h('span', 'name', f.name));
      const miss = h('span', 'extra');
      miss.appendChild(document.createTextNode('missing: '));
      f.missing.forEach((m, i) => {
        if (i) miss.appendChild(document.createTextNode(', '));
        miss.appendChild(filmLink(m.tmdbId, `${m.title} (${m.year})`));
      });
      li.appendChild(miss);
      ol.appendChild(li);
    }
    fr.appendChild(ol);
    rx.appendChild(fr);
  }

  wrap.appendChild(rx);
}

// ---------- sections: school ----------
function secSchool(v, wrap) {
  const school = v.recs?.school;
  if (!school) return;

  // the term plan
  if (v.recs.seasonPass?.length) {
    const sp = block('The term plan', 'four weeks, cut fresh each print');
    const row = h('div', 'shelf');
    for (const w of v.recs.seasonPass) {
      const cell = h('div', 'week-cell');
      cell.appendChild(h('p', 'week-k', `Week ${w.week} · ${w.label}`));
      cell.appendChild(buildCard(w.card, true));
      row.appendChild(cell);
    }
    sp.appendChild(row);
    wrap.appendChild(sp);
  }

  // the transcript header
  const fs = block('Film school', 'the degree & the graduate school');
  const tr = h('div', 'tiles transcript');
  tr.appendChild(tile('Standing', school.standing || '—'));
  tr.appendChild(tile('BA', school.ba ? `${school.ba.done}/${school.ba.total}` : `${school.done}/${school.total}`, 'the four years', { animate: false }));
  if (school.mfa) tr.appendChild(tile('MFA', `${school.mfa.done}/${school.mfa.total}`, 'the graduate school', { animate: false }));
  tr.appendChild(tile('GPA', school.gpa ? `${school.gpa}` : '—', school.gpaLetter ? `that’s ${/^A/.test(school.gpaLetter) ? 'an' : 'a'} ${school.gpaLetter}` : 'no graded credits yet'));
  if (school.deansList) tr.appendChild(tile('Dean’s list', String(school.deansList), 'courses at 4.5★+'));
  fs.appendChild(tr);

  // office hours — the course currently in session
  if (school.semester) {
    const oh = h('div', 'semester');
    oh.appendChild(h('p', 'spot-k', 'In session this semester'));
    const head = h('h4', 'spot-name', `${school.semester.code} — ${school.semester.title}`);
    oh.appendChild(head);
    if (school.semester.desc) oh.appendChild(h('p', 'course-desc', school.semester.desc));
    if (school.semester.next) {
      const row = h('div', 'shelf');
      row.appendChild(buildCard({
        tmdbId: school.semester.next.tmdbId, title: school.semester.next.title,
        year: school.semester.next.year, poster: school.semester.next.poster,
        tmdb: school.semester.next.tmdb ? { rating: school.semester.next.tmdb } : null,
        runtime: null, genres: [], imdb: null, why: 'next screening',
      }, true));
      oh.appendChild(row);
    }
    fs.appendChild(oh);
  }

  const YEAR_NAMES = {
    1: 'Year One — foundations', 2: 'Year Two — movements',
    3: 'Year Three — genre & form', 4: 'Year Four — advanced studies',
    5: 'MFA I — craft studies', 6: 'MFA II — seminars & geographies',
  };
  let lastYear = null;
  for (const course of school.courses) {
    if (course.year !== lastYear) {
      lastYear = course.year;
      fs.appendChild(h('h4', 'school-year', YEAR_NAMES[course.year] || `Year ${course.year}`));
    }
    const doneHere = course.films.filter((f) => f.watched).length;
    const head = h('div', 'course-head');
    head.appendChild(h('h4', 'course-code', course.code));
    head.appendChild(h('span', 'course-title', course.title));
    if (course.grade) head.appendChild(h('span', 'course-grade' + (course.honors ? ' honors' : ''), course.grade + (course.honors ? ' ★' : '')));
    head.appendChild(h('span', 'course-score', `${doneHere}/${course.films.length}`));
    const dl = h('button', 'csv-btn', '↓ csv');
    dl.type = 'button';
    dl.title = `Download ${course.code} as a CSV for a Letterboxd list`;
    dl.addEventListener('click', () => {
      const rows = [['Title', 'Year', 'tmdbID'],
        ...course.films.map((f) => [f.title, f.year, f.tmdbId]),
        ...(course.extra?.tmdbId ? [[course.extra.title, course.extra.year, course.extra.tmdbId]] : [])];
      const csv = rows.map((r) => r.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = `${course.code.replace(/\s+/g, '-')}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    head.appendChild(dl);
    fs.appendChild(head);
    if (course.desc) fs.appendChild(h('p', 'course-desc', course.desc));
    const ul = h('ul', 'diary course-list');
    for (const f of course.films) {
      const li = h('li', f.watched ? 'screened' : '');
      li.appendChild(h('span', 'tick', f.watched ? '✓' : '○'));
      const t = h('span', 't');
      t.appendChild(filmLink(f.tmdbId, f.title));
      t.appendChild(document.createTextNode(' '));
      t.appendChild(h('span', 'y', `(${f.year})`));
      if (f.director) {
        const d = h('a', 'course-dir', f.director);
        d.href = dirUrl(f.director);
        d.target = '_blank';
        d.rel = 'noopener';
        t.appendChild(document.createTextNode(' '));
        t.appendChild(d);
      }
      li.appendChild(t);
      li.appendChild(h('span', 'why-inline', f.why));
      if (f.userRating) li.appendChild(h('span', 'stars', stars(f.userRating)));
      else if (f.tmdb) li.appendChild(h('span', 'extra', `${f.tmdb} tmdb`));
      ul.appendChild(li);
    }
    fs.appendChild(ul);
    if (course.extra) {
      const fx = h('p', 'further');
      fx.appendChild(h('span', 'tick', course.extra.watched ? '✓' : '+'));
      fx.appendChild(document.createTextNode('further screening: '));
      fx.appendChild(filmLink(course.extra.tmdbId, `${course.extra.title} (${course.extra.year})`));
      if (course.extra.director) fx.appendChild(document.createTextNode(`, ${course.extra.director}`));
      fx.appendChild(document.createTextNode(` — ${course.extra.why}`));
      fs.appendChild(fx);
    }
    if (course.complete) {
      fs.appendChild(h('p', 'course-crit',
        `✓ Course complete${course.grade ? ` — ${course.grade}${course.honors ? ', dean’s list' : ''}` : ''}. Crit session: ${course.assignment}`));
    } else if (course.assignment) {
      fs.appendChild(h('p', 'course-assign', `Assignment — ${course.assignment}`));
    }
  }
  wrap.appendChild(fs);

  // the shelves: reading + theory
  const rs = block('The library', 'the books and the arguments');
  const shelfList = (title, items) => {
    const rp = h('div', 'panel');
    rp.appendChild(h('h4', null, title));
    const rl = h('ul', 'diary');
    for (const [t2, author, note] of items) {
      const li = h('li');
      const t = h('span', 't');
      const b = h('span', null, t2);
      b.style.fontWeight = '600';
      t.appendChild(b);
      t.appendChild(h('span', 'y', ` — ${author}`));
      li.appendChild(t);
      li.appendChild(h('span', 'why-inline', note));
      rl.appendChild(li);
    }
    rp.appendChild(rl);
    return rp;
  };
  const g = h('div', 'grid2');
  g.appendChild(shelfList('The reading shelf — craft', READING_SHELF));
  g.appendChild(shelfList('The theory shelf — arguments', THEORY_SHELF));
  rs.appendChild(g);
  wrap.appendChild(rs);

  // the seminar room: the method, then the working vocabulary — every term
  // anchored to the syllabus film that teaches it
  const sem = block('The seminar room', 'talk like you studied here');
  const normLex = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const filmIdx = new Map();
  for (const c of school.courses) {
    for (const f of c.films) filmIdx.set(normLex(f.title), f);
    if (c.extra) filmIdx.set(normLex(c.extra.title), c.extra);
  }
  const mp = h('div', 'panel');
  mp.appendChild(h('h4', null, 'How to read a film — the method'));
  const ml = h('ol', 'method');
  for (const line of METHOD) ml.appendChild(h('li', null, line));
  mp.appendChild(ml);
  sem.appendChild(mp);
  const lp = h('div', 'panel');
  lp.appendChild(h('h4', null, `The working vocabulary — ${LEXICON.length} terms`));
  const dl = h('div', 'lexicon');
  for (const [term, def, seeIn] of LEXICON) {
    const en = h('div', 'lex-entry');
    en.appendChild(h('span', 'lex-term', term));
    en.appendChild(h('span', 'lex-def', def + '. '));
    const see = h('span', 'lex-see');
    see.appendChild(document.createTextNode('see it in: '));
    const f = filmIdx.get(normLex(seeIn));
    see.appendChild(f?.tmdbId ? filmLink(f.tmdbId, seeIn) : h('em', null, seeIn));
    if (f?.watched) see.appendChild(document.createTextNode(' ✓'));
    en.appendChild(see);
    dl.appendChild(en);
  }
  lp.appendChild(dl);
  sem.appendChild(lp);
  wrap.appendChild(sem);
}

// ---------- sections: archive ----------
function secThisWeek(v, wrap) {
  if (!v.thisWeek || !v.thisWeek.length) return;
  const tw = block('Same week, other years', 'the archive remembers');
  const pw = h('div', 'panel');
  const uw = h('ul', 'diary');
  for (const r of v.thisWeek.slice(0, 10)) {
    const li = h('li');
    li.appendChild(h('span', 'd', r.date));
    const t = h('span', 't', r.title + ' ');
    t.appendChild(h('span', 'y', `(${r.year})`));
    li.appendChild(t);
    li.appendChild(h('span', 'stars', stars(r.rating)));
    uw.appendChild(li);
  }
  pw.appendChild(uw);
  tw.appendChild(pw);
  wrap.appendChild(tw);
}

function secArchive(v, wrap) {
  if (!v.ledger || !v.ledger.length) return;
  const ar = block('The archive', 'the ledger & the margins');
  const twoCol = h('div', 'grid2 archive-cols');
  const pa2 = h('div', 'panel');
  pa2.appendChild(h('h4', null, `The ledger — ${v.ledger.length} screenings`));
  const filt = h('div', 'archive-filter');
  const inp = h('input');
  inp.type = 'search';
  inp.placeholder = 'grep the diary — title or year…';
  inp.setAttribute('aria-label', 'Filter the diary');
  filt.appendChild(inp);

  // power filters: watch-year, rating band, rewatches
  const fYear = h('select');
  {
    const o = h('option', null, 'any year');
    o.value = 'any';
    fYear.appendChild(o);
    for (const y of [...new Set(v.ledger.map((r) => r.d.slice(0, 4)))].sort().reverse()) {
      const oy = h('option', null, y);
      oy.value = y;
      fYear.appendChild(oy);
    }
  }
  const fRate = h('select');
  for (const [val, label] of [['any', 'any rating'], ['5', '5★ only'], ['4', '4★ and up'], ['low', '2★ and under'], ['none', 'unrated']]) {
    const o = h('option', null, label);
    o.value = val;
    fRate.appendChild(o);
  }
  const fRw = h('label', 'rw-filter');
  const rwBox = h('input');
  rwBox.type = 'checkbox';
  fRw.appendChild(rwBox);
  fRw.appendChild(document.createTextNode(' rewatches only'));
  const row = h('div', 'archive-selects');
  row.appendChild(fYear);
  row.appendChild(fRate);
  row.appendChild(fRw);
  filt.appendChild(row);
  pa2.appendChild(filt);

  const ul2 = h('ul', 'diary');
  const rows = v.ledger.map((r) => {
    const li = h('li');
    li.appendChild(h('span', 'd', r.d));
    const t = h('span', 't');
    t.appendChild(filmLink(r.id, r.t));
    t.appendChild(document.createTextNode(' '));
    t.appendChild(h('span', 'y', `(${r.y})`));
    li.appendChild(t);
    if (r.w) li.appendChild(h('span', 'rw', 'RW'));
    li.appendChild(h('span', 'stars', stars(r.r)));
    li.dataset.q = (r.t + ' ' + r.y).toLowerCase();
    ul2.appendChild(li);
    return li;
  });
  pa2.appendChild(ul2);
  const foot = h('div', 'archive-foot');
  const count = h('p', 'archive-count', '');
  const btns = h('div', 'archive-btns');
  const more = h('button', 'btn archive-more', 'Show more');
  const less = h('button', 'btn archive-less', 'Show less');
  more.type = 'button';
  less.type = 'button';
  btns.appendChild(less);
  btns.appendChild(more);
  foot.appendChild(count);
  foot.appendChild(btns);
  pa2.appendChild(foot);

  const PAGE_SIZE = 25;
  let cap = PAGE_SIZE;
  function applyFilter() {
    const q = inp.value.trim().toLowerCase();
    const anyFilter = q || fYear.value !== 'any' || fRate.value !== 'any' || rwBox.checked;
    let matches = 0;
    let shown = 0;
    rows.forEach((li, i) => {
      const r = v.ledger[i];
      let hit = !q || li.dataset.q.includes(q);
      if (hit && fYear.value !== 'any') hit = r.d.startsWith(fYear.value);
      if (hit && fRate.value === '5') hit = r.r === 5;
      else if (hit && fRate.value === '4') hit = r.r >= 4;
      else if (hit && fRate.value === 'low') hit = r.r !== null && r.r <= 2;
      else if (hit && fRate.value === 'none') hit = r.r === null;
      if (hit && rwBox.checked) hit = r.w;
      if (hit) matches++;
      const show = hit && (anyFilter ? true : shown < cap);
      if (show) shown++;
      li.style.display = show ? '' : 'none';
    });
    more.style.display = !anyFilter && cap < rows.length ? '' : 'none';
    less.style.display = !anyFilter && cap > PAGE_SIZE ? '' : 'none';
    count.textContent = anyFilter
      ? `${matches} match${matches === 1 ? '' : 'es'} of ${rows.length}`
      : `showing ${Math.min(cap, rows.length)} of ${rows.length}`;
  }
  more.addEventListener('click', () => { cap += 100; applyFilter(); });
  less.addEventListener('click', () => {
    cap = PAGE_SIZE;
    applyFilter();
    ar.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'start' });
  });
  inp.addEventListener('input', applyFilter);
  fYear.addEventListener('change', applyFilter);
  fRate.addEventListener('change', applyFilter);
  rwBox.addEventListener('change', applyFilter);
  applyFilter();

  twoCol.appendChild(pa2);
  const margins = buildMargins(v);
  if (margins) twoCol.appendChild(margins);
  ar.appendChild(twoCol);
  wrap.appendChild(ar);
}

function buildMargins(v) {
  if (!v.reviews || !v.reviews.length) return null;
  const panel = h('div', 'panel');
  panel.appendChild(h('h4', null, `The margins — ${v.reviews.length} review${v.reviews.length === 1 ? '' : 's'}, in your own hand`));
  const filt = h('div', 'archive-filter');
  const inp = h('input');
  inp.type = 'search';
  inp.placeholder = 'search your reviews…';
  inp.setAttribute('aria-label', 'Search reviews');
  filt.appendChild(inp);
  panel.appendChild(filt);

  const CLAMP = 420;
  const list = h('div');
  const cards = v.reviews.map((r) => {
    const card = h('div', 'review');
    const head = h('p', 'review-head');
    head.appendChild(h('span', 'd', r.d));
    head.appendChild(document.createTextNode(' '));
    head.appendChild(filmLink(r.tid, `${r.t} (${r.y})`));
    if (r.r) head.appendChild(h('span', 'stars', ' ' + stars(r.r)));
    card.appendChild(head);
    // long reviews fold, so one essay can't fill the column
    if (r.text.length > CLAMP) {
      const cut = r.text.lastIndexOf(' ', CLAMP);
      const body = h('p', 'review-text', r.text.slice(0, cut > 0 ? cut : CLAMP) + '… ');
      const moreBtn = h('button', 'read-more', 'read on');
      moreBtn.type = 'button';
      let open = false;
      moreBtn.addEventListener('click', () => {
        open = !open;
        body.textContent = (open ? r.text : r.text.slice(0, cut > 0 ? cut : CLAMP) + '… ') + ' ';
        body.appendChild(moreBtn);
        moreBtn.textContent = open ? 'fold' : 'read on';
      });
      body.appendChild(moreBtn);
      card.appendChild(body);
    } else {
      card.appendChild(h('p', 'review-text', r.text));
    }
    card.dataset.q = (r.t + ' ' + r.y + ' ' + r.text).toLowerCase();
    list.appendChild(card);
    return card;
  });
  panel.appendChild(list);

  const foot = h('div', 'archive-foot');
  const count = h('p', 'archive-count', '');
  const btns = h('div', 'archive-btns');
  const more = h('button', 'btn', 'Show more');
  const less = h('button', 'btn', 'Show less');
  more.type = 'button';
  less.type = 'button';
  btns.appendChild(less);
  btns.appendChild(more);
  foot.appendChild(count);
  foot.appendChild(btns);
  panel.appendChild(foot);

  const PAGE_SIZE = 10;
  let cap = PAGE_SIZE;
  function apply() {
    const q = inp.value.trim().toLowerCase();
    let matches = 0;
    let shown = 0;
    for (const c of cards) {
      const hit = !q || c.dataset.q.includes(q);
      if (hit) matches++;
      const show = hit && (q ? true : shown < cap);
      if (show) shown++;
      c.style.display = show ? '' : 'none';
    }
    more.style.display = !q && cap < cards.length ? '' : 'none';
    less.style.display = !q && cap > PAGE_SIZE ? '' : 'none';
    count.textContent = q
      ? `${matches} match${matches === 1 ? '' : 'es'} of ${cards.length}`
      : `showing ${Math.min(cap, cards.length)} of ${cards.length}`;
  }
  more.addEventListener('click', () => { cap += 25; apply(); });
  less.addEventListener('click', () => {
    cap = PAGE_SIZE;
    apply();
    panel.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'start' });
  });
  inp.addEventListener('input', apply);
  apply();
  return panel;
}

// ---------- page assembly ----------
// The projectionist's log — one dated line per print of this site.
function secPrints(v, wrap) {
  if (!v.printHistory || !v.printHistory.length) return;
  const pr = block('The projectionist’s log', 'every print, dated and noted');
  const pp = h('div', 'panel');
  const ul = h('ul', 'diary printlog');
  for (const e of [...v.printHistory].reverse().slice(0, 40)) {
    const li = h('li');
    li.appendChild(h('span', 'd', e.d));
    li.appendChild(h('span', 't', e.n));
    ul.appendChild(li);
  }
  pp.appendChild(ul);
  pr.appendChild(pp);
  wrap.appendChild(pr);
}

const PAGES = {
  overview: [secHero, secTiles, secReel, secRecent, secWall],
  stats: [secYears, secHabits, secTaste, secMap, secCentury, secGaps, secPeople, secRange, secVerdicts, secYearReview],
  next: [secNext],
  school: [secSchool],
  archive: [secThisWeek, secArchive, secPrints],
};

function renderPage(v) {
  root.innerHTML = '';
  resetBlockCounter();
  const wrap = h('div', 'wrap');
  wrap.appendChild(masthead(v));
  for (const section of PAGES[PAGE] || PAGES.overview) section(v, wrap);
  wrap.appendChild(h('div', 'fin', 'fin.'));
  wrap.appendChild(credits());
  root.appendChild(wrap);
  window.scrollTo(0, 0);
  polish(wrap);
  chrome();
}

// Once-per-session page chrome: the reel-progress line and keyboard shortcuts.
function chrome() {
  if (document.getElementById('reelbar')) return;
  const bar = h('div');
  bar.id = 'reelbar';
  document.body.appendChild(bar);
  const track = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = max > 0 ? `${Math.min(100, (window.scrollY / max) * 100)}%` : '0%';
  };
  addEventListener('scroll', track, { passive: true });
  addEventListener('resize', track, { passive: true });
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.key === '/') {
      const s = document.querySelector('input[type="search"]');
      if (s) { e.preventDefault(); s.focus(); }
    } else if (e.key === 'r') {
      document.getElementById('roll-btn')?.click();
    }
  });
}

// ---------- motion: count-ups and scroll-reveal (skipped for reduced motion) --
function countUp(el) {
  const target = Number(el.dataset.count);
  if (!Number.isFinite(target) || target <= 0) return;
  const dur = 900;
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(target * eased).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function polish(wrap) {
  const blocks = [...wrap.querySelectorAll('section.block')];
  if (REDUCED_MOTION) {
    blocks.forEach((b) => b.classList.add('on'));
    return;
  }
  wrap.querySelectorAll('[data-count]').forEach(countUp);
  let pending = blocks;
  let ticking = false;
  let firstBatch = true;
  const check = () => {
    ticking = false;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!vh) {
      pending.forEach((b) => b.classList.add('on'));
      pending = [];
    }
    const limit = vh * 0.88;
    let i = 0;
    pending = pending.filter((b) => {
      if (b.getBoundingClientRect().top < limit) {
        b.style.transitionDelay = firstBatch ? `${0.18 + i * 0.1}s` : '0s';
        b.classList.add('on');
        i++;
        return false;
      }
      return true;
    });
    firstBatch = false;
    if (!pending.length) {
      removeEventListener('scroll', onScroll);
      removeEventListener('resize', onScroll);
    }
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(check); } };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
  requestAnimationFrame(() => requestAnimationFrame(check));
  setTimeout(() => { if (firstBatch) check(); }, 350);
}

main();
