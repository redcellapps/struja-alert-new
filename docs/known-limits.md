# Known limits

## Android: system font size change while the app is open (React Native 0.88)

React Native's Android `DeviceInfoModule` refreshes its `fontScale` only in `onHostResume`. If the main activity handles `fontScale` itself (`android:configChanges`), no resume happens, so `useWindowDimensions().fontScale` stays at the old value: the text rescales natively but our layout rules (`apps/mobile/src/design/largeText.ts`, stacked tiles and buttons) do not follow.

Decision (2026-10-27): the manifest is not changed. Android restarts the activity on a font or density change, which is rare; the screen the person was on resets to Početna, and in a debug build the router logs "Looks like you have configured linking in multiple places" once per change. The warning does not appear on a cold start or when the app is opened through a deep link (checked in a debug build, warm and cold).

Revisit after a React Native upgrade: if `fontScale` follows a configuration change without a resume, `fontScale|density` can go into `configChanges` through a config plugin so the screen survives the change.
