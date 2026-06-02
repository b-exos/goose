/** Tests for the pure GPS distance math and jitter filtering. */
import { haversineMeters, WorkoutLocationTracker } from './location';

describe('workout location', () => {
  it('computes great-circle distance between coordinates', () => {
    // ~111.19 km per degree of latitude at the equator
    const oneDegreeNorth = haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
    expect(oneDegreeNorth).toBeGreaterThan(111_000);
    expect(oneDegreeNorth).toBeLessThan(111_400);
    // identical points -> 0
    expect(haversineMeters({ latitude: 40, longitude: -111 }, { latitude: 40, longitude: -111 })).toBeCloseTo(0, 6);
  });

  it('accumulates distance across fixes and ignores sub-jitter movement', () => {
    const tracker = new WorkoutLocationTracker();
    tracker.addFix({ latitude: 40.0, longitude: -111.0 });
    // tiny jitter (< 2m) -> ignored
    tracker.addFix({ latitude: 40.0 + 1e-6, longitude: -111.0 });
    expect(tracker.distanceMeters).toBe(0);
    // ~111m north -> counted
    const total = tracker.addFix({ latitude: 40.001, longitude: -111.0 });
    expect(total).toBeGreaterThan(100);
    expect(total).toBeLessThan(120);
  });
});
