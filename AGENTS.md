# YFRemote agent guide

## Repository layout

YFRemote is a single public Git repository, `YannikFroehlich/YFRemote.Server`:

- Local path: `D:\Dev\YFRemote\server\YFRemote.Server` (laptop) /
  `D:\Dokumente\Programmieren\YFRemote\server\YFRemote.Server` (PC)
- Default branch: `main`; day-to-day work happens on `develop` and is merged into `main`
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

**Current status: code compiles and unit-tests here, but is unverified end-to-end.** No Linux
box or VM has run it yet — see the plan's two-stage proof: (1) a standalone `/dev/uinput`
round-trip (create device, write events, read them back from `/dev/input/eventN`) with no
compositor involved, then (2) a real bridged-VM run (phone → Angular page served from the VM →
WebSocket → uinput → visible cursor/keystrokes on the Ubuntu desktop). Until stage (1) has passed
at least once, treat the exact ioctl request codes, the legacy `uinput_user_dev` struct layout,
and the `input_event` struct size (24 bytes, assumed for 64-bit `long` time fields on x64/arm64)
as unverified against a real kernel, even though they match well-established values used by other
uinput bindings (e.g. `ydotool`, the Go `uinput` package). Verify portability with:

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
Windows-hosted CI can't do for the Linux target either.

**Multi-targeting broke `dotnet publish` without `-f`.** `dotnet publish YFRemote.Server.csproj`
used to infer the single `net10.0-windows` target; once the project multi-targets, `publish`
(unlike `build`/`test`, which happily build/run every target) refuses to guess and fails with
`NETSDK1129`. `release.yml`'s existing Windows publish step now passes
`--framework net10.0-windows` explicitly. Keep this in mind for any other `dotnet publish`
invocation added later (locally or in a workflow) — it needs an explicit `-f`/`--framework` now.

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
`-beta` suffix reflects that the uinput input path has never run against real hardware (see
above); it also carries into `--packTitle "YFRemote (Linux Beta)"` and, once, into the shared
GitHub Release body (a step gated to the `linux-x64` matrix leg so it only runs once per release,
appending rather than overwriting whatever notes the Windows job/`vpk` already set). Promoting
Linux to stable later means switching the channel name to `linux-x64`/`linux-arm64` — a clean
channel change, not a retroactive relabel of already-published beta packages. `--mainExe` has no
`.exe` suffix on Linux. **This job has never actually run** (no release has happened since it was
added) — before it runs for a real release, treat as open questions: whether `vpk upload
--publish` cleanly adds packages to a tag/release the Windows job already published (rather than
erroring or duplicating), whether the `ubuntu-24.04-arm` runner label is correct/available, and
packaging icon format for the Linux `vpk pack` step (intentionally omitted here rather than
guessing — Windows uses `--icon client/public/favicon.ico`, a `.ico`, which AppImage packaging
may not accept as-is).

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
7. creates the installer, portable archive, full package, and delta package;
8. publishes a GitHub Release and uploads the manifest as a separate release asset.

Both entry points behave identically — there is no Client input to pass between workflows
any more.

Typical release assets are:

- `YFRemote-win-Setup.exe`
- `YFRemote-win.msi` (wizard installer with selectable install location)
- `YFRemote-win-Portable.zip`
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

1. Run the relevant Client and Server checks before merging (see "Validation" above).
2. Merge to `main` — use Conventional Commit prefixes (`fix:`, `feat:`,
   `feat!:`/`BREAKING CHANGE:`) in the commit or PR title so the automatic version bump is
   meaningful. Add `[skip release]` to the merge commit message to merge without releasing.
3. `auto-tag.yml` fires automatically on the merge, computes the next version, and invokes
   `release.yml`. No manual tagging step is needed.
4. Monitor the `Auto Tag YFRemote` and `Release YFRemote` workflow runs and verify all
   assets.

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
