# YFRemote agent guide

## Repository layout

YFRemote is a single public Git repository, `YannikFroehlich/YFRemote.Server`:

- Local path: `D:\Dev\YFRemote\server\YFRemote.Server` (laptop) /
  `D:\Dokumente\Programmieren\YFRemote\server\YFRemote.Server` (PC)
- Default branch: `main`; day-to-day work happens on `develop` and is merged into `main`.
  Neither branch takes direct pushes: work goes on a feature branch cut from `develop` and
  reaches `develop` through a pull request (see "Release automation")
- Repository root: .NET Windows application, web server, tray application, and release owner
- `client/`: the Angular web application, including its own `client/CLAUDE.md`

The Client previously lived in a separate repository (`YannikFroehlich/YFRemote.Client`,
branch `master`) and was checked out at release time. Its history was merged into `client/`;
that repository is obsolete and nothing in this repo depends on it any more. Do not
reintroduce a checkout of it, and do not create a separate Client release: all installable
releases belong to this repository and include a production build of the Client.

The Client is excluded from the server project's MSBuild globs via `DefaultItemExcludes` in
`YFRemote.Server.csproj`. Removing that line pulls `client/**` — including `node_modules` —
into the publish output.

## Product architecture

- The Angular Client is built as static files and copied into the Server's
  `wwwroot` directory during the release workflow.
- The Server hosts the Client, the `/health` endpoint, and the `/ws` WebSocket.
- `DELETE /pair` authenticates with the current device's bearer token and atomically
  revokes that pairing. The Client clears its local token and closes its WebSocket only
  after the Server confirms the removal (or reports that the token is already invalid).
- WebSocket actions may include a `requestId`; every parsed action response echoes it
  so the Client can wait for the exact server acknowledgement before advancing a macro.
- The default server binding is `http://0.0.0.0:5050`.
- The Client uses the exact HTTP(S) origin that served the page for pairing and
  WebSocket connections, mapping `http` to `ws` and `https` to `wss`. Changing
  host or port performs a full-page navigation to the new server so the connection
  remains same-origin. The Angular development server proxies these paths to the
  default local Server on port `5050`.
- The Server multi-targets `net10.0-windows;net10.0` (see [Linux support](#linux-support)
  below). On `net10.0-windows` it uses Windows Forms and has `OutputType=WinExe`, so a
  normal installed launch has no terminal window; on plain `net10.0` it is a console `Exe`.
  Only the Windows build ships or is released today.
- Only one Server instance may run at a time (Windows: a named `Mutex`; the headless build
  has no tray/mutex and relies on the port bind failing instead).
- A successful pairing is acknowledged only after its hashed device token has been
  atomically persisted to `%LOCALAPPDATA%\YFRemote\devices.json`; the previous valid
  state is retained as `devices.json.bak`. The used PIN rotates immediately after a
  successful write. Failed pairing or unpairing writes are rolled back in memory.
- Device `LastSeenUtc` updates remain immediate in memory and are persisted at most
  once every five minutes to avoid a disk write for every status check or connection.
- Client button layouts are grouped into named browser-local profiles. The legacy single
  layout is migrated to `Standard`; JSON export/import contains every profile, custom
  button, macro, and the active profile selection.

## Linux support

The project multi-targets `net10.0-windows;net10.0` from one `.csproj` (no separate class
library) so the same code and Git history serve both platforms. `Tray\**`, `Services\Windows*.cs`
(the `SendInput`-based `WindowsInputSender`/`WindowsInputService`/`WindowsMouseService` and
`WindowsStartupService`), and `Updates\**` (Velopack) are excluded from the `net10.0` compile via
`<Compile Remove>` in `YFRemote.Server.csproj`, not `#ifdef`. `Program.cs` itself is split with a
`#if WINDOWS` / `#else` on `Main`: the SDK defines the `WINDOWS` preprocessor symbol automatically
for the `-windows` target, so `RunWindows` (Velopack lifecycle, single-instance `Mutex`, tray)
compiles only there, and `RunLinux` (`BuildApplication` + blocking `app.Run()`, startup errors to
`Console.Error` instead of a `MessageBox`) only for `net10.0`. The three DI registrations for
`IInputService`/`IMouseService` (plus the sender they depend on) in `Program.BuildApplication` are
`#if WINDOWS`/`#else` conditional: `WindowsInputSender`/`WindowsInputService`/`WindowsMouseService`
on `net10.0-windows`, `LinuxInputSender`/`LinuxInputService`/`LinuxMouseService` on `net10.0`.
`NetworkAddressService` and `PairingQrCodePayload` live in `Services/` (not `Tray/`) because they
are BCL-only and needed on both platforms. The test project mirrors this:
`tests/YFRemote.Server.Tests.csproj` also multi-targets, excluding `**\Windows*Tests.cs` and
`Updates\**` for `net10.0`, and `**\Linux*Tests.cs` for `net10.0-windows`.

**Linux input backend (`Services/LinuxInputSender.cs`, `LinuxInputService.cs`,
`LinuxMouseService.cs`).** Registers a virtual keyboard and a virtual mouse with the kernel via
`/dev/uinput` (P/Invoke on `libc`: `open`/`ioctl`/`write`/`close`), whose events are
indistinguishable from real hardware to X11, Wayland, and the console alike. `LinuxInputSender`
serializes every send behind one lock (`ExecuteSynchronized`), mirroring
`WindowsInputSender.ExecuteSynchronized`, so hotkey modifier press/release ordering can't
interleave across concurrent requests. The two uinput devices are created lazily on first actual
send (not in the constructor), which keeps `ExecuteSynchronized` and any validation that throws
before a real send (e.g. `UnsupportedKeyException`) unit-testable without a Linux kernel — see
`tests/YFRemote.Server.Tests/Services/Linux*Tests.cs`. `LinuxInputService` maps the same 66 key
names as `WindowsInputService.VirtualKeys` to Linux `KEY_*` codes (physical key positions, not
characters). `TypeText` sends characters as a `KEY_*` code plus Shift instead of Unicode — uinput
has no equivalent to Windows' `KEYEVENTF_UNICODE` — using a US-layout mapping; on a different
active keyboard layout on the target machine, the wrong character (or nothing) arrives for
non-ASCII input. This is a property of the technique (`ydotool` has the same limitation), not a
bug in the mapping table. Operationally the target machine needs the `uinput` kernel module loaded
(`modprobe uinput`, persist via `/etc/modules-load.d/`) and a udev rule granting the service user
access without running as root — see `packaging/linux/99-yfremote-uinput.rules`.

**Current status: both stages of the plan's proof have now passed, on x86_64 only.** Manually
tested on a Linux Mint 22 (Cinnamon) VM in VirtualBox: (1) the standalone `/dev/uinput`
round-trip via `--uinput-smoke-test` (typed text and moved/clicked/scrolled the mouse with no
compositor-specific code involved — X11 vs. Wayland made no difference, as expected for a
kernel-level technique), then (2) a real bridged-VM run — paired a phone over the LAN, sent
key/mouse actions through the actual `/ws` pipeline, and watched them land on the VM's desktop.
This confirms the ioctl request codes, the legacy `uinput_user_dev` struct layout, and the
`input_event` struct size (24 bytes, assumed for 64-bit `long` time fields) against a real x64
kernel. Still open: `linux-arm64` has not been run on real hardware/VM (only cross-published and
unit-tested); non-ASCII `TypeText` input was not exercised (only an ASCII string); the actual
Velopack-installed path (`~/.local/share/YFRemote/current/...`, `packaging/linux/yfremote.service`
systemd autostart) was not exercised — the manual test ran a bare `dotnet publish` output
directly, not an installed package (the `release-linux` CI job does produce that package on every
release since v2.9.0, see below — it just hasn't been installed and exercised). Two other things
surfaced by this manual
run, independent of the input backend itself: the target user account needs to be in the
kernel's `input` group (via the udev rule in `packaging/linux/99-yfremote-uinput.rules`) *and*
that group membership only takes effect in a new login session (`newgrp <group>` works as a
same-shell shortcut for testing) — forgetting this reads as a mysterious "Action failed" from the
client with no server-side clue; and headless Linux has no tray to show the pairing PIN in, so
`RunLinux` now also prints it to the console (or, once installed as a systemd service, to
`journalctl --user -u yfremote`) right after startup. Verify portability with:

```powershell
dotnet build --configuration Release
dotnet test tests\YFRemote.Server.Tests\YFRemote.Server.Tests.csproj --configuration Release
dotnet publish -c Release -f net10.0 -r linux-arm64 --self-contained true -o publish-linux
```

The publish output should be an ELF binary with no `System.Windows.Forms.dll`, `Velopack.dll`, or
`QRCoder.dll` — `System.Drawing*.dll` is expected (a baseline self-contained-deployment assembly,
not evidence of a WinForms dependency). The two integration tests that open a real WebSocket
(`WebSocket_WithValidTokenAndOrigin_Connects`,
`Unpair_WithValidToken_RevokesTokenAndForceClosesOpenSocket` in
`tests/YFRemote.Server.Tests/Integration/ServerEndpointsTests.cs`) are still `#if WINDOWS`-only:
they exercise the full `/ws` pipeline including a real input-service call, which this repo's
Windows-hosted CI can't do for the Linux target either. Two `PairingServiceTests` are `#if
WINDOWS`-only for a related but different reason:
`RemoveDevice_WhenWriteFails_RollsBackAndCanBeRetried` and
`RemoveDeviceByToken_WhenWriteFails_KeepsTheTokenValidForRetry` simulate a write failure by
opening `devices.json` with `FileShare.None`. Windows enforces that as a mandatory lock (a second
handle on the same path fails); POSIX/Linux locking is advisory only, and `File.Replace`
(`rename()`) doesn't check other open handles at all, so the write just succeeds and the test's
precondition never triggers. The actual rollback code path (`TryPersistDevices` catching any
exception from `PersistDevicesAtomically`) is shared by `TryPair`/`RemoveDevice`/
`RemoveDeviceByToken` alike and stays covered on both platforms via
`TryPair_WhenWriteFails_RollsBackDeviceAndKeepsPinUsable`, which induces the failure with a
blocking file in place of a directory instead — a portable failure mode, unlike exclusive
locking. This is a real gap in the original Linux plan's assumption that "Pairing, WebSockets,
Integration" tests would run unchanged on both platforms; they mostly do, but not these two.

**Multi-targeting broke `dotnet publish` without `-f`.** `dotnet publish YFRemote.Server.csproj`
used to infer the single `net10.0-windows` target; once the project multi-targets, `publish`
(unlike `build`/`test`, which happily build/run every target) refuses to guess and fails with
`NETSDK1129`. `release.yml`'s existing Windows publish step now passes
`--framework net10.0-windows` explicitly. Keep this in mind for any other `dotnet publish`
invocation added later (locally or in a workflow) — it needs an explicit `-f`/`--framework` now.

**Multi-targeting also needs `EnableWindowsTargeting=true` to restore/build at all on a
non-Windows host** (set in both `YFRemote.Server.csproj` and the test project). `-f`/`--framework`
only scopes which single `TargetFramework` a `build`/`test`/`publish` invocation *builds*; the
*restore* step for a crosstargeted project always evaluates the complete `TargetFrameworks` list
first to compute the NuGet dependency graph, regardless of `-f`. Without this property, that
restore-time evaluation of `net10.0-windows` fails on a real Linux host with `NETSDK1100` ("set
the EnableWindowsTargeting property to true") — this bit the first real run of `ci.yml`'s `linux`
job even with `--framework net10.0` already on every command. The property lets restore/build
resolve Windows-only reference assemblies from NuGet on any host OS (it doesn't let you produce a
runnable Windows executable from Linux); it's a no-op on Windows, which already resolves natively.

**Linux release packaging (`release-linux` job in `release.yml`).** Runs `needs: release` after
the existing Windows job, so it reuses the same tag/version/commit and does not rebuild the
Angular client — the Windows job uploads its assembled `wwwroot/` as a build artifact
(`actions/upload-artifact`), which this job downloads instead of running `npm` again, keeping the
"Server and Client come from one commit" guarantee. It matrixes over `linux-x64` (on
`ubuntu-latest`) and `linux-arm64` (on `ubuntu-24.04-arm`, a native ARM64 runner, free for public
repos) rather than cross-packing arm64 from an x64 runner — the plan explicitly left that
cross-packing question open, so this sidesteps it. Each leg publishes self-contained
(`dotnet publish -f net10.0 -r <rid>`), then runs `vpk pack`/`vpk download`/`vpk upload` with
`--channel <rid>-beta` (`linux-x64-beta`/`linux-arm64-beta`) so Velopack keeps a separate feed per
architecture (`releases.linux-x64-beta.json`/`releases.linux-arm64-beta.json`) alongside the
untouched `releases.win.json` — an installed Windows client never sees the Linux packages. The
`-beta` suffix reflects that the Linux build is only partially verified — x64 input via a bare
`dotnet publish` output, but not arm64 and not the installed package (see above); it also carries into `--packTitle "YFRemote (Linux Beta)"` and, once, into the shared
GitHub Release body (a step gated to the `linux-x64` matrix leg so it only runs once per release,
appending rather than overwriting whatever notes the Windows job/`vpk` already set). Promoting
Linux to stable later means switching the channel name to `linux-x64`/`linux-arm64` — a clean
channel change, not a retroactive relabel of already-published beta packages. `--mainExe` has no
`.exe` suffix on Linux. **This job ran for real for the first time in the v2.9.0 release**
(2026-09-19, both `linux-x64` and `linux-arm64` legs succeeded), resolving what used to be open
questions here: `vpk upload --publish` cleanly added both Linux packages to the tag/release the
Windows job already published, without erroring or duplicating; the `ubuntu-24.04-arm` runner
label was valid and available; and the Windows `--icon client/public/favicon.ico` (a `.ico`)
packaged without issue for the Linux `vpk pack` step too.

**CI (`linux` job in `ci.yml`).** Runs on every PR alongside `build-and-test` (Windows,
`net10.0-windows`) and `client`, building and testing the `net10.0` target on `ubuntu-latest`. Not
named `build-and-test` and not a required check, matching the existing `client` job's status —
see "Release automation" above for why the required check's name must not change. Note that
`build-and-test` itself now also builds/tests `net10.0` on `windows-latest` as a side effect of
`dotnet build`/`dotnet test` (unlike `publish`) building every target by default when `-f` is
omitted; the new `linux` job additionally proves the `net10.0` target on a real Linux runner.

**Autostart (`packaging/linux/yfremote.service`).** A `systemd --user` unit, the Linux
counterpart to `WindowsStartupService`/the `HKCU\...\Run` entry — starts at user login, not at
boot (`loginctl enable-linger` documented in the file for boot-time start without login).
`ExecStart` assumes Velopack installs to `~/.local/share/YFRemote/current/...`, mirroring
`%LOCALAPPDATA%\YFRemote\current\...` on Windows (consistent with
`SpecialFolder.LocalApplicationData` resolving to `~/.local/share` on Linux, already used by
`PairingStorageOptions`/`DiagnosticPaths`) — **unverified**, since no Linux Velopack install has
happened yet; the path may need correcting once one has.

## Android support

An Android APK that runs its own server, so a second device can open the same Angular Client and
remote-control the Android device itself — the same product idea as
[Linux support](#linux-support) (server runs *on* the target device), but for a device where
`SendInput`/`uinput`-style raw injection isn't available without root. Implemented under
`android/` (native Kotlin + Ktor, its own Gradle build) and merged to `develop` — pairing, the
virtual cursor, typing, the remaining actions, and its own branding are all in place and verified
on real hardware. Not yet released: no CI build job, no signed APK, not wired into
`auto-tag.yml`/`release.yml` (see "Status" below). [`android/PLAN.md`](android/PLAN.md) is the
executable roadmap this section summarizes, including the full action-by-action
protocol-compatibility table; read it for implementation detail beyond the decisions recorded
here.

**Why not extend the existing multi-targeted `.csproj`.** `Microsoft.AspNetCore.App` has no
runtime pack for `android-arm64`/`android-x64` — Kestrel is unsupported on Android TFMs
(`dotnet/aspnetcore#35077`, `#60259`). Hosting it there requires unofficial DLL-copying hacks
with no stability guarantee across SDK updates. The Android server is therefore a **separate
native Kotlin + Ktor** project (`android/`, its own Gradle build, no relation to
`YFRemote.Server.csproj`'s `TargetFrameworks`), not a third multi-target leg. It re-implements
the pairing/action protocol against the same wire format the Windows/Linux server and the
Angular Client already use — see `Services/PairingService.cs` and
`Services/RemoteActionHandler.cs` for the exact semantics to match (6-digit PIN with a 10-minute
lifetime, PIN rotates only after a successful pairing write, SHA-256-hashed device tokens, 5
failed attempts per IP → 60s lockout). The Angular Client is reused unmodified: it derives its
HTTP/WebSocket origin from `location.origin` (`client/src/app/remote/server-config.ts`), so
serving the same production `client/dist` bundle from the Ktor server's assets keeps the Client
same-origin and protocol-compatible with no Client changes.

**Scope decision: remote control of a visible device, not screen mirroring.** The Android device
is assumed to sit somewhere visible (a TV box, a mounted tablet) and is controlled the way the
Windows/Linux server is — no `MediaProjection`/video-encoding screen capture into the browser.

**Rights model: `AccessibilityService` + a custom `InputMethodService`, both user-enabled in
system settings, no root/Shizuku.** This is what actually bounds the feature set — there is no
way to widen it later without asking for root or an ADB-based tool like Shizuku:
- `shutdown`/`restart` (`IPowerService.Shutdown`/`Restart`) have **no Android equivalent**
  without root; the action must fail with a clear message rather than silently no-op.
  `sleep` maps to `AccessibilityService.performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN)` (API 28+)
  — a lock screen, not the Windows/Linux suspend-to-RAM semantics.
- `key`/`hotkey` (`IInputService`) route through the IME for text/navigation keys
  (`commitText`/`sendKeyEvent`), which only works while a text field has focus and the YFRemote
  keyboard is the active input method. Volume/media keys instead go through `AudioManager` and
  work regardless of focus. Multi-key hotkeys (Ctrl+C and friends) are IME meta-state at best —
  unreliable across third-party apps, unlike the Windows/Linux `SendInput`/`uinput` path.
- `mouseMove`/`mouseClick`/`mouseDown`/`mouseUp`/`mouseScroll` (`IMouseService`) route through
  `AccessibilityService.dispatchGesture`, which only takes **absolute** screen coordinates,
  while the Client sends **relative** deltas (`deltaX`/`deltaY`, unchanged to keep the Client
  untouched). The Android server must therefore track a virtual cursor position itself and
  render it via a `TYPE_ACCESSIBILITY_OVERLAY` window (no `SYSTEM_ALERT_WINDOW` permission
  needed for that window type) so the user can see where clicks will land. Drag
  (`mouseDown`/`mouseUp`) needs a gesture stroke left open with `willContinue` (API 26+); scroll
  becomes a synthesized swipe gesture, not a real scroll event, so its granularity won't match
  the Windows/Linux wheel-delta behavior.
- `/files` (`FileTransferService`) and clipboard (`IClipboardService`) stay close to their
  current shape: `MediaStore`/Downloads for files, `ClipboardManager` for the clipboard (Android
  10+ restricts clipboard reads/writes to the focused app or the active IME).

**Status: Stufen 0–4 done; Stufe 5 partially done — the app itself is finished, its release
packaging is not.** Each stage was gated on the previous one actually working on a real device
(an emulator doesn't validate `AccessibilityService`/IME behavior reliably) — verified on a
Galaxy S25 (Android 16).
0. ✅ Bare Kotlin app, `AccessibilityService` only, proved gesture injection reaches a real device.
1. ✅ Ktor server: pairing/`/ws` protocol, matching `PairingService`/`RemoteActionHandler`
   semantics exactly.
2. ✅ Virtual cursor + overlay + gesture dispatch — including a fix for a tap-offset bug caused
   by the overlay window's status-bar positioning.
3. ✅ IME for `text`/`key`, including the enabled-vs-selected keyboard status and an "other
   keyboard" fallback bar while the YFRemote IME is selected (Android leaves no usable keyboard
   otherwise).
4. ✅ Remaining actions (navigation, `sleep`→lock, files, clipboard; `shutdown`/`restart` return
   a clear error) and `GET /health` reporting `platform` so the Client switches to an
   Android-specific button layout.
5. Foreground service, setup Activity (address, PIN, paired devices, links to the two required
   system-settings screens) and its own branding (app icon, dark theme, card layout) are done.
   **Still open:**
   - `DefaultItemExcludes` in `YFRemote.Server.csproj` still only excludes `client\**`, not
     `android\**` — without it the Web SDK's default globs can pull the Gradle tree into the
     server's own publish output once `android/` is checked out locally, the same failure mode
     `client/**` needed the exclusion for.
   - Gradle task to copy `client/dist` into `app/src/main/assets/www/` automatically (still a
     manual step).
   - Release-signing keystore not yet created; store it base64-encoded in GitHub Secrets before
     the first real release build — a release-signed APK cannot replace a debug-signed one on a
     device without uninstalling first.
   - No CI job builds `assembleRelease` yet. Must not be named `build-and-test` — that name is
     the required status check on `main` (see "Release automation" below) and must stay pointed
     at the Windows server job.
   - Not yet wired into `auto-tag.yml`/`release.yml` — a push to `main` triggers a full release
     regardless of which part of the repo changed (see "Release automation" below), so an
     Android-only change will release Windows/Linux too unless `[skip release]` is used
     deliberately, until this wiring exists.

## Tray application

The Windows notification-area application is implemented in
`Tray/TrayApplicationContext.cs`.

The tray menu shows:

- installed YFRemote version;
- server status and device address;
- open in browser;
- copy device address;
- show a connection QR code, optionally including the current pairing PIN in the URL fragment;
- open the persistent diagnostics folder;
- check for, download, and install updates;
- enable or disable startup with Windows for the current user;
- exit.

Double-clicking the tray icon opens the local web UI. The app performs an update
check shortly after startup and then every six hours. When an update is available,
the menu item changes to `Neue Version vX.Y.Z verfügbar - installieren`. Installing
an update downloads it, exits the current process, applies it, and restarts the app.

Runtime diagnostics are written to `%LOCALAPPDATA%\YFRemote\Logs` as daily rolling
`yfremote-*.log` files. A file also rolls at 10 MB, and the newest 14 files are
retained. `startup-error.log` remains the fallback for failures before normal host
logging is available. Do not log pairing tokens, PINs, or user-entered text.

The startup checkbox writes the stable installed launcher to
`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. It is disabled for
development builds, because they do not have an installed Velopack launcher. The
entry is removed by the Velopack uninstall hook.

The tray icon is loaded from the deployed `wwwroot/favicon.ico`. The canonical
source is `client/public/favicon.ico`, which contains the existing YF
brand mark in 16, 32, 48, 128, and 256 pixel sizes. The same icon is used by the
browser and Velopack installer. Preserve this relationship when changing branding.

## Updates and installation

- Velopack package ID: `YFRemote`
- Velopack version used by the project: `1.2.0`
- Main executable: `YFRemote.Server.exe`
- Update source: public GitHub Releases in
  `https://github.com/YannikFroehlich/YFRemote.Server`
- Prereleases are not used by the installed updater.
- Update functionality depends on `UpdateManager.IsInstalled`. A development build
  launched with `dotnet run` is not an installed Velopack app and must not be used
  to judge whether the updater works.

The one-click `.exe` installer is per-user and normally installs to:

```text
%LOCALAPPDATA%\YFRemote
```

The real current executable is normally:

```text
%LOCALAPPDATA%\YFRemote\current\YFRemote.Server.exe
```

Velopack also creates a stable execution stub in the YFRemote root. The `current`
directory is replaced during updates. Never store persistent settings or user data
inside it. Startup failures are logged to
`%LOCALAPPDATA%\YFRemote\Logs\startup-error.log`.

Releases also include a Windows Installer (`.msi`) built with
`--msi --instLocation Either`. Use the `.msi` when the user wants an installation
wizard and wants to choose the installation scope or target directory. The generated
`Setup.exe` remains a one-click installer; Velopack does not add wizard pages to that
executable. Tray updates continue to work for MSI installations.

## Validation before publishing

Run the relevant checks before merging or releasing.

Client (from `client/`):

```powershell
cd client
npm ci
npm test -- --watch=false
npm run build
```

Server (from the repository root):

```powershell
dotnet restore
dotnet test tests\YFRemote.Server.Tests\YFRemote.Server.Tests.csproj --configuration Release
dotnet build --configuration Release
```

For changes involving the packaged UI, also ensure the Client production output is
copied into `wwwroot` (`Copy-Item client\dist\YFRemote.Client\browser\* wwwroot -Recurse
-Force`) or let the GitHub release workflow perform that integration.
Test update behavior using an installed older version, not a development binary.

## Release automation

Merging to `main` triggers a release automatically. Nothing else is required — this now
covers Client-only changes too, because the Client lives in this repository.

`.github/workflows/ci.yml` runs on every pull request with two jobs: `build-and-test`
(restores, builds, and tests the Server on `windows-latest`) and `client` (`npm ci`, Client
tests, and the Client production build on `ubuntu-latest`). Neither has a `paths` filter, so
both run for every change.

`main` is protected by exactly one required status check, named `build-and-test`. Because that
check only runs on `pull_request`, a merge into `main` has to go through a pull request. The
protection matches the job by name: **renaming the `build-and-test` job in `ci.yml` makes the
required check unsatisfiable and blocks every merge into `main`** until the protection rule is
updated to the new name. The `client` job is deliberately not a required check — add it in the
branch protection settings if Client regressions should also block a merge.

`develop` has the same `build-and-test` rule. The owner's admin account can bypass it, and a
direct push then succeeds with a "Bypassed rule violations" notice — that is a mistake, not
a shortcut. Every change, including small docs follow-ups such as the CHANGELOG rename after
a release, goes on a feature branch and into `develop` through a pull request whose checks
passed.

`.github/workflows/auto-tag.yml` runs on every push to `main`. It:

1. analyzes commits since the previous tag using Conventional Commits (`fix:` → patch,
   `feat:` → minor, `feat!:` or a `BREAKING CHANGE:` footer → major; anything else falls
   back to a patch bump, so every merge produces at least a patch release);
2. computes the next `X.Y.Z` version without creating a tag itself (`dry_run: true`);
3. invokes `release.yml` directly as a reusable workflow (`workflow_call`), passing the
   version — the tag itself is created later by `vpk upload github --publish` inside
   `release.yml`, not by `auto-tag.yml`.

All automatic and manually triggered version calculations share the
`yfremote-version-release` concurrency group. Runs queue instead of replacing one another,
which prevents two releases from selecting or publishing the same next version in parallel.

Use Conventional Commit prefixes in commit/PR titles so the version bump is meaningful.
To skip a release entirely for a given merge (e.g. a docs-only change), include
`[skip release]` in the merge commit message.

`auto-tag.yml` also accepts a manual `workflow_dispatch` run with a chosen `bump` input
(`patch`/`minor`/`major`). It is only needed to force a version step or to redo a release
without a new commit.

`.github/workflows/release.yml` does the actual build/pack/publish work. It runs either
invoked by `auto-tag.yml` above, or directly when a semantic-version tag matching `v*.*.*`
is pushed by hand — keep the manual tag-push path in mind as a fallback (e.g. for re-running
a release, or environments where the automated workflow can't run).

The workflow:

1. checks out and verifies the exact commit that triggered the release — Server and Client
   come from that one commit, so they can no longer drift apart;
2. runs `npm ci`, Client tests, the Client production build, and the Server tests;
3. copies `client/dist/YFRemote.Client/browser/*` to `wwwroot`;
4. publishes a self-contained `win-x64` Server build with the tag version;
5. creates `release-manifest.json` with the version and the repository SHA and includes
   it in the packaged application;
6. downloads the previous release when available so Velopack can create a delta;
7. creates the installer, full package, and delta package (`--noPortable`: no portable
   archive, since Setup.exe already covers the installation case and it added no real use
   case, just build time and release size);
8. publishes a GitHub Release (`vpk upload github`), then renames the uploaded Setup.exe/msi
   assets via the GitHub API to include the version (`vpk pack` names them without one), and
   uploads the manifest as a separate release asset. The rename must happen *after* the upload:
   `vpk upload` uploads the file names recorded by `vpk pack`, not whatever is in `Releases/`,
   so renaming the files on disk first makes the upload fail (that is how the first v2.21.0
   run broke).

Both entry points behave identically — there is no Client input to pass between workflows
any more.

Typical release assets are:

- `YFRemote-win-Setup-X.Y.Z.exe`
- `YFRemote-win-X.Y.Z.msi` (wizard installer with selectable install location)
- `YFRemote-X.Y.Z-full.nupkg`
- `YFRemote-X.Y.Z-delta.nupkg` when a previous release exists
- `RELEASES`
- `releases.win.json`
- `release-manifest.json` (version plus the exact commit SHA the release was built from)

Never reuse, move, or overwrite a published version tag. If a release changes after
publication, increment the semantic version and create a new tag.

## Releasing a change

Server-only, Client-only, and combined changes all follow the same path — the Client is no
longer a separate repository, so there is no ordering constraint and no manual step.

1. Add an entry for the change under `[Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
   `release.yml` copies that section (or `## [<version>]`, if it already exists) into the
   GitHub Release text, so an empty `[Unreleased]` means a release without real notes.
2. Run the relevant Client and Server checks before merging (see "Validation" above).
3. Open a pull request from your feature branch into `develop` and merge it once
   `build-and-test` passed. Never push to `develop` directly.
4. Open a pull request from `develop` into `main` and merge it — use Conventional Commit
   prefixes (`fix:`, `feat:`, `feat!:`/`BREAKING CHANGE:`) in the commit or PR title so the
   automatic version bump is meaningful. Add `[skip release]` to the merge commit message to
   merge without releasing.
5. `auto-tag.yml` fires automatically on the merge, computes the next version, and invokes
   `release.yml`. No manual tagging step is needed.
6. Monitor the `Auto Tag YFRemote` and `Release YFRemote` workflow runs and verify all
   assets, then rename `[Unreleased]` in `CHANGELOG.md` to the version/date that was just
   published and start a fresh empty `[Unreleased]` section above it — on a feature branch
   and through a pull request into `develop`, like any other change.

Fallback if the automated workflow is unavailable: tag the intended `main` commit by hand
and push the tag, which triggers `release.yml` directly.

```powershell
cd <repo-local-path>   # see "Repository layout" above
git switch main
git pull --ff-only
git tag -a v1.0.2 -m "YFRemote v1.0.2"
git push origin v1.0.2
```

Do not assume any particular current version: query releases and tags before assuming what
the next automatic version will be.

## GitHub CLI notes

GitHub CLI is installed at:

```text
C:\Program Files\GitHub CLI\gh.exe
```

Authentication should be checked with `gh auth status` before GitHub writes. Useful
verification commands include:

```powershell
gh run list --repo YannikFroehlich/YFRemote.Server --workflow "Release YFRemote"
gh release list --repo YannikFroehlich/YFRemote.Server
gh release view vX.Y.Z --repo YannikFroehlich/YFRemote.Server
```

Keep release operations deliberate: confirm repository, branch, clean working tree,
target commit, and tag availability before pushing a release tag.
