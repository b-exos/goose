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

/**
 * UTC bounds for a local calendar day. `created_at` is stored in UTC, so the window must be
 * the local-midnight instants converted to UTC — otherwise, when local and UTC dates differ
 * (e.g. evening in a UTC-behind zone), the day's freshly-captured frames fall outside it.
 */
export function dayWindowIso(dateKey: string): { startIso: string; endIso: string } {
  const [year, month, day] = dateKey.split('-').map(Number);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0); // local midnight
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/** Lightweight counts from the last recompute, to make "why is X empty" visible in the UI. */
export interface HealthDebug {
  hrSamples: number;
  motionSamples: number;
}

interface HealthState {
  today: DailyMetricsSummary | null;
  debug: HealthDebug | null;
  loading: boolean;
  load: (db: GooseDatabase, dateKey: string) => Promise<void>;
  refresh: (db: GooseDatabase, dateKey: string, timezone?: string) => Promise<void>;
}

export const useHealthStore = create<HealthState>((set) => ({
  today: null,
  debug: null,
  loading: false,

  load: async (db, dateKey) => {
    set({ loading: true });
    try {
      const today = await loadDailyMetrics(db, dateKey);
      set({ today });
    } finally {
      set({ loading: false });
    }
  },

  refresh: async (db, dateKey, timezone = 'UTC') => {
    set({ loading: true });
    try {
      const { startIso, endIso } = dayWindowIso(dateKey);
      const metrics = await runDailyRollup(db, { dateKey, startIso, endIso, timezone, profile: {} });
      const today = await loadDailyMetrics(db, dateKey);
      set({ today, debug: { hrSamples: metrics.hrSampleCount, motionSamples: metrics.motionSampleCount } });
    } finally {
      set({ loading: false });
    }
  },
}));
