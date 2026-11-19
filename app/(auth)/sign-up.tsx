import { Link } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '../../src/auth/AuthProvider';
import { Banner, Button, Field, Screen } from '../../src/ui/components/Primitives';
import { colors, space, type } from '../../src/ui/theme';

export default function SignUp() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSent, setConfirmSent] = useState(false);

  const submit = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email address.');
    if (password.length < 8) return setError('Use a password with at least 8 characters.');
    setBusy(true);
    setError(null);
    try {
      const { needsConfirmation } = await signUp(email, password);
      if (needsConfirmation) setConfirmSent(true);
      // Otherwise the session starts and the app layout navigates Home (§4.2).
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (confirmSent) {
    return (
      <Screen>
        <View style={{ marginTop: space.xxl * 2 }}>
          <Text style={type.title} accessibilityRole="header">Check your inbox</Text>
          <Text style={[type.body, { marginTop: space.md, color: colors.muted }]}>
            We sent a confirmation link to {email.trim()}. Open it, then come back and log in.
          </Text>
          <Link href="/sign-in" style={[type.body, { marginTop: space.xl, textDecorationLine: 'underline' }]}>Back to log in</Link>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ marginTop: space.xxl * 2, marginBottom: space.xxl }}>
        <Text style={type.title} accessibilityRole="header">Create your account</Text>
        <Text style={[type.body, { color: colors.muted, marginTop: space.sm }]}>Start with something small.</Text>
      </View>
      {error ? <Banner text={error} tone="warn" /> : null}
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" hint="At least 8 characters" onSubmitEditing={submit} />
      <Button title="Create account" onPress={submit} loading={busy} />
      <Link href="/sign-in" style={[type.body, { marginTop: space.xl, textAlign: 'center' }]}>
        Already have an account? <Text style={{ textDecorationLine: 'underline' }}>Log in</Text>
      </Link>
    </Screen>
  );
}
