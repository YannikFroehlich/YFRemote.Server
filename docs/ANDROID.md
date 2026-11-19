# Android support

Moved out of [AGENTS.md](../AGENTS.md) unchanged to keep that file readable for release work.
AGENTS.md has the summary and the status; this file is the full record. Keep it up to date in
the same change that touches the code.

An Android APK that runs its own server, so a second device can open the same Angular Client and
remote-control the Android device itself — the same product idea as
[Linux support](LINUX.md) (server runs *on* the target device), but for a device where
`SendInput`/`uinput`-style raw injection isn't available without root. Implemented under
`android/` (native Kotlin + Ktor, its own Gradle build) and merged to `develop` — pairing, the
virtual cursor, typing, the remaining actions, and its own branding are all in place and verified
on real hardware. Released with every version since v2.18.2: the `release-android` job in
`release.yml` attaches a signed `YFRemote-Android-vX.Y.Z.apk` (see "Status" below). [`android/PLAN.md`](../android/PLAN.md) is the
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

**The app is also a controller.** `SetupActivity`'s "Steuern" section lists devices
this phone controls (`remote/RemoteDevices`, in `SharedPreferences`) with an online dot from
polling their unauthenticated `GET /health`. When the list holds both `http://` and `https://`
entries (often the same PC twice), a "Unverschlüsselt | Verschlüsselt" switch above it shows one
kind at a time; the choice is the `deviceTabSecure` preference (default encrypted), and with only
one kind there is no switch. Each entry shows its name, with address and
"verschlüsselt" (HTTPS) as secondary text; the name is the `name` from `/health`
(`Environment.MachineName` on the PC, `Settings.Global.DEVICE_NAME` on Android) unless the user set
one under "Bearbeiten" (`RemoteDevice.named`; older entries count as named when their name differs
from the address). The `macAddress` from that response
is stored with the device; while it is offline, "Aufwecken" sends a Wake-on-LAN magic packet
(`remote/WakeOnLan`, UDP port 9 to `255.255.255.255` and every interface's broadcast address) —
native, because the browser Client cannot send UDP. If `/health` reported `macAddressWireless`, the
confirmation toast warns that most PCs do not wake over Wi-Fi. Opening one starts
`remote/RemoteWebActivity`, a plain `WebView` on `http://<host>:<port>/` — the target serves the
same Angular Client, which does the PIN pairing itself and keeps its token in the WebView's
per-origin `localStorage`, exactly like a browser. No native protocol code on this side, hence
`usesCleartextTraffic`. The WebView cannot save the Client's `blob:` downloads, so
`RemoteWebActivity` injects `window.YFRemoteDownloads` and the Client's `FileTransferService`
hands "Laden" on a file offer to it (`DOWNLOAD_BRIDGE`) instead of fetching: the app enqueues
`GET /files/{id}` with the `Bearer` token in Android's `DownloadManager` (Android 10+,
`Downloads/YFRemote`), only for URLs on the loaded target's own origin. The WebView refuses the
microphone over `http://`, so dictation goes through a second bridge, `window.YFRemoteSpeech`:
the app recognizes speech with Android's `SpeechRecognizer` (asking for `RECORD_AUDIO` on first
use) and answers with `yfremote-speech` events (`SPEECH_BRIDGE` in the Client). Files that only
exist in the Client (the settings dialog's JSON exports, an image fetched from the PC clipboard)
have no URL for `DownloadManager`, so the Client's `FILE_SAVER` hands them to
`YFRemoteDownloads.save(fileName, mimeType, base64)`, which writes them through
`MediaStore.Downloads` into `Downloads/YFRemote` - only while the loaded page is still on the
target's origin. An older app without `save` makes `FILE_SAVER` report failure instead of
clicking a dead `blob:` link. `window.YFRemoteRing` (`start()`/`stop()`, target origin only) is
the native side of the tray's "Gerät klingeln lassen": the Client's `RING_PLAYER` calls it on a
`ring` push, and `remote/PhoneRinger` loops the default alarm tone through a `MediaPlayer` with
`USAGE_ALARM`, the alarm stream at full volume (restored on stop), so a silent phone rings too, plus
a high-importance notification (`yfremote_ring`, id 4) whose "Stopp" action or swipe answers with a
`yfremote-ring-stop` event that clears the Client's overlay. `PhoneRinger` is one object per
process, so the WebView and the background socket never play two tones. That socket is
`remote/RingListenerService` ("Im Hintergrund erreichbar" in the "Steuern" tab, off by default,
`ring_listener` prefs): a `dataSync` foreground service (silent notification `yfremote_listener`,
id 5) holding one OkHttp WebSocket per device with a stored token, `/ws?background=1` with a 30 s
ping, reconnecting after 2 s / 5 s doubling to 1 min, and stopping on 401. It restarts on boot
(`BootReceiver`), on app start, and whenever `RemoteDevices.setToken`/`remove` change the list.
Without it, a ring only reaches the phone while `RemoteWebActivity` is connected. A third bridge, `window.YFRemoteMedia`, mirrors the target's `media`
push into a media notification: the Client's `MediaBridgeService` (`MEDIA_BRIDGE`) calls
`update(json)` with title/artist/playing/position/duration/canSeek, `cover(dataUrl)` per new cover
and `clear()` without a title, and `remote/RemoteMediaNotification` turns that into a
`MediaSession` plus `Notification.MediaStyle` (lock screen too, no `POST_NOTIFICATIONS` needed for
media notifications on Android 13+). Its buttons answer with `yfremote-media` events (`key` with
`MEDIA_PLAY_PAUSE`/`MEDIA_NEXT`/`MEDIA_PREVIOUS`, `seek` in seconds), which the Client sends as
normal actions. The same bridge's `captureVolumeKeys(enabled)` (sent by the Client while connected)
makes `RemoteWebActivity.dispatchKeyEvent` swallow the phone's volume keys and answer with
`{type:'volume',direction}`, which the Client sends as `VOLUME_UP`/`VOLUME_DOWN`, or which the
"Folien" tab turns into slide steps (`MediaBridgeService.setVolumeKeyHandler`); only in the
foreground. The notification lives as long as `RemoteWebActivity`. Two things keep it working in
the background, both measured on the dev phone (Android 16) on 2026-11-03:
`remote/RemoteMediaService`, a `mediaPlayback` foreground service that runs only while the
notification is shown (Android's background firewall chain otherwise cut the app's network about
6 s after leaving it), and a `WebView` subclass in `RemoteWebActivity` that reports itself visible
while `media.isShowing` (Chromium otherwise froze the hidden page after about 60 s, so no `media`
pushes arrived and the notification stayed on the old state; a Web Lock did not prevent that).
With both, pushes and the notification's buttons kept working with the app in the background and
with the screen off for 150 s, and the lock screen shows the player. Not measured: hours with the
screen off (Doze).
Sharing to a PC and the home-screen media widget talk to the target without the WebView, through
`remote/RemoteClient` (OkHttp: `POST /files`, `POST /clipboard/text`, one short `/ws` connection per
action that waits for the response with its `requestId`; `Origin` set to the target's URL, the
pinned CA for HTTPS). The token comes from the Client: `RemoteWebActivity.copyToken` reads
`localStorage['yfremote.pairingToken']` on `onPageFinished` and `onPause`, only while the page is on
the target's origin, and `RemoteDevices.setToken` keeps a copy per URL in app-private preferences.
A device paired without "Gerät merken" has no stored token there, so it gets none here either, and
removing a device drops it. `ShareActivity` takes `SEND`/`SEND_MULTIPLE`: files go to `POST /files`,
a text that is only an http(s) link (`sharedUrl`, same limits as `HandleLaunch`) is opened with
`launch`, any other text goes to the clipboard; with several targets (every device with a token,
plus "Gekoppelten Geräten anbieten" for one file while the phone's own server runs) it asks first.
`remote/MediaWidget` (4x1) sends `VOLUME_DOWN`, `MEDIA_PREVIOUS`, `MEDIA_PLAY_PAUSE`, `MEDIA_NEXT`,
`VOLUME_UP` to the device opened last (`RemoteDevices.setLast`, set by `RemoteWebActivity`); its
name opens that device. The buttons start `remote/MediaWidgetService`, a `dataSync` foreground
service that ends with the response, because a broadcast receiver would run as a background process
behind the firewall chain described above. None of this is verified on a phone yet.
Custom buttons reach the home screen and the quick settings the same way: `copyToken` also reads
the WebView's `localStorage['yfremote.buttonLayout']` (the active layout only, not other profiles)
and `RemoteDevices.setButtons` keeps its `customButtons` per origin (`RemoteButton`, steps capped
like the Client: 10 steps, 5 s delay). `remote/ButtonWidget` (1x1, reconfigurable) and the three
fixed tiles `ButtonTile1`-`3` ("YFRemote 1-3", Android only knows tiles declared in the manifest)
point at one device + button id in `ButtonTargets`, chosen in `ButtonPickerActivity` (widget
configure, first tap on an empty tile, or long press via `QS_TILE_PREFERENCES`). A tap starts
`MediaWidgetService` with `EXTRA_TARGET`, which looks the steps up fresh and runs them through
`RemoteClient.sendSteps`: one `/ws` connection, each step only after the previous one's `requestId`
answer, stopping at the first rejection, like the Client's `runSteps`. If Android refuses the
foreground service from a tile, the tile sends directly. A button only shows up after the remote
was left once (`onPause`), and a deleted button leaves its widget/tile asking for a new choice.
Devices are added by typing an address or by scanning a connection QR code
(`zxing-android-embedded`'s `CaptureActivity`, no Google Play services needed):
`RemoteDevices.parseQrCode` reads the same `http://<host>:<port>/#pin=<pin>` payload as
`PairingQrCodePayload`, and the PIN is handed to the WebView in the URL fragment so the Client
prefills it. With "HTTPS verwenden" the tray's QR code also carries `ca=<sha256>`, the fingerprint
of the PC's local CA (`PairingQrCodePayload`, lowercase hex over the DER). Such a code stays on
`https://<host>:<port>`: `PinnedCa.fetch` loads `/ca.crt` over plain HTTP (port 5050, or the code's
`http=<port>` when `Server:Port` differs; the PC serves it there before anything is trusted) and
keeps it only if its fingerprint matches, then `RemoteDevice.ca` stores it. There is deliberately no
accept-all `TrustManager` (CodeQL flags it). `RemoteWebActivity.onReceivedSslError` proceeds only for that device's origin, only when
"untrusted" is the sole SSL error and only if `PinnedCa.issued` verifies the leaf against the
pinned CA (Android 10+, which exposes the leaf; older versions cancel). `/health` and file
downloads use `HttpsURLConnection` with that CA as the only trust anchor, because
`DownloadManager` cannot. Typed addresses and HTTPS codes without a fingerprint (older PCs) open
as `http://<host>:5050`. Switching a device to HTTPS changes its origin, so it pairs again.
Unit tests only (fixed openssl certificates in `PinnedCaTest`), **not yet checked on a device**.
The "Freigeben" section shows the same kind of QR code for this phone, always
with the current PIN (it is displayed right next to it anyway).

**Bluetooth controller.** The "Controller" section registers the phone as a Bluetooth HID gamepad
(`bluetooth/BluetoothGamepad`, `BluetoothHidDevice`, API 28+) - for targets like another Android
device, where input injection over the WebSocket protocol isn't possible. `bluetooth/GamepadActivity`
loads the bundled Angular Client from `assets/www` under `https://appassets.androidplatform.net/`
(served via `shouldInterceptRequest`, so it is a secure context and tilt control works) and injects
`window.YFRemoteBluetooth`. The Client then renders only `GamepadComponent`, whose
`GAMEPAD_TRANSPORT` sends each `GamepadState` through that bridge instead of `RemoteService`
(`client/src/app/remote/gamepad/gamepad-transport.ts`). `bluetooth/GamepadReport` holds the HID
descriptor and the XInput-to-HID mapping (Linux/Android generic gamepad button order, sticks X/Y and
Z/Rz, triggers Brake/Gas, D-pad as hat). No rumble back from the host, and an HID output report
alone would not change that: hosts only send rumble to gamepads whose driver knows the report
format, chosen by the vendor/product ID (Linux/Android `hid-microsoft`, `hid-playstation`, ...).
Over Bluetooth that ID comes from the phone's Device ID SDP record, which
`BluetoothHidDeviceAppSdpSettings` cannot set, so the host always binds the generic driver
(`hid-generic`, no force feedback). Only Windows DirectInput would honor a full HID PID
force-feedback descriptor (with its Set Effect/Block Load reports), and XInput games don't see a
generic HID gamepad at all.

**Pairing parity with the PC server.** `PairingRepository` mirrors `PairingService`'s device
expiry (90 days without a connection, dropped at startup, on every token check and when the setup
screen lists devices) and the `mediaOnly` flag, which the "Gekoppelte Geräte" list in
`SetupActivity` toggles with "Nur Medien"/"Vollzugriff" and which closes the device's open
connections. `/ws` sends `{"type":"access","mediaOnly"}` first and gives a media-only connection
no `fileOffer`; `isMediaAction` in `RemoteActionRouter.kt` only lets single `MEDIA_*`/`VOLUME_*`
keys through, and every `Bearer` endpoint answers 403 `Not allowed for this device.`
(`authorizeFullAccess` in `Http.kt`), since Android has no media endpoint. Covered by unit tests,
**not yet checked on a device**.

**Media status.** `/ws` pushes the same `media` message as the PC from `media/MediaStatusReader`,
read once per second per connection and sent only on change, like `PollingBroadcaster`. Volume and
mute come from `DeviceVolume` (`STREAM_MUSIC` in percent); the `volume` action sets it and unmutes,
and Android's 15-25 steps make the slider snap. Title, artist, timeline and cover come from the
playing `MediaSession` (else the first one), which `MediaSessionManager.getActiveSessions` only
hands to an enabled notification listener: `media/MediaAccessListener` is an empty
`NotificationListenerService`, a third, optional permission in the setup screen ("Medieninfos").
Without it the push carries only volume and `isMusicActive`, and the Client shows "Lautstärke am
Gerät" (`media.nothing.android`) instead of "Am PC läuft nichts". `mediaSeek` uses
`transportControls.seekTo` when the session offers `ACTION_SEEK_TO`; `GET /media/cover` serves the
embedded album-art bitmap as JPEG (max 512 px, re-encoded only when title or bitmap size change;
apps that only set `METADATA_KEY_ALBUM_ART_URI` have no cover). Unit tests only, **not yet checked
on a device**.

**Launching apps.** `launch` and `GET /launch/apps` mirror `IAppLauncher`: `AppLauncher` lists the
labels of all `MAIN`/`LAUNCHER` activities (visible on Android 11+ only through the `<queries>`
entry in the manifest) and starts one only by exact label (case-insensitive), never a free
component or intent; URLs must pass `parseLaunchUrl` (absolute `http`/`https`, ≤ 2000 chars) and
open with `ACTION_VIEW`. Both start from the `AccessibilityService` context, because a bound
accessibility service exempts the app from Android 10+'s background activity start block, so the
action fails while it is off. The Client shows the "Öffnen" step for every known platform
(`launchSupported`), the "App" volume step still only for PCs. Unit tests only, **not yet checked
on a device**.

**System stats.** `{"type":"systemStats","enabled"}` sets `RemoteActionSession.systemStats`, and a
per-connection loop in `Routes.kt` then pushes `SystemStatsReader` once per second on change:
`memoryUsedMb`/`memoryTotalMb` from `ActivityManager.MemoryInfo` plus Android-only
`batteryLevel`/`batteryCharging`/`batteryTemperature` from the sticky `ACTION_BATTERY_CHANGED`
intent (omitted without a battery). CPU load (`/proc/stat` since Android 8) and CPU/GPU temperatures
are closed to normal apps and never sent. The Client shows that tab as "Gerät" without the CPU/GPU
rows; `systemStatsSupported` now means any known platform, `mixerSupported` keeps Mixer and app
steps PC-only. Unit tests only, **not yet checked on a device**.

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

**Status: Stufen 0–5 done.** Each stage was gated on the previous one actually working on a real device
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
5. ✅ Foreground service, setup Activity (address, PIN, paired devices, links to the two required
   system-settings screens), its own branding, and release packaging:
   - `DefaultItemExcludes` in `YFRemote.Server.csproj` excludes `android\**`, so the Gradle tree
     never ends up in the server's publish output.
   - A Gradle task in `app/build.gradle.kts` copies `client/dist` into `app/src/main/assets/www/`
     for local builds; the release CI fills `assets/www` directly.
   - The release-signing keystore lives base64-encoded in the `ANDROID_KEYSTORE_*` repository
     secrets. A release-signed APK cannot replace a debug-signed one on a device without
     uninstalling first.
   - `ci.yml`'s `android` job runs `assemble` (debug plus an unsigned release build) and the
     unit tests on every PR; the signed `assembleRelease` only runs in `release-android`. Without
     `YFREMOTE_KEYSTORE_PATH` the release build type has no signing config at all - an empty one
     makes `packageRelease` fail, which also broke CodeQL's Kotlin autobuild (`./gradlew
     assemble`). Neither may be named
     `build-and-test` — that name is the required status check on `main` (see "Release
     automation" below) and must stay pointed at the Windows server job.
   - The app updates itself from the same GitHub Release (`update/AppUpdate.kt`, Velopack has no
     Android support): `SetupActivity.checkForUpdate` asks `releases/latest` on every `onResume`
     at most every 6 hours, takes the `.apk` asset only from this repository's
     `releases/download/` URL, and offers it only for a strictly higher `x.y.z` versionName, so a
     `0.1-dev` build never sees one. "Installieren" streams the APK into a `PackageInstaller`
     session (`setAppPackageName`, `USER_ACTION_NOT_REQUIRED` on Android 12+) and the result comes
     back to `SetupActivity` as a mutable `PendingIntent` (`ACTION_UPDATE_STATUS`, singleTop); on
     `STATUS_PENDING_USER_ACTION` it starts the system's confirm dialog. The first time it sends the
     user to "Unbekannte Apps installieren" (`REQUEST_INSTALL_PACKAGES`); back in the app with the
     permission granted, `onResume` continues the install on its own (`installAfterPermission`).
     Android itself rejects an APK with a different signature. A successful update ends the
     process, so the foreground service is off until the app is opened again. Only the parser and
     version check have unit tests. The update 2.46.0 → 2.47.0 was verified on the phone on
     2026-11-03. The steps were: the permission, Android's "Diese App aktualisieren?", and Google
     Play Protect's "App-Scan empfohlen" (Play Protect does not know the self-signed APK).
     Afterwards YFRemote is its own installer (`installerPackageName`). Whether a later update
     then skips the prompt on Android 12+ is still unverified.
   - There is no separate Android version or trigger: every push to `main` releases Windows,
     Linux and Android together, so an Android-only change releases the PC packages too unless
     `[skip release]` is used deliberately.

   The signed release APK (v2.26.1) is also verified on a device: signature, a non-debuggable
   manifest, the bundled Client, and the full endpoint/action set (see `android/PLAN.md`,
   "Nächster Schritt").
