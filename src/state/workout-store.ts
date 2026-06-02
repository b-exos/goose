/**
 * Active-workout state: drives the Live Activity / ongoing notification, a GPS tracker, and
 * an elapsed-time ticker. Pulls live heart rate from the BLE store for the status surface.
 */
import { create } from 'zustand';
import {
  endWorkout as endLiveActivity,
  startWorkout as startLiveActivity,
  updateWorkout as updateLiveActivity,
} from '../features/workout/live-activity-controller';
import { WorkoutLocationTracker } from '../features/workout/location';
import type { WorkoutActivityProps } from '../widgets/workout-activity';
import { useBleStore } from './ble-store';

interface WorkoutState {
  isRecording: boolean;
  activityName: string;
  startedAtMs: number | null;
  elapsedSeconds: number;
  distanceMeters: number;
  start: (activityName?: string) => void;
  stop: () => void;
}

let ticker: ReturnType<typeof setInterval> | null = null;
let tracker: WorkoutLocationTracker | null = null;

function currentProps(state: WorkoutState, isPaused = false): WorkoutActivityProps {
  return {
    activityName: state.activityName,
    status: isPaused ? 'Paused' : 'In progress',
    elapsedSeconds: state.elapsedSeconds,
    currentHeartRate: useBleStore.getState().liveHeartRate,
    activeCalories: null,
    distanceMeters: state.distanceMeters,
    isPaused,
  };
}

export const useWorkoutStore = create<WorkoutState>((set, get) => ({
  isRecording: false,
  activityName: 'Workout',
  startedAtMs: null,
  elapsedSeconds: 0,
  distanceMeters: 0,

  start: (activityName = 'Workout') => {
    if (get().isRecording) return;
    set({ isRecording: true, activityName, startedAtMs: Date.now(), elapsedSeconds: 0, distanceMeters: 0 });
    void startLiveActivity(currentProps(get()));

    tracker = new WorkoutLocationTracker();
    void tracker.start((meters) => set({ distanceMeters: meters })).catch(() => undefined);

    ticker = setInterval(() => {
      const { startedAtMs } = get();
      if (startedAtMs == null) return;
      set({ elapsedSeconds: Math.floor((Date.now() - startedAtMs) / 1000) });
      void updateLiveActivity(currentProps(get()));
    }, 1000);
  },

  stop: () => {
    if (!get().isRecording) return;
    if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }
    const finalDistance = tracker?.stop() ?? get().distanceMeters;
    tracker = null;
    void endLiveActivity({ ...currentProps(get()), status: 'Completed', distanceMeters: finalDistance });
    set({ isRecording: false, startedAtMs: null });
  },
}));
