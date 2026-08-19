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

## Release workflow

The release workflow is
`YFRemote.Server/.github/workflows/release.yml`. It runs when a semantic-version tag
matching `v*.*.*` is pushed to the Server repository.

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
commit.

1. Commit and merge the Client change into `YFRemote.Client/master`.
2. Verify that GitHub shows the intended Client commit on `master`.
3. Choose the next unused product version, for example `v1.0.2`.
4. Create and push that tag in `YFRemote.Server` on the intended `main` commit:

```powershell
cd D:\Dokumente\Programmieren\YFRemote\server\YFRemote.Server
git switch main
git pull --ff-only
git tag -a v1.0.2 -m "YFRemote v1.0.2"
git push origin v1.0.2
```

5. Monitor the `Release YFRemote` GitHub Actions workflow until it succeeds.
6. Verify the public Server release and its assets.

The order is important: merge the Client first, then push the Server tag. The
workflow checks out the current Client default branch at workflow runtime; tagging
too early can package the previous Client version.

## Releasing a Server or combined change

1. Merge all required Client changes to `master`, if any.
2. Merge the Server changes to `main`.
3. Run/confirm the relevant Client and Server checks.
4. Tag the intended Server `main` commit with the next unused `vX.Y.Z` version.
5. Push the tag, monitor the release workflow, and verify all assets.

The latest known release when this file was created was `v1.0.1`. Do not assume
that remains current: query Server releases and tags before choosing a new version.

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
