import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { Onboarding } from '@/features/onboarding/onboarding';
import { DatabaseProvider } from '@/state/db-provider';
import { useOnboardingStore } from '@/state/onboarding-store';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const onboardingComplete = useOnboardingStore((s) => s.completed);

  return (
    <DatabaseProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        {/* The tab navigator stays mounted so routing remains valid; onboarding overlays it. */}
        <AppTabs />
        {onboardingComplete ? null : <Onboarding />}
      </ThemeProvider>
    </DatabaseProvider>
  );
}
