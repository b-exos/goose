/** Round-trip + known-vector tests for the base64 codec. */
import { base64ToBytes, bytesToBase64 } from './base64';

describe('base64 codec', () => {
  it('encodes known vectors', () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe('');
    expect(bytesToBase64(new Uint8Array([0x4d]))).toBe('TQ==');
    expect(bytesToBase64(new Uint8Array([0x4d, 0x61]))).toBe('TWE=');
    expect(bytesToBase64(new Uint8Array([0x4d, 0x61, 0x6e]))).toBe('TWFu');
  });

  it('decodes known vectors', () => {
    expect([...base64ToBytes('TQ==')]).toEqual([0x4d]);
    expect([...base64ToBytes('TWE=')]).toEqual([0x4d, 0x61]);
    expect([...base64ToBytes('TWFu')]).toEqual([0x4d, 0x61, 0x6e]);
  });

  it('round-trips arbitrary frame bytes', () => {
    const bytes = new Uint8Array([0xaa, 0x01, 0x08, 0x00, 0x00, 0x01, 0xe6, 0x71, 0x23, 0x01, 0x91, 0x01]);
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });
});
