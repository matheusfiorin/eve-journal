# Replacing persisted timer snapshots

On Windows, `File.renameTo` can refuse to replace an existing destination. Ignoring its result leaves the first
snapshot on disk: updates and removals appear to work until the store is reopened.

`TimerStore` serialises through its existing write mutex and calls the shared `core/cache/Caches.kt` `atomicWrite`
helper. The helper writes a temporary file in the same directory, then uses `Files.move` with `ATOMIC_MOVE` and
`REPLACE_EXISTING`. Only `AtomicMoveNotSupportedException` triggers a replacement-only fallback. The fallback does
not promise atomicity; other I/O errors propagate to the caller. The helper never deletes the saved destination
as a workaround. The HTTP and universe caches also use this helper.

Timer save failures emit a warning instead of silently leaving a stale snapshot. No timer payload is included in
the log message. The JSON format, local timer ownership and room-sharing rules are unchanged.

`TimersTest.replacingAndRemovingSavedTimersSurvivesRestart` covers initial save, replacement and removal, reopening
the store at each step, and verifies that private timers are not sent to the room. This specifically catches
Windows rename-replacement behaviour; the old implementation also passes on Linux/macOS. `AtomicWriteTest` checks
successive replacements and verifies that an unreplaceable destination raises I/O failure without losing its contents.

The NIO APIs used are available from Android 26; the app's minSdk is 29.

References: [File.renameTo](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/io/File.html#renameTo(java.io.File)),
[Files.move](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/file/Files.html#move(java.nio.file.Path,java.nio.file.Path,java.nio.file.CopyOption...)),
[Android Files](https://developer.android.com/reference/java/nio/file/Files).
