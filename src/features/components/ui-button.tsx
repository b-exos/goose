/**
 * Expo UI button wrapped in its required `Host` boundary.
 *
 * Uses the Expo UI *universal* API (`@expo/ui`), which renders a native SwiftUI button on
 * iOS, a Jetpack Compose button on Android, and a plain view on web. Per Expo UI rules,
 * every Expo UI subtree must sit under a `<Host>` — this wrapper guarantees that so callers
 * can drop in a button without repeating the boundary.
 */
import { Button, type ButtonVariant, Host } from '@expo/ui';

interface UiButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
}

export function UiButton({ label, onPress, variant = 'filled' }: UiButtonProps) {
  return (
    <Host matchContents>
      <Button variant={variant} onPress={onPress} label={label} />
    </Host>
  );
}
