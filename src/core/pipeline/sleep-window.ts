/**
 * Sleep-window detection + scoring (MVP heuristic).
 *
 * Bins motion/HR into minutes, finds the longest contiguous low-motion block as the sleep
 * window, derives duration/efficiency/disturbances/HR-dip, and scores it with `gooseSleepV0`.
 * Coarse asleep/awake only — no deep/REM/core stages (that's the full-parity calibrated
 * stager). `sleepNeedMinutes` is a static 8h for MVP until a chronotype model exists.
 */
import type { HeartRateSample, MotionSample } from '../features/resting-hr';
import { gooseSleepV0, type SleepScoreOutput } from '../metrics/sleep';
import type { AlgorithmRunResult } from '../types';

const LOW_MOTION_MAX = 0.08;
const MIN_SLEEP_MINUTES = 120;
const SLEEP_NEED_MINUTES = 480;
const MINUTE_MS = 60_000;
/** Still runs separated by a moving gap no longer than this are merged into one window. */
const MERGE_GAP_MINUTES = 20;

export interface SleepWindow {
  startMs: number;
  endMs: number;
  timeInBedMinutes: number;
  sleepDurationMinutes: number;
  awakeMinutes: number;
  disturbanceCount: number;
  heartRateDipPercent: number | null;
}

/** Detect the primary sleep window from a night's motion + HR. Returns null if none qualifies. */
export function detectSleepWindow(
  motionSamples: MotionSample[],
  hrSamples: HeartRateSample[],
): SleepWindow | null {
  const times = [...motionSamples.map((m) => m.timeUnixMs), ...hrSamples.map((h) => h.timeUnixMs)];
  if (times.length === 0) return null;
  const firstMs = Math.min(...times);
  const lastMs = Math.max(...times);
  const minuteCount = Math.floor((lastMs - firstMs) / MINUTE_MS) + 1;
  if (minuteCount < MIN_SLEEP_MINUTES) return null;

  // Per-minute "moving" flag: true if any motion sample in the minute exceeds the threshold.
  const moving = new Array<boolean>(minuteCount).fill(false);
  for (const m of motionSamples) {
    if (m.motionIntensity0To1 > LOW_MOTION_MAX) {
      const idx = Math.floor((m.timeUnixMs - firstMs) / MINUTE_MS);
      if (idx >= 0 && idx < minuteCount) moving[idx] = true;
    }
  }

  // Still runs (contiguous non-moving minutes), as [start, end) minute indices.
  const stillRuns: { start: number; end: number }[] = [];
  let runStart: number | null = null;
  for (let i = 0; i <= minuteCount; i++) {
    const still = i < minuteCount && !moving[i];
    if (still && runStart === null) runStart = i;
    if (!still && runStart !== null) {
      stillRuns.push({ start: runStart, end: i });
      runStart = null;
    }
  }
  if (stillRuns.length === 0) return null;

  // Merge still runs separated by short moving gaps into clusters; pick the most-asleep one.
  let best: { start: number; end: number; sleepMinutes: number; disturbances: number } | null = null;
  let clusterStart = stillRuns[0].start;
  let clusterEnd = stillRuns[0].end;
  let sleepMinutes = stillRuns[0].end - stillRuns[0].start;
  let disturbances = 0;
  const consider = () => {
    if (sleepMinutes >= MIN_SLEEP_MINUTES && (!best || sleepMinutes > best.sleepMinutes)) {
      best = { start: clusterStart, end: clusterEnd, sleepMinutes, disturbances };
    }
  };
  for (let r = 1; r < stillRuns.length; r++) {
    const run = stillRuns[r];
    if (run.start - clusterEnd <= MERGE_GAP_MINUTES) {
      clusterEnd = run.end;
      sleepMinutes += run.end - run.start;
      disturbances += 1;
    } else {
      consider();
      clusterStart = run.start;
      clusterEnd = run.end;
      sleepMinutes = run.end - run.start;
      disturbances = 0;
    }
  }
  consider();
  if (!best) return null;
  const cluster: { start: number; end: number; sleepMinutes: number; disturbances: number } = best;

  const startMs = firstMs + cluster.start * MINUTE_MS;
  const endMs = firstMs + cluster.end * MINUTE_MS;
  const timeInBedMinutes = cluster.end - cluster.start;

  return {
    startMs,
    endMs,
    timeInBedMinutes,
    sleepDurationMinutes: cluster.sleepMinutes,
    awakeMinutes: timeInBedMinutes - cluster.sleepMinutes,
    disturbanceCount: cluster.disturbances,
    heartRateDipPercent: heartRateDip(hrSamples, startMs, endMs),
  };
}

/** Percent HR dip from pre-sleep average to in-window minimum, or null without data. */
function heartRateDip(hrSamples: HeartRateSample[], startMs: number, endMs: number): number | null {
  const inWindow = hrSamples.filter((h) => h.timeUnixMs >= startMs && h.timeUnixMs < endMs);
  const preSleep = hrSamples.filter((h) => h.timeUnixMs >= startMs - 30 * MINUTE_MS && h.timeUnixMs < startMs);
  if (inWindow.length === 0 || preSleep.length === 0) return null;
  const minSleepHr = Math.min(...inWindow.map((h) => h.heartRateBpm));
  const preAvg = preSleep.reduce((s, h) => s + h.heartRateBpm, 0) / preSleep.length;
  if (preAvg <= 0) return null;
  return Math.max(((preAvg - minSleepHr) / preAvg) * 100, 0);
}

/** Score a detected sleep window with sleep v0 (no per-stage breakdown). */
export function computeSleepScore(
  window: SleepWindow,
  startTime: string,
  endTime: string,
): AlgorithmRunResult<SleepScoreOutput> {
  return gooseSleepV0({
    startTime,
    endTime,
    sleepDurationMinutes: window.sleepDurationMinutes,
    sleepNeedMinutes: SLEEP_NEED_MINUTES,
    timeInBedMinutes: window.timeInBedMinutes,
    midpointDeviationMinutes: 0,
    disturbanceCount: window.disturbanceCount,
    sleepLatencyMinutes: 0,
    wakeAfterSleepOnsetMinutes: window.awakeMinutes,
    wakeEpisodeCount: window.disturbanceCount,
    stageMinutes: {},
    heartRateDipPercent: window.heartRateDipPercent,
    inputIds: ['pipeline.sleep-window'],
  });
}
