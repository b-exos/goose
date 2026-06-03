/** Tests sleep-window detection (clustering + disturbances + HR dip) and scoring. */
import type { HeartRateSample, MotionSample } from '../features/resting-hr';
import { computeSleepScore, detectSleepWindow } from './sleep-window';

const T = Date.parse('2026-05-27T22:00:00.000Z'); // sleep onset
const PRE = 30; // 30 min of pre-sleep "awake"
const MIN = 60_000;

// Timeline: 30 min awake (moving) → 480 min asleep (still) with a 3-min disturbance.
function buildNight(): { motion: MotionSample[]; hr: HeartRateSample[] } {
  const motion: MotionSample[] = [];
  const hr: HeartRateSample[] = [];
  const firstMs = T - PRE * MIN;
  for (let m = 0; m < PRE + 480; m++) {
    const timeUnixMs = firstMs + m * MIN;
    const awakeMinute = m < PRE || (m >= PRE + 200 && m < PRE + 203); // pre-sleep + disturbance
    motion.push({ timeUnixMs, motionIntensity0To1: awakeMinute ? 0.5 : 0.01 });
    const bpm = m < PRE ? 70 : m === PRE + 220 ? 50 : 60;
    hr.push({ id: `${m}`, timeUnixMs, heartRateBpm: bpm });
  }
  return { motion, hr };
}

describe('sleep-window detection', () => {
  it('detects the window, disturbance, and HR dip', () => {
    const { motion, hr } = buildNight();
    const w = detectSleepWindow(motion, hr)!;
    expect(w).not.toBeNull();
    expect(w.startMs).toBe(T);
    expect(w.timeInBedMinutes).toBe(480);
    expect(w.sleepDurationMinutes).toBe(477); // 480 - 3 disturbed minutes
    expect(w.awakeMinutes).toBe(3);
    expect(w.disturbanceCount).toBe(1);
    expect(w.heartRateDipPercent).toBeCloseTo(((70 - 50) / 70) * 100, 6);
  });

  it('scores the detected window with sleep v0', () => {
    const { motion, hr } = buildNight();
    const w = detectSleepWindow(motion, hr)!;
    const result = computeSleepScore(w, '2026-05-27T22:00:00Z', '2026-05-28T06:00:00Z');
    expect(result.output).not.toBeNull();
    expect(result.output!.sleepDebtMinutes).toBeCloseTo(3, 6); // need 480 - asleep 477
    expect(result.output!.score0To100).toBeGreaterThan(0);
  });

  it('returns null without enough data', () => {
    expect(detectSleepWindow([], [])).toBeNull();
  });

  it('does not report sedentary daytime rest (flat HR, no dip) as sleep', () => {
    // 300 min sitting still at a flat ~60 bpm, minimal motion — no HR dip ⇒ not sleep.
    const hr: HeartRateSample[] = [];
    const motion: MotionSample[] = [];
    const start = Date.parse('2026-05-27T14:00:00.000Z');
    for (let m = 0; m < 300; m++) {
      hr.push({ id: `${m}`, timeUnixMs: start + m * MIN, heartRateBpm: 60 });
      motion.push({ timeUnixMs: start + m * MIN, motionIntensity0To1: 0.02 });
    }
    expect(detectSleepWindow(motion, hr)).toBeNull();
  });

  it('detects the night from HR alone when motion is absent (history sync)', () => {
    // 120 min active (HR ~90) then 300 min sleeping (HR ~55), no motion samples at all.
    const hr: HeartRateSample[] = [];
    const start = Date.parse('2026-05-27T20:00:00.000Z');
    for (let m = 0; m < 420; m++) {
      const bpm = m < 120 ? 90 : 55;
      hr.push({ id: `${m}`, timeUnixMs: start + m * MIN, heartRateBpm: bpm });
    }
    const w = detectSleepWindow([], hr)!;
    expect(w).not.toBeNull();
    // Window starts at the HR drop (~minute 120) and runs to the end.
    expect(w.startMs).toBe(start + 120 * MIN);
    expect(w.sleepDurationMinutes).toBeGreaterThanOrEqual(290);
  });
});
