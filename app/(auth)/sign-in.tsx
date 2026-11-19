import { Link } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '../../src/auth/AuthProvider';
import { Banner, Button, Field, Screen } from '../../src/ui/components/Primitives';
import { colors, space, type } from '../../src/ui/theme';

export default function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ marginTop: space.xxl * 2, marginBottom: space.xxl }}>
        <Text style={type.display} accessibilityRole="header">Streaks</Text>
        <Text style={[type.body, { color: colors.muted, marginTop: space.sm }]}>Small things, every day.</Text>
      </View>
      {error ? <Banner text={error} tone="warn" /> : null}
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={submit} />
      <Button title="Log in" onPress={submit} loading={busy} />
      <View style={{ marginTop: space.xl, gap: space.lg, alignItems: 'center' }}>
        <Link href="/forgot-password" style={[type.body, { textDecorationLine: 'underline' }]}>Forgot your password?</Link>
        <Link href="/sign-up" style={type.body}>
          New here? <Text style={{ textDecorationLine: 'underline' }}>Create an account</Text>
        </Link>
      </View>
    </Screen>
  );
}
