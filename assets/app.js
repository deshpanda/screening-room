// Gate + dashboard orchestration. The vault is fetched as ciphertext and
// decrypted only here, in the visitor's browser. The derived key (not the
// passphrase) is kept in sessionStorage so a refresh inside the same tab
// doesn't re-prompt; Lock clears it.

import { decryptWithKeyBytes, deriveKeyBytes, envelopeSalt, b64 } from '../lib/vaultcrypto.js';
import { h, initTip, stars, vBars, hBars, heatmap, ranked, callout, tile, block, resetBlockCounter } from '../lib/render.js';

const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
const YEAR_WEEKS = 54; // one shared grid for every year strip

// Letterboxd's stable per-TMDB-id redirect — links a film without knowing its slug.
const lbUrl = (tid) => `https://letterboxd.com/tmdb/${tid}`;
function filmLink(tid, text, cls) {
  if (!tid) return h('span', cls, text);
  const a = h('a', cls ? cls + ' film-link' : 'film-link', text);
  a.href = lbUrl(tid);
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

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
  resetBlockCounter();
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

  // stat tiles
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

  // the reel — one strip per year, same scale everywhere so the years compare
  const hm = block('The reel — year by year', 'one cell per day, one scale');
  const strips = v.heatmapYears || [];
  for (const yr of strips) {
    const strip = h('div', 'yearstrip');
    strip.appendChild(h('div', 'yearlabel', `${yr.year} — ${yr.count} film${yr.count === 1 ? '' : 's'}`));
    strip.appendChild(heatmap(yr.byDate, { weeks: YEAR_WEEKS }));
    hm.appendChild(strip);
  }
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
  p2.appendChild(h('h4', null, `How hard a grader you are${v.totals.avgRating ? ` — lifetime ${v.totals.avgRating}★` : ''}`));
  // numeric sort — Object.entries puts integer-like keys first otherwise
  p2.appendChild(vBars(Object.entries(v.ratingsHist).sort((a, b) => a[0] - b[0]).map(([r, n]) => ({
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

    // attention span
    if (v.runtimeBuckets && v.runtimeBuckets.some((b) => b.count)) {
      const pr2 = h('div', 'panel');
      pr2.appendChild(h('h4', null, 'Attention span — runtimes'));
      pr2.appendChild(vBars(v.runtimeBuckets.map((b) => ({
        label: b.label.replace('Under ', '<').replace('–', '–'), value: b.count,
        tipText: `${b.label} — ${b.count} films`,
      }))));
      g3.appendChild(pr2);
    }
    // comfort reels
    if (v.rewatchTop && v.rewatchTop.length) {
      const pc2 = h('div', 'panel');
      pc2.appendChild(h('h4', null, 'Comfort reels — most rewatched'));
      const list = ranked(v.rewatchTop, (d) => `(${d.year})`);
      // swap plain names for Letterboxd links where we know the film
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

  // the next pictures — recommendation shelves
  if (v.recs) {
    const rx = block('The next pictures', 'TMDB’s engine, weighted by your ratings');
    const SHELVES = [
      ['because', 'Because you just watched'],
      ['forYou', 'From everything you’ve loved'],
      ['meet', 'Meet a master'],
      ['moreFrom', 'More from directors you love'],
      ['watchlistFirst', 'Off your watchlist first'],
    ];
    for (const [key, label] of SHELVES) {
      const cards = v.recs[key];
      if (!cards || !cards.length) continue;
      rx.appendChild(h('h4', 'shelf-label', label));
      const shelf = h('div', 'shelf');
      cards.forEach((c, ci) => {
        const card = c.tmdbId ? h('a', 'pcard') : h('div', 'pcard');
        if (c.tmdbId) { card.href = lbUrl(c.tmdbId); card.target = '_blank'; card.rel = 'noopener'; }
        if (c.poster) {
          const img = document.createElement('img');
          if (ci >= 4) img.loading = 'lazy'; // first few paint immediately
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
        shelf.appendChild(card);
      });
      rx.appendChild(shelf);
    }
    wrap.appendChild(rx);
  }

  // recent + five-star wall
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

  // same week, other years
  if (v.thisWeek && v.thisWeek.length) {
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

  // the archive — full diary, searchable
  if (v.ledger && v.ledger.length) {
    const ar = block('The archive', `${v.ledger.length} screenings`);
    const pa2 = h('div', 'panel');
    const filt = h('div', 'archive-filter');
    const inp = h('input');
    inp.type = 'search';
    inp.placeholder = 'grep the diary — title or year…';
    inp.setAttribute('aria-label', 'Filter the diary');
    filt.appendChild(inp);
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

    // Progressive reveal: 25 rows at a time; a search always sweeps everything.
    const PAGE = 25;
    let cap = PAGE;
    function applyFilter() {
      const q = inp.value.trim().toLowerCase();
      let matches = 0;
      let shown = 0;
      for (const li of rows) {
        const hit = !q || li.dataset.q.includes(q);
        if (hit) matches++;
        const show = hit && (q ? true : shown < cap);
        if (show) shown++;
        li.style.display = show ? '' : 'none';
      }
      more.style.display = !q && cap < rows.length ? '' : 'none';
      less.style.display = !q && cap > PAGE ? '' : 'none';
      count.textContent = q
        ? `${matches} match${matches === 1 ? '' : 'es'} of ${rows.length}`
        : `showing ${Math.min(cap, rows.length)} of ${rows.length}`;
    }
    more.addEventListener('click', () => { cap += 100; applyFilter(); });
    less.addEventListener('click', () => {
      cap = PAGE;
      applyFilter();
      ar.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'start' });
    });
    inp.addEventListener('input', applyFilter);
    applyFilter();

    ar.appendChild(pa2);
    wrap.appendChild(ar);
  }

  // end card
  wrap.appendChild(h('div', 'fin', 'fin.'));

  // credits
  const foot = h('footer', 'credits');
  foot.innerHTML =
    'A private print · encrypted at rest, decrypted in this browser only<br>' +
    'Film metadata: this product uses the TMDB API but is not endorsed or certified by TMDB';
  wrap.appendChild(foot);

  root.appendChild(wrap);
  window.scrollTo(0, 0);
  polish(wrap);
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
  // Plain rect checks on a rAF-throttled scroll listener — no observer APIs,
  // so a section can never be left invisible.
  let pending = blocks;
  let ticking = false;
  let firstBatch = true;
  const check = () => {
    ticking = false;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!vh) {
      // a viewport we can't measure gets no animation — content always wins
      pending.forEach((b) => b.classList.add('on'));
      pending = [];
    }
    const limit = vh * 0.88;
    let i = 0;
    pending = pending.filter((b) => {
      if (b.getBoundingClientRect().top < limit) {
        // stagger only the batch visible on arrival; scroll reveals are immediate
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
  // Let the hidden state paint first — a transition needs a "before" frame.
  requestAnimationFrame(() => requestAnimationFrame(check));
  // If rAF is starved (headless/embedded viewers), content still wins.
  setTimeout(() => { if (firstBatch) check(); }, 350);
}

main();
