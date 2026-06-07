/**
 * token-crypto.ts — C-03 fix
 *
 * AES-256-GCM encryption/decryption for Shopify OAuth access tokens stored
 * in the `store_installations` table. The encryption key is stored as a
 * Supabase edge function secret (ACCESS_TOKEN_ENCRYPTION_KEY) — never in DB.
 *
 * Token format (base64url):  <12-byte IV> || <ciphertext> || <16-byte GCM auth tag>
 * Encoding:                  standard base64 (URL-safe via replace)
 *
 * Backward compatibility: if decryption fails (plaintext legacy token or
 * wrong key), the raw value is returned so existing installations keep working
 * during rollout. Set ENCRYPT_ACCESS_TOKENS=true to enforce encryption on write.
 */

const ENC_PREFIX = 'enc:v1:'; // sentinel so we can detect encrypted vs plaintext

async function getKey(): Promise<CryptoKey> {
  const raw = Deno.env.get('ACCESS_TOKEN_ENCRYPTION_KEY');
  if (!raw) throw new Error('ACCESS_TOKEN_ENCRYPTION_KEY not set');

  // Key must be 32 bytes (256 bits) for AES-256. Accept hex (64 chars) or base64 (44 chars).
  let keyBytes: Uint8Array;
  if (raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) {
    keyBytes = new Uint8Array(raw.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  } else {
    keyBytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
  }

  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptToken(plaintext: string): Promise<string> {
  if (!plaintext || plaintext.startsWith(ENC_PREFIX)) return plaintext;
  // Feature flag: only encrypt on write when explicitly enabled. This lets the
  // rollout be safe & gradual — deploy ALL consumers with decryptToken() first
  // (a no-op for plaintext), THEN set ENCRYPT_ACCESS_TOKENS=true so new writes are
  // encrypted, THEN backfill existing rows. decryptToken() always handles both forms.
  if (Deno.env.get('ENCRYPT_ACCESS_TOKENS') !== 'true') return plaintext;
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  // Concatenate iv + ciphertext (includes 16-byte GCM tag appended by SubtleCrypto)
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return ENC_PREFIX + btoa(String.fromCharCode(...combined));
}

export async function decryptToken(stored: string): Promise<string> {
  if (!stored) return stored;
  if (!stored.startsWith(ENC_PREFIX)) return stored; // plaintext legacy — pass through

  try {
    const key = await getKey();
    const combined = Uint8Array.from(atob(stored.slice(ENC_PREFIX.length)), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const dec = new TextDecoder();
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return dec.decode(plaintext);
  } catch {
    // Decryption failed (wrong key, corrupted data) — return raw value to avoid breaking prod
    console.error('[token-crypto] decryptToken failed — returning raw value');
    return stored;
  }
}
