# 🎞 The Screening Room

**A private film dashboard hiding in plain sight.**

This is a single-viewer site: one person's complete film-watching history —
hours in the dark, streaks, genres, most-watched directors, a contrarian
index against the crowd — rendered as a dark little cinema and locked behind
a passphrase. The repo and the page are fully public; the data is not.

```
you ──▶ passphrase ──▶ PBKDF2 (310k) ──▶ AES-256-GCM ──▶ your film life
anyone else ─────────────────────────────────────────▶ ciphertext
```

## How the privacy works

- The only data in this repo is [`data/vault.enc`](data/vault.enc) and
  [`data/source.enc`](data/source.enc) — AES-256-GCM ciphertext. Decryption
  happens **only in the visitor's browser** ([`lib/vaultcrypto.js`](lib/vaultcrypto.js)),
  with a key derived from the passphrase via PBKDF2-SHA256 at 310,000
  iterations. Wrong passphrase, no picture.
- No usernames, account identifiers, API keys or raw exports exist anywhere
  in the repository — see [`.gitignore`](.gitignore). The gate carries
  `noindex` and `robots.txt` blocks crawlers.
- The lock is real cryptography, not a hidden `<div>` — and therefore exactly
  as strong as the passphrase. Choose accordingly.

## How it stays fresh (zero maintenance)

A scheduled workflow ([`.github/workflows/refresh.yml`](.github/workflows/refresh.yml))
runs twice a week: it reads the owner's public diary feed, merges any new
entries into the encrypted source, enriches new films with genres, runtimes
and credits, recomputes every insight, re-encrypts, and commits — at which
point the page redeploys itself. Credentials live only in Actions secrets
(`LB_USER`, `VAULT_PASS`, `TMDB_KEY`), masked in logs.

The one-time seed came from a full data export; the feed keeps it current
from there. No servers, no cron boxes, no cost.

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

Nothing is ever lost with a forgotten passphrase: the source of truth is
your diary itself, and a new vault can always be cut from a fresh export
with a brand-new passphrase.

1. Get raw data locally, either way:
   - reuse the gitignored `export/` folder if you still have it, or
   - download a fresh export (your film site → Settings → Data → Export)
     and unzip it into `export/`.
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

Same four steps as above. Only needed if you backfill or edit diary entries
older than the feed's ~50-entry window, re-rate films without rewatching, or
change the watchlist and care about that number.

### Run the refresh by hand

Actions tab → **refresh-vault** → *Run workflow*. It prints `CHANGED` or
`NO-CHANGE` and commits only when something moved.

---

Film metadata: this product uses the [TMDB](https://www.themoviedb.org/) API
but is not endorsed or certified by TMDB.
