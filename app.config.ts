import type { ExpoConfig } from 'expo/config';

// Change these two identifiers to your own before the first Android/iOS build.
const ANDROID_PACKAGE = 'com.yourname.streaks';
const IOS_BUNDLE_ID = 'com.yourname.streaks';

const config: ExpoConfig = {
  name: 'Streaks',
  slug: 'streaks',
  scheme: 'streaks',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  backgroundColor: '#F7F4EC',
  ios: {
    bundleIdentifier: IOS_BUNDLE_ID,
    supportsTablet: false,
  },
  android: {
    package: ANDROID_PACKAGE,
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#344B3A' },
    // No exact-alarm permission: Google Play restricts it to alarm/calendar apps, so
    // Android may deliver a check-in a few minutes after the selected time.
    permissions: ['android.permission.POST_NOTIFICATIONS'],
  },
  web: {
    bundler: 'metro',
    output: 'single',
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-localization',
    'expo-status-bar',
    ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 160, backgroundColor: '#F7F4EC' }],
    ['expo-notifications', { icon: './assets/notification-icon.png', color: '#344B3A' }],
    '@react-native-community/datetimepicker',
  ],
  // GitHub Pages serves the site from /<repo-name>/. Keep this in sync with the repo name.
  experiments: { typedRoutes: false, baseUrl: '/streaks' },
};

export default config;
