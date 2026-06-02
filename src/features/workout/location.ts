/**
 * Workout GPS distance tracking via expo-location.
 *
 * Replaces the Swift `ActivityLocationTracker`. The haversine math is pure and unit-tested;
 * the tracker watches position updates and accumulates traveled distance, filtering jitter.
 */
import type { LocationSubscription } from 'expo-location';

export interface LatLng {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance between two coordinates, in meters. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Minimum step (m) between fixes to count toward distance — filters GPS jitter. */
const MIN_STEP_METERS = 2;

/**
 * Accumulates traveled distance from a stream of location fixes. Pure to feed/read;
 * `start` attaches a native watcher.
 */
export class WorkoutLocationTracker {
  private last: LatLng | null = null;
  private subscription: LocationSubscription | null = null;
  distanceMeters = 0;

  /** Feed a fix; returns the updated total distance. Ignores sub-jitter movement. */
  addFix(point: LatLng): number {
    if (this.last !== null) {
      const step = haversineMeters(this.last, point);
      if (step >= MIN_STEP_METERS) {
        this.distanceMeters += step;
        this.last = point;
      }
    } else {
      this.last = point;
    }
    return this.distanceMeters;
  }

  /** Request permission and begin watching position, feeding fixes into `addFix`. */
  async start(onDistance?: (meters: number) => void): Promise<void> {
    const Location = await import('expo-location');
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') throw new Error('location permission not granted');
    this.subscription = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: MIN_STEP_METERS },
      (location) => {
        const meters = this.addFix({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        });
        onDistance?.(meters);
      },
    );
  }

  /** Stop watching and return the final distance. */
  stop(): number {
    this.subscription?.remove();
    this.subscription = null;
    return this.distanceMeters;
  }
}
