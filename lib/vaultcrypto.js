// Vault encryption — the whole privacy model of this site.
//
// The repo and the hosted page are PUBLIC; the data is not. Insights are
// encrypted locally (tools/build-vault.mjs) into data/vault.enc and decrypted
// only in the visitor's browser with the passphrase. No passphrase, no data.
//
// Format (before base64): "SRV1" | salt(16) | iv(12) | AES-256-GCM ciphertext
// Key: PBKDF2-SHA256, 310,000 iterations. Works in Node 18+ and every modern
// browser via WebCrypto — this exact file is imported by both.

const MAGIC = new TextEncoder().encode('SRV1');
export const PBKDF2_ITERATIONS = 310000;

const te = new TextEncoder();
const td = new TextDecoder();

function toB64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64) {
  const s = atob(b64.trim());
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Derive the AES key's raw bytes from a passphrase + salt. */
export async function deriveKeyBytes(passphrase, salt) {
  const base = await crypto.subtle.importKey('raw', te.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    base,
    256,
  );
  return new Uint8Array(bits);
}

async function importAesKey(rawBytes, usages) {
  return crypto.subtle.importKey('raw', rawBytes, 'AES-GCM', false, usages);
}

/** Encrypt any JSON-serialisable object with a passphrase → base64 envelope. */
export async function encryptVault(obj, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyBytes = await deriveKeyBytes(passphrase, salt);
  const key = await importAesKey(keyBytes, ['encrypt']);
  const plaintext = te.encode(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  const out = new Uint8Array(MAGIC.length + salt.length + iv.length + ct.length);
  out.set(MAGIC, 0);
  out.set(salt, MAGIC.length);
  out.set(iv, MAGIC.length + salt.length);
  out.set(ct, MAGIC.length + salt.length + iv.length);
  return toB64(out);
}

function splitEnvelope(b64) {
  const bytes = fromB64(b64);
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) throw new Error('Not a vault file');
  }
  const salt = bytes.slice(4, 20);
  const iv = bytes.slice(20, 32);
  const ct = bytes.slice(32);
  return { salt, iv, ct };
}

/** Decrypt with a passphrase. Throws on a wrong passphrase (GCM auth fails). */
export async function decryptVault(b64, passphrase) {
  const { salt, iv, ct } = splitEnvelope(b64);
  const keyBytes = await deriveKeyBytes(passphrase, salt);
  return decryptCore(keyBytes, iv, ct);
}

async function decryptCore(keyBytes, iv, ct) {
  const key = await importAesKey(keyBytes, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(td.decode(pt));
}

/** Salt of an envelope (so a session can re-derive/reuse a cached key). */
export function envelopeSalt(b64) {
  return splitEnvelope(b64).salt;
}

/** Decrypt with pre-derived key bytes (for same-tab session restore). */
export async function decryptWithKeyBytes(b64, keyBytes) {
  const { iv, ct } = splitEnvelope(b64);
  return decryptCore(keyBytes, iv, ct);
}

export const b64 = { to: toB64, from: fromB64 };
