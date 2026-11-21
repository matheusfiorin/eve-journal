# Echelon for Android

A native client (Kotlin, Jetpack Compose, Material 3) of the Echelon Worker backend for Fiofka and Decxus: **Plan**
what to do next, help while you **Fly**, and run the **Corp**. The Worker keeps the EVE tokens and syncs ESI; the app
holds only per-pilot sessions, sealed with an Android Keystore key.

## Build

Needs JDK 17 or newer (21 is used here) and an Android SDK with `platforms;android-36` and `build-tools;36.0.0`.

```sh
cd android
echo "sdk.dir=$HOME/android-sdk" > local.properties   # or export ANDROID_HOME
./gradlew :app:assembleDebug                          # app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:testDebugUnitTest                      # JVM unit tests, including the JS planner bridge
./gradlew :app:verifyPaparazziDebug                   # screenshot tests against app/src/test/snapshots
./gradlew :app:recordPaparazziDebug                   # re-record the goldens after an intended UI change
```

The planner bundle in `app/src/main/assets/planners.js` is built from the web's root modules: run
`npm run bundle:android` at the repository root after changing any planner, and commit the result (CI checks it is
current).

Release builds are signed in CI from the `ANDROID_KEYSTORE_*` secrets; see `.github/workflows/android.yml`.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the packages, the design system and how to add a screen.
