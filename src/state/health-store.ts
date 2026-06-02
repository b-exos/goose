/**
 * Holds the day's computed metrics for the UI. `load` reads persisted values; `refresh`
 * recomputes the day from captured frames (runs the daily rollup) and then reads them back.
 */
import { create } from 'zustand';
import { runDailyRollup } from '../core/pipeline/daily-rollup';
import { loadDailyMetrics, type DailyMetricsSummary } from '../core/store/daily-metrics-repository';
import type { GooseDatabase } from '../core/store/db';

/** Local date key (YYYY-MM-DD) for `date`. */
export function dateKeyOf(date: Date): string {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}

function dayWindowIso(dateKey: string): { startIso: string; endIso: string } {
  const start = new Date(`${dateKey}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

interface HealthState {
  today: DailyMetricsSummary | null;
  loading: boolean;
  load: (db: GooseDatabase, dateKey: string) => Promise<void>;
  refresh: (db: GooseDatabase, dateKey: string, timezone?: string) => Promise<void>;
}

export const useHealthStore = create<HealthState>((set) => ({
  today: null,
  loading: false,

  load: async (db, dateKey) => {
    set({ loading: true });
    const today = await loadDailyMetrics(db, dateKey);
    set({ today, loading: false });
  },

  refresh: async (db, dateKey, timezone = 'UTC') => {
    set({ loading: true });
    const { startIso, endIso } = dayWindowIso(dateKey);
    await runDailyRollup(db, { dateKey, startIso, endIso, timezone, profile: {} });
    const today = await loadDailyMetrics(db, dateKey);
    set({ today, loading: false });
  },
}));
