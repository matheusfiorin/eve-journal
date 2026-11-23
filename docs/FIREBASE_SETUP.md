# Firebase setup: pushes when the Android app is closed

Optional. Without it the wing still works live (the app holds a socket to the wing room while it is open or a timer
runs); you just get no notification from your wingmate while the app is fully closed. Firebase Cloud Messaging (FCM) is
free for this volume. It takes about 15 minutes, once.

How it fits together:

```
wingmate's phone ──► wing room (Durable Object) ──FCM HTTP v1──► Google ──► your phone ──► EchelonMessagingService
                          │  uses the Worker secrets FCM_PROJECT_ID + FCM_SERVICE_ACCOUNT
                          └─ finds your phone's token in D1 (push_tokens), registered by the app after sign-in
```

Three things must exist: the Firebase project, `google-services.json` inside the app (so the phone can get a token), and
the two Worker secrets (so the room may send). The app and the Worker each work without the other, they just do nothing
for push.

## 1. Create the Firebase project
1. Open <https://console.firebase.google.com> with a Google account and choose **Create a project** (or **Add project**).
2. Name it, for example `echelon-eve`. Google Analytics is not needed: switch it off.
3. Note the **Project ID** on **Project settings** (gear icon, **General**). It is not always the name: it looks like
   `echelon-eve-1a2b3`. This is the value for `FCM_PROJECT_ID`.
4. Cloud Messaging: on **Project settings**, **Cloud Messaging**, **Firebase Cloud Messaging API (V1)** must say
   *Enabled*. It is on by default for new projects. If it says disabled, use the three-dot menu to open it in Google Cloud
   and press **Enable**. (The old "Cloud Messaging API (Legacy)" and its server key are not used and may stay off.)

## 2. Add the Android app
1. **Project settings**, **General**, **Your apps**, **Add app**, the Android icon.
2. **Android package name**: `com.echelon.eve`. Nickname: `Echelon`. Skip the SHA-1 (not needed for messaging).
3. Press **Register app**. Add a second Android app the same way with the package name `com.echelon.eve.debug`: debug
   builds (the CI APK, `assembleDebug`) have that suffix, and the build fails with *No matching client found for package
   name* if the file lacks the package being built. Both apps go in the same project and produce one file.
4. Download **google-services.json** (**Project settings**, **General**, scroll to **Your apps**, **SDK setup and
   configuration**). Skip the console's "add the SDK" steps: the Gradle files already have them. The file holds an API key
   for the app but no secret that can send messages; it is the same file every install of the app carries.

## 3. Put google-services.json in the app
- **Building on your computer:** copy it to `android/app/google-services.json`. Git ignores that path. The build applies
  the Google services plugin only when the file exists, so nothing else changes. Build as usual
  (`cd android && ./gradlew :app:assembleDebug`) and install.
- **The APK from GitHub (a `v*` tag builds a signed release):** add the repository Actions secret
  `GOOGLE_SERVICES_JSON_BASE64`: `base64 -w0 google-services.json` on Linux, or `base64 -i google-services.json | tr -d '\n'` on macOS. The release job writes it to `android/app/` before building and logs
  whether it did. The debug APK that every push builds has no push unless you commit the file, which is allowed (it is
  not a secret) but then lives in the repository.

On the phone: Android 13 and later ask for the notification permission (the Wing screen offers it). After sign-in the app
registers its token with the Worker (`POST /api/push/register`); sign in each pilot you want to be reachable.

## 4. Create the service account the Worker sends with
The room signs in to Google with a service account key and trades it for a short-lived token.

1. In the Firebase console: **Project settings**, **Service accounts**, **Generate new private key**, then **Generate
   key**. This downloads a JSON file for `firebase-adminsdk-…@<project>.iam.gserviceaccount.com`, which already has the
   FCM role.
   Alternative with the least access: in <https://console.cloud.google.com/iam-admin/serviceaccounts> (same project),
   **Create service account**, grant it only the role **Firebase Cloud Messaging API Admin**
   (`roles/firebasecloudmessaging.admin`), then **Keys**, **Add key**, **Create new key**, **JSON**.
2. The file looks like `{"type":"service_account","project_id":…,"private_key":"-----BEGIN PRIVATE KEY-----…","client_email":…}`.
   Treat it as a password: never commit it or paste it in chat. Delete the downloaded copy after step 5.

## 5. Set the Worker secrets
The deploy script (`scripts/deploy-backend.mjs`, run by the Pages workflow on every push to `main`) reads two environment
variables and, only when both are set, stores them as Worker secrets of the same names. It refuses a
`FCM_SERVICE_ACCOUNT` that is not JSON. Add them as **repository Actions secrets** (GitHub, **Settings**, **Secrets and
variables**, **Actions**, **New repository secret**):

| Secret | Value |
|---|---|
| `FCM_PROJECT_ID` | the Project ID from step 1 (for example `echelon-eve-1a2b3`) |
| `FCM_SERVICE_ACCOUNT` | the whole contents of the JSON key file, as is |

Then run the **Pages** workflow (push to `main`, or **Actions**, **Run workflow**) and look in the deploy job's log for
`FCM push configured in Cloudflare.` If it says `FCM_SERVICE_ACCOUNT and FCM_PROJECT_ID are not set`, one of the
repository secrets is missing or empty. The secrets are not shown anywhere afterwards; to change one, edit the Actions
secret and deploy again.

Without GitHub Actions (a manual deploy), the equivalent is `npx wrangler secret put FCM_PROJECT_ID` and
`npx wrangler secret put FCM_SERVICE_ACCOUNT --name eve-journal-api`, pasting the value when asked.

## 6. Check that it works
1. Close the app on your phone completely (swipe it away) and sign in the other pilot's app on a second device to be
   the sender.
2. Send a ping, or start a shared timer. Within a few seconds the phone shows "Decxus: Needs help" or "Decxus started a
   timer". Tapping it opens the Wing screen (timers open the Cockpit).
3. Pushes go only to a pilot whose app has no open socket, so a phone with the app in the foreground shows the message in
   the app instead of a notification.

What a push contains: who, what happened, and the label or text the sender typed. Never where anyone is: no system, no
route, no destination, no ship (the room's tests fail if one appears). Pushes are sent for a timer starting and ending,
a ping, a shared plan, an answer to your call ("on it", "can't"; "seen" is silent) and a shared session starting or
ending. A live status never pushes.

## When it does not work
| Symptom | Likely cause |
|---|---|
| Gradle: *No matching client found for package name* | the package being built (`com.echelon.eve.debug` for debug) is not registered in step 2 |
| The deploy log says FCM is not set | `FCM_PROJECT_ID` or `FCM_SERVICE_ACCOUNT` is missing from the repository Actions secrets |
| The deploy fails with *FCM_SERVICE_ACCOUNT is not JSON* | the secret holds something other than the key file's contents |
| No notification, the phone is signed in | the notification permission is off (Android settings, Echelon, Notifications), or the phone never registered a token: sign in again with the app open and online |
| It worked, then stopped for one phone | Google rotated its token (the app registers the new one on its own) or the app was uninstalled; the room deletes tokens Google reports as dead |
| Sender sees nothing happen | the wingmate's app was open (their socket is live), which is by design |
| `Firebase Cloud Messaging API (V1)` is disabled | step 1.4 |
