/**
 * Test-only `GooseDatabase` adapter backed by better-sqlite3 (synchronous, in-memory).
 *
 * Lets the store repositories run under jest in node without the expo-sqlite native
 * module. The SQL is identical to what runs on-device; only the driver differs.
 */
import Database from 'better-sqlite3';
import type { GooseDatabase, RunResult, SqlValue } from '../store/db';

export interface TestDatabase extends GooseDatabase {
  close(): void;
}

/** Open an in-memory SQLite database exposing the async `GooseDatabase` surface. */
export function createTestDatabase(): TestDatabase {
  const db = new Database(':memory:');
  return {
    async execAsync(sql: string): Promise<void> {
      db.exec(sql);
    },
    async runAsync(sql: string, params: SqlValue[] = []): Promise<RunResult> {
      const info = db.prepare(sql).run(...params);
      return { lastInsertRowId: Number(info.lastInsertRowid), changes: info.changes };
    },
    async getFirstAsync<T>(sql: string, params: SqlValue[] = []): Promise<T | null> {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async getAllAsync<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      return db.prepare(sql).all(...params) as T[];
    },
    close(): void {
      db.close();
    },
  };
}
