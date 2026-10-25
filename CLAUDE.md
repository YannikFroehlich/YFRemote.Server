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

The Server project multi-targets `net10.0-windows10.0.17763.0;net10.0`. Windows is the stable release; every
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
workflow runs them before publishing. `ServerEndpointsTests` drive `/ws` end to end over the
real HTTP stack with `FakeInputService` swapped in for `IInputService`/`IMouseService` via
`BuildApplication`'s `configureServices` hook, so they never touch the test machine's keyboard
or mouse and run on both target frameworks. For a manual check against real input, use the
Angular client itself. There is no lint step beyond `dotnet build` warnings.

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
without a valid token, 403 `Not allowed for this device.` for a "Nur Medien" device unless
`mediaOnlyAllowed: true` (only `GET /media/cover`). A new endpoint of that kind should go through it rather than repeat those
checks. `/ws` (token in `?token=`, own warning logs, "Pairing required." body) and `DELETE /pair`
(401 from `RemoveDeviceByToken`) deliberately do their own checks.
- `GET /health` → `HealthResponse`, including the server platform (`windows`/`linux`), from
  which the Client picks its built-in button set, `gamepad` (controller mode available), and
  `macAddress` of the LAN adapter behind the shown device address (`NetworkAddressService`), which
  the Android app stores to wake the PC later via Wake-on-LAN, plus `macAddressWireless` (that
  adapter is Wi-Fi, so waking it will most likely fail; the app warns after sending), and
  `voicemeeter` (Voicemeeter installed; the Client then adds its inputs and outputs to the "Mixer" tab).
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
- `GET /files/{id}` → downloads the file the tray currently offers ("Datei an Geräte senden...",
  `FileOfferService`: one offer at a time, 10-minute lifetime). The offer itself reaches devices as
  an unsolicited `{"type":"fileOffer","id","name","size"}` WebSocket message, pushed on offer and
  again on every connect. `Origin` optional like `GET /clipboard/text`; every download raises a
  "Datei gesendet" balloon.
- `POST /clipboard/text` (JSON, `Clipboard:MaxTextLength` 200 000) and `POST /clipboard/image`
  (multipart, `Clipboard:MaxImageSizeBytes` 20 MB) → write the PC clipboard via
  `IClipboardService`.
- `GET /clipboard/text` → reads the PC clipboard's text back (`{ text: null }` when it holds
  none, `422` beyond `Clipboard:MaxTextLength`), sent with `Cache-Control: no-store`. Unlike the
  POST endpoints it only rejects a *mismatching* `Origin`: browsers send none on a same-origin
  GET `fetch()`, so the `Bearer` token is the real gate here. `LinuxClipboardService` shells out
  to `wl-paste`/`wl-copy` (Wayland) or `xclip` (X11); a missing tool or graphical session becomes
  a `NotSupportedException` → `501`. The Client offers "Vom PC holen" for every known platform
  ("Vom Gerät holen" for the Android app's own `GET /clipboard/text`, which answers `409` unless
  the YFRemote keyboard is the selected IME - Android 10+ only lets that IME read the
  clipboard). Every successful
  read calls `ClipboardReadNotifier.NotifyRead(deviceName)`, which the tray turns into a
  "Zwischenablage gesendet" balloon so an unexpected read is visible at the PC.
- `GET /clipboard/image` → the same gate and `no-store`, but the clipboard image as `image/png`
  in the body (`204` without one, `422` beyond `Clipboard:MaxImageSizeBytes`). The Client asks for
  it only when `GET /clipboard/text` found no text, and never on the Android server, which has no
  such endpoint. `WindowsClipboardService` converts the bitmap to PNG; Linux asks
  `wl-paste`/`xclip` for `image/png`.
- `GET /media/cover` (`MediaEndpoints`) → the album cover of the playing media app from
  `IMediaControl.Cover`, same `Bearer`/optional-`Origin` gate and `no-store`, `204` without one.
  The `media` push carries only its `coverId`, so the image is fetched once per track, not every
  second. Windows reads the GSMTC thumbnail on a track change; Linux loads playerctl's
  `mpris:artUrl` (`file://` from browsers/VLC, `https://` from Spotify; PNG/JPEG only) beside the
  poll when URL or title change, so a slow download never delays the push - the `coverId` follows
  with the next one. Both cap it at 2 MB. Linux is only covered by tests on local files.
- `GET /launch/apps` (`LaunchEndpoints`) → `{ apps: [name] }`, the apps a `launch` action may
  start (`IAppLauncher.ListApps`), for the button editor's suggestions; same gate and `no-store`.
- `GET /windows` (`WindowEndpoints`) → `{ windows: [{id,title,app}] }` for the "PC" tab's window
  switcher, same gate and `no-store`; `501` without an `IWindowService` (Linux). `focusWindow`
  (`id`, digits only, must be in the current list) brings one to the front.
  `WindowsWindowService` follows the Alt+Tab rules (visible, unowned, not cloaked, no
  `WS_EX_TOOLWINDOW`, `WS_EX_NOACTIVATE` only with `WS_EX_APPWINDOW`, own process excluded), front
  window first. `SetForegroundWindow` only works for the process that sent the last input, so it
  first sends a 0-pixel mouse move through `WindowsInputSender` (the PowerToys trick); minimized
  windows are restored. Listing and switching back and forth were checked on the dev PC on
  2026-10-24.
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
`sleep`, `lock`, `displayOff`, `volume`, `mediaSeek`, `shutdownTimer`, `voicemeeterParameter`, `launch`, ...) into `IInputService` /
`IMouseService` / `IPowerService` / `IVolumeService` (implemented by the media status readers;
it also unmutes, like the Windows volume slider), validates
ranges/argument shape per action, and always returns a `RemoteActionResponse` (never throws
through to the socket — exceptions become `Success:false` responses). An optional `requestId`
from the action is echoed in that response so the Client can correlate macro steps with their
server acknowledgements. One handler instance serially processes one client's messages, but
multiple clients can connect concurrently. Each connection also carries its own fixed-window
rate limit (120 messages/second; a `Fail` response beyond that, connection stays open) as a
backstop against a flooding bug or a misbehaving already-paired device — legitimate mouse
move/scroll traffic tops out around one message per animation frame.

**Volume per app.** The "Mixer" tab subscribes `{"type":"apps","enabled"}` like `systemStats` and
gets `{"type":"apps","apps":[{id,name,volume,muted}]}` from a `PollingBroadcaster` over
`IAppVolumeService.ReadAppsAsync`. On Windows (`WindowsMediaStatusReader.Apps.cs`) these are the
Core Audio sessions of the default playback device, grouped per process (`id` = process id, or
`system` for the system sounds, which the Client names itself). The name is the session's display
name or the executable's file description, cached per process id. Session volume also works behind
Voicemeeter, because Windows applies it before the stream reaches the virtual device. On Linux the
entries are `pactl list sink-inputs`, one per stream (`id` = sink-input number). `appVolume`
(`id`, `volume` 0-100 and/or `muted`) only accepts `system` or digits as `id`, so nothing can reach
`pactl` as an option. Custom buttons send `name` instead of `id` (`HandleAppVolumeByName`): it hits
every entry of that name, case-insensitive, and without `volume`/`muted` it toggles mute (all muted
→ unmute, else mute). Verified on Windows on 2026-10-24 by reading and setting a running process's
session; Linux is only covered by the parser test.

The same push carries `outputs` (`{id,name,default}`), the active playback devices. `audioOutput`
(`id`) makes one the default, but only an `id` from the current list (`HandleAudioOutput` reads it
first). Windows sets the console and multimedia roles through the undocumented `IPolicyConfig`
(`CPolicyConfigClient`, the API every switcher tool uses), and leaves the communications device
alone; the vtable order of that interface matters, a missing method before `SetDefaultEndpoint`
would call `SetEndpointVisibility` and hide the device. Linux uses `pactl list sinks`,
`get-default-sink` and `set-default-sink`. Reading the list and re-setting the current default
was verified on Windows on 2026-10-24 (the test PC has only one device, so an actual switch is
not).

**Launching apps and websites.** `launch` (custom-button step "Öffnen") takes either `url`
(only absolute `http`/`https`, ≤ 2000 chars, opened in the default browser) or `name`, which must
match an entry of `IAppLauncher.ListApps` case-insensitively — never a free path or command line
with arguments. `WindowsAppLauncher` lists the `.lnk`/`.url` files of the user's and the common
Start menu (`.url` because Steam puts its games there), plus the packaged (Store) apps of
`shell:AppsFolder` (via `Shell.Application`, recognized by the `!` in their AUMID; started as
`shell:AppsFolder\<AUMID>`), and starts them via `UseShellExecute`, like a double click. Listing
and starting a Store app (Rechner) were checked on the dev PC on 2026-10-25. `LinuxAppLauncher` reads the visible
`Type=Application` `.desktop` files from the XDG data dirs plus the Flatpak/Snap export folders
and starts them with `gio launch` (URLs with `xdg-open`), using the graphical session that
`LinuxClipboardService.GetBackendAsync` finds. Windows listing was checked against the real Start
menu on 2026-10-24; actually launching, and all of Linux beyond the parser tests, is unverified.

**Media timeline.** `position`/`duration` in the `media` push are whole seconds; without a track
length (livestream) both are missing. GSMTC reports the position as of `LastUpdatedTime`, and many
apps update it only on pause or seek, so `WindowsMediaStatusReader.Timeline` adds the time since then
while playing. That makes the push change every second during playback, which is intended.
`mediaSeek` (`position` 0-86400 s) goes to `IMediaControl.Seek`: GSMTC
`TryChangePlaybackPositionAsync` (some apps advertise seeking and still refuse) or
`playerctl position`; a refusal is a `Fail` response. `canSeek` is GSMTC's
`IsPlaybackPositionEnabled`; on Linux it is assumed whenever there is a length.

**Shutdown timer.** `shutdownTimer` with `minutes` 1-1440 schedules a shutdown in the singleton
`ShutdownTimer`, `minutes: 0` cancels it. It deliberately runs its own in-process timer instead of
`shutdown.exe /s /t N`: any `/t` above 0 implies `/f` and would close apps with unsaved work
without asking; when due it calls the normal `IPowerService.Shutdown`. The timer is lost when
YFRemote exits. The tray shows a balloon naming the device and a "Herunterfahren um HH:mm Uhr
abbrechen" entry while one is pending. The Client asks for the minutes with `prompt()`. Every
change (scheduled, cancelled, elapsed) is pushed to all connected devices as
`{"type":"shutdownTimer","remainingSeconds"}` (`ShutdownTimer.Status`; no `remainingSeconds` = none
pending), and again on connect while one is pending. Remaining seconds rather than a time of day,
because the device clock may differ from the PC's. The Client shows a countdown with "Abbrechen"
above the Remote buttons.

**Server pushes besides responses.** Next to `fileOffer` and `rumble`, the socket carries
`{"type":"media","volume","muted","title","artist","playing","position","duration","canSeek","coverId"}`
(`WindowsMediaStatusReader` reads
Core Audio over COM and the WinRT media session manager; for a Voicemeeter device see below;
`LinuxMediaStatusReader` shells out to
`pactl` and `playerctl`, leaving a part empty when its tool is missing) and
`{"type":"clipboard","text"}`. Both come from a `PollingBroadcaster<T>`, which polls its source
once per second only while at least one connection subscribes and reports only changes. Media is
subscribed for every connection and announces the current state on subscribe; the clipboard
broadcaster is subscribed only after the device sends `{"type":"clipboardSync","enabled":true}`
(kept in the connection's `RemoteActionSession`), and it never sends content that was already in
the clipboard when sync started. `ClipboardReadNotifier.NotifySyncEnabled` shows a tray balloon
once per device and run. A third broadcaster pushes
`{"type":"systemStats","cpuLoad","cpuTemperature","gpuLoad","gpuTemperature","memoryUsedMb","memoryTotalMb"}`,
subscribed only while the device has the Client's "PC" tab open (`{"type":"systemStats","enabled"}`,
kept in `RemoteActionSession` like clipboard sync), so the PC measures nothing otherwise.
`WindowsSystemStatsReader` uses `GetSystemTimes`, `GlobalMemoryStatusEx`, the PDH counter
`\GPU Engine(*)\Utilization Percentage` (summed per engine, busiest engine wins, like Task Manager)
and `D3DKMTQueryAdapterInfo(KMTQAITYPE_ADAPTERPERFDATA)` for the GPU temperature - no admin rights,
so Windows itself yields no CPU temperature. If LibreHardwareMonitor runs (it has its own driver and
admin rights) with its "Remote Web Server", `http://localhost:8085/data.json` (port from
`SystemStats:SensorToolPort`, `SystemStatsOptions`, default 8085 like LHM; set it in
`%LOCALAPPDATA%\YFRemote\settings.json`, which survives updates) fills the CPU temperature and a missing GPU temperature (`ParseSensorToolTemperatures`; values are
formatted in LHM's UI language, "55,0 °C"). LHM 0.9.x no longer publishes WMI. Without the web
server the reader retries only every 30 s, because a refused localhost connection takes ~2 s; the
request runs beside the poll and its answer counts from the next reading on, so it never stalls the
display, and any failure (also foreign JSON on that port) only drops the temperatures. After a pause
of more than 5 s both readers start over like on the first read (CPU/GPU load `null` once) instead
of reporting the average over the whole pause. `LinuxSystemStatsReader` reads `/proc/stat`, `/proc/meminfo`,
hwmon (`coretemp`/`k10temp`/..., `amdgpu`/...) and amdgpu's `gpu_busy_percent`. A missing value is
`null` and the Client shows it as unavailable. In the Client, `ClipboardSyncService` writes pushed text into the
device clipboard and, when the app regains focus, sends newly copied device text via
`POST /clipboard/text`. That needs the Async Clipboard API, so it works over HTTPS only.

**Voicemeeter (Windows).** Voicemeeter ignores Windows volume and mute on its virtual playback
devices, so `WindowsVoicemeeter` talks to the Voicemeeter Remote API (`VoicemeeterRemote64.dll`
from the install folder found via the uninstall registry key, loaded only once that file exists;
`IsInstalled` feeds `/health`). Strip and bus counts and the routes (`A1`...`B3`) are probed from
Voicemeeter itself (unknown parameters return an error) instead of hard-coded per version; only the
hardware-input count per type (2/3/5) is fixed, because the virtual inputs follow it. When the
default playback device's adapter name (`PKEY_DeviceInterface_FriendlyName`, e.g. "VB-Audio
Voicemeeter AUX VAIO") is a Voicemeeter one, or `Voicemeeter:Target` (`VoicemeeterOptions`,
e.g. `Strip[3]`, settable in `settings.json`) names a channel, `WindowsMediaStatusReader` routes
the media push's `volume`/`muted`, the `volume` action and the `VOLUME_MUTE/UP/DOWN` keys
(`IVolumeService.TryHandleVolumeKey`, called by `RemoteActionHandler` before `SendInput`) to that
channel's `Gain`/`Mute`; percent maps linearly to -60...0 dB like Voicemeeter's fader. The
"Mixer" tab subscribes `{"type":"voicemeeter","enabled"}` like `systemStats` and gets
`{"type":"voicemeeter","channels":[{id,name,muted,gain}],"routes"}` (no `channels` = not running).
`voicemeeterParameter` sets only `Strip[n].Mute|Gain|A1-A5|B1-B3` and `Bus[n].Mute|Gain`
(regex in `RemoteActionHandler`, no free Voicemeeter script that could load files or quit it);
without `value` a switch toggles. The owner confirmed it works on their PC with a real Voicemeeter
on 2026-10-23 (v2.37.0).

**Controller mode.** A `gamepad` action carries the full controller state
(`GamepadState`: XInput button bitmask, stick axes, triggers) instead of single button events, so a
lost message cannot leave a button stuck. `RemoteActionHandler` plugs a virtual Xbox 360 controller
in through `IGamepadService` on the first `gamepad` message of a connection and keeps it in that
connection's `RemoteActionSession`, which `YFRemoteWebSocketHandler` disposes when the socket ends -
one controller per connected device, so several phones are several players. `gamepadDisconnect`
unplugs it early (the Client sends it when leaving the controller view). When a game sets
vibration, ViGEm's `FeedbackReceived` (driver thread) is deduplicated in `WindowsGamepadService`
and pushed to the device as `{"type":"rumble","largeMotor","smallMotor"}` - like `fileOffer`, a
server message that is not a response. That is why `YFRemoteWebSocketHandler` serializes every send behind one
`SemaphoreSlim`: a WebSocket allows only one `SendAsync` at a time. `WindowsGamepadService`
uses the ViGEmBus driver via `Nefarius.ViGEm.Client` and caps at 4 controllers (XInput slots). The
driver needs admin rights and is not bundled with the per-user Velopack install: without it
`/health` reports `gamepad: false`, the Client hides the tab, and the tray shows
"Controller-Treiber installieren..." linking to the ViGEmBus releases page. Availability is
re-checked on every call, so installing the driver needs no restart. On Linux,
`LinuxGamepadService` creates one `uinput` device per controller with the USB ID and the
button/axis codes of a wired Xbox 360 pad under the kernel's `xpad` driver, so SDL/Steam map it
without a custom mapping; available whenever `/dev/uinput` exists, no slot cap, no rumble yet.

**Input simulation.** `WindowsInputService`/`WindowsMouseService` translate high-level actions
into raw Win32 `SendInput` calls via the shared `WindowsInputSender`, which serializes all
sends behind one lock (`ExecuteSynchronized`) so hotkey modifier press/release ordering and
concurrent requests from different clients can't interleave and produce stuck modifier keys.
Hotkeys press all modifiers down, then non-modifier keys, then release modifiers in reverse
order, with `finally`-based best-effort cleanup if a send fails partway through. Supported keys
are a fixed allowlist in `WindowsInputService.VirtualKeys`; anything else throws
`UnsupportedKeyException`, which `RemoteActionHandler` converts into a `Fail` response.
While the secure desktop is active (UAC prompt, lock screen), `SendInput` and `GetCursorPos` fail
with `ERROR_ACCESS_DENIED` (measured on a real UAC prompt). `WindowsInputSender.LastWin32Failure`
turns that into `InputBlockedException`. The Client recognizes its fixed message text and shows a
translated hint, and the socket stays open. A non-SYSTEM process cannot answer the UAC prompt
itself.

**Tray app.** `TrayApplicationContext` (Windows Forms `ApplicationContext`) builds the
`NotifyIcon` context menu (version, status, device address, open-in-browser, copy-address,
PIN display/copy/regenerate, a "Gekoppelte Geräte" entry whose device/connection count updates live
via `WebSocketConnectionRegistry.ConnectionsChanged` (which also drives the tooltip and status line)
and which opens `UnpairDevicesDialog` to revoke several devices at once, an HTTPS
toggle, update check/install, Windows-startup toggle, exit) and owns the update-check timers (initial
check ~1.5s after launch, then every 6 hours) via `UpdateService` (thin wrapper over Velopack's
`UpdateManager`, pointed at public GitHub Releases of this repo). `CanUpdate` is
`UpdateManager.IsInstalled` — a `dotnet run` dev build is never "installed" and update UI stays
disabled for it. The PIN text and the paired-devices entry are refreshed on the
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
memory and is persisted on a five-minute throttle. A device whose `LastSeenUtc` is older than
`PairingStorage:DeviceExpiry` (default 90 days, `0` disables) is dropped at startup, on every token
check and when the tray lists devices; it stays invalid even if that write fails. `LastSeenUtc`
only moves on a handshake or HTTP request, so a device connected without a break for longer than
the expiry has to pair again. Failed pairing attempts are rate-limited per
client IP
(5 attempts → 60s lockout), in-memory only. Removing a device — in the tray, or via
`DELETE /pair` — also force-closes any open `/ws` connection for that device
(`WebSocketConnectionRegistry.CloseConnections`), not just future connections. This closes the
previous "no auth" gap (see README "Sicherheit" section): reaching the bound port is no longer
enough to send input, a device must first be paired.

**Media-only devices.** Each device record carries `MediaOnly` (default `false`, so older
`devices.json` files load as full access). The tray's "Gekoppelte Geräte" dialog sets it with
"Nur Medien"/"Vollzugriff" (`PairingService.SetMediaOnly`, rolled back on a failed write) and then
closes the device's open `/ws` connections, because the flag is read once per connection
(`TryValidateToken(..., out mediaOnly)` → `RemoteActionSession.MediaOnly`); the Client reconnects on
its own. `RemoteActionHandler.IsMediaAction` is the allowlist checked before dispatch: `MEDIA_*`/
`VOLUME_*` single keys, `volume`, `mediaSeek`, `appVolume`, `audioOutput`, the Voicemeeter actions,
the `apps`/`systemStats` subscriptions, `gamepadDisconnect` and `clipboardSync` with
`enabled:false`. Everything else answers `Not allowed for this device.`, which the Client shows as a
translated hint. Such a device also gets no `fileOffer` push.

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
  `[Unreleased]` to the new version/date and merges itself via auto-merge once `build-and-test`
  passes - don't rename by hand. Without the `CHANGELOG_PR_TOKEN` secret its CI first needs
  "Approve workflows to run" (see AGENTS.md).
