#!/usr/bin/env node
/**
 * Recut the vault from `data/source.enc` alone: no Letterboxd export needed.
 *
 * `build-vault.mjs` starts from a fresh export, which is the wrong tool after a
 * scheduled RSS refresh has already merged newer watches into source.enc: it
 * would rebuild from the older export and quietly drop them. Use this whenever
 * the insights engine or the shelves change and the diary itself has not:
 *
 *   VAULT_PASS=... TMDB_KEY=... node tools/rebuild-from-source.mjs
 *
 * Source of truth stays source.enc; only vault.enc is rewritten, and the
 * projectionist's print history is carried across with a note.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeInsights } from '../lib/insights.js';
import { encryptVault, decryptVault } from '../lib/vaultcrypto.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_PATH = join(ROOT, 'data', 'source.enc');
const OUT_PATH = join(ROOT, 'data', 'vault.enc');

const VAULT_PASS = process.env.VAULT_PASS;
const TMDB_KEY = process.env.TMDB_KEY;
if (!VAULT_PASS) {
  console.error('VAULT_PASS is required (the vault passphrase).');
  process.exit(1);
}

const src = await decryptVault(readFileSync(SRC_PATH, 'utf8'), VAULT_PASS);
console.log(`source.enc: ${src.diary.length} diary entries, ${Object.keys(src.films || {}).length} enriched films.`);

src.generatedAt = new Date().toISOString().slice(0, 10);
const insights = computeInsights(src);
console.log(`Insights: ${insights.totals.uniqueFilms} films, ${insights.totals.hours} hours.`);

if (TMDB_KEY) {
  console.log('Rebuilding recommendation shelves…');
  const { buildRecs } = await import('./recs-build.mjs');
  insights.recs = await buildRecs(src, TMDB_KEY);
} else {
  console.log('No TMDB_KEY: shelves skipped (the vault will carry insights only).');
}

// the projectionist's log survives a recut, with this one noted
const history = [...(src.printHistory || [])];
const line = { d: src.generatedAt, n: 'recut from source (shelves rebuilt)' };
while (history.length && history[history.length - 1].d === line.d && history[history.length - 1].n === line.n) {
  history.pop();
}
history.push(line);
insights.printHistory = history.slice(-80);
src.printHistory = insights.printHistory;

writeFileSync(OUT_PATH, await encryptVault(insights, VAULT_PASS));
writeFileSync(SRC_PATH, await encryptVault(src, VAULT_PASS));
console.log(`Wrote ${OUT_PATH} (${Math.round(readFileSync(OUT_PATH).length / 1024)} KB). Commit data/ and push.`);
