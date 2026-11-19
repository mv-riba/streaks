// Installs every dependency at the version that matches the installed Expo SDK.
// `npx expo install` picks SDK-compatible versions, so nothing is guessed by hand.
// Run once after cloning:  npm install && npm run bootstrap
import { execSync } from 'node:child_process';

const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', shell: true });
};

const runtime = [
  'expo-router',
  'expo-linking',
  'expo-constants',
  'expo-status-bar',
  'expo-splash-screen',
  'expo-font',
  '@expo-google-fonts/dm-sans',
  'expo-localization',
  'expo-notifications',
  'expo-task-manager',
  'react',
  'react-dom',
  'react-native',
  'react-native-web',
  '@expo/metro-runtime',
  'react-native-safe-area-context',
  'react-native-screens',
  '@react-native-async-storage/async-storage',
  '@react-native-community/datetimepicker',
  '@react-native-community/netinfo',
  '@supabase/supabase-js',
  'react-native-url-polyfill',
];

const dev = ['typescript', '@types/react', 'tsx'];

run(`npx expo install ${runtime.join(' ')}`);
run(`npx expo install ${dev.join(' ')} -- --save-dev`);
run('npx expo install --check');
console.log('\nDependencies installed. Next: copy .env.example to .env and fill in your Supabase values.');
