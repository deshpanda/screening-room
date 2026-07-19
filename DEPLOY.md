# Setup (owner's manual steps)

## 1. Rename the repo (recommended, before enabling Pages)

The GitHub repo was created as `letterboxd-insights`, which leaks what the
data is. Rename it: repo → **Settings → General → Repository name** →
`screening-room`. Old URLs redirect automatically, so nothing breaks.

## 2. Push (already wired)

The local remote points at the original name — it keeps working after the
rename via GitHub's redirect. To tidy it up after renaming:

```sh
git remote set-url origin git@github.com-personal:deshpanda/screening-room.git
```

## 3. Enable GitHub Pages

Settings → Pages → Deploy from a branch → `main` / root.
Site: `https://deshpanda.github.io/screening-room/`

Note: on the free plan the repo and the page are public — that's exactly why
everything sensitive ships encrypted. The committed vault is a demo
(passphrase: `preview`) until you build your own.

## 4. Build your real vault

1. Letterboxd → Settings → Data → **Export your data**; unzip into `export/`
   (gitignored — never commit it).
2. Free TMDB key: themoviedb.org → account Settings → API → register as
   Developer (needed for genres/directors/runtimes; skip with `--no-enrich`).
3. ```sh
   TMDB_KEY=xxxx node tools/build-vault.mjs ./export --name "S"
   ```
   Pick a strong passphrase when prompted — it is the entire security model.
   Don't reuse a password from anywhere else.
4. `git add data/vault.enc && git commit -m "Refresh vault" && git push`

Repeat whenever you want fresher numbers (monthly-ish is plenty; the TMDB
cache makes re-runs fast).

## Threat model, honestly

- Anyone can see the ciphertext and this code; nobody without the passphrase
  can read your data (AES-256-GCM, PBKDF2 310k).
- Your Letterboxd username appears nowhere in the repo or the site.
- What a visitor CAN infer: that this GitHub account keeps an encrypted
  film dashboard. That's it.
- The passphrase gate is real crypto, not a hidden div — but it is only as
  strong as the passphrase you choose.
