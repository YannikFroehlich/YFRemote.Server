# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

YFRemote.Server is the .NET half of YFRemote, a Windows remote-control app: a phone/tablet/
second computer sends key, hotkey, and mouse actions over a WebSocket to this server, which
replays them into the interactive Windows session via `SendInput`. This repo also owns the
tray application, the installer, and GitHub Releases for the whole product.

The Angular client lives in a **separate repository** (`YFRemote.Client`, local path
`D:\Dokumente\Programmieren\YFRemote\client\YFRemote.Client`, branch `master`). Its production
build is copied into this repo's `wwwroot/` and served as static files — it is not present in a
normal checkout of this repo and is not built by `dotnet build`.

**Merging to `main` is release-related.** A push to `main` automatically triggers
`auto-tag.yml`, which computes the next semantic version from commit messages and invokes
`release.yml` to build, package, and publish a public GitHub Release — there is no separate
manual tagging step anymore. Treat every commit, push, or merge to `main` as a release action:
before doing so, read [AGENTS.md](AGENTS.md)'s "Release automation" section. In short:
- Use Conventional Commit prefixes (`fix:`, `feat:`, `feat!:`/`BREAKING CHANGE:` footer) in
  commit/PR titles so the automatic version bump (patch/minor/major) is meaningful — anything
  else still triggers at least a patch release.
- Add `[skip release]` to the merge commit message to merge without releasing (e.g. docs-only).
- A Client-only change needs a manual `workflow_dispatch` run of `auto-tag.yml` afterwards
  (nothing changes in this repo, so the automation doesn't fire on its own).

Full binding project/release rules (repo layout, release process, Velopack/versioning
constraints, GitHub CLI usage) are in [AGENTS.md](AGENTS.md) — read it before doing anything
release-related; it is authoritative and more detailed than the summary above.

## Commands

```powershell
dotnet restore
dotnet build --configuration Release
dotnet run                                    # starts server + tray; Velopack updates disabled (not an installed build)
dotnet run -- Server:Port=5060                # override port for a dev run
```

There is no automated test project in this repo (`test/websocket-test.html` is a manual
browser-based smoke test — not run via `dotnet test`). During a `dotnet run` dev session the
server serves this file itself at `http://<host>:<port>/test/websocket-test.html` (only when the
`test/` directory exists next to the working directory, so never in an installed build); open it
that way rather than via `file://`, since `/ws` rejects handshakes whose `Origin` header doesn't
match the server's own origin. There is no lint step beyond `dotnet build` warnings.

To exercise a full client+server integration locally:

```powershell
cd ..\..\client\YFRemote.Client
npm ci
npm test -- --watch=false
npm run build
cd ..\..\server\YFRemote.Server
New-Item -ItemType Directory -Path wwwroot -Force | Out-Null
Copy-Item ..\..\client\YFRemote.Client\dist\YFRemote.Client\browser\* wwwroot -Recurse -Force
dotnet publish -c Release -r win-x64 --self-contained true -o publish
```

Server binding (host/port) comes from `appsettings.json` (`Server:Host` / `Server:Port`,
default `0.0.0.0:5050`); validated in `ServerOptions.Validate()`.

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

**Web layer.** Minimal-API endpoints registered in `Program.BuildApplication`:
- `GET /health` → `HealthResponse`.
- `/ws` → upgraded to a WebSocket and handed to `YFRemoteWebSocketHandler`.
- Static files from `wwwroot` (the externally-built Angular client) with SPA fallback to
  `index.html` if present.

**Action pipeline.** `YFRemoteWebSocketHandler` owns the socket loop: reads a length-capped
(16 KB) framed text message, deserializes it as `RemoteActionRequest`, and passes it to
`RemoteActionHandler.Handle`, which dispatches on `request.Type` (`key`, `hotkey`, `mouseMove`,
`mouseClick`, `mouseScroll`) into `IInputService` / `IMouseService`, validates ranges/argument
shape per action, and always returns a `RemoteActionResponse` (never throws through to the
socket — exceptions become `Success:false` responses). One handler instance serially processes
one client's messages, but multiple clients can connect concurrently.

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
update check/install, Windows-startup toggle, exit) and owns the update-check timers (initial
check ~1.5s after launch, then every 6 hours) via `UpdateService` (thin wrapper over Velopack's
`UpdateManager`, pointed at public GitHub Releases of this repo). `CanUpdate` is
`UpdateManager.IsInstalled` — a `dotnet run` dev build is never "installed" and update UI stays
disabled for it. `WindowsStartupService` writes/reads the per-user
`HKCU\...\CurrentVersion\Run` registry value and only offers autostart when running from an
installed Velopack `current` directory (`GetLauncherPath` walks up to find the stable launcher
stub next to it). `NetworkAddressService` picks the LAN-facing IPv4 address (preferring
interfaces with a default gateway, skipping loopback/link-local) shown as the "device address"
for connecting from another device on the network.

**No auth.** There is currently no authentication/authorization on `/ws` or the action
protocol — anyone who can reach the bound port can send input. This is a known, documented
product constraint (see README "Sicherheit" section), not an oversight to silently patch.

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
