# Architecture details

Moved out of [CLAUDE.md](../CLAUDE.md) to keep that file short. CLAUDE.md has the overview
(process shape, web layer gate, action pipeline, input simulation, tray, pairing); this file has
the per-endpoint and per-feature detail. Keep it up to date in the same change that touches the
feature.

## Endpoints

- `GET /health` → `HealthResponse`, including the server platform (`windows`/`linux`), from
  which the Client picks its built-in button set, `gamepad` (controller mode available), and
  `macAddress` of the LAN adapter behind the shown device address (`NetworkAddressService`), which
  the Android app stores to wake the PC later via Wake-on-LAN, plus `macAddressWireless` (that
  adapter is Wi-Fi, so waking it will most likely fail; the app warns after sending), and
  `voicemeeter` (Voicemeeter installed; the Client then adds its inputs and outputs to the "Mixer" tab),
  and `name` (`Environment.MachineName`), which the Android app shows in "Steuern" instead of the IP,
  and `screen` (an `IScreenCapture` is registered), without which the Client hides the "Bildschirm"
  tab - an older server would answer `GET /screen` with the SPA's `index.html`, and `audio` (an
  `IAudioCapture` is registered), without which the tab hides its "Ton" switch, and `httpsPort`
  (`Https:Port` while `Https:Enabled`, otherwise `null`), from which the Client's iPhone guide
  builds the `https://` address.
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
  "Datei gesendet" balloon. The Explorer's context menu offers the same ("An YFRemote-Geräte
  senden", `WindowsExplorerSendMenu`): an installed build writes
  `HKCU\Software\Classes\*\shell\YFRemote.SendToDevices` on every start (removed by the uninstall
  hook), whose command starts the launcher with `--offer-file "%1"`. A second instance hands the path
  to the running one over a per-session named pipe (`PipeOptions.CurrentUserOnly`) instead of the
  "läuft bereits" box; without a running one it starts normally and offers the file. Windows 11
  shows the entry only under "Weitere Optionen anzeigen", because the new menu needs package
  identity. With several files selected, the last one wins (one offer at a time).
- `GET /processes` (`WindowEndpoints`) → `{ processes: [{id,name,cpu,memoryMb}] }`, the 15
  processes with the highest CPU load (ties by memory), for the "PC" tab; same gate as
  `GET /windows`. `ProcessService` (BCL only, Windows and Linux) samples `TotalProcessorTime`
  twice 500 ms apart on request instead of polling, so the answer takes half a second; `cpu` is
  the share of all cores like Task Manager. Processes whose values the system withholds (system
  processes, elevated ones) and the server itself are left out. `killProcess` (`id` digits, `name`)
  ends one; the name must still match, because the system may have reused the id since the list
  was read. Not for "Nur Medien". Listing was checked by test on the dev PC, ending a real process
  is unverified.
- `GET /folder` → `{ files: [{name,size}] }`, the files directly inside
  `FileTransfer:TargetDirectory` (newest first, at most 200; no subfolders, no hidden or system
  files, no reparse points), so a device can fetch a file without someone offering it at the PC.
  `GET /folder/{name}` downloads one: `FileTransferService.TryGetPath` looks the name up in that
  list instead of building a path from it, so `..\` cannot leave the folder. Same gate as
  `GET /files/{id}` (not for "Nur Medien"), `no-store`, and the same "Datei gesendet" balloon per
  download. The "PC" tab lists them under "Dateien vom PC" (not on the Android server, which has
  no such endpoint; an older server answers with `index.html`, the section is then hidden).
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
  (`id`, digits only, must be in the current list) brings one to the front, `minimizeWindow` and
  `closeWindow` (same check, `IWindowService.TryApply`) minimize it or post `WM_CLOSE` like its X
  button, so the app can still ask about unsaved work; an elevated window refuses the message.
  `killWindow` (same check) ends the window's whole process with `Process.Kill` for a program that
  hangs; unsaved work is lost, so the Client asks first. Unverified in the real app.
  `WindowsWindowService` follows the Alt+Tab rules (visible, unowned, not cloaked, no
  `WS_EX_TOOLWINDOW`, `WS_EX_NOACTIVATE` only with `WS_EX_APPWINDOW`, own process excluded), front
  window first. `SetForegroundWindow` only works for the process that sent the last input, so it
  first sends a 0-pixel mouse move through `WindowsInputSender` (the PowerToys trick); minimized
  windows are restored. Listing and switching back and forth were checked on the dev PC on
  2026-10-24.
- `GET /brightness` (`WindowEndpoints`, same gate and `no-store` as `GET /windows`) →
  `{ monitors: [{id,brightness}] }` for the "PC" tab's sliders, `501` without an
  `IBrightnessService` (Linux). `WindowsBrightnessService` reads the built-in laptop panel through
  WMI (`WmiMonitorBrightness`, late-bound `WbemScripting`, no package) as `id` `internal`, and every
  external monitor answering DDC/CI (`dxva2` `GetMonitorBrightness`) by its device name. The panel
  is its own entry because the WMI instance cannot be tied to an `HMONITOR` reliably (under Parsec
  the active display has no monitor device at all). `brightness` (`id`, `value` 0-100, whole
  numbers) sets it; the Client sends only when the slider is let go, because DDC/CI takes tens of
  milliseconds per value. On the dev PC on 2026-11-12 reading the panel took 227 ms and setting it to
  its current value worked; DDC/CI with a real external monitor and an actual change are unverified.
- `GET /screen/monitors` (`ScreenEndpoints`, same gate as `GET /screen`) → `{ monitors: [{id,width,height,primary}] }`,
  left to right, from `WindowsMonitors` (`EnumDisplayMonitors` in physical pixels; `id` is the device
  name, `\\.\DISPLAY1`). The "Bildschirm" tab shows a select with more than one monitor
  (`RemoteService.screenMonitor`, `yfremote.screenMonitor`) and passes `monitor` to `/screen`,
  `/screen/video` and `screenClick`. `ScreenMonitor.Resolve` turns an unknown or missing id into the
  primary monitor for capture and click alike, so picture and tap always agree. Capture state
  (`MonitorCapture`: duplication, JPEG cache, lock) is per monitor. A cursor on another monitor counts
  as invisible, so its movement encodes nothing. The dev PC has one monitor, so a real second one
  (including negative coordinates left of the primary) is unverified.
- `GET /screen?width=N` (`ScreenEndpoints`) → one JPEG of a monitor for the Client's
  "Bildschirm" tab, which keeps two requests in flight, each at most every 33 ms (paused while the
  page is hidden), and shows a frame only if no later-started one was shown already. Same gate and
  `no-store` as `GET /windows`, refused for "Nur Medien" devices; `width` (320-3840, never upscaled)
  is the device's display width, `quality` (30-95, default 70) the JPEG quality. The tab's select
  (`RemoteService.screenQuality`, `yfremote.screenQuality`) picks pixel ratio and quality:
  "Leistung" 1x/50, "Ausgeglichen" 1.5x/70, "Qualität" up to 3x/85. `WindowsScreenCapture` uses DXGI
  Desktop Duplication (`Vortice.Direct3D11`) of that output: `AcquireNextFrame` waits up to
  100 ms for a change, the `Latest` texture keeps the last image, and the JPEG for an unchanged
  frame + cursor + width is cached. Only acquire and copy run under its lock, so two requests
  overlap; it drops the duplication after 10 s without requests. A rotated monitor arrives in panel
  orientation and `CopyScaled` turns it upright (`UprightCorners`; checked by corner pixels on the dev
  PC's panel on 2026-11-09 for all three rotations). For H.264 the `composed` texture stays in panel
  orientation: the cursor is drawn with a GDI world transform (`PanelTransform`, `DrawIconEx`) and
  `VideoProcessorSetStreamRotation` turns the frame upright (checked on the dev PC's Intel panel on
  2026-11-11 for all three rotations: corner markers and cursor position and direction in the recorded
  stream; on the phone the same day, upright with a matching tap); a video processor without
  `VideoProcessorFeatureCaps.Rotation` answers `501`, so the Client uses JPEG. A lost duplication (mode change, secure desktop) falls back to GDI `CopyFromScreen` (about 38 ms per copy at 1080p, which is why it is not the default). Parsec's virtual display never delivers a first frame
  (`DXGI_ERROR_WAIT_TIMEOUT`, cause unknown), so after that timeout `/screen` goes straight to GDI for 5 s
  (`NoFramesUntil`; measured 2026-11-09 at 2244x1080: ~93 ms per frame instead of ~650 ms). Both run in physical pixels (per-monitor DPI context,
  like `WindowsMouseService`), draw the cursor themselves and encode at quality 70. On the dev PC on
  2026-11-03 two parallel requests at 1350 px took 18 ms per frame (BitBlt: 61-80 ms). The secure desktop makes it throw `Win32Exception` → `503`,
  without `IScreenCapture` (Linux) → `501`. `ScreenViewNotifier` raises the tray's "Bildschirm wird
  übertragen" balloon when a device starts viewing after more than a minute without frames.
  Gestures on `.screen-view__stage` (`touch-action: none`, so the page does not scroll over the
  image). One finger beyond 8 px drags: `screenMove` (`x`/`y` like `screenClick`, at most one
  per frame and every 16 ms) around `mouseDown`/`mouseUp`. A hidden page sends `mouseUp` right away; a `RemoteActionSession`
  releases buttons still held when it ends, also for the touchpad (`KeepAliveTimeout` of 30 s bounds
  how long a dead connection goes unnoticed). Two fingers work like a touchpad: their first move
  beyond 8 px decides between zoom and scroll for the rest of the gesture, because the finger
  distance always changes a little while scrolling. Scrolling moves the page, or, when the page has
  nothing to scroll (always in fullscreen), the PC: `mouseScroll` like the touchpad (`SCROLL_SCALE`),
  after one `screenMove` to where the fingers landed, so the wheel hits the window under them.
  Spreading sends `mouseZoom` (`delta` ±120 per 15 % change of the finger distance), which the
  server turns into Ctrl + wheel, the same input a real touchpad pinch gives Chrome, Office or
  Explorer. The picture itself never zooms. In fullscreen the toolbar collapses behind a logo button
  (`.screen-view__handle`): a tap opens it towards the free side, dragging moves the logo (fraction of
  the view, kept only until the tab closes), and a tap on the picture closes it without clicking the PC.
  A tap into the image sends `screenClick` (`x`/`y` 0-1 on the monitor, `button`
  `left`/`right`, long press = right): `IMouseService.MoveToScreen` sets the pointer in
  physical pixels like the capture, then the normal click runs. Linux throws
  `NotSupportedException`. Verified on the phone on 2026-11-03 (pointer landed within ~15 px).
  The tab's "Touch" switch (`/health` `touch`, shown only then; `RemoteService.screenTouch`,
  `yfremote.screenTouch`, default off) replaces all of these gestures with real touch input: every
  finger on the picture gets an id 0-9 while it lies, and each `pointerdown`/`pointerup` (moves at
  most per frame and every 16 ms) sends the whole state as `{"type":"touch","points":[{id,x,y}],"monitor"}`,
  like the controller, so a lost message cannot leave a finger down. `WindowsTouchService` diffs it
  against the previous state into `InjectTouchInput` frames (new id `DOWN`, known `UPDATE`, missing
  `UP`; physical pixels like the capture, max 10 contacts, works without a touchscreen) and re-sends
  held contacts every 100 ms, because Windows cancels a contact that gets no frames. Windows then
  recognizes its own gestures (pinch, swipe, edge swipes, press-and-hold). The connection's
  `RemoteActionSession` lifts the fingers when it ends, a hidden page sends an empty list, and "Nur
  Medien" devices are refused. Checked on the dev PC on 2026-11-16 with a temporary test window: a
  held contact arrived as `WM_POINTERDOWN`, three keep-alive `WM_POINTERUPDATE`s and `WM_POINTERUP`,
  promoted to a left click. Gestures in real apps and the phone side are unverified.
- `GET /screen/video?width=N&bitrate=K` (same gate) → the Client's first choice for that tab: one
  endless response of H.264 in fragmented MP4, played through MediaSource (`screen-video.ts`, works
  over plain HTTP; WebCodecs would need HTTPS), codec string in `X-Codec`. `/screen` stays the
  fallback: the Client switches as soon as an answer is not `video/mp4` (`501` without a hardware
  encoder, an older server's SPA fallback), also after video already played (server updated, monitor
  switched), otherwise the last frame would freeze; only a request that gets no answer at all is
  retried as video. iPhone Safari has no MediaSource, only `ManagedMediaSource` (iOS 17.1+), which
  `findMediaSource` takes as the fallback; it only opens with `video.disableRemotePlayback = true`.
  That path is unverified on a real iPhone.
  `WindowsScreenCapture.Video.cs` runs on the duplication's own D3D11 device: copy of `Latest` into a
  GDI-compatible texture, cursor via `DrawCursor`, `ID3D11VideoProcessor` (BGRA to NV12 and scaling),
  hardware H.264 MFT of the same adapter (`Vortice.MediaFoundation`; async, event-driven; `ICodecAPI`
  is declared by hand for the 120-frame GOP). Encoded sizes are rounded to width % 16 and height % 4,
  because Intel's encoder fails on the first frame otherwise (710x398, 1376x774 measured). A frame is
  encoded on a desktop or cursor change, at least once per second, at most 60/s on a fixed schedule (high-resolution waitable timer: `Thread.Sleep` rounds to 15.6 ms, which made a 60 Hz monitor deliver only every second frame, and Windows 11 ignores `timeBeginPeriod` for the windowless tray process); a full send buffer
  throttles capture instead of queueing. `Fmp4Writer` (one `moof`+`mdat` per frame) gives every frame
  1/60 s of media time regardless of when it arrived, because a gap in the timeline would stall the
  browser: with fewer frames the video waits at the buffer end and shows each on arrival, the player
  runs at 2x above 100 ms lag and jumps above 1 s. Without data for 3 s the Client marks the picture as out of date (`screen.stalled`, also for JPEG), and after 10 s it reopens the video, because TCP notices a network change only much later, keeping the last picture until the new stream starts; the same 10 s abort the hanging JPEG `fetch`es, which then retry. Trimming the buffer only works up to a keyframe,
  which is why the GOP is fixed. `bitrate` is only the ceiling: `VideoBitrateControl` lowers it when sending blocks for over a quarter of a second-long window (below 80 % of what got through, at most halved, floor 1 Mbit/s) and raises it by 20 % every 2 s after a hold, only if the stream uses at least 30 % of it. The hold starts at 5 s, doubles after every failed raise up to 60 s and resets once the ceiling is reached again. That needs the rate control mode `UnconstrainedVBR`: in the default mode and CBR, Intel's `IsModifiable` answers `S_FALSE` for `AVEncCommonMeanBitRate` and the bitrate stays. A refusal by another encoder is ignored and leaves only the throttled frame rate. Measured against the dev PC's encoder on 2026-11-06 with a reader limited to 3 Mbit/s and noise on screen (loopback, no real WLAN): 42-47 fps and no queue most of the time, without the control 10-12 fps and ~800 ms queue. Failed raises came about every 50-60 s in a 150 s run (every 20-odd s with a fixed hold), each with about 5 s of queue up to 1 s. Known gap: a bitrate that just saturates the link can hold ~750 ms of queue for over 10 s while sending blocks for under a quarter of the window (measured once, 12 s); a lower threshold is untested on real Wi-Fi. Before the first frame, `E_ACCESSDENIED` becomes `Win32Exception` → `503` (the Client shows the hint
  and keeps retrying the video), any other `SharpGenException` becomes `NotSupportedException` → `501`
  (JPEG). `/screen` answers `503` on `E_ACCESSDENIED` as well instead of falling back to BitBlt. On
  2026-11-06 the idle, unlocked dev PC gave `E_ACCESSDENIED` from `DuplicateOutput` while BitBlt
  returned, without an error, a picture frozen about an hour earlier (`OpenInputDesktop` worked, so no
  secure desktop); presumably the display had turned off. Each
  viewer gets its own encoder, all share the duplication. On the dev PC (Intel UHD, 1080p) on
  2026-11-06: ~3 ms CPU per frame, 36-46 fps of real desktop activity, ~5.5 Mbit/s at 12 Mbit/s
  target, MediaSource decoded ~42 fps with ~30 ms lag in a hidden browser pane. Frames actually
  presented on a phone are unverified.
- `GET /screen/audio` (same gate) → one endless response of raw 16-bit little-endian PCM, format in
  `X-Sample-Rate`/`X-Channels`, until the device aborts. Audio without a running screen view of the same device raises
  its own tray balloon (`ScreenViewNotifier.NotifyAudio`), so listening in is as visible as watching. `WindowsAudioCapture` is a WASAPI loopback
  of the default playback device (mix format float32 or int16; more than two channels are mixed down
  to stereo via `dwChannelMask`, LFE dropped, not normalized, only covered by tests),
  polled every 20 ms; during silence loopback delivers nothing, so nothing is sent. Raw because the
  browser plays PCM without a decoder: `screen-audio.ts` schedules each chunk as its own
  `AudioBufferSourceNode` (AudioWorklet exists only over HTTPS), 150 ms lead, chunks dropped beyond
  600 ms queued. The capture was checked against a played tone on the dev PC on 2026-11-03 (48 kHz
  stereo). The tab's "Tastatur" switch opens the device keyboard on a live field
  (`liveTextActions` in `keyboard-keys.ts`, shared with the touchpad) plus `.screen-view__keys`
  (Strg/Alt/Win held until the next key, also a typed letter or digit, which then becomes a
  `hotkey`; Esc, Tab, arrows, Entf), "Vollbild" puts the view
  into `requestFullscreen` with a landscape lock. The owner confirmed all three on the phone against
  a dev build on 2026-11-03.
- `/files` and `POST /clipboard/*` require the same `Origin` check plus a `Bearer` pairing token.
- `GET /ca.crt` → the public certificate of the local certificate authority, registered only when
  `Https:Enabled` is set. Deliberately without an `Origin` or pairing check and reachable over
  plain HTTP, because it has to be installable before a device trusts the server.
- `GET /ca.mobileconfig` → the same certificate as an iOS configuration profile
  (`AppleConfigurationProfile`, `application/x-apple-aspen-config`, UUIDs derived from the
  certificate so a second download replaces the profile). Same registration and lack of checks as
  `/ca.crt`. The Client's settings link to it on an iPhone/iPad opened over HTTP, when `/health`
  reports `httpsPort` (set only while `Https:Enabled`).
- Static files from `wwwroot` (the Angular client's production build, copied in from `client/`)
  with SPA fallback to `index.html` if present.

## Features

**Volume per app.** The "Mixer" tab subscribes `{"type":"apps","enabled"}` like `systemStats` and
gets `{"type":"apps","apps":[{id,name,volume,muted}]}` from a `PollingBroadcaster` over
`IAppVolumeService.ReadAppsAsync`. On Windows (`WindowsMediaStatusReader.Apps.cs`) these are the
Core Audio sessions of all active playback devices, grouped per process (`id` = process id, or
`system` for the system sounds, which the Client names itself); with sessions on several devices
the list shows the first one and `appVolume` sets all of them. Reading and setting were checked on
the dev PC on 2026-10-25, which has only one playback device. The name is the session's display
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
`ShutdownTimer`, `minutes: 0` cancels it. An optional `power` (`sleep`, `displayOff`; default
`shutdown`, so an older Client still means shutdown) picks what happens instead (`TimerAction`);
there is only ever one timer. It deliberately runs its own in-process timer instead of
`shutdown.exe /s /t N`: any `/t` above 0 implies `/f` and would close apps with unsaved work
without asking; when due it calls the normal `IPowerService.Shutdown` (or `Sleep`/`TurnOffDisplay`).
The timer is lost when YFRemote exits. The tray shows a balloon naming the device and a
"Herunterfahren/Ruhemodus/Bildschirm aus um HH:mm Uhr abbrechen" entry while one is pending. The
Client's "Timer" button opens a native `<dialog>` (top layer, so `.remote-panel`'s `backdrop-filter`
does not clip it) with minutes and that action; it leaves `power` out for a shutdown, so an older
server still understands it. Every
change (scheduled, cancelled, elapsed) is pushed to all connected devices as
`{"type":"shutdownTimer","remainingSeconds","action"}` (`ShutdownTimer.Status`; no
`remainingSeconds` = none pending), and again on connect while one is pending. Remaining seconds rather than a time of day,
because the device clock may differ from the PC's. The Client shows a countdown with "Abbrechen"
above the Remote buttons.

**Server pushes besides responses.** The tray's "Gerät klingeln lassen" lists the connected
devices and calls `WebSocketConnectionRegistry.Ring(deviceId)`; every open connection of that device
(`HandleAsync` gets its `deviceId`) pushes `{"type":"ring"}`. The Client shows a full-screen
`.ring-alert` with "Klingeln beenden" and plays a tone through `RING_PLAYER` (Web Audio beeps plus
vibration in a browser, `YFRemoteRing` in the Android app, see docs/ANDROID.md). `ringing` stays on
across a lost connection until it is stopped on the device. A `/ws?background=1` connection (the
Android app's background socket) gets the ring but no `media`, `fileOffer` or `shutdownTimer`
pushes, so it never keeps the media poll running; it still counts as connected in the tray. Next to `fileOffer` and `rumble`, the socket carries
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
once per device and run. Windows notifications work the same way (`{"type":"notifications","enabled"}`,
Client setting "Windows-Benachrichtigungen anzeigen", Windows server only, own balloon via
`NotifyNotificationsEnabled`): `WindowsNotificationReader` polls `UserNotificationListener` and
pushes `{"type":"notification","id","app","title","text"}` for the toast with the highest id seen so
far, so dismissing the newest never resends an older one. The listener grants access to the
unpackaged app, but its `NotificationChanged` event needs package identity (`0x80070490`, measured on
the dev PC on 2026-11-10), hence the polling. The Client shows it for 8 s as a banner; its "Am PC
entfernen" sends `dismissNotification` (`id`, digits only), which `IPcNotifications.Dismiss`
(`UserNotificationListener.RemoveNotification`) turns into removing it from the PC's notification
center too (not allowed for "Nur Medien"; unverified on a real toast). The app in front works the
same way on Windows only: after `{"type":"foregroundApp","enabled":true}` (also allowed for "Nur
Medien") the broadcaster pushes `{"type":"foregroundApp","name"}` on every change, where `name` is
the same file description as in the Mixer and the window list (`WindowsWindowService.ForegroundApp`,
`null` without a foreground window or for YFRemote itself). The Client subscribes only while its
setting "Profil passend zum Programm am PC wechseln" (`yfremote.autoProfile`, off by default) is on,
and `ButtonLayoutService.applyForegroundApp` switches to the layout profile whose `apps` list holds
that name (case-insensitive), then back to the previous profile once none matches. A profile's
optional `view` makes `RemoteControlComponent` open that tab too (skipped where the device lacks it)
and return to the previous tab the same way; picking a tab by hand ends that. A third broadcaster pushes
`{"type":"systemStats","cpuLoad","cpuTemperature","gpuLoad","gpuTemperature","memoryUsedMb","memoryTotalMb","batteryLevel","batteryCharging","powerMode"}`
(battery only on a laptop: `GetSystemPowerStatus` on Windows, "charging" = on AC; `powerMode` is
the Windows power mode `efficiency`/`balanced`/`performance` from `IPowerService.PowerMode`, added in
`Program.ReadWithPowerMode`. `WindowsPowerService` reads it with the undocumented but exported
`PowerGetEffectiveOverlayScheme` and only while the plan is "Ausbalanciert", because Windows ignores
the overlay under any other plan; `powerMode` (`mode`) sets it with `PowerSetActiveOverlayScheme`.
The "PC" tab shows a select for it, hidden for "Nur Medien". Reading was checked on the dev PC on
2026-11-12, switching is unverified; the same push carries `displayMode`
(`internal`/`clone`/`extend`/`external`, like Win+P: `QueryDisplayConfig(QDC_DATABASE_CURRENT)`
reports the topology, the `displayMode` action applies one with
`SetDisplayConfig(SDC_APPLY | SDC_TOPOLOGY_*)`; reading was checked on the dev PC on 2026-11-15,
switching is unverified, and it is reported with a single monitor too, where Windows refuses to
switch) and `micMuted` (mute of the default capture device through the same
`IAudioEndpointVolume` path as the volume, `null` without a microphone; the `micMute` action with
`muted` sets it; Windows only, unverified in the real app). Both are hidden for "Nur Medien".
`SystemExtrasReader.Wrap` adds, on both platforms, `drives` (`[{name,freeMb,totalMb}]`: fixed
drives of at least 1 GB via `DriveInfo`, which leaves out network and USB drives) and
`netDownKbps`/`netUpKbps` (kilobit per second summed over all active adapters except loopback and
tunnels, `null` on the first reading; virtual adapters may count the same traffic twice)),
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
without a custom mapping; available whenever `/dev/uinput` exists, no slot cap. Rumble comes from
a reader thread per controller that answers the game's force-feedback uploads (unverified on a real
kernel, see AGENTS.md).
