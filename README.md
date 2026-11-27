# Streaks — build, set up & launch guide

One Expo (React Native + TypeScript) codebase gives you three things:

- **Web app**: the first launch target
- **Android app**: built with EAS when you're ready
- **iOS app**: possible later

[Neon](https://neon.com) provides the database (Lakebase Postgres), auth (Neon Auth / Managed Better Auth) and the Data API the app queries through `@neon/neon-js`.

```
app/                     Screens (Expo Router)
  (auth)/                sign-in, sign-up
  (app)/                 index (Home), streak/new, streak/[id], streak/[id]/edit, account
  forgot-password.tsx
src/
  logic/                 Pure business rules + tests (dates, streaks, notificationPlan, completionQueue)
  data/                  Data API calls, the single completion path, app store
  notifications/         Permissions, scheduling, action handling, background task
  auth/                  AuthProvider, offline session fallback
  lib/                   Neon client (+ native session cookie storage, polyfills)
  ui/                    Theme + reusable components
neon/
  migrations/            0001 schema, RLS, record_completion(), delete_my_account(); 0002 one-off data import
  tests/                 SQL tests against a local Neon stub (constraints, RLS isolation, RPCs, import)
neon.ts                  Neon project policy (Auth + Data API), applied with `neon deploy`
docs/                    The original Supabase migration, for reference
scripts/                 bootstrap (installs SDK-matched deps), test-db, simulate-native-session
```

---

## Step 0 — What you need on your computer

- **Node.js 20 or newer** (LTS). Check with `node -v`.
- **Git**.
- A free **Neon** account: <https://neon.com>, and the Neon CLI: `npm i -g neon@latest`
- A free **Expo** account: <https://expo.dev>. This one is for web hosting and Android builds.
- *(Android, later)* an Android phone. For Play Store release you also need a Google Play developer account, which has a one-time fee.

## Step 1 — Install dependencies

```bash
cd streaks
npm install          # installs Expo SDK 58
npm run bootstrap    # installs every other package at the version that matches the SDK
```

`bootstrap` uses `npx expo install`, so the versions always match each other. Don't hand-edit package versions.

## Step 2 — Set up Neon

1. **Link the project** (creates `.neon`, pulls connection details into `.env`):
   ```bash
   neon init -y --org-id <org> --project-id <project> --branch production --services postgres
   neon deploy          # applies neon.ts: Neon Auth + Data API (Managed Better Auth provider)
   neon data-api get -o json   # expect "auth_provider": "neon_auth"
   ```
2. **Create the database.** Open Neon Console → **SQL Editor** (branch `production`, database `neondb`), paste the whole of `neon/migrations/0001_init.sql` and click **Run**. Then **Data API → Refresh schema cache** (or `neon data-api refresh-schema`).
3. **Trust your web origin** so Neon Auth accepts sign-in from it and from the phone app:
   ```bash
   neon neon-auth domain add https://streaks.mvriba.com
   ```
   `localhost` is allowed by default for development.
4. **Emails.** Password-reset codes are sent by Neon's shared mailer (`auth@mail.myneon.app`); the app uses the 6-digit code, so reset works the same on web and Android. "Verify email at signup" is off, so new accounts sign in straight away; if you turn it on, the app tells users to confirm first. Before launch, add your own SMTP: <https://neon.com/docs/auth/production-checklist>.
5. **Set the app's URL.** Your Neon base URL is the connection host plus database name over https:
   ```bash
   cp .env.example .env
   # EXPO_PUBLIC_NEON_URL=https://ep-xxx.c-3.eu-west-2.aws.neon.tech/neondb
   ```
   This URL is meant to be public; Row Level Security protects the data. **Never** put `DATABASE_URL` (it has the password) in an `EXPO_PUBLIC_` variable.

**Account deletion** is the `delete_my_account()` database function (Neon Auth has no self-service delete): it deletes the caller's Neon Auth user, which cascades to profiles, streaks and completions.

## Step 3 — Run it locally

```bash
npm run web          # opens http://localhost:8081
```

Then work through the checks:

- Sign up.
- Create a streak and mark it complete.
- Open the streak and check the calendar.
- Try editing, archiving and deleting.
- Log out, and try the password reset.

## Step 4 — Run the automated tests

```bash
npm test             # streak maths, dates/DST/timezones, notification planning, offline queue, session cookie jar
npm run test:db      # schema, constraints, RLS isolation, record_completion, delete_my_account, data import (needs PostgreSQL 15+)
```

`test:db` creates a throwaway local Postgres with a stand-in for Neon's `neon_auth`/`auth` schemas, so it never touches your Neon project.

## Step 5 — Put the web app live (EAS Hosting)

```bash
npx eas-cli@latest login
npx eas-cli@latest init          # links the project to your Expo account (first time only)
npm run deploy:web               # = expo export --platform web && eas deploy --prod
```

You'll get a URL like `https://streaks--yourname.expo.app`. You can add your own domain in the Expo dashboard under Hosting.

After deploying:

- Add that URL to Neon Auth's trusted domains (Step 2.3).
- Every later update is just `npm run deploy:web` again.

*Alternatives:* `npm run export:web` creates a static `dist/` folder that you can upload to Netlify, Vercel or Cloudflare Pages. `public/_redirects` is already included, so deep links work on Netlify.

## Step 6 — Android app (when you're ready)

1. In `app.config.ts`, change `com.yourname.streaks` to your own reverse-domain ID. **It can't be changed after you publish.**
2. Give EAS your Neon URL. `.env` isn't uploaded to cloud builds, so add it there:
   ```bash
   npx eas-cli@latest env:create --name EXPO_PUBLIC_NEON_URL --value https://ep-...neon.tech/neondb --environment development --environment preview --environment production --visibility plaintext
   ```
   If the CLI flags differ in your version, add the variable on expo.dev, under your project's **Environment variables**.
   The phone app keeps the Neon Auth session cookie in AsyncStorage and sends `Origin: https://streaks.mvriba.com` (override with `EXPO_PUBLIC_NEON_AUTH_ORIGIN`), which must be a trusted domain (Step 2.3).
3. Build an installable test APK:
   ```bash
   npx eas-cli@latest build -p android --profile preview
   ```
   Open the link EAS gives you on your phone and install the APK.
4. **Test notifications on the phone.** The checklist is below; this is the part that can't be tested in a browser.
5. Release to Google Play:
   ```bash
   npx eas-cli@latest build -p android --profile production
   npx eas-cli@latest submit -p android
   ```
   - The production profile builds an `.aab`.
   - `submit` needs a Play Console app and a service account key the first time; EAS walks you through it.
   - New personal Play accounts must run a closed test with testers before going public.

> **Expo Go isn't enough for check-ins.** Notification action buttons and the background task need a real build (the APK above, or a development build: `eas build --profile development`).

---

## Device test checklist for notifications (PRD §8, §16)

Do these on a real Android phone with the preview APK.

- [ ] Enabling a check-in for the first time asks for notification permission, and the app explains why.
- [ ] Deny the permission: the streak is still saved, and a message points you to device settings.
- [ ] Set a check-in 2 minutes ahead: the prompt arrives, names the activity, and shows **Yes, completed** and **Not yet**.
- [ ] **Yes, completed** with the app open records the completion, and Home updates.
- [ ] **Yes, completed** with the app in the background records the completion; check when you next open the app.
- [ ] **Yes, completed** after swiping the app away (closed, *not* force-stopped) records the completion.
- [ ] **Not yet**: nothing is recorded, the streak isn't reset, no repeat prompt that day, and manual completion still works.
- [ ] Ignore the prompt: nothing is recorded and the streak isn't broken.
- [ ] Complete the activity manually before the prompt time: no prompt that day.
- [ ] Complete it while a prompt is on screen: the prompt disappears.
- [ ] Change the time: only the new time fires. Disable: nothing fires. Archive or delete: nothing fires.
- [ ] Two streaks at different times each prompt independently.
- [ ] Airplane mode: tap **Yes, completed**, open the app (shows "saved on this device"), go online, and it syncs.
- [ ] Answer a prompt after midnight: it's rejected with "That check-in was for an earlier day".
- [ ] Change the phone's timezone: prompts follow the new local time.
- [ ] Log out: no more prompts. Log in again: prompts are rebuilt.

If background **Yes, completed** doesn't record on some configuration, set `OPEN_APP_ON_COMPLETE = true` in `src/notifications/scheduler.ts`. Tapping the button then opens the app briefly to record it, which is the closest reliable behaviour (PRD §17).

---

## Platform limitations (stated plainly)

1. **No check-in notifications on the web.** Browsers can't schedule local notifications with action buttons through Expo Notifications. On the web you track completions manually; check-in settings are still saved, and the phone app delivers them. The UI says this wherever check-ins are configured.
2. **Background "Yes, completed" depends on the OS.**
   - The app saves the answer on the device first, then syncs, so it's never discarded.
   - Android won't run app code at all after a user **force-stops** the app (Settings → Force stop) until it's opened again. In that case the tap may not register, and the user needs to open the app.
   - iOS gives only a few seconds of background time; anything unfinished syncs on next open.
3. **Rolling schedule window.** Each day's prompt is scheduled individually, so the app can skip days that are already done and include the date in each prompt. Up to 14 days are scheduled ahead, staying under iOS's 64-notification cap. If the phone app isn't opened for about two weeks, prompts pause until it's opened again.
4. **Timing on Android.** The app doesn't request the restricted exact-alarm permission, because Google Play limits it to alarm and calendar apps. Android may deliver a prompt a few minutes after the chosen time, especially in battery-saver mode.
5. **A time skipped by daylight saving** (for example 02:30 on spring-forward night) fires just after the jump on that one night.
6. **Offline sync window.** A completion saved offline syncs if you reconnect within 7 days. Older ones are rejected and you're told; they're never silently dropped.
7. **Logging out with unsynced completions** discards them after a warning. Pending completions belong to the signed-in user.

## Key design decisions

- **Stats are always calculated from completion records**, never stored, so history and longest streak can't drift. The rules live in `src/logic/streaks.ts` and are covered by tests.
- **One completion path.** Manual taps, notification answers and offline sync all go through `recordCompletion()`, which then calls the `record_completion()` database function. That function checks ownership, archive state, the date window, the start date and duplicates on the server.
- **Clients can't write the completions table directly.** RLS plus revoked grants enforce this, and the composite foreign key guarantees a completion's owner matches its streak's owner.
- **The database is the source of truth** for check-in settings. The device's notification schedule is rebuilt from it on app start, on resume, after completions and on every settings change.
- **Dates are calendar dates** (`YYYY-MM-DD`) in the device's timezone. Creation timestamps are stored separately in UTC.

## Free-tier note

Neon's free plan scales compute to zero when idle; the first request after a pause takes a moment longer.
