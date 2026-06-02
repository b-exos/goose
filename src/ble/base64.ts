/**
 * Minimal base64 <-> bytes codec. react-native-ble-plx exchanges characteristic values
 * as base64 strings, and Hermes has no `Buffer`, so we implement it directly.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

/** Encode bytes to a base64 string. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const n = bytes[i] << 16;
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + '==';
  } else if (remaining === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + '=';
  }
  return out;
}

/** Decode a base64 string to bytes (ignores padding/whitespace). */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const byteLength = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(byteLength);
  let outIndex = 0;
  for (let i = 0; i + 3 < clean.length; i += 4) {
    const n =
      (LOOKUP[clean.charCodeAt(i)] << 18) |
      (LOOKUP[clean.charCodeAt(i + 1)] << 12) |
      (LOOKUP[clean.charCodeAt(i + 2)] << 6) |
      LOOKUP[clean.charCodeAt(i + 3)];
    out[outIndex++] = (n >> 16) & 0xff;
    out[outIndex++] = (n >> 8) & 0xff;
    out[outIndex++] = n & 0xff;
  }
  const remaining = clean.length % 4;
  if (remaining === 2) {
    const n = (LOOKUP[clean.charCodeAt(clean.length - 2)] << 18) | (LOOKUP[clean.charCodeAt(clean.length - 1)] << 12);
    out[outIndex++] = (n >> 16) & 0xff;
  } else if (remaining === 3) {
    const n =
      (LOOKUP[clean.charCodeAt(clean.length - 3)] << 18) |
      (LOOKUP[clean.charCodeAt(clean.length - 2)] << 12) |
      (LOOKUP[clean.charCodeAt(clean.length - 1)] << 6);
    out[outIndex++] = (n >> 16) & 0xff;
    out[outIndex++] = (n >> 8) & 0xff;
  }
  return out.subarray(0, outIndex);
}
