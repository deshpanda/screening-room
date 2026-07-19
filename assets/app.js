// Gate + dashboard orchestration. The vault is fetched as ciphertext and
// decrypted only here, in the visitor's browser. The derived key (not the
// passphrase) is kept in sessionStorage so a refresh inside the same tab
// doesn't re-prompt; Lock clears it.

import { decryptWithKeyBytes, deriveKeyBytes, envelopeSalt, b64 } from '../lib/vaultcrypto.js';
import { h, initTip, stars, vBars, hBars, heatmap, ranked, callout, tile, block } from '../lib/render.js';

const KEY_SLOT = 'sr-key';
const root = document.getElementById('root');
let envelope = null;

async function main() {
  initTip();
  const res = await fetch('data/vault.enc', { cache: 'no-store' });
  envelope = (await res.text()).trim();

  const cached = sessionStorage.getItem(KEY_SLOT);
  if (cached) {
    try {
      const insights = await decryptWithKeyBytes(envelope, b64.from(cached));
      return renderDashboard(insights);
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
      renderDashboard(insights);
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

// ---------- dashboard ----------
function renderDashboard(v) {
  root.innerHTML = '';
  const wrap = h('div', 'wrap');

  // masthead
  const mast = h('header', 'masthead');
  const title = h('div', 'title');
  title.innerHTML = 'The <span>Screening</span> Room';
  mast.appendChild(title);
  const meta = h('span', 'meta', v.generatedAt ? `print of ${v.generatedAt}` : 'private print');
  mast.appendChild(meta);
  const lock = h('button', null, 'Lock');
  lock.addEventListener('click', () => { sessionStorage.removeItem(KEY_SLOT); location.reload(); });
  mast.appendChild(lock);
  wrap.appendChild(mast);

  // hero
  const hero = h('div', 'hero');
  const hh = h('h2');
  hh.innerHTML = `${v.totals.uniqueFilms.toLocaleString()} films.<br><em>${v.totals.hours.toLocaleString()} hours</em> in the dark.`;
  hero.appendChild(hh);
  hero.appendChild(h('p', null,
    `${v.totals.diaryEntries.toLocaleString()} logged watches, ${v.totals.rewatches.toLocaleString()} of them rewatches. ` +
    `Average rating ${v.totals.avgRating ?? '—'}. ${v.totals.watchlistCount.toLocaleString()} still on the watchlist.`));
  wrap.appendChild(hero);

  // stat tiles
  const tiles = h('div', 'tiles');
  const thisYear = v.perYear[v.perYear.length - 1];
  tiles.appendChild(tile('Films', v.totals.uniqueFilms.toLocaleString()));
  tiles.appendChild(tile('Hours', v.totals.hours.toLocaleString(), v.totals.estimatedRuntimes ? `${v.totals.estimatedRuntimes} runtimes estimated` : null));
  tiles.appendChild(tile('Avg rating', v.totals.avgRating ? `${v.totals.avgRating}★` : '—', `${v.totals.ratedCount} rated`));
  tiles.appendChild(tile('Rewatches', v.totals.rewatches.toLocaleString()));
  if (thisYear) tiles.appendChild(tile(`In ${thisYear.year}`, String(thisYear.count), `${thisYear.hours} hours`));
  tiles.appendChild(tile('Watchlist', v.totals.watchlistCount.toLocaleString(), 'unwatched debts'));
  wrap.appendChild(tiles);

  // heatmap
  const hm = block('The reel — last 12 months', 'one cell per day');
  hm.appendChild(heatmap(v.heatmap));
  wrap.appendChild(hm);

  // per-year + ratings
  const yr = block('Films per year');
  const g1 = h('div', 'grid2');
  const p1 = h('div', 'panel');
  p1.appendChild(h('h4', null, 'Logged watches by year'));
  p1.appendChild(vBars(v.perYear.map((y) => ({
    label: y.year, value: y.count,
    tipText: `${y.year} — ${y.count} films · ${y.hours} h · avg ${y.avgRating ?? '—'}★`,
  }))));
  const p2 = h('div', 'panel');
  p2.appendChild(h('h4', null, 'How hard a grader you are'));
  p2.appendChild(vBars(Object.entries(v.ratingsHist).map(([r, n]) => ({
    label: (+r) % 1 ? '' : r + '★', value: n,
    tipText: `${stars(+r) || r} — ${n} films`, valueLabel: n > 0 ? String(n) : '',
  })), { height: 190 }));
  g1.appendChild(p1); g1.appendChild(p2);
  yr.appendChild(g1);
  wrap.appendChild(yr);

  // habits: day of week + months + streak callouts
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
  habits.appendChild(cs);
  wrap.appendChild(habits);

  // taste: genres + decades
  if (v.genres.length) {
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
      label: d.name.replace('0s', "0s").slice(2), value: d.count,
      tipText: `${d.name} — ${d.count} films${d.avgRating ? ` · avg ${d.avgRating}★` : ''}`,
    })), { height: 220 }));
    g3.appendChild(pg); g3.appendChild(pdec);
    taste.appendChild(g3);
    wrap.appendChild(taste);
  }

  // people
  if (v.directors.length || v.actors.length) {
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

  // world
  if (v.countries.length || v.languages.length) {
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

  // the verdicts: contrarian + deep cuts + milestones
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
  wrap.appendChild(verdicts);

  // recent + five-star wall
  const last = block('Last reels', 'recent diary');
  const g6 = h('div', 'grid2');
  const pr = h('div', 'panel');
  pr.appendChild(h('h4', null, 'Recently logged'));
  const ul = h('ul', 'diary');
  for (const r of v.recent) {
    const li = h('li');
    li.appendChild(h('span', 'd', r.date));
    const t = h('span', 't', r.title + ' ');
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
      const c = h('span', 'chip', f.title + ' ');
      c.appendChild(h('span', 'y', f.year));
      chips.appendChild(c);
    }
    pf.appendChild(chips);
    g6.appendChild(pf);
  }
  last.appendChild(g6);
  wrap.appendChild(last);

  // credits
  const foot = h('footer', 'credits');
  foot.innerHTML =
    'A private print · encrypted at rest, decrypted in this browser only<br>' +
    'Film metadata: this product uses the TMDB API but is not endorsed or certified by TMDB';
  wrap.appendChild(foot);

  root.appendChild(wrap);
  window.scrollTo(0, 0);
}

main();
