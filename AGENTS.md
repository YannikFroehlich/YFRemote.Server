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
- The Server multi-targets `net10.0-windows10.0.17763.0;net10.0` (see [Linux support](#linux-support)
  below). On `net10.0-windows10.0.17763.0` it uses Windows Forms and has `OutputType=WinExe`, so a
  normal installed launch has no terminal window; on plain `net10.0` it is a console `Exe`.
  The Windows target names platform version 10.0.17763 (Windows 10 1809) because
  `WindowsMediaStatusReader` uses the WinRT `GlobalSystemMediaTransportControlsSessionManager`;
  that pulls `Microsoft.Windows.SDK.NET.dll` (~23 MB) into the publish output. Every
  `-f`/`--framework` and every `Condition` on the target name has to use the full TFM.
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


The Server multi-targets `net10.0-windows10.0.17763.0;net10.0` from one `.csproj`; `net10.0` is the
Linux build: no tray and no Velopack code, input through `/dev/uinput` (keyboard, mouse, and the
virtual controller including rumble), clipboard through `wl-clipboard`/`xclip`, media status
through `pactl`/`playerctl`. Every release ships Linux x64/arm64 packages on separate `-beta`
Velopack channels (`release-linux` job); the `linux` job in `ci.yml` builds and tests `net10.0` on
every PR.

Status: the input backend is verified end to end on a real x86_64 kernel, but only as a bare
`dotnet publish` output. arm64 on real hardware, the Velopack-installed path, the controller
(including rumble), clipboard images and the media status are unverified on a real Linux session.

The full record - target split, each backend, verification history, packaging, CI, autostart - is
in [docs/LINUX.md](docs/LINUX.md). Read it before touching Linux code, `packaging/linux/`, or the
`release-linux` job, and keep it up to date in the same change.

## Android support


[`android/`](android) holds a native Kotlin + Ktor app with its own Gradle build (not .NET). It
runs its own server on the Android device, serves the same Angular Client and speaks the same
protocol, so a second device can remote-control the Android device. The app is also a controller
itself: it remote-controls paired PCs ("Steuern"), and can register the phone as a Bluetooth HID
gamepad. Released with every version since v2.18.2: the `release-android` job in `release.yml`
attaches a signed `YFRemote-Android-vX.Y.Z.apk`.

Status: Stufen 0-5 of the plan are done and verified on real hardware; several later additions
(sharing to a PC, the media widget, CA pinning, launching apps, media status) have unit tests only
and are marked "not yet checked on a device" where they are described.

The full record - why it is not part of the multi-targeted `.csproj`, scope, each feature, parity
with the PC server, status per stage - is in [docs/ANDROID.md](docs/ANDROID.md);
[`android/PLAN.md`](android/PLAN.md) is the executable roadmap with the action-by-action
protocol table. Read both before touching `android/` or the `release-android` job, and keep them
up to date in the same change.

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
source is `client/public/favicon.ico`, which contains the brand mark (mouse
pointer with signal waves) in 16, 32, 48, 128, and 256 pixel sizes. The same icon
is used by the browser, the Velopack installer, and embedded into
`YFRemote.Server.exe` via `ApplicationIcon` (Windows target only). Preserve this relationship when
changing branding. All logo files (`favicon.ico`, `client/public/brand-mark-*.png`,
the Android launcher PNGs, `branding/logo.svg`) are generated by
`python branding/render_icons.py` (Edge headless + Pillow); change the motif there
and re-run it instead of editing the images. The Android notification icon
`ic_notification.xml` repeats the motif's paths by hand.

## Updates and installation

- Velopack package ID: `YFRemote`
- Velopack version used by the project: `1.2.161`
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

Velopack also creates a stable execution stub in the YFRemote root, `YFRemote.exe`
(named after `--packTitle`), which `WindowsStartupService` writes into the autostart
entry. Packages built with Velopack before 1.2.158 named the stub that Setup.exe
installs and every update re-extracts after `--mainExe` instead (`YFRemote.Server.exe`),
so only MSI installs had `YFRemote.exe`; such a leftover `YFRemote.Server.exe` in the
root is harmless. The `current` directory is replaced during updates. Never store
persistent settings or user data inside it. Startup failures are logged to
`%LOCALAPPDATA%\YFRemote\Logs\startup-error.log`.

Releases also include a Windows Installer (`.msi`) built with
`--msi --instLocation Either`. Use the `.msi` when the user wants an installation
wizard and wants to choose the installation scope or target directory. The generated
`Setup.exe` remains a one-click installer; Velopack does not add wizard pages to that
executable. Tray updates continue to work for MSI installations.

Both installers carry the brand: `vpk pack` gets the files in `branding/installer/` -
`msi-banner.bmp` (493x58, header of the wizard pages), `msi-dialog.bmp` (493x312, welcome and
finish page), `welcome.txt`/`conclusion.txt` (German texts of those two pages) and `splash.png`
(the `Setup.exe` window). The images come from `branding/render_icons.py` like the logo files. The
wizard writes black text onto the bitmaps, so everything outside the dark brand field has to stay
white: text starts at 180 px on the dialog bitmap and reaches about 400 px on the banner. The
wizard's own strings follow the Windows display language; only the two text files are German.

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

`.github/workflows/ci.yml` runs on every pull request with four jobs: `build-and-test`
(restores, builds, and tests the Server on `windows-latest`), `client` (`npm ci`, Client
tests, and the Client production build on `ubuntu-latest`), `linux` (the `net10.0` Server build
and tests), and `android` (`gradle -p android assemble testDebugUnitTest`, no signing
secrets needed). None has a `paths` filter, so all run for every change. The Android SDK setup is
shared with `release-android` via the composite action `.github/actions/setup-android`, so a fix
to it (retries, license handling) applies to both.

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
   assets. The `changelog-pr` job in `release.yml` then opens a pull request into `develop`
   that renames `[Unreleased]` in `CHANGELOG.md` to the version/date just published, with a
   fresh empty `[Unreleased]` above it, and enables auto-merge (squash) on it, so it lands once
   `build-and-test` passes. It pushes and opens the PR with the repository secret
   `CHANGELOG_PR_TOKEN`, a fine-grained personal access token of the owner limited to this
   repository (Contents and Pull requests: read and write). Without that secret it falls back
   to `GITHUB_TOKEN`: since June 2026 GitHub creates the `pull_request` CI run of a PR opened by
   `github-actions[bot]` in an approval-required state, so the PR then waits for "Approve
   workflows to run" in its merge box before `build-and-test` runs (a `workflow_dispatch` run
   on the branch does not satisfy the required check). Renew the token before it expires.
   The job skips with a notice if `develop` already has the version heading or `[Unreleased]`
   was empty, and with a warning if `[Unreleased]` in `develop` changed after the release
   commit (new entries merged meanwhile) — then do the rename by hand, as before.

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
