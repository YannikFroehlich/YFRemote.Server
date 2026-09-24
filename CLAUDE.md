# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

YFRemote.Server is the .NET half of YFRemote, a Windows remote-control app: a phone/tablet/
second computer sends key, hotkey, and mouse actions over a WebSocket to this server, which
replays them into the interactive Windows session via `SendInput`. This repo also owns the
tray application, the installer, and GitHub Releases for the whole product.

The Angular client lives in [`client/`](client) **in this same repository** — it has its own
[`client/CLAUDE.md`](client/CLAUDE.md). It is not built by `dotnet build` and is excluded from
the server project's globs via `DefaultItemExcludes`; its production build is copied into
`wwwroot/` (gitignored) and served as static files. Server and client are therefore versioned
and released from a single commit.

The Server project multi-targets `net10.0-windows;net10.0`. Windows is the stable release; every
release also ships Linux x64/arm64 packages on separate `-beta` Velopack channels
(`release-linux` job). The Linux `uinput` input backend is manually verified end-to-end on a real
x86_64 kernel, but only as a bare `dotnet publish` output — arm64 on real hardware and the
Velopack-installed path are still unverified, see AGENTS.md's "Linux support" section.

[`android/`](android) holds a separate native Kotlin/Ktor server app (not .NET) that serves the
same Angular client and speaks the same protocol; `release-android` attaches its signed APK to
every release. Its plan and verification status are in [`android/PLAN.md`](android/PLAN.md) and
AGENTS.md's "Android support" section.

**Merging to `main` is release-related.** A push to `main` automatically triggers
`auto-tag.yml`, which computes the next semantic version from commit messages and invokes
`release.yml` to build, package, and publish a public GitHub Release — there is no separate
manual tagging step anymore. Treat every commit, push, or merge to `main` as a release action:
before doing so, read [AGENTS.md](AGENTS.md)'s "Release automation" section. In short:
- Use Conventional Commit prefixes (`fix:`, `feat:`, `feat!:`/`BREAKING CHANGE:` footer) in
  commit/PR titles so the automatic version bump (patch/minor/major) is meaningful — anything
  else still triggers at least a patch release.
- Add `[skip release]` to the merge commit message to merge without releasing (e.g. docs-only).
- A Client-only change releases exactly like a Server change — it is a commit in this repo, so
  the automation fires on its own. No manual `workflow_dispatch` step is needed.
- `main` is protected by the required status check `build-and-test` (the server job in
  `ci.yml`), so a merge needs a PR whose checks passed. Do not rename that job — see AGENTS.md.

Full binding project/release rules (repo layout, release process, Velopack/versioning
constraints, GitHub CLI usage) are in [AGENTS.md](AGENTS.md) — read it before doing anything
release-related; it is authoritative and more detailed than the summary above.

## Commands

```powershell
dotnet restore
dotnet build --configuration Release
dotnet test tests\YFRemote.Server.Tests\YFRemote.Server.Tests.csproj --configuration Release
dotnet run                                    # starts server + tray; Velopack updates disabled (not an installed build)
dotnet run -- Server:Port=5060                # override port for a dev run
dotnet run -- Https:Enabled=true               # additionally serve HTTPS on 5443 via a local CA
```

Automated Server tests live in `tests/YFRemote.Server.Tests` and cover pairing persistence,
backup recovery, write rollbacks, PIN lockout, and throttled last-seen writes. The release
workflow runs them before publishing. `test/websocket-test.html` remains a separate manual
browser-based smoke test. During a `dotnet run` dev session the server serves this file itself at
`http://<host>:<port>/test/websocket-test.html` (only when the `test/` directory exists next to
the working directory, so never in an installed build); open it that way rather than via
`file://`, since `/ws` rejects handshakes whose `Origin` header doesn't match the server's own
origin. There is no lint step beyond `dotnet build` warnings.

To exercise a full client+server integration locally:

```powershell
cd client
npm ci
npm test -- --watch=false
npm run build
cd ..
New-Item -ItemType Directory -Path wwwroot -Force | Out-Null
Copy-Item client\dist\YFRemote.Client\browser\* wwwroot -Recurse -Force
dotnet publish -c Release -r win-x64 --self-contained true -o publish
```

Server binding (host/port) comes from `appsettings.json` (`Server:Host` / `Server:Port`,
default `0.0.0.0:5050`); validated in `ServerOptions.Validate()`.

HTTPS is opt-in via `Https:Enabled` (`HttpsOptions`, default off, port 5443). When it is on,
`LocalCertificateAuthority` creates a local CA once (`%LOCALAPPDATA%\YFRemote\ca.pfx`, DPAPI on
Windows, `0600` on Linux) and `ServerCertificateProvider` issues the server certificate from it for
every local IPv4 address, reissuing it on `NetworkAddressChanged`. HTTP keeps serving on
`Server:Port` either way. A damaged CA file is a hard startup error on purpose: silently creating a
new CA would leave every device that installed the old one on a certificate warning. Enabling HTTPS
changes the page origin, so paired devices have to pair again — the pairing token lives in the
client's `localStorage`, which is per-origin.

`Https:Enabled` is normally set from the tray ("HTTPS verwenden"), which writes it via
`UserSettingsStore` to `%LOCALAPPDATA%\YFRemote\settings.json` and restarts the process. That file
is a config source added in `Program.AddUserSettings`, inserted *before* the command-line source:
command line > settings.json > environment variables > `appsettings.json`. It deliberately does not
live in the installation's `appsettings.json`, which Velopack replaces with the `current` folder on
every update. The restart passes `Program.RestartWaitArgument`, which makes the new process wait for
the single-instance mutex instead of reporting "läuft bereits"; that argument is filtered out before
the args reach `BuildApplication`.

## Architecture

**Process shape.** `Program.Main` is `[STAThread]` and does three things in order: (1) runs
`VelopackApp.Build()...Run()` so Velopack can intercept installer/uninstaller lifecycle events
before anything else starts (it registers `WindowsStartupService.SetEnabled(false)` as an
uninstall hook); (2) takes a named `Mutex` (`YFRemote.Server.SingleInstance`) and exits with a
message box if another instance already holds it — only one server may run per machine; (3)
builds and starts the ASP.NET Core `WebApplication`, then hands control to
`Application.Run(new TrayApplicationContext(app))`, a Windows Forms message loop. There is no
console UI — `OutputType=WinExe`. Startup exceptions are caught, written to
`%LOCALAPPDATA%\YFRemote\Logs\startup-error.log`, and shown in a message box rather than
crashing silently.

**Web layer.** Minimal-API endpoints, wired up in `Program.BuildApplication`. `/health` and
`/ca.crt` are mapped there directly; everything else lives in `Endpoints/` as one `Map…` extension
method on `WebApplication` per area (`WebSocketEndpoint`, `PairingEndpoints`, `FileEndpoints`,
`ClipboardEndpoints`), so they keep logging through `app.Logger`. `RequestGuards` holds
`IsAllowedOrigin`, `GetBearerToken`, and `AuthorizePairedDeviceAsync` — the shared gate of the
`Bearer`-token endpoints (`POST /files`, `/clipboard/*`): 403 unless the `Origin` matches (a
missing `Origin` is only tolerated with `originOptional: true`, i.e. `GET /clipboard/text`), 401
without a valid token. A new endpoint of that kind should go through it rather than repeat those
checks. `/ws` (token in `?token=`, own warning logs, "Pairing required." body) and `DELETE /pair`
(401 from `RemoveDeviceByToken`) deliberately do their own checks.
- `GET /health` → `HealthResponse`, including the server platform (`windows`/`linux`), from
  which the Client picks its built-in button set.
- `/ws` → upgraded to a WebSocket and handed to `YFRemoteWebSocketHandler`, but only after both
  an `Origin` check and a `?token=` pairing-token check (`PairingService.IsValidToken`) pass.
- `POST /pair` → exchanges a PIN for a device token (`PairingService.TryPair`).
- `GET /pair/status` → lets a client check whether a previously-issued token is still valid
  without opening a WebSocket (`PairingService.IsValidToken`).
- `DELETE /pair` → removes the device identified by the `Bearer` token
  (`PairingService.RemoveDeviceByToken`) and force-closes any open `/ws` connection for that
  device via `WebSocketConnectionRegistry.CloseConnections`.
- `POST /files` → multipart upload from the device, saved by `FileTransferService` to
  `FileTransfer:TargetDirectory` (default `Documents\YFRemote`, 200 MB cap counted on the actual
  bytes read, not `Content-Length`) under a sanitized, collision-free name; the tray shows a
  "Datei empfangen" balloon via its `FileReceived` event.
- `POST /clipboard/text` (JSON, `Clipboard:MaxTextLength` 200 000) and `POST /clipboard/image`
  (multipart, `Clipboard:MaxImageSizeBytes` 20 MB) → write the PC clipboard via
  `IClipboardService`.
- `GET /clipboard/text` → reads the PC clipboard's text back (`{ text: null }` when it holds
  none, `422` beyond `Clipboard:MaxTextLength`), sent with `Cache-Control: no-store`. Unlike the
  POST endpoints it only rejects a *mismatching* `Origin`: browsers send none on a same-origin
  GET `fetch()`, so the `Bearer` token is the real gate here. Only the Windows service can read;
  `LinuxClipboardService` throws `NotSupportedException` for every clipboard call, which becomes
  `501`, and the Client offers "Vom PC holen" only for `platform: windows`. Every successful
  read calls `ClipboardReadNotifier.NotifyTextRead(deviceName)`, which the tray turns into a
  "Zwischenablage gesendet" balloon so an unexpected read is visible at the PC.
- `/files` and `POST /clipboard/*` require the same `Origin` check plus a `Bearer` pairing token.
- `GET /ca.crt` → the public certificate of the local certificate authority, registered only when
  `Https:Enabled` is set. Deliberately without an `Origin` or pairing check and reachable over
  plain HTTP, because it has to be installable before a device trusts the server.
- Static files from `wwwroot` (the Angular client's production build, copied in from `client/`)
  with SPA fallback to `index.html` if present.

**Action pipeline.** `YFRemoteWebSocketHandler` owns the socket loop: reads a length-capped
(16 KB) framed text message, deserializes it as `RemoteActionRequest`, and passes it to
`RemoteActionHandler.Handle`, which dispatches on `request.Type` (`key`, `hotkey`, `text`,
`mouseMove`, `mouseClick`, `mouseDown`, `mouseUp`, `mouseScroll`, `shutdown`, `restart`,
`sleep`) into `IInputService` / `IMouseService` / `IPowerService`, validates
ranges/argument shape per action, and always returns a `RemoteActionResponse` (never throws
through to the socket — exceptions become `Success:false` responses). An optional `requestId`
from the action is echoed in that response so the Client can correlate macro steps with their
server acknowledgements. One handler instance serially processes one client's messages, but
multiple clients can connect concurrently. Each connection also carries its own fixed-window
rate limit (120 messages/second; a `Fail` response beyond that, connection stays open) as a
backstop against a flooding bug or a misbehaving already-paired device — legitimate mouse
move/scroll traffic tops out around one message per animation frame.

**Input simulation.** `WindowsInputService`/`WindowsMouseService` translate high-level actions
into raw Win32 `SendInput` calls via the shared `WindowsInputSender`, which serializes all
sends behind one lock (`ExecuteSynchronized`) so hotkey modifier press/release ordering and
concurrent requests from different clients can't interleave and produce stuck modifier keys.
Hotkeys press all modifiers down, then non-modifier keys, then release modifiers in reverse
order, with `finally`-based best-effort cleanup if a send fails partway through. Supported keys
are a fixed allowlist in `WindowsInputService.VirtualKeys`; anything else throws
`UnsupportedKeyException`, which `RemoteActionHandler` converts into a `Fail` response.

**Tray app.** `TrayApplicationContext` (Windows Forms `ApplicationContext`) builds the
`NotifyIcon` context menu (version, status, device address, open-in-browser, copy-address,
PIN display/copy/regenerate, a "Gekoppelte Geräte" submenu for revoking devices, an HTTPS
toggle, update check/install, Windows-startup toggle, exit) and owns the update-check timers (initial
check ~1.5s after launch, then every 6 hours) via `UpdateService` (thin wrapper over Velopack's
`UpdateManager`, pointed at public GitHub Releases of this repo). `CanUpdate` is
`UpdateManager.IsInstalled` — a `dotnet run` dev build is never "installed" and update UI stays
disabled for it. The PIN text and the paired-devices submenu are refreshed on the
`ContextMenuStrip.Opening` event rather than a polling `Timer`, since nothing needs to be
current while the menu is closed. `WindowsStartupService` writes/reads the per-user
`HKCU\...\CurrentVersion\Run` registry value and only offers autostart when running from an
installed Velopack `current` directory (`GetLauncherPath` walks up to find the stable launcher
stub next to it). `NetworkAddressService` picks the LAN-facing IPv4 address (preferring
interfaces with a default gateway, skipping loopback/link-local) shown as the "device address"
for connecting from another device on the network.

**Pairing.** `PairingService` (singleton) is the only gate in front of `/ws`, `/pair`,
`/pair/status`, `/files`, and `/clipboard/*`. It generates a 6-digit PIN (10-minute lifetime,
shown in the tray, manually regenerable), exchanges a correct PIN for an opaque per-device token, and persists *hashed*
(SHA-256) tokens plus a device name and timestamps to `%LOCALAPPDATA%\YFRemote\devices.json`
(same base folder as `Logs\startup-error.log`, never inside the Velopack `current\` directory
that gets replaced on update). Persistence uses a flushed temporary file plus atomic replacement;
the previous valid state remains in `devices.json.bak` and is loaded when the primary file is
damaged. Pairing only succeeds after that write, then immediately rotates the used PIN. Failed
pairing and removal writes roll back their in-memory change. `LastSeenUtc` updates immediately in
memory and is persisted on a five-minute throttle. Failed pairing attempts are rate-limited per
client IP
(5 attempts → 60s lockout), in-memory only. Removing a device — in the tray, or via
`DELETE /pair` — also force-closes any open `/ws` connection for that device
(`WebSocketConnectionRegistry.CloseConnections`), not just future connections. This closes the
previous "no auth" gap (see README "Sicherheit" section): reaching the bound port is no longer
enough to send input, a device must first be paired.

## Conventions in this codebase

- Commit and PR titles follow Conventional Commits (`fix:`, `feat:`, `feat!:`/`BREAKING
  CHANGE:` footer, `chore:`, `docs:`, ...) because `main` is wired to automatic semantic
  versioning and releases — see the release-automation note above and AGENTS.md.
- Primary constructors are used throughout for DI (e.g. `RemoteActionHandler(IInputService
  inputService, IMouseService mouseService, ILogger<...> logger)`); follow that pattern for new
  services rather than field + constructor-body assignment.
- User-facing strings (message boxes, tray menu, balloon tips) are German; keep new user-facing
  strings consistent with that.
- Code comments in this repo are sparse and, where present, in German explaining a non-obvious
  "why" (e.g. why an uninstall-hook failure is swallowed). Match that style rather than adding
  English comments.
- [`CHANGELOG.md`](CHANGELOG.md) tracks every notable change per released version. Add an entry
  under its `[Unreleased]` section in the same change that adds a feature or fix. After a
  release, `release.yml` (job `changelog-pr`) opens a PR into `develop` that renames
  `[Unreleased]` to the new version/date - merge it instead of renaming by hand.
