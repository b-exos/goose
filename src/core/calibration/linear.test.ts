/** Golden parity test for linear calibration against the recovery fixture. */
import { evaluateLinearCalibration, type CalibrationDataset, type CalibrationRecord } from './linear';
import { loadFixture, loadJson } from '../testing/fixtures';

interface RecordJson {
  record_id: string;
  captured_at: string;
  session_id?: string;
  metric_family: string;
  algorithm_id: string;
  algorithm_version: string;
  prediction: number;
  label: number;
}

interface CalibrationExpected {
  algorithm_id: string;
  version: string;
  split_at: string;
  slope: number;
  intercept: number;
  holdout_mae_after: number;
}

describe('evaluateLinearCalibration (golden)', () => {
  it('recovers slope/intercept and a zero holdout MAE for the linear fixture', () => {
    const raw = loadJson<{ schema: string; records: RecordJson[] }>(
      'synthetic/recovery_calibration_linear.json',
    );
    const { expected } = loadFixture<CalibrationExpected>(
      'synthetic/recovery_calibration_linear.fixture.json',
    );

    const dataset: CalibrationDataset = {
      schema: raw.schema,
      records: raw.records.map<CalibrationRecord>((r) => ({
        recordId: r.record_id,
        capturedAt: r.captured_at,
        sessionId: r.session_id ?? null,
        metricFamily: r.metric_family,
        algorithmId: r.algorithm_id,
        algorithmVersion: r.algorithm_version,
        prediction: r.prediction,
        label: r.label,
      })),
    };

    const report = evaluateLinearCalibration(dataset, {
      metricFamily: 'recovery',
      algorithmId: expected.algorithm_id,
      algorithmVersion: expected.version,
      splitAt: expected.split_at,
      minTrainRows: 3,
      minHoldoutRows: 1,
    });

    expect(report.pass).toBe(true);
    expect(report.model?.slope).toBeCloseTo(expected.slope, 9);
    expect(report.model?.intercept).toBeCloseTo(expected.intercept, 9);
    expect(report.calibratedHoldout?.mae).toBeCloseTo(expected.holdout_mae_after, 9);
    expect(report.holdoutImproved).toBe(true);
    expect(report.leakageChecks.noSessionOverlap).toBe(true);
    expect(report.trainCount).toBe(3);
    expect(report.holdoutCount).toBe(2);
  });

  it('flags session leakage across the split', () => {
    const shared = (capturedAt: string): CalibrationRecord => ({
      recordId: capturedAt,
      capturedAt,
      sessionId: 'shared',
      metricFamily: 'recovery',
      algorithmId: 'goose.recovery.v0',
      algorithmVersion: '0.1.0',
      prediction: 50,
      label: 55,
    });
    const report = evaluateLinearCalibration(
      { schema: 'goose.calibration-dataset.v1', records: [shared('2026-05-01T00:00:00Z'), shared('2026-05-09T00:00:00Z')] },
      { metricFamily: 'recovery', algorithmId: 'goose.recovery.v0', algorithmVersion: '0.1.0', splitAt: '2026-05-04T00:00:00Z', minTrainRows: 1, minHoldoutRows: 1 },
    );
    expect(report.issues).toContain('session_id appears in both train and holdout');
    expect(report.pass).toBe(false);
  });
});
