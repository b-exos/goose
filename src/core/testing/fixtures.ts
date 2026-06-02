/**
 * Test-only helpers for loading the preserved Rust fixtures under `/__fixtures__/`.
 *
 * Each `*.fixture.json` carries metadata plus an `expected` block (the golden output
 * the Rust engine produced). Companion input files (`*.json` / `*.hex`) hold the inputs.
 * Golden tests load both and assert the TS engine reproduces `expected`.
 *
 * Node-only (uses `fs`); imported solely from `*.test.ts` files.
 */
import fs from 'fs';
import path from 'path';

/** Absolute path to the repo-root `__fixtures__` directory. */
export const FIXTURES_ROOT = path.resolve(__dirname, '../../../__fixtures__');

/** A `*.fixture.json` document: arbitrary metadata plus the golden `expected` block. */
export interface FixtureDoc<TExpected = unknown> {
  id: string;
  path: string;
  notes?: string;
  expected: TExpected;
  [key: string]: unknown;
}

/** Read and parse a fixture JSON file by path relative to `__fixtures__/`. */
export function loadFixture<TExpected = unknown>(
  relativePath: string,
): FixtureDoc<TExpected> {
  const full = path.join(FIXTURES_ROOT, relativePath);
  return JSON.parse(fs.readFileSync(full, 'utf8')) as FixtureDoc<TExpected>;
}

/** Read and parse an arbitrary JSON input file relative to `__fixtures__/`. */
export function loadJson<T = unknown>(relativePath: string): T {
  const full = path.join(FIXTURES_ROOT, relativePath);
  return JSON.parse(fs.readFileSync(full, 'utf8')) as T;
}

/** Read a raw `.hex` payload fixture as a trimmed string. */
export function loadHex(relativePath: string): string {
  const full = path.join(FIXTURES_ROOT, relativePath);
  return fs.readFileSync(full, 'utf8').trim();
}
