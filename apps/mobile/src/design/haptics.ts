import * as Haptics from 'expo-haptics';

// Haptics sparingly, with the platform's own types: selection on chips and days, success when an
// address is saved, a light impact when a refresh completes. A failure never reaches the user.
const run = (f: () => Promise<void>) => void f().catch(() => {});

export const haptics = {
  selection: () => run(() => Haptics.selectionAsync()),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  light: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
};
