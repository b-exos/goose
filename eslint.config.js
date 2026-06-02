// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'docs/rust-reference/*', '__fixtures__/*'],
  },
  {
    rules: {
      // File-size discipline: target ~200 lines, hard cap 500 (errors above 500).
      // Comments and blank lines are excluded so dense logic isn't penalized.
      'max-lines': [
        'error',
        { max: 500, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    // Tests and the expo-router screens may legitimately run longer; warn instead of error.
    files: ['**/*.test.ts', '**/*.test.tsx', 'src/app/**'],
    rules: {
      'max-lines': [
        'warn',
        { max: 500, skipBlankLines: true, skipComments: true },
      ],
    },
  },
]);
