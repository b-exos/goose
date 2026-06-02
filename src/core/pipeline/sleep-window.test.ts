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
});
