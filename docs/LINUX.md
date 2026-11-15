# Linux support

Moved out of [AGENTS.md](../AGENTS.md) unchanged to keep that file readable for release work.
AGENTS.md has the summary and the status; this file is the full record. Keep it up to date in
the same change that touches the code.

The project multi-targets `net10.0-windows10.0.17763.0;net10.0` from one `.csproj` (no separate class
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
on `net10.0-windows10.0.17763.0`, `LinuxInputSender`/`LinuxInputService`/`LinuxMouseService` on `net10.0`.
`NetworkAddressService` and `PairingQrCodePayload` live in `Services/` (not `Tray/`) because they
are BCL-only and needed on both platforms. The test project mirrors this:
`tests/YFRemote.Server.Tests.csproj` also multi-targets, excluding `**\Windows*Tests.cs` and
`Updates\**` for `net10.0`, and `**\Linux*Tests.cs` for `net10.0-windows10.0.17763.0`.

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

**Linux clipboard (`Services/LinuxClipboardService.cs`).** No Wayland/X11 client of its own: it
runs `wl-paste`/`wl-copy` from `wl-clipboard` on Wayland and `xclip` on X11, so the target needs
one of those packages; a missing tool is a `NotSupportedException` → `501` naming the package.
`SelectBackend` prefers `WAYLAND_DISPLAY`, then a `wayland-*` socket in `XDG_RUNTIME_DIR` (the
`systemd --user` unit starts before the graphical session and does not inherit its environment),
then `DISPLAY`. X11 has no such socket, so if the process environment has none of the three, it asks
the systemd user manager (`systemctl --user show-environment`) on every call: the X session reports
`DISPLAY` and `XAUTHORITY` there only after the service has started (Debian/Ubuntu's Xsession runs
`dbus-update-activation-environment --systemd --all`), and `XAUTHORITY` is passed on to `xclip`. Writers
redirect only stdin, because `wl-copy`/`xclip` leave a background child serving the selection
that would keep redirected stdout/stderr pipes open forever. Images are PNG or JPEG only
(sniffed from the magic bytes, the tools need a MIME type). **Unverified on a real Linux session**
— only backend selection and image sniffing are unit-tested (`LinuxClipboardServiceTests`).

**Linux controller (`Services/LinuxGamepadService.cs`).** Each `gamepad` connection gets its own
`uinput` device (`LinuxInputSender.UinputDevice` with `EV_ABS` axes), announced as a wired Xbox
360 pad (USB `045e:028e`, version `0x0114`, name "Microsoft X-Box 360 pad") with the exact
button/axis codes and ranges the kernel's `xpad` driver uses — `BTN_X`/`BTN_Y` by label, Y axes
mirrored with `~`, D-pad as `ABS_HAT0X`/`ABS_HAT0Y` — so SDL's controller database, Steam, and
Proton treat it like the real thing. No driver and no slot cap; it needs the same `/dev/uinput`
access as keyboard and mouse, and `IsAvailable` only checks that `/dev/uinput` exists (a missing
group membership fails at connect with the same hint). Rumble: the device announces `FF_RUMBLE`
(opened `O_RDWR`, `ff_effects_max` 16), and one reader thread per controller answers the game's
effect uploads and erases (`UI_BEGIN/END_FF_UPLOAD`, `UI_BEGIN/END_FF_ERASE`) and turns `EV_FF`
play/stop events into the same `rumble` message as on Windows (`RumbleEffects`: strong motor =
large motor, only changes are sent, an effect ends by itself after its `replay.length`, one effect
at a time). **Unverified on a real Linux kernel** — only the XInput-to-evdev mapping, the
`uinput_ff_upload` offsets and the effect bookkeeping are unit-tested (`LinuxGamepadServiceTests`).

**Linux media status (`Services/LinuxMediaStatusReader.cs`).** Volume and mute from `pactl`
(`get-sink-volume`/`get-sink-mute @DEFAULT_SINK@`, so PulseAudio and PipeWire via
`pipewire-pulse`), title/artist/playing from `playerctl metadata` (any MPRIS player). Every command
runs with `LANGUAGE=en` because `pactl` translates "Mute: yes". A missing tool or a failing command
just leaves its part empty, like Windows without a playback device, so the strip still shows.
**Unverified on a real Linux session** — only output parsing is unit-tested
(`LinuxMediaStatusReaderTests`).

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
not evidence of a WinForms dependency). The integration tests that open a real WebSocket
(`tests/YFRemote.Server.Tests/Integration/ServerEndpointsTests.cs`) run on both targets: they swap
`FakeInputService` in for the input services via `BuildApplication`'s `configureServices` hook, so
no real `SendInput`/`uinput` call happens. Two `PairingServiceTests` are `#if WINDOWS`-only:
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
locking.

**Multi-targeting broke `dotnet publish` without `-f`.** `dotnet publish YFRemote.Server.csproj`
used to infer the single `net10.0-windows10.0.17763.0` target; once the project multi-targets, `publish`
(unlike `build`/`test`, which happily build/run every target) refuses to guess and fails with
`NETSDK1129`. `release.yml`'s existing Windows publish step now passes
`--framework net10.0-windows10.0.17763.0` explicitly. Keep this in mind for any other `dotnet publish`
invocation added later (locally or in a workflow) — it needs an explicit `-f`/`--framework` now.

**Multi-targeting also needs `EnableWindowsTargeting=true` to restore/build at all on a
non-Windows host** (set in both `YFRemote.Server.csproj` and the test project). `-f`/`--framework`
only scopes which single `TargetFramework` a `build`/`test`/`publish` invocation *builds*; the
*restore* step for a crosstargeted project always evaluates the complete `TargetFrameworks` list
first to compute the NuGet dependency graph, regardless of `-f`. Without this property, that
restore-time evaluation of `net10.0-windows10.0.17763.0` fails on a real Linux host with `NETSDK1100` ("set
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
`net10.0-windows10.0.17763.0`) and `client`, building and testing the `net10.0` target on `ubuntu-latest`. Not
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
