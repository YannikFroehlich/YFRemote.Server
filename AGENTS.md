# YFRemote agent guide

## Repository layout

YFRemote consists of two separate public Git repositories:

- Client: `YannikFroehlich/YFRemote.Client`
  - Local path: `D:\Dokumente\Programmieren\YFRemote\client\YFRemote.Client`
  - Default branch: `master`
  - Angular web application
- Server: `YannikFroehlich/YFRemote.Server`
  - Local path: `D:\Dokumente\Programmieren\YFRemote\server\YFRemote.Server`
  - Default branch: `main`
  - .NET Windows application, web server, tray application, and release owner

Treat the repositories as one product but keep their Git histories separate. Do not
create a Client GitHub Release: all installable releases belong to the Server
repository and include a production build of the Client.

## Product architecture

- The Angular Client is built as static files and copied into the Server's
  `wwwroot` directory during the release workflow.
- The Server hosts the Client, the `/health` endpoint, and the `/ws` WebSocket.
- The default server binding is `http://0.0.0.0:5050`.
- The Client derives its default WebSocket host from the hostname of the page that
  served it and falls back to `localhost`; the default port is `5050`.
- The Server targets `net10.0-windows`, uses Windows Forms, and has
  `OutputType=WinExe`, so a normal installed launch has no terminal window.
- Only one Server instance may run at a time.

## Tray application

The Windows notification-area application is implemented in
`Tray/TrayApplicationContext.cs`.

The tray menu shows:

- installed YFRemote version;
- server status and device address;
- open in browser;
- copy device address;
- check for, download, and install updates;
- enable or disable startup with Windows for the current user;
- exit.

Double-clicking the tray icon opens the local web UI. The app performs an update
check shortly after startup and then every six hours. When an update is available,
the menu item changes to `Neue Version vX.Y.Z verfügbar - installieren`. Installing
an update downloads it, exits the current process, applies it, and restarts the app.

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
2. computes the next `X.Y.Z` version without creating a tag itself (`dry_run: true`);
3. invokes `release.yml` directly as a reusable workflow (`workflow_call`), passing that
   version — the tag itself is created later by `vpk upload github --publish` inside
   `release.yml`, not by `auto-tag.yml`.

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

1. checks out the tagged Server commit;
2. checks out the current default branch of `YFRemote.Client`;
3. runs `npm ci`, Client tests, and the Client production build;
4. copies `client/dist/YFRemote.Client/browser/*` to `server/wwwroot`;
5. publishes a self-contained `win-x64` Server build with the tag version;
6. downloads the previous release when available so Velopack can create a delta;
7. creates the installer, portable archive, full package, and delta package;
8. publishes a GitHub Release in `YFRemote.Server`.

Typical release assets are:

- `YFRemote-win-Setup.exe`
- `YFRemote-win.msi` (wizard installer with selectable install location)
- `YFRemote-win-Portable.zip`
- `YFRemote-X.Y.Z-full.nupkg`
- `YFRemote-X.Y.Z-delta.nupkg` when a previous release exists
- `RELEASES`
- `releases.win.json`

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

The order is important: merge the Client first, then run the workflow. It checks out
the current Client default branch at run time; triggering it too early can package
the previous Client version.

Fallback if the automated workflow is unavailable: tag the intended Server `main`
commit by hand and push the tag, which triggers `release.yml` directly.

```powershell
cd D:\Dokumente\Programmieren\YFRemote\server\YFRemote.Server
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
