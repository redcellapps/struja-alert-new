// The entry file: side effects that must exist before the app (or a headless load of the bundle)
// runs anything. The push task is defined here at module scope, as expo-notifications requires;
// expo-router's entry comes last so every setup is in place before the first render.
import { defineBackgroundTask } from './src/notifications/background';
import { defineRefreshTask } from './src/notifications/refresh';

defineBackgroundTask();
defineRefreshTask();

import 'expo-router/entry';
