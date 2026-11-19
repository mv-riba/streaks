import { Redirect, Stack } from 'expo-router';
import React from 'react';
import { useAuth } from '../../src/auth/AuthProvider';
import { Loading } from '../../src/ui/components/Primitives';
import { colors } from '../../src/ui/theme';

export default function AppLayout() {
  const { session, initializing } = useAuth();
  if (initializing) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.cream } }} />;
}
