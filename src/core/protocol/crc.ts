/**
 * Checksums used by the WHOOP frame protocol.
 *
 * Ported from `docs/rust-reference/src/protocol.rs` (`crc16_modbus`, `crc8`) plus
 * the CRC-32/IEEE used for the payload CRC (the Rust core used `crc32fast::hash`,
 * which is the standard zlib CRC-32). Bit-exact reproduction is required for the
 * `header_crc_valid` / `payload_crc_valid` flags to match the golden fixtures.
 */

/** CRC-16/Modbus (poly 0xA001 reflected, init 0xFFFF). Used for the 8-byte header CRC. */
export function crc16Modbus(data: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}

/** CRC-8 (poly 0x07, init 0x00, MSB-first). Used for the 4-byte Gen4 header CRC. */
export function crc8(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc & 0xff;
}

// Precomputed CRC-32/IEEE table (reflected poly 0xEDB88320).
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32/IEEE (zlib-compatible), matching the Rust `crc32fast::hash`. Returns a u32. */
export function crc32Ieee(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
