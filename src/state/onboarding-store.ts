/**
 * Onboarding flow state.
 *
 * Tracks the current step and whether onboarding is complete. Persistence across launches
 * (via expo-sqlite app settings) is a follow-up; for now the flag lives in memory and is set
 * when the user finishes the flow.
 */
import { create } from 'zustand';

export type OnboardingStep = 'welcome' | 'permissions' | 'connect';

const STEP_ORDER: OnboardingStep[] = ['welcome', 'permissions', 'connect'];

interface OnboardingState {
  completed: boolean;
  step: OnboardingStep;
  next: () => void;
  complete: () => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  completed: false,
  step: 'welcome',
  next: () =>
    set((state) => {
      const index = STEP_ORDER.indexOf(state.step);
      const isLast = index >= STEP_ORDER.length - 1;
      return isLast
        ? { completed: true }
        : { step: STEP_ORDER[index + 1] };
    }),
  complete: () => set({ completed: true }),
  reset: () => set({ completed: false, step: 'welcome' }),
}));
