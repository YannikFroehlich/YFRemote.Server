# Changelog

All notable changes to YFRemote (Server, Client, tray app, and installer — released together
from this one repository) are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Version numbers,
however, are not chosen by hand: `auto-tag.yml` computes the next `X.Y.Z` from
[Conventional Commit](https://www.conventionalcommits.org/) prefixes on every merge to `main`
(`fix:` → patch, `feat:` → minor, `feat!:`/`BREAKING CHANGE:` → major, anything else → patch) and
`release.yml` publishes it automatically — see [AGENTS.md](AGENTS.md#release-automation). A
handful of versions below share an identical commit with their predecessor: those are the
release pipeline being re-run by hand (`workflow_dispatch`) to fix a packaging problem, not a
source change, and are noted as such instead of inventing a changelog entry for them.

## Keeping this file up to date

Add an entry under **[Unreleased]** in the same commit/PR that makes the change. Once that
change reaches `main` and the release pipeline tags a new version, rename `[Unreleased]` to the
new version number and its release date, and start a fresh empty `[Unreleased]` above it.

## [Unreleased]

### Added

- Touchpad: pointer acceleration. Slow finger movement stays 1:1 for precise positioning, fast
  swipes move the cursor up to three times as far.
- Touchpad: tap, then touch down again and move to drag with the left button held (moving
  windows, selecting text). Two quick taps give a double click. A single tap's left click now
  arrives about 0.2 seconds later, because the touchpad first waits to see whether a drag
  follows.
- Touchpad: a short three-finger tap sends a middle click.
- Touchpad text field: a "Live" switch sends every keystroke to the PC immediately, including
  backspace and Enter, instead of waiting for "Senden". Autocorrect replacements from the
  phone keyboard are sent as the matching backspaces plus the new text. The switch is
  remembered across reloads.
- New keys: Home (Pos1), End (Ende), Page Up/Down (Bild ↑/↓) and Print Screen (Druck) on the
  keyboard tab and for custom buttons, on Windows and Linux.
- New built-in buttons for previous track, stop and next track, placed below the volume
  buttons. Existing custom layouts get them in the first free spot.
- Settings: scroll speed and a switch to reverse the scroll direction of the two-finger
  gesture.
- Short vibration on button presses, clicks and macros (Android only; can be turned off in the
  settings).
- Web app manifest, theme color and home-screen icon, so "Add to home screen" shows the YF
  icon and opens without the browser bar where the browser allows it.

## [2.11.0] - 2026-09-19

### Added

- Touchpad: a short two-finger tap sends a right click, like on a laptop trackpad. While the
  two fingers could still be a tap, small jitter no longer scrolls the page.

### Changed

- GitHub Releases now carry release notes: `release.yml` copies the version's section of this
  changelog into the release text instead of leaving it empty. The Linux beta note appended
  to it now says the backend is verified on x86_64 instead of untested.

## [2.10.0] - 2026-09-19

_Merge of `develop` into `main`; the Linux PIN/verification changes it carries already shipped
in 2.9.0._

### Changed

- README and AGENTS.md now describe the Linux backend as verified on x86_64 (arm64 and the
  installed package still unverified) and record the `release-linux` job's first successful
  run.
- Disabled Angular CLI analytics prompts in `client/angular.json`, and ignored the local
  `publish-linux/` output folder.

## [2.9.0] - 2026-09-19

### Added

- On Linux, the pairing PIN is printed to the console (or `journalctl --user -u yfremote` when
  running as a systemd service) at startup, since there is no tray to show it in.

### Changed

- Verified the Linux `uinput` input backend end-to-end on a real x86_64 kernel (Linux Mint VM,
  paired phone over the LAN). arm64 and the Velopack-installed package remain unverified, so
  Linux stays on the `-beta` channels.

## [2.8.2] - 2026-09-17

### Added

- This `CHANGELOG.md`, backfilled from the release history.

### Changed

- Reworked the README with release/build/download badges, a Mermaid diagram of the core
  concept, and a Features section, and translated it to English to match the project's
  commit-message convention.

## [2.8.1] - 2026-09-17

### Fixed

- Linux release packaging: pass `--merge` to the Linux `vpk` upload so it no longer collides
  with the Windows release publish step.

## [2.8.0] - 2026-09-17

### Added

- Linux (beta) input backend built on `/dev/uinput`, and multi-targeted the Server to
  `net10.0`/`net10.0-windows` so the same code builds portably on Linux.
- Linux release packaging and a dedicated Linux CI job. The Linux release channel is labeled
  "beta" because the uinput path has not yet been verified against real hardware.

### Fixed

- Scoped the Linux CI job's restore to the `net10.0` target only.
- Set `EnableWindowsTargeting` so the cross-targeted project restores/builds on a Linux host.
- Fixed two real Linux test failures found by the first real Linux CI run.

### Changed

- Documented the CI workflow and the required status check on `main`.
- Bumped npm/yarn dependencies (Dependabot).

## [2.7.0] - 2026-09-17

### Changed

- **Merged the previously separate `YFRemote.Client` repository into this repository as a
  monorepo** (`client/`). Server and Client are now versioned, built, and released from a
  single commit; the Client is excluded from the Server's own MSBuild globs and built from this
  repository in CI instead of being checked out separately.

### Added

_Carried over from the Client's own history, now tracked in this repository's changelog for the
first time — these features had already shipped previously through the Client's own release
channel, not new in v2.7.0 itself:_

- Angular-based remote control UI (touchpad, keyboard tab, custom buttons) behind a PIN pairing
  gate.
- Freely positionable, user-editable custom button layout with multi-step action chains.
- Layout profiles with JSON export/import, and device self-service (unpair from settings).
- Same-origin connections, with the server confirming each macro step before the client
  advances.
- Multi-finger touchpad gestures: two-finger vertical/horizontal scroll, middle-button click,
  and press-and-hold dragging.
- Mobile layout fixes (prevent page scrolling on Chrome, fit touchpad/keyboard views).
- YF brand mark as the application and browser-tab icon.

## [2.6.2] - 2026-09-15

### Testing

- Added dedicated test coverage for `DiagnosticPaths`.

## [2.6.1] - 2026-09-15

### Changed

- Updated MSTest to 4.4.0.

### Testing

- Added HTTP-layer integration tests for pairing and WebSocket endpoints.

## [2.6.0] - 2026-09-03

### Changed

- Added a `build-and-test` CI pipeline that runs on every pull request.

### Testing

- Added coverage for `WindowsInputSender` locking behavior and `ServerOptions` validation.

## [2.5.0] - 2026-09-01

### Added

- Horizontal mouse scroll support.
- Per-connection rate limiting for WebSocket action messages, as a backstop against a flooding
  bug or misbehaving client.

### Fixed

- Pairing lockouts are now persisted, and open sockets are force-closed when a device is
  unpaired.

### Testing

- Added coverage for `WindowsMouseService`, the WebSocket handler, and the
  network/startup/update services.

## [2.4.2] - 2026-08-31

No source changes — release pipeline re-run of [2.4.0](#240---2026-08-24).

## [2.4.1] - 2026-08-28

No source changes — release pipeline re-run of [2.4.0](#240---2026-08-24).

## [2.4.0] - 2026-08-24

### Added

- Middle-click and press-and-hold mouse actions.

### Changed

- Fixed stale local repository paths referenced in `CLAUDE.md`/`AGENTS.md`.

## [2.3.1] - 2026-08-23

No source changes — release pipeline re-run of [2.3.0](#230---2026-08-23).

## [2.3.0] - 2026-08-23

### Added

- Improved remote management and diagnostics.

## [2.2.0] - 2026-08-22

### Added

- Hardened pairing and confirmation of remote actions.

### Changed

- Merged reliability improvements from `develop`.

## [2.1.0] - 2026-08-22

### Added

- Modernized the remote web interface.
- YFRemote logo in the README.

### Fixed

- Web assets are now copied to the build output correctly.

## [2.0.0] - 2026-08-21

### Added

- **Breaking:** device pairing via PIN is now required before `/ws` accepts input, closing the
  previous "no auth" gap where simply reaching the bound port was enough to send input.

## [1.4.0] - 2026-08-21

No source changes — release pipeline re-run of [1.3.0](#130---2026-08-21).

## [1.3.0] - 2026-08-21

### Added

- A `text` action that types arbitrary Unicode text via `SendInput`.

## [1.2.0] - 2026-08-20

No source changes — release pipeline re-run of [1.1.1](#111---2026-08-20).

## [1.1.1] - 2026-08-20

### Fixed

- Validate the `Origin` header on `/ws` to block cross-origin control.

### Changed

- Shortened the README and linked out to the wiki.

## [1.1.0] - 2026-08-20

### Added

- Automatic semantic-version release pipeline — the basis of today's `auto-tag.yml` /
  `release.yml`.

## [1.0.4] - 2026-08-19

### Added

- Option to launch YFRemote automatically at Windows login.

## [1.0.3] - 2026-08-19

### Changed

- Improved user documentation.

## [1.0.2] - 2026-08-19

### Added

- Configurable MSI installer.

## [1.0.1] - 2026-08-19

No source changes — release pipeline re-run of [1.0.0](#100---2026-08-19).

## [1.0.0] - 2026-08-19

### Added

- Initial release: Windows tray application hosting the local control server, with automatic
  updates via Velopack.
