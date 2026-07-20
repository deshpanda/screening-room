# 🎞 The Screening Room

**A private [Letterboxd](https://letterboxd.com) dashboard hiding in plain sight.**

Letterboxd is the diary; this is the projection booth. Every film logged
there becomes part of a single-viewer site — locked behind a passphrase,
refreshed twice a week by a scheduled workflow, maintained by no one.
The repo and the page are fully public; the data is not.

```
you ──▶ passphrase ──▶ PBKDF2 (310k) ──▶ AES-256-GCM ──▶ your film life
anyone else ─────────────────────────────────────────▶ ciphertext
```

## The rooms

| Page | What's inside |
|---|---|
| **Overview** | Hours in the dark, stat tiles, a year-by-year watch heatmap on one shared scale, the recent diary and the five-star shelf |
| **Stats** | Films per year, a ratings histogram, habits and streaks, taste by genre/decade/runtime, the terra-incognita coverage matrix, most-watched directors and faces, a you-vs-the-crowd scatter, and a wrapped card for every year |
| **Next** | The recommendation desk (below) |
| **Archive** | The full diary — searchable, paginated, every title linked to its Letterboxd page |

## The recommendation desk

Candidates come from TMDB's own per-film recommendation engine (item-based
collaborative filtering over its user base); the owner's ratings weight the
seeds, and a ranker in [`lib/recs.js`](lib/recs.js) aggregates with position
decay, a cubed quality prior, same-title exclusion and an IMDb floor — a
shelf earns trust by what it refuses to show. Each card carries a poster,
TMDB + IMDb scores, runtime and the reason it's there.

- **Master spotlight** — one great director per print, rotating each refresh,
  with their best unseen films as a mini retrospective
- **Because you just watched / From everything you've loved** — recency- and
  lifetime-seeded shelves
- **Short reels & The long haul** — the same engine, cut by runtime
- **The masters program** — canon greats you haven't met, ranked by fit, and
  masters in progress with your seen-counts; the full canon board keeps score
- **Terra incognita** — the emptiest genre × decade cells on your matrix,
  filled by discovery
- **Follow the faces / Unfinished business / Off your watchlist first**
- **The projector bar** — roll one film by length and decade, programme a
  double feature, or budget a whole weekend and let it chain films that pair
- Every shelf exports as CSV in Letterboxd's list-import format
- **Two-seater** (dormant) — build with a second person's export for a shelf
  neither of you has seen, plus a taste-correlation score

IMDb scores come from IMDb's official keyless daily dataset; Letterboxd
links use its per-TMDB-id redirects. Rotten Tomatoes and Letterboxd expose
no free ratings API, so those numbers aren't shown — nothing here scrapes.

## How it stays fresh (zero maintenance)

[`.github/workflows/refresh.yml`](.github/workflows/refresh.yml) runs Monday
and Thursday: reads the owner's public Letterboxd RSS feed (the last ~50
diary entries, TMDB ids included), merges new watches into the encrypted
source, re-enriches, recomputes every insight and shelf, re-encrypts,
commits — and GitHub Pages redeploys itself. Secrets: `LB_USER`,
`VAULT_PASS`, `TMDB_KEY`. The one-time seed came from a full Letterboxd
export; the feed keeps it current from there.

## How the privacy works

- The only data committed is [`data/vault.enc`](data/vault.enc) and
  [`data/source.enc`](data/source.enc) — AES-256-GCM ciphertext, key derived
  from the passphrase (PBKDF2-SHA256, 310k iterations), decrypted **only in
  the visitor's browser** ([`lib/vaultcrypto.js`](lib/vaultcrypto.js)).
- The Letterboxd username appears nowhere in the repo or the site — it lives
  in an Actions secret. Raw exports and API keys stay local, gitignored.
- One unlock carries across the site's pages within a tab; **Lock** ends it.
  `noindex` + `robots.txt` keep crawlers out. The lock is real cryptography,
  exactly as strong as the passphrase.

## Under the hood

Zero dependencies — plain HTML/CSS/JS, hand-rolled SVG charts, no build
step. The heavy lifting happens at vault-build time
([`tools/build-vault.mjs`](tools/build-vault.mjs),
[`tools/update-from-rss.mjs`](tools/update-from-rss.mjs),
[`tools/recs-build.mjs`](tools/recs-build.mjs)); the browser only decrypts
and draws. The pure core — CSV parsing, the insights engine, the
recommendation ranker, the crypto round-trip — is covered by `node --test`.

Owner's operations (re-keying the passphrase, full rebuilds, two-seater
mode) are documented in [`DEPLOY.md`](DEPLOY.md).

---

Not affiliated with Letterboxd. Film metadata: this product uses the
[TMDB](https://www.themoviedb.org/) API but is not endorsed or certified by
TMDB. Ratings data from IMDb's non-commercial datasets.
