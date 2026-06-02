/**
 * Jest config for Goose.
 *
 * Uses the jest-expo preset so React Native / Expo modules transform correctly.
 * The bulk of our suite is pure-TS golden + unit tests under `src/core/**`, which
 * verify the TypeScript engine against the preserved Rust fixtures in `/__fixtures__/`.
 */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: [],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-native-ble-plx|zustand))',
  ],
  collectCoverageFrom: ['src/core/**/*.ts', '!src/core/**/*.test.ts'],
};
