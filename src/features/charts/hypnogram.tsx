/**
 * Sleep stage timeline. MVP renders coarse asleep/awake segments (the only stages the
 * heuristic produces); deep/REM/core colors are ready for when calibrated staging lands.
 * Plain RN views — each segment widthed by its share of the night.
 */
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { STATUS_GREEN, STATUS_YELLOW, STRAIN_BLUE, NEUTRAL } from './colors';

export type SleepStage = 'awake' | 'core' | 'deep' | 'rem' | 'asleep';

export interface StageSegment {
  stage: SleepStage;
  minutes: number;
}

const STAGE_COLOR: Record<SleepStage, string> = {
  awake: STATUS_YELLOW,
  asleep: STATUS_GREEN,
  core: STRAIN_BLUE,
  deep: '#5E5CE6',
  rem: '#30D5C8',
};

export function Hypnogram({ segments, estimated = true }: { segments: StageSegment[]; estimated?: boolean }) {
  const total = Math.max(1, segments.reduce((s, seg) => s + seg.minutes, 0));
  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        {segments.map((seg, i) => (
          <View
            key={`${seg.stage}-${i}`}
            style={{ flex: seg.minutes / total, backgroundColor: STAGE_COLOR[seg.stage] }}
          />
        ))}
      </View>
      {estimated ? (
        <ThemedText type="small" themeColor="textSecondary">
          Estimated (asleep/awake) — stage breakdown requires calibration.
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.one, alignSelf: 'stretch' },
  bar: { flexDirection: 'row', height: 24, borderRadius: 6, overflow: 'hidden', backgroundColor: `${NEUTRAL}22` },
});
