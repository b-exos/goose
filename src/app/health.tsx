/** Health tab — per-family metric surfaces (recovery, strain, sleep, HRV, stress). */
import { ThemedText } from '@/components/themed-text';
import { MetricReadout, SectionCard } from '@/features/components/section-card';
import { ScreenScaffold } from '@/features/components/screen-scaffold';

interface FamilyRow {
  family: string;
  title: string;
  caption: string;
}

const FAMILIES: FamilyRow[] = [
  { family: 'recovery', title: 'Recovery', caption: 'Score 0–100' },
  { family: 'sleep', title: 'Sleep', caption: 'Score 0–100' },
  { family: 'strain', title: 'Strain', caption: 'Score 0–21' },
  { family: 'hrv', title: 'HRV', caption: 'RMSSD (ms)' },
  { family: 'stress', title: 'Stress', caption: 'Score 0–100' },
];

export default function HealthScreen() {
  return (
    <ScreenScaffold title="Health">
      <ThemedText type="small">
        Metrics are computed on-device from your band data. Values appear after a sync.
      </ThemedText>
      {FAMILIES.map((row) => (
        <SectionCard key={row.family} title={row.title}>
          <MetricReadout value="—" caption={row.caption} />
        </SectionCard>
      ))}
    </ScreenScaffold>
  );
}
