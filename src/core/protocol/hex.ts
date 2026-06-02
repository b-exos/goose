/**
 * Hex encode/decode helpers for the frame protocol.
 * Ported from `decode_hex_with_whitespace` in `docs/rust-reference/src/protocol.rs`.
 */

/** Encode bytes as a lowercase hex string (no separators). */
export function encodeHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

/** Decode a hex string (ignoring any ASCII whitespace) into bytes. Throws on bad input. */
export function decodeHexWithWhitespace(hexValue: string): Uint8Array {
  const stripped = /\s/.test(hexValue) ? hexValue.replace(/\s+/g, '') : hexValue;
  if (stripped.length % 2 !== 0) {
    throw new Error('hex string has odd length');
  }
  const out = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`invalid hex at byte ${i}`);
    }
    out[i] = byte;
  }
  return out;
}

/** Read a little-endian u16 at `offset`, or null if out of bounds. */
export function readU16Le(bytes: Uint8Array, offset: number): number | null {
  if (offset + 1 >= bytes.length) return null;
  return bytes[offset] | (bytes[offset + 1] << 8);
}

/** Read a little-endian u32 at `offset`, or null if out of bounds. */
export function readU32Le(bytes: Uint8Array, offset: number): number | null {
  if (offset + 3 >= bytes.length) return null;
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

/** Read a little-endian signed i16 at `offset`, or null if out of bounds. */
export function readI16Le(bytes: Uint8Array, offset: number): number | null {
  if (offset + 1 >= bytes.length) return null;
  const raw = bytes[offset] | (bytes[offset + 1] << 8);
  return raw > 0x7fff ? raw - 0x10000 : raw;
}
