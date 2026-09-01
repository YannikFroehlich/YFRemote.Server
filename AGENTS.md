# YFRemote agent guide

## Repository layout

YFRemote consists of two separate public Git repositories:

- Client: `YannikFroehlich/YFRemote.Client`
  - Local path: `D:\Dev\YFRemote\client\YFRemote.Client` (laptop) /
    `D:\Dokumente\Programmieren\YFRemote\client\YFRemote.Client` (PC)
  - Default branch: `master`
  - Angular web application
- Server: `YannikFroehlich/YFRemote.Server`
  - Local path: `D:\Dev\YFRemote\server\YFRemote.Server` (laptop) /
    `D:\Dokumente\Programmieren\YFRemote\server\YFRemote.Server` (PC)
  - Default branch: `main`
  - .NET Windows application, web server, tray application, and release owner

Treat the repositories as one product but keep their Git histories separate. Do not
create a Client GitHub Release: all installable releases belong to the Server
repository and include a production build of the Client.

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
- The Server targets `net10.0-windows`, uses Windows Forms, and has
  `OutputType=WinExe`, so a normal installed launch has no terminal window.
- Only one Server instance may run at a time.
- A successful pairing is acknowledged only after its hashed device token has been
  atomically persisted to `%LOCALAPPDATA%\YFRemote\devices.json`; the previous valid
  state is retained as `devices.json.bak`. The used PIN rotates immediately after a
  successful write. Failed pairing or unpairing writes are rolled back in memory.
- Device `LastSeenUtc` updates remain immediate in memory and are persisted at most
  once every five minutes to avoid a disk write for every status check or connection.
- Client button layouts are grouped into named browser-local profiles. The legacy single
  layout is migrated to `Standard`; JSON export/import contains every profile, custom
  button, macro, and the active profile selection.

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
source is `YFRemote.Client/public/favicon.ico`, which contains the existing YF
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

Client:

```powershell
npm ci
npm test -- --watch=false
npm run build
```

Server:

```powershell
dotnet restore
dotnet test tests\YFRemote.Server.Tests\YFRemote.Server.Tests.csproj --configuration Release
dotnet build --configuration Release
```

For changes involving the packaged UI, also ensure the Client production output is
copied into `wwwroot` or let the GitHub release workflow perform that integration.
Test update behavior using an installed older version, not a development binary.

## Release automation

Merging to the Server's `main` branch triggers a release automatically. Nothing else is
required for a Server-only or combined change.

`YFRemote.Server/.github/workflows/auto-tag.yml` runs on every push to `main`. It:

1. analyzes commits since the previous tag using Conventional Commits (`fix:` → patch,
   `feat:` → minor, `feat!:` or a `BREAKING CHANGE:` footer → major; anything else falls
   back to a patch bump, so every merge produces at least a patch release);
2. resolves `YFRemote.Client/master` once and records the resulting immutable commit SHA;
3. computes the next `X.Y.Z` version without creating a tag itself (`dry_run: true`);
4. invokes `release.yml` directly as a reusable workflow (`workflow_call`), passing both
   the version and Client SHA — the tag itself is created later by
   `vpk upload github --publish` inside `release.yml`, not by `auto-tag.yml`.

All automatic and manually triggered version calculations share the
`yfremote-version-release` concurrency group. Runs queue instead of replacing one another,
which prevents two releases from selecting or publishing the same next version in parallel.

Use Conventional Commit prefixes in commit/PR titles so the version bump is meaningful.
To skip a release entirely for a given merge (e.g. a docs-only change), include
`[skip release]` in the merge commit message.

`auto-tag.yml` also accepts a manual `workflow_dispatch` run with a chosen `bump` input
(`patch`/`minor`/`major`). Use this for a **Client-only change**: since nothing changes in
the Server repo, no push to `main` happens and the automation never fires on its own — run
the workflow manually (GitHub → Actions → "Auto Tag YFRemote" → "Run workflow") after the
Client change has been merged to `master`.

`YFRemote.Server/.github/workflows/release.yml` does the actual build/pack/publish work. It
runs either invoked by `auto-tag.yml` above, or directly when a semantic-version tag matching
`v*.*.*` is pushed to the Server repository by hand — keep the manual tag-push path in mind
as a fallback (e.g. for re-running a release, or environments where the automated workflow
can't run).

The workflow:

1. checks out and verifies the exact Server commit that triggered the release;
2. checks out and verifies the pinned `YFRemote.Client` commit passed by `auto-tag.yml`;
3. runs `npm ci`, Client tests, the Client production build, and the Server tests;
4. copies `client/dist/YFRemote.Client/browser/*` to `server/wwwroot`;
5. publishes a self-contained `win-x64` Server build with the tag version;
6. creates `release-manifest.json` with the version and both repository SHAs and includes
   it in the packaged application;
7. downloads the previous release when available so Velopack can create a delta;
8. creates the installer, portable archive, full package, and delta package;
9. publishes a GitHub Release in `YFRemote.Server` and uploads the manifest as a separate
   release asset.

The manual tag-push fallback has no `workflow_call` Client input. In that path,
`release.yml` resolves `master` once at the start, verifies the checked-out SHA, and records
it in the manifest. Prefer `auto-tag.yml` whenever possible because it passes the Client SHA
explicitly between workflows.

Typical release assets are:

- `YFRemote-win-Setup.exe`
- `YFRemote-win.msi` (wizard installer with selectable install location)
- `YFRemote-win-Portable.zip`
- `YFRemote-X.Y.Z-full.nupkg`
- `YFRemote-X.Y.Z-delta.nupkg` when a previous release exists
- `RELEASES`
- `releases.win.json`
- `release-manifest.json` (version plus exact Server and Client commit SHAs)

Never reuse, move, or overwrite a published version tag. If a release changes after
publication, increment the semantic version and create a new tag.

## Releasing a Client-only change

A Client-only change still requires a new Server release because the compiled
Client is embedded in the Server package. The Server source does not need a new
commit — but that also means `auto-tag.yml` never fires on its own for this case,
since nothing gets pushed to the Server's `main`.

1. Commit and merge the Client change into `YFRemote.Client/master`.
2. Verify that GitHub shows the intended Client commit on `master`.
3. In `YFRemote.Server`, run `auto-tag.yml` manually: GitHub → Actions → "Auto Tag
   YFRemote" → "Run workflow" on `main`, choosing the appropriate `bump` (usually
   `patch`).
4. Monitor the run until both the tagging job and the invoked `release.yml` succeed.
5. Verify the public Server release and its assets.

The order is important: merge the Client first, then run the workflow. `auto-tag.yml`
resolves `master` once at the start and passes that exact SHA to the release; triggering it
too early can therefore pin and package the previous Client version.

Fallback if the automated workflow is unavailable: tag the intended Server `main`
commit by hand and push the tag, which triggers `release.yml` directly.

```powershell
cd <server-repo-local-path>   # see "Repository layout" above
git switch main
git pull --ff-only
git tag -a v1.0.2 -m "YFRemote v1.0.2"
git push origin v1.0.2
```

## Releasing a Server or combined change

1. Merge all required Client changes to `master`, if any.
2. Merge the Server changes to `main` — use Conventional Commit prefixes (`fix:`,
   `feat:`, `feat!:`/`BREAKING CHANGE:`) in the commit or PR title so the automatic
   version bump is meaningful.
3. Run/confirm the relevant Client and Server checks before merging.
4. `auto-tag.yml` fires automatically on the merge to `main`, computes the next
   version, and invokes `release.yml`. No manual tagging step is needed.
5. Monitor the `Auto Tag YFRemote` and `Release YFRemote` workflow runs and verify
   all assets.

The latest known release when this file was created was `v1.0.1`. Do not assume
that remains current: query Server releases and tags before assuming what the next
automatic version will be.

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
