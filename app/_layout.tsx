// Must be first: defines the background notification task before the OS delivers responses.
import '../src/notifications/backgroundTask';
import '../src/notifications/foreground';

import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold, useFonts } from '@expo-google-fonts/dm-sans';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../src/auth/AuthProvider';
import { StoreProvider } from '../src/data/store';
import { supabaseConfigured } from '../src/lib/supabase';
import { NotificationBridge } from '../src/notifications/NotificationBridge';
import { Loading } from '../src/ui/components/Primitives';
import { colors, space, type } from '../src/ui/theme';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ DMSans_400Regular, DMSans_500Medium, DMSans_700Bold });
  if (!fontsLoaded) return <Loading />;

  if (!supabaseConfigured) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.cream, justifyContent: 'center', padding: space.xl }}>
        <Text style={type.title}>Almost there</Text>
        <Text style={[type.body, { marginTop: space.md }]}>
          Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to your .env file, then restart the dev server.
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthProvider>
        <StoreProvider>
          <NotificationBridge />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.cream } }} />
        </StoreProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
