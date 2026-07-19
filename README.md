# 🎞 The Screening Room

**A private [Letterboxd](https://letterboxd.com) dashboard hiding in plain sight.**

Letterboxd is the diary; this is the projection booth. Every film logged
there becomes part of a single-viewer site — hours in the dark, streaks,
genres, most-watched directors, a contrarian index against the crowd —
rendered as a dark little cinema and locked behind a passphrase. The repo
and the page are fully public; the data is not.

```
you ──▶ passphrase ──▶ PBKDF2 (310k) ──▶ AES-256-GCM ──▶ your film life
anyone else ─────────────────────────────────────────▶ ciphertext
```

## Where the data comes from

Letterboxd has no public API, so the pipeline uses the two doors it does have:

1. **The seed — a one-time Letterboxd data export** (Settings → Data →
   Export): `diary.csv`, `watched.csv`, `ratings.csv`, `watchlist.csv` give
   the full history. Parsed locally, never committed.
2. **The drip — the public Letterboxd RSS feed**, which carries the last ~50
   diary entries (with TMDB ids). A scheduled workflow merges new watches
   from it twice a week, so the export never needs downloading again.
3. **The garnish — TMDB.** Letterboxd's export has titles and dates but no
   genres, runtimes or credits; each film is enriched once via the TMDB API
   and cached.

## How the privacy works

- The only data in this repo is [`data/vault.enc`](data/vault.enc) and
  [`data/source.enc`](data/source.enc) — AES-256-GCM ciphertext. Decryption
  happens **only in the visitor's browser** ([`lib/vaultcrypto.js`](lib/vaultcrypto.js)),
  with a key derived from the passphrase via PBKDF2-SHA256 at 310,000
  iterations. Wrong passphrase, no picture.
- The Letterboxd **username appears nowhere** in the repository or the site —
  it lives only in an Actions secret, alongside the vault passphrase and the
  TMDB key (all masked in logs). Raw exports are gitignored. The gate carries
  `noindex` and `robots.txt` blocks crawlers.
- The lock is real cryptography, not a hidden `<div>` — and therefore exactly
  as strong as the passphrase. Choose accordingly.

## How it stays fresh (zero maintenance)

[`.github/workflows/refresh.yml`](.github/workflows/refresh.yml) runs Monday
and Thursday: reads the Letterboxd feed, merges new diary entries into the
encrypted source, enriches new films by their TMDB id, recomputes every
insight, re-encrypts, commits — and GitHub Pages redeploys itself. It needs
three repository secrets: `LB_USER`, `VAULT_PASS`, `TMDB_KEY`.

No servers, no cron boxes, no cost, nothing to remember.

## Under the hood

- **Zero dependencies.** Plain HTML/CSS/JS; charts are hand-rolled SVG —
  a watch-calendar heatmap, ratings histogram, genre and decade bars —
  in a single projector-amber hue on a dark surface.
- **Pure, tested core.** CSV parsing, the insights engine and the crypto
  round-trip are covered by `node --test` (no frameworks).
- **Everything computed at build time.** The browser only decrypts and
  draws; the heavy lifting happens in [`tools/build-vault.mjs`](tools/build-vault.mjs)
  and [`tools/update-from-rss.mjs`](tools/update-from-rss.mjs).

## Owner's manual

### Change the passphrase — or reset it if you forget it

Nothing is ever lost with a forgotten passphrase: Letterboxd itself is the
source of truth, and a new vault can always be cut from a fresh export with
a brand-new passphrase.

1. Get raw data locally, either way:
   - reuse the gitignored `export/` folder if you still have it, or
   - Letterboxd → Settings → Data → **Export your data**, unzip into `export/`.
2. Cut a new print with the new passphrase (you'll be prompted twice):
   ```sh
   TMDB_KEY=<your key> node tools/build-vault.mjs ./export --name "S"
   ```
3. Ship it:
   ```sh
   git add data/ && git commit -m "Re-key the vault" && git push
   ```
4. Update the `VAULT_PASS` repository secret to the new passphrase
   (Settings → Secrets and variables → Actions), so the auto-refresh can
   keep working.

That's it — the old ciphertext is dead, the new passphrase is the only key.

### Full rebuild (rare)

Same four steps as above. Only needed if you backfill or edit Letterboxd
diary entries older than the feed's ~50-entry window, re-rate films without
rewatching, or change the watchlist and care about that number.

### Run the refresh by hand

Actions tab → **refresh-vault** → *Run workflow*. It prints `CHANGED` or
`NO-CHANGE` and commits only when something moved.

---

Not affiliated with Letterboxd. Film metadata: this product uses the
[TMDB](https://www.themoviedb.org/) API but is not endorsed or certified by TMDB.
