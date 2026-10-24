import { useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { TextField } from './TextField';

export interface MessageFormProps {
  // The button that opens the form ("Prijavi grešku", "Pošalji povratnu informaciju").
  openLabel: string;
  // The label of the text field ("Šta nije tačno?").
  hint: string;
  sendLabel: string;
  thanks: string;
  failedText: string;
  // Rejects when the message could not be sent.
  onSend: (message: string) => Promise<unknown>;
}

/** A button that opens a short message form; after sending it says thanks. No account, no address. */
export function MessageForm({
  openLabel,
  hint,
  sendLabel,
  thanks,
  failedText,
  onSend,
}: MessageFormProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  if (!open)
    return <Button label={openLabel} variant="secondary" fullWidth onPress={() => setOpen(true)} />;
  if (state === 'sent')
    return (
      <AppText variant="bodyStrong" accessibilityLiveRegion="polite">
        {thanks}
      </AppText>
    );
  const send = async () => {
    setState('sending');
    try {
      await onSend(text.trim());
      setState('sent');
    } catch {
      setState('failed');
    }
  };
  return (
    <View style={{ gap: 12 }}>
      <TextField label={hint} value={text} onChangeText={setText} maxLength={1000} autoFocus />
      {state === 'failed' ? (
        <AppText variant="bodyStrong" color={colors.chrome.error} accessibilityLiveRegion="polite">
          {failedText}
        </AppText>
      ) : null}
      <Button
        label={sendLabel}
        disabled={text.trim().length < 3 || state === 'sending'}
        onPress={send}
      />
    </View>
  );
}
