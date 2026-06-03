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
import { ROLLUP_SCHEMA_SQL } from './schema-rollups';

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
  await db.execAsync(ROLLUP_SCHEMA_SQL);
  await addDecodedFramePacketK(db);
}

/**
 * Add + backfill `decoded_frames.packet_k` on databases created before the column existed, so the
 * daily rollup can SQL-filter the high-volume raw-optical frames instead of parsing every row.
 * No-op on fresh DBs (the column is in the CREATE). Best-effort: backfill uses SQLite JSON1.
 */
async function addDecodedFramePacketK(db: GooseDatabase): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(decoded_frames)');
  if (!columns.some((c) => c.name === 'packet_k')) {
    await db.execAsync('ALTER TABLE decoded_frames ADD COLUMN packet_k INTEGER');
    try {
      await db.runAsync(
        "UPDATE decoded_frames SET packet_k = json_extract(parsed_payload_json, '$.packetK') " +
          "WHERE packet_k IS NULL AND parsed_payload_json LIKE '%\"packetK\"%'",
      );
    } catch {
      // JSON1 unavailable — new rows still populate packet_k on insert; old rows stay null.
    }
  }
  // Create the index only after the column is guaranteed to exist (in CREATE or via the ALTER).
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_decoded_frames_extract ON decoded_frames(created_at, packet_k)');
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
