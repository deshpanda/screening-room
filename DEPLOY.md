# Setup & operations

Done already: repo renamed to `screening-room`, Pages enabled, the real vault
built from a full export and pushed.

## Zero-maintenance mode (recommended): the auto-refresh

`.github/workflows/refresh.yml` runs twice a week (and on demand via the
Actions tab → refresh-vault → Run workflow): it reads the public RSS feed,
merges any new diary entries, enriches new films by their TMDB id, recomputes
insights, re-encrypts, commits. Pages redeploys automatically.

**One-time setup — add three repository secrets**
(Settings → Secrets and variables → Actions → New repository secret):

| Secret | Value |
|---|---|
| `LB_USER` | your Letterboxd username |
| `VAULT_PASS` | the vault passphrase |
| `TMDB_KEY` | your TMDB v3 API key |

Secrets are masked in logs and invisible to visitors. After that: nothing to
maintain.

**What the feed can't carry** (the only reasons to ever re-run a full export):
- backfilled/edited diary entries older than the feed's ~50-entry window
- re-rating films you didn't rewatch, watchlist changes
- GitHub pauses cron jobs after ~60 days with zero repo activity — its own
  commits usually keep it alive; if paused, one click re-enables it.

## Full rebuild (rare)

1. Letterboxd → Settings → Data → **Export your data** → unzip into `export/`
   (gitignored).
2. `TMDB_KEY=xxxx node tools/build-vault.mjs ./export --name "S"`
   — prompts for the passphrase (use the same one as `VAULT_PASS`, or update
   the secret if you change it).
3. `git add data/ && git commit -m "Refresh vault" && git push`

## Rotating the passphrase

Re-run the full rebuild with a new passphrase (the TMDB cache makes it fast),
push, and update the `VAULT_PASS` secret.

## Threat model, honestly

- Anyone can see the ciphertext and this code; nobody without the passphrase
  can read your data (AES-256-GCM, PBKDF2 310k).
- Your Letterboxd username appears nowhere in the repo or the site.
- What a visitor CAN infer: that this GitHub account keeps an encrypted
  film dashboard. That's it.
- The passphrase gate is real crypto, not a hidden div — but it is only as
  strong as the passphrase you choose.
