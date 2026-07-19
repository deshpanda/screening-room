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

## Refreshing the data (owner's ritual)

1. Download your film-diary data export (ZIP of CSVs) and unzip it locally:
   `unzip export.zip -d export/` (the folder is gitignored).
2. `TMDB_KEY=<your key> node tools/build-vault.mjs ./export --name "S"`
   — you'll be prompted for the vault passphrase (never stored).
   Add `--no-enrich` to skip TMDB (no genres/directors/runtimes).
3. Commit the updated `data/vault.enc` and push. Done.

`node --test` runs the suite (CSV parsing, insights math, crypto round-trip).

Film metadata: this product uses the [TMDB](https://www.themoviedb.org/) API
but is not endorsed or certified by TMDB.
