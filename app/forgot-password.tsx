/**
 * Password reset with a 6-digit email code: works identically on web and Android, with no
 * deep-link setup. Uses Neon Auth's email OTP ("forget-password" type), sent by Neon's
 * managed mailer; after the new password is set the user is signed in with it. Lives
 * outside the (auth) group so signing in does not redirect away mid-flow.
 */
import { Link, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '../src/auth/AuthProvider';
import { Banner, Button, Field, Screen } from '../src/ui/components/Primitives';
import { colors, space, type } from '../src/ui/theme';

export default function ForgotPassword() {
  const { requestPasswordReset, confirmPasswordReset } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () =>
    run(async () => {
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) throw new Error('Enter a valid email address.');
      await requestPasswordReset(email);
      setStep('code');
    });

  const reset = () =>
    run(async () => {
      if (!/^\d{6,10}$/.test(code.trim())) throw new Error('Enter the code from the email.');
      if (password.length < 8) throw new Error('Use a password with at least 8 characters.');
      await confirmPasswordReset(email, code, password);
      router.replace('/'); // signed in with the new password
    });

  return (
    <Screen>
      <View style={{ marginTop: space.xxl * 2, marginBottom: space.xl }}>
        <Text style={type.title} accessibilityRole="header">Reset your password</Text>
        <Text style={[type.body, { color: colors.muted, marginTop: space.sm }]}>
          {step === 'email'
            ? 'We’ll email you a code to set a new password.'
            : `If an account exists for ${email.trim()}, a code is on its way.`}
        </Text>
      </View>
      {error ? <Banner text={error} tone="warn" /> : null}
      {step === 'email' ? (
        <>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <Button title="Send code" onPress={sendCode} loading={busy} />
        </>
      ) : (
        <>
          <Field label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" />
          <Field label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" hint="At least 8 characters" />
          <Button title="Set new password" onPress={reset} loading={busy} />
          <Button title="Send a new code" variant="ghost" onPress={sendCode} disabled={busy} style={{ marginTop: space.md }} />
        </>
      )}
      <Link href="/sign-in" style={[type.body, { marginTop: space.xl, textAlign: 'center', textDecorationLine: 'underline' }]}>Back to log in</Link>
    </Screen>
  );
}
