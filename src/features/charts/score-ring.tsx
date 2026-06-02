/**
 * Circular score gauge (recovery / sleep / strain), drawn with Skia.
 *
 * A faint background ring plus a colored progress arc for `value / max`, with the value and
 * label centered over it. The arc color conveys status (see `colors.ts`). Renders natively on
 * iOS/Android via Skia; on web/test Skia falls back gracefully.
 */
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { NEUTRAL } from './colors';

interface ScoreRingProps {
  value: number | null;
  max: number;
  label: string;
  color: string;
  size?: number;
  /** Text shown in the center; defaults to the rounded value (or "—" when null). */
  display?: string;
}

export function ScoreRing({ value, max, label, color, size = 120, display }: ScoreRingProps) {
  const strokeWidth = size * 0.12;
  const inset = strokeWidth / 2;
  const dimension = size - strokeWidth;
  const fraction = value === null ? 0 : Math.min(Math.max(value / max, 0), 1);

  const { background, progress } = useMemo(() => {
    const oval = Skia.XYWHRect(inset, inset, dimension, dimension);
    const bg = Skia.Path.Make();
    bg.addArc(oval, 0, 360);
    const fg = Skia.Path.Make();
    fg.addArc(oval, -90, fraction * 360);
    return { background: bg, progress: fg };
  }, [inset, dimension, fraction]);

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Canvas style={{ width: size, height: size }}>
        <Path path={background} style="stroke" strokeWidth={strokeWidth} color={`${NEUTRAL}33`} strokeCap="round" />
        {value !== null ? (
          <Path path={progress} style="stroke" strokeWidth={strokeWidth} color={color} strokeCap="round" />
        ) : null}
      </Canvas>
      <View style={styles.center} pointerEvents="none">
        <ThemedText type="title">{display ?? (value === null ? '—' : `${Math.round(value)}`)}</ThemedText>
        <ThemedText type="small">{label}</ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
