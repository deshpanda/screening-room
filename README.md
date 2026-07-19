# The Screening Room

A private, single-viewer dashboard of one person's film-watching history.
Static site, no dependencies, hosted on GitHub Pages.

**The privacy model, since the repo and the page are public:**

- The dashboard data lives in [`data/vault.enc`](data/vault.enc) —
  AES-256-GCM ciphertext, key derived from a passphrase with PBKDF2-SHA256
  (310k iterations). Decryption happens only in the visitor's browser
  ([`lib/vaultcrypto.js`](lib/vaultcrypto.js)). No passphrase, no data.
- No account identifiers, source usernames, or API keys exist anywhere in
  this repository. The raw export, the enrichment cache and the keys stay on
  the owner's machine (see `.gitignore`).
- `robots.txt` and `noindex` keep the gate out of search engines.

## Refreshing the data

A scheduled workflow (`.github/workflows/refresh.yml`) merges new entries
from a public feed twice a week and re-encrypts — credentials live only in
Actions secrets. Full rebuilds from a data export (rare) are documented in
`DEPLOY.md`; the raw export never enters the repo.

`node --test` runs the suite (CSV parsing, insights math, crypto round-trip).

Film metadata: this product uses the [TMDB](https://www.themoviedb.org/) API
but is not endorsed or certified by TMDB.
