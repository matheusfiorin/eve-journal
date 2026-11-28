# Development environment

The frontend is static ES modules. Local checks use Node.js, esbuild and Playwright; Android also needs a JDK and
Android SDK. Installing dependencies and running tests does not deploy the site or change the Worker.

## Node and npm on Windows

Use Node 24 to match CI. If you use fnm, initialise the current PowerShell session:

```powershell
fnm env --shell powershell | Out-String | Invoke-Expression
fnm install 24
fnm use 24
node --version
npm.cmd --version
```

For new terminals, follow [fnm's PowerShell setup](https://github.com/Schniz/fnm#powershell) while preserving your
existing profile. Reopen the terminal and VS Code if a newly installed command is not found. Use the npm version
shipped with Node; an update notice is not a project requirement.

From the repository root:

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd test
npm.cmd start
```

The server listens on `http://127.0.0.1:8000/`; Ctrl+C stops it. Using `npm.cmd` avoids PowerShell script-policy
issues with `npm.ps1`. The syntax checker runs on Node and does not require Bash.

If npm reports blocked install scripts, inspect the affected packages and whether their binaries work before
approving scripts. A download failure requires checking the terminal's network access; it is not a syntax failure.

## Browser tests

Install Playwright's Chromium once, choose an unused port, then run the mocked suite:

```powershell
npx.cmd playwright install chromium
$env:E2E_PORT = '8137'
npm.cmd run test:e2e -- --trace off --reporter=line --workers 2
```

The config starts and stops the server. Use an exclusive port: an existing server may belong to another checkout.
The command excludes `LIVE:` scenarios. Reports and screenshots go to ignored `test-results/` and
`playwright-report/`. If a failure occurs only under load, rerun with `--last-failed` and report both results.

Only if Playwright cannot find browsers installed in your normal user profile:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\ms-playwright"
```

## Line endings and paths

`.gitattributes` keeps JavaScript and YAML in LF even with `core.autocrlf=true`. Workflow and Android bundle
checks still compare exact content; they do not ignore differences or regenerate the bundle during tests.

A new checkout applies these attributes automatically. For an older checkout, preserve local changes first and
confirm `git status` is clean for the affected files. On the branch containing the attributes, refresh only those
working-tree copies:

```powershell
git restore --worktree -- .github/workflows android/app/src/main/assets/planners.js
```

This replaces those files with the current branch's content. No global Git configuration change is needed.
Convert `file:` URLs with `fileURLToPath` before passing paths to subprocesses; `.pathname` can yield
`/C:/...` and encoded spaces on Windows. See [Git attributes](https://git-scm.com/docs/gitattributes) and
[Node fileURLToPath](https://nodejs.org/api/url.html#urlfileurltopathurl-options).

Windows text clipboard data uses CRLF. The EFT test compares the entire native representation (CRLF on Windows,
LF elsewhere), including blank lines, without altering observed content. See
[CF_UNICODETEXT](https://learn.microsoft.com/en-us/windows/win32/dataxchg/standard-clipboard-formats).

## Android

Use JDK 21, Android platform 36 and Build Tools 36.0.0. Point `ANDROID_HOME` or ignored `android/local.properties`
at your SDK. See [android/README.md](../android/README.md) for build and signing details.

For command-line tools on Windows:

```powershell
winget install --id EclipseAdoptium.Temurin.21.JDK --exact --source winget
winget install --id Google.AndroidCLI --exact --source winget
```

Reopen the terminal and verify `java --version` and `android --version`. If another JDK is first on PATH, set
`JAVA_HOME` to your JDK 21 installation for the build session. Install SDK packages in your preferred directory:

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
android --sdk="$env:ANDROID_HOME" sdk install platform-tools platforms/android-36 build-tools/36.0.0
```

Follow the tool's licence prompts. See the [Android CLI reference](https://developer.android.com/tools/agents/android-cli/commands/sdk_install).
This local setup does not change CI's existing SDK installation.

If your default Gradle home is not writable, set `GRADLE_USER_HOME` to a writable cache directory. The first build
needs network access to download Gradle and Maven dependencies. From the repository root:

```powershell
node scripts/bundle-android.mjs --check
cd android
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:verifyPaparazziDebug
```

JVM tests pin en-US dates, times and number grouping to match the checked-in goldens. Do not re-record goldens or
disable tests to work around locale differences. Node bridge checks do not replace Android compilation and JVM tests.
