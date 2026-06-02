/**
 * Ambient module declarations.
 *
 * Expo SDK 56 supports CSS imports (via Metro), but `tsc` doesn't understand them.
 * Until `expo-env.d.ts` is generated on the first `expo` run, declare CSS side-effect
 * imports here so `bun run typecheck` stays clean.
 */
declare module "*.css";
declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
