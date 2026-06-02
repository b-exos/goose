/**
 * Database abstraction for the Goose store.
 *
 * `GooseDatabase` is the minimal async surface the repositories use. It is a structural
 * subset of expo-sqlite's `SQLiteDatabase`, so at runtime the expo database can be passed
 * directly; in tests a `better-sqlite3`-backed adapter implements the same interface.
 *
 * This replaces the Rust `GooseStore` connection (`docs/rust-reference/src/store.rs`).
 */
import { OVERNIGHT_MIRROR_SQL, SCHEMA_SQL } from './schema';

/** Values that can be bound to a SQL statement. */
export type SqlValue = string | number | null | Uint8Array;

/** Result of a write statement. */
export interface RunResult {
  lastInsertRowId: number;
  changes: number;
}

/**
 * Minimal async DB surface (subset of expo-sqlite's SQLiteDatabase).
 * `params` is always passed as an array for consistency across drivers.
 */
export interface GooseDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: SqlValue[]): Promise<RunResult>;
  getFirstAsync<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
}

/** Create the schema if absent. Idempotent (all DDL is `IF NOT EXISTS`). */
export async function migrate(db: GooseDatabase): Promise<void> {
  await db.execAsync(SCHEMA_SQL);
  await db.execAsync(OVERNIGHT_MIRROR_SQL);
}

/** Read the SQLite `user_version` pragma (14 once migrated). */
export async function schemaVersion(db: GooseDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/**
 * Open (or create) the on-device database and run migrations. Runtime-only — imports
 * expo-sqlite lazily so the pure-logic/test paths never pull in the native module.
 */
export async function openGooseDatabase(name = 'goose.db'): Promise<GooseDatabase> {
  const SQLite = await import('expo-sqlite');
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await migrate(db as unknown as GooseDatabase);
  return db as unknown as GooseDatabase;
}
