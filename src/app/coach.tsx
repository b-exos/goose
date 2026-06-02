/** Coach tab — chat with the on-device-metrics coach (OpenAI + local tools). */
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { ScreenScaffold } from '@/features/components/screen-scaffold';
import { SectionCard } from '@/features/components/section-card';
import { UiButton } from '@/features/components/ui-button';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useCoachStore } from '@/state/coach-store';

export default function CoachScreen() {
  const colors = Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const messages = useCoachStore((s) => s.messages);
  const isSending = useCoachStore((s) => s.isSending);
  const error = useCoachStore((s) => s.error);
  const apiKey = useCoachStore((s) => s.apiKey);
  const setApiKey = useCoachStore((s) => s.setApiKey);
  const sendMessage = useCoachStore((s) => s.sendMessage);

  const [draft, setDraft] = useState('');
  const [keyDraft, setKeyDraft] = useState('');

  const onSend = () => {
    const text = draft;
    setDraft('');
    void sendMessage(text);
  };

  return (
    <ScreenScaffold title="Coach">
      {apiKey ? null : (
        <SectionCard title="Connect" subtitle="OpenAI API key">
          <TextInput
            value={keyDraft}
            onChangeText={setKeyDraft}
            placeholder="sk-…"
            placeholderTextColor={colors.textSecondary}
            secureTextEntry
            autoCapitalize="none"
            style={[styles.input, { color: colors.text, borderColor: colors.backgroundSelected }]}
          />
          <UiButton label="Save key" onPress={() => setApiKey(keyDraft.trim())} />
        </SectionCard>
      )}

      {messages.map((message, index) => (
        <ThemedView
          key={index}
          type={message.role === 'user' ? 'backgroundSelected' : 'backgroundElement'}
          style={styles.bubble}>
          <ThemedText type="small">{message.role === 'user' ? 'You' : 'Coach'}</ThemedText>
          <ThemedText type="default">{message.content}</ThemedText>
        </ThemedView>
      ))}

      {messages.length === 0 ? (
        <ThemedText type="small">
          Ask about your recovery, strain, sleep, or stress. The coach computes them on-device.
        </ThemedText>
      ) : null}

      {error ? <ThemedText type="small">{error}</ThemedText> : null}

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask your coach…"
          placeholderTextColor={colors.textSecondary}
          editable={!isSending}
          style={[styles.input, { color: colors.text, borderColor: colors.backgroundSelected }]}
        />
        <UiButton label={isSending ? 'Sending…' : 'Send'} onPress={onSend} />
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  bubble: { alignSelf: 'stretch', gap: Spacing.half, padding: Spacing.three, borderRadius: Spacing.three },
  composer: { gap: Spacing.two },
  input: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
});
