/**
 * Local coach tools — functions the model can call to compute Goose metrics on-device.
 *
 * Replaces the Swift `CoachLocalToolContext`. Each tool maps directly onto a ported,
 * golden-tested algorithm in `src/core/metrics`, so the coach's numbers are the same the
 * app computes. Pure and unit-testable; no network or device dependency.
 */
import { gooseHrvV0, type HrvInput } from '../core/metrics/hrv';
import { gooseRecoveryV0, type RecoveryInput } from '../core/metrics/recovery';
import { gooseSleepV0, type SleepInput } from '../core/metrics/sleep';
import { gooseStrainV0, type StrainInput } from '../core/metrics/strain';
import { gooseStressV0, type StressInput } from '../core/metrics/stress';

/** OpenAI-style function/tool definition. */
export interface CoachTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

const numberProp = (description: string) => ({ type: 'number', description });

export const COACH_TOOLS: CoachTool[] = [
  {
    name: 'compute_hrv',
    description: 'Compute HRV metrics (RMSSD, SDNN, mean NN) from a list of RR intervals in milliseconds.',
    parameters: {
      type: 'object',
      properties: { rrIntervalsMs: { type: 'array', items: { type: 'number' }, description: 'RR intervals (ms)' } },
      required: ['rrIntervalsMs'],
    },
  },
  {
    name: 'compute_recovery',
    description: 'Compute the daily recovery score (0–100) from HRV, RHR, respiration, temperature, sleep, and prior strain.',
    parameters: {
      type: 'object',
      properties: {
        hrvRmssdMs: numberProp('current HRV RMSSD (ms)'),
        hrvBaselineRmssdMs: numberProp('baseline HRV RMSSD (ms)'),
        restingHrBpm: numberProp('resting HR (bpm)'),
        restingHrBaselineBpm: numberProp('baseline resting HR (bpm)'),
        respiratoryRateRpm: numberProp('respiratory rate'),
        respiratoryRateBaselineRpm: numberProp('baseline respiratory rate'),
        skinTempDeltaC: numberProp('skin temperature delta (C)'),
        sleepScore0To100: numberProp('last sleep score'),
        priorStrain0To21: numberProp('prior-day strain (0–21)'),
      },
      required: ['hrvRmssdMs', 'hrvBaselineRmssdMs', 'restingHrBpm', 'restingHrBaselineBpm', 'respiratoryRateRpm', 'respiratoryRateBaselineRpm', 'skinTempDeltaC', 'sleepScore0To100', 'priorStrain0To21'],
    },
  },
  {
    name: 'compute_strain',
    description: 'Compute the daily strain score (0–21) from HR-zone minutes and average HR reserve.',
    parameters: {
      type: 'object',
      properties: {
        durationMinutes: numberProp('duration (min)'),
        restingHrBpm: numberProp('resting HR'),
        averageHrBpm: numberProp('average HR'),
        maxHrBpm: numberProp('max HR'),
        hrZoneMinutes: { type: 'array', items: { type: 'number' }, description: '5 zone minutes' },
      },
      required: ['durationMinutes', 'restingHrBpm', 'averageHrBpm', 'maxHrBpm', 'hrZoneMinutes'],
    },
  },
  {
    name: 'compute_stress',
    description: 'Compute the instantaneous stress score (0–100) from HR elevation and HRV suppression.',
    parameters: {
      type: 'object',
      properties: {
        heartRateBpm: numberProp('current HR'),
        restingHrBpm: numberProp('resting HR'),
        hrvRmssdMs: numberProp('current HRV RMSSD'),
        hrvBaselineRmssdMs: numberProp('baseline HRV RMSSD'),
        motionIntensity0To1: numberProp('motion intensity 0–1'),
      },
      required: ['heartRateBpm', 'restingHrBpm', 'hrvRmssdMs', 'hrvBaselineRmssdMs', 'motionIntensity0To1'],
    },
  },
  {
    name: 'compute_sleep',
    description: 'Compute the sleep score (0–100) from duration, need, time in bed, consistency, and disturbances.',
    parameters: {
      type: 'object',
      properties: {
        sleepDurationMinutes: numberProp('asleep minutes'),
        sleepNeedMinutes: numberProp('sleep need minutes'),
        timeInBedMinutes: numberProp('time in bed minutes'),
        midpointDeviationMinutes: numberProp('midpoint deviation minutes'),
        disturbanceCount: numberProp('disturbance count'),
      },
      required: ['sleepDurationMinutes', 'sleepNeedMinutes', 'timeInBedMinutes', 'midpointDeviationMinutes', 'disturbanceCount'],
    },
  },
];

const WINDOW = { startTime: 'coach', endTime: 'coach', inputIds: ['coach'] };

/** Execute a tool call by name; returns a JSON-serializable result for the model. */
export function executeCoachTool(name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case 'compute_hrv':
      return gooseHrvV0({ ...WINDOW, rrIntervalsMs: args.rrIntervalsMs as number[] } as HrvInput).output;
    case 'compute_recovery':
      return gooseRecoveryV0({ ...WINDOW, ...(args as object) } as RecoveryInput).output;
    case 'compute_strain':
      return gooseStrainV0({ ...WINDOW, ...(args as object) } as StrainInput).output;
    case 'compute_stress':
      return gooseStressV0({ ...WINDOW, ...(args as object) } as StressInput).output;
    case 'compute_sleep':
      return gooseSleepV0({
        ...WINDOW,
        sleepLatencyMinutes: 0,
        wakeAfterSleepOnsetMinutes: 0,
        wakeEpisodeCount: 0,
        stageMinutes: {},
        heartRateDipPercent: null,
        ...(args as object),
      } as SleepInput).output;
    default:
      throw new Error(`unknown coach tool: ${name}`);
  }
}
