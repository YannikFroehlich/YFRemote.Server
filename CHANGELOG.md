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

- Touchpad: Die Zwischenablage geht jetzt auch vom PC aufs Geraet (`GET /clipboard/text`) - bisher nur in die andere Richtung. Mit einem Windows-Server fragt der Zwischenablage-Knopf nach der Richtung ("An PC senden" / "Vom PC holen"), statt einen weiteren Knopf in die Zeile zu setzen, die auf einem 375 px breiten Handy sonst "Senden" in eine dritte Zeile gedraengt haette. Der geholte Text erscheint in einem Feld; ueber HTTPS kopiert "Kopieren" ihn direkt in die Zwischenablage des Geraets, ueber `http://<LAN-IP>` gibt der Browser diese Funktion nicht frei, dann wird der Text zum manuellen Markieren angezeigt. Linux kann die Zwischenablage noch nicht lesen und der Android-Server kennt den Endpunkt nicht - dort fuehrt der Knopf wie bisher direkt zum Einfuege-Feld. Die Antwort wird nie zwischengespeichert (`Cache-Control: no-store`), da sie Passwoerter enthalten kann.
- Infobereich: Jedes Mal, wenn ein gekoppeltes Geraet die Zwischenablage des PCs abholt, erscheint die Sprechblase "Zwischenablage gesendet" mit dem Namen des Geraets - so faellt am PC auf, wenn jemand unerwartet mitliest. Keine Meldung, wenn die Zwischenablage leer oder der Text zu lang war, denn dann wurde nichts uebertragen.

### Changed

- Release-Assets: Setup.exe und MSI heissen jetzt `YFRemote-win-Setup-X.Y.Z.exe` bzw. `YFRemote-win-X.Y.Z.msi` statt ohne Versionsnummer - wer direkt von GitHub Releases laedt, sieht so beim Speichern welche Version es ist. Die portable ZIP entfaellt (`--noPortable`): Setup.exe deckt den Installationsfall ab, ein zusaetzliches Format ohne echten Anwendungsfall spart Build-Zeit und Release-Groesse.

### Fixed

- Windows: Getippter Text kam im Windows-11-Editor (Notepad) verstuemmelt an - ab einem Leerzeichen oder direkt nach ENTER wurde jedes Zeichen durch das zuletzt gesendete ersetzt ("123 456" wurde "123 666"). Der Editor verarbeitet die per `SendInput` als Unicode gesendeten Zeichen verspaetet und liest dann nur noch das letzte; in anderen Programmen (z. B. einem normalen Windows-Textfeld) trat das nicht auf. Der Server sendet die Zeichen jetzt mit 30 ms Abstand und gibt die Eingabesperre zwischen zwei Zeichen frei, damit Mausbewegungen anderer Geraete waehrend eines langen Textes nicht haengen. Ein Text mit 100 Zeichen braucht dadurch rund 3 Sekunden.
- Release-Pipeline: Setup.exe und MSI werden jetzt erst nach dem Hochladen umbenannt, per GitHub-API. Vorher benannte ein Schritt die Dateien vor `vpk upload github` um - `vpk` laedt aber die beim Packen erfassten Dateinamen hoch und fand `YFRemote-win-Setup.exe` nicht mehr, der erste Release-Lauf fuer diese Version brach deshalb ab (es blieb nur ein unveroeffentlichter Entwurf, das Auto-Update war nicht betroffen).
- Touchpad: Solange das Einfuege-Feld der Zwischenablage oder eine Statusmeldung (z. B. "Datei gesendet") eingeblendet war, rutschte die Touchpad-Flaeche in die Zeile der Maustasten und ueberdeckte Links-/Mittel-/Rechtsklick. Die Karte war ein Raster mit genau vier festen Zeilen, jedes zusaetzlich eingeblendete Element verschob die Zuordnung. Die Flaeche nimmt jetzt den Restplatz ein, egal wie viel darueber steht.
- Zertifikatsdialog: Der Einleitungssatz behauptete, der QR-Code lade das Zertifikat auf das Geraet und erst danach sei die Verbindung verschluesselt. Beides war falsch: Auf Android laedt der QR-Code nur die Datei herunter, installiert wird sie separat ueber die Systemeinstellungen (der Weg dorthin stand schon im selben Dialog, nur unter einem Satz, der die Installation als erledigt darstellte). Und verschluesselt ist die Verbindung auch ohne installiertes Zertifikat - die Warnung betrifft die Echtheit des Servers, nicht die Verschluesselung.
- WebSocket: Lehnte der Server eine Nachricht wegen des Rate-Limits (120 Nachrichten pro Sekunde) ab, fehlte in der Antwort die mitgeschickte `requestId`. Der Client konnte die Ablehnung so keinem Makro-Schritt zuordnen, wartete 5 Sekunden und meldete dann eine fehlende Bestaetigung statt des eigentlichen Grundes. Windows-, Linux- und Android-Server geben die `requestId` jetzt auch in dieser Antwort zurueck.
- Infobereich-Menue: Die Rueckfrage beim Einschalten von HTTPS sagte, auf jedem Geraet muesse einmalig das Zertifikat installiert werden. Noetig ist das nicht - ohne Installation erscheint lediglich eine wegklickbare Zertifikatswarnung. Diktieren und Steuern funktionieren auch dann, weil ein Browser den sicheren Kontext am Schema (`https:`) festmacht und nicht an der Gueltigkeit des Zertifikats.
- Release-Pipeline: Der Download der Android-cmdline-tools von Google laeuft jetzt mit `--retry 5 --retry-all-errors`. Ein einzelner Netzwerkaussetzer hatte den `release-android`-Job und damit den ganzen Release-Lauf von v2.20.0 abreissen lassen (`curl: (92) HTTP/2 stream 1 was not closed cleanly: INTERNAL_ERROR`); Windows- und Linux-Assets waren da bereits veroeffentlicht, nur die APK fehlte bis zum manuellen Neustart des Jobs.
- Release-Pipeline: Die APK haengt jetzt als `YFRemote-Android-vX.Y.Z.apk` am Release statt als `app-release.apk` (so in v2.18.2 bis v2.20.0). Das `#...`-Suffix von `gh release upload` setzt nur das Label des Assets, nicht seinen Namen - die Datei wird vor dem Upload umbenannt. Ausserdem `--clobber`, damit ein erneuter Lauf desselben Jobs nicht an einem bereits hochgeladenen Asset scheitert.

## [2.20.0] - 2026-09-23

### Added

- Infobereich-Menue: "HTTPS verwenden" schaltet HTTPS ohne Bearbeiten der appsettings.json ein und aus. Die Wahl landet in `%LOCALAPPDATA%\YFRemote\settings.json` - also neben `devices.json` und nicht im `current`-Ordner, den Velopack bei jedem Update ersetzt - und YFRemote startet danach auf Nachfrage selbst neu. Der Dialog nennt vorher beide Folgen: alle gekoppelten Geraete muessen neu gekoppelt werden (die Seite bekommt eine neue Adresse), und auf jedem Geraet ist einmalig das Zertifikat zu installieren. Steht unter `Server:Host` ein Name statt einer IP, lehnt der Schalter mit Begruendung ab, statt den Neustart im Startfehler enden zu lassen. `Https:Enabled` in der appsettings.json und Umgebungsvariablen funktionieren unveraendert; ausdrueckliche Kommandozeilenargumente haben weiterhin Vorrang vor der gespeicherten Einstellung.

### Fixed

- Diktieren im Touchpad-Textfeld meldete ueber die LAN-Adresse nur "Mikrofonzugriff wurde verweigert", ohne dass sich daran etwas aendern liess: Browser geben Mikrofon, Kamera und Zwischenablage nur in einem sicheren Kontext frei, und `http://<LAN-IP>` ist keiner - die Freigabe laesst sich fuer so eine Seite in den Browser-Einstellungen auch gar nicht erteilen. Der Client erkennt das jetzt vorab und nennt den Grund samt Abhilfe ("Setze in der appsettings.json des Servers `"Https": { "Enabled": true }` und starte ihn neu"), statt den Browser erst ins Leere laufen zu lassen. Ueber `http://localhost` (Server auf demselben Rechner) und ueber HTTPS funktioniert das Diktat unveraendert.
- Touchpad-Textfeld auf dem Handy: Mikrofon, Datei, Zwischenablage, "Live" und "Senden" standen in derselben Zeile wie das Eingabefeld und quetschten es auf wenige Zeichen zusammen (auf einem 412 px breiten Bildschirm war nur noch "Te" vom Platzhalter zu sehen). Das Eingabefeld bekommt jetzt eine eigene Zeile, die Schalter ruecken darunter; ab 540 px Breite bleibt das bisherige einzeilige Layout.

## [2.19.0] - 2026-09-23

### Added

- Android-App: Die Setup-Seite zeigt jetzt pro Berechtigung eine Statuszeile statt den fehlenden Schalter erst als Fehler pro Aktion auf dem steuernden Geraet sichtbar zu machen. Die Tastatur-Zeile unterscheidet dabei "aktiviert, aber nicht ausgewaehlt" von "inaktiv" - Android braucht beide Schritte -, ein Button "Tastatur auswaehlen" oeffnet den System-Auswahldialog direkt, und ein Hinweis nennt "Eingeschraenkte Einstellungen zulassen", das Android 13+ bei per APK installierten Apps fuer Bedienungshilfen verlangt.
- Android-App: Die YFRemote-Tastatur zeigt beim Tippen am Telefon selbst eine Leiste mit einem "Andere Tastatur"-Button. Vorher war sie eine unsichtbare 1x1-View, dadurch stand waehrend ihrer Auswahl gar keine bedienbare Tastatur mehr zur Verfuegung und der Weg zurueck fuehrte nur ueber die Systemeinstellungen.
- Android-App: eigenes Erscheinungsbild statt der Android-Standardansicht - das Logo aus `client/public/brand-mark-*.png` ist jetzt App-Icon (adaptiv, mit eigenem Hintergrund) und Kopfzeile der Setup-Seite, dazu ein dunkles Theme in den Farben des Web-Clients, Karten statt loser Buttons, farbige Statuspunkte fuer Dienst/Bedienungshilfe/Tastatur und ein eigenes Benachrichtigungs-Icon statt des generischen System-Icons.
- Der Remote-Tab passt sich der Gegenstelle an: `GET /health` meldet jetzt zusaetzlich ein `platform`-Feld ("windows", "linux", "android"), und bei einer Verbindung zu einem Android-Server wechselt der Client in ein eigenes Layout-Profil "Android". Dort fehlen die Buttons, die ein Telefon nicht ausfuehren kann (Tab zurueck/weiter, Tab schliessen/wiederherstellen, Vollbild, Neustart, Herunterfahren), dafuer gibt es Home, Uebersicht und Bildschirm sperren. Das Profil ist normal editierbar; beim naechsten Verbinden mit einem PC schaltet der Client auf das vorherige Profil zurueck.

### Fixed

- Android-App: Taps und Wischgesten landeten um die Hoehe der Statusleiste neben dem sichtbaren Cursor, weil das Overlay-Fenster ohne `FLAG_LAYOUT_IN_SCREEN` unterhalb der Statusleiste positioniert wird, `dispatchGesture()` aber in Display-Koordinaten arbeitet. Getippte Buttons wurden dadurch verfehlt.
- Android-App: Texte der Setup-Seite, der Benachrichtigung und der Fehlermeldungen zeigen jetzt echte Umlaute ("Gerät", "läuft", "möglich") statt "Geraet"/"laeuft"/"moeglich".
- Kopplungsseite des Clients: Bei einem Android-Server steht dort jetzt "Mit deinem Android-Gerät verbinden" samt Hinweis auf die YFRemote-App statt "Mit deinem PC verbinden" und dem Infobereich-Hinweis; die Plattform kommt vorab aus `GET /health`. Auch der Live-Eingabe-Hinweis im Touchpad-Textfeld sagt jetzt "Gerät" statt "PC".
- Android-App: Drag (Antippen, Halten, Ziehen im Touchpad) funktionierte nicht - jede Fortsetzung der Geste wurde von Android abgebrochen ("Geste abgebrochen" im Log), weil die fortgesetzte Stroke nicht am Endpunkt der vorherigen begann. Sie startet jetzt dort und zieht eine Linie zum Cursor; auf einem Samsung SM-S938B mit 25 Moves im 16-ms-Takt geprueft (Liste scrollt, keine Abbrueche, kein haengender Finger).
- Build: `tests/` und lokale Publish-Ausgaben (`publish/`, `publish-linux/`) sind jetzt aus den Default-Globs des Server-Projekts ausgeschlossen. Vorher landeten sie im Output-Ordner (`bin/Release/net10.0/tests/...`), der beim naechsten Build wieder mitgeglobt wurde - die Verschachtelung wuchs mit jedem `dotnet build`/`dotnet test`, bis allein die Projektauswertung Minuten dauerte. Sauberer Build danach: 14 s, Rebuild 4 s, keine verschachtelten Ordner. Die CI war nicht betroffen, weil sie jedes Mal frisch startet.
- Linux: Nach dem Start des Servers gingen die ersten Tastendruecke beziehungsweise Mausbewegungen verloren - das virtuelle Geraet wird erst beim ersten Sendevorgang angelegt und X11/libinput oeffnet es einen Moment spaeter (auf einer Linux-Mint-VM fehlte der komplette erste Text). Der Server wartet jetzt nach dem Anlegen jedes Geraets 500 ms, bevor er die ersten Events schreibt; nur der allererste Tastendruck bzw. die erste Mausbewegung nach dem Start ist dadurch minimal verzoegert.
- Kopplungsseite des Clients: Bei einem Linux-Server steht dort jetzt "Gib die sechsstellige PIN ein, die YFRemote im Terminal des Ziel-PCs ausgibt" (als Dienst: im Journal) statt des Hinweises auf das Infobereich-Symbol - Linux hat kein Tray. Der Client merkt sich dafuer die Plattform aus `GET /health` als `serverPlatform` (windows/linux/android) statt nur "Android ja/nein".

## [2.18.2] - 2026-09-22

### Fixed

- Release-Pipeline: Das Akzeptieren der Android-SDK-Lizenzen im `release-android`-Job scheiterte an `pipefail`. Keine Aenderung an Server, Client oder App.

## [2.18.1] - 2026-09-22

### Fixed

- Release-Pipeline: `android-actions/setup-android` im `release-android`-Job durch ein direktes Setup der Android-cmdline-tools ersetzt. Keine Aenderung an Server, Client oder App.

## [2.18.0] - 2026-09-22

### Added

- Experimenteller Android-Server-Prototyp unter `android/` (Kotlin + Ktor): dieselbe Pairing-/WebSocket-API wie der Windows/Linux-Server, plus `AccessibilityService`-basierte Zeigersteuerung, eine eigene Tastatur (IME) fuers Tippen, Datei- und Zwischenablage-Uebertragung. Noch kein Bestandteil der Windows/Linux-App-Erfahrung und noch nicht auf echter Hardware verifiziert - siehe `android/PLAN.md`. Die Release-Pipeline baut ab jetzt zusaetzlich eine signierte APK (siehe `release-android`-Job in `release.yml`), sobald die dafuer noetigen Signing-Secrets hinterlegt sind.

## [2.17.0] - 2026-09-22

### Added

- Touchpad text field: a microphone button dictates via the browser's speech recognition instead of typing. With "Live" on, dictated text is sent as it is recognized, same as typing; with it off, it only fills the field for review before "Senden". Multiple sentences append instead of overwriting each other as long as the button stays on. Not shown on browsers without speech recognition support (e.g. Firefox).
- The client now supports English in addition to German. Switch via the new "Sprache"/"Language" field in Settings — German stays the default, and the choice is remembered on the device.
- The client now caches its app shell via an Angular service worker, so it loads even over a flaky connection once it has been opened once. Production builds only; a `dotnet run`/`ng serve` dev session is unaffected.
- The install manifest now ships properly sized 192x192 and 512x512 icons plus a maskable variant, so Android/desktop installs get a crisp, adaptive-icon-compatible app icon instead of one giant PNG scaled down.
- Settings: a "Zuletzt verbunden"/"Recently connected" list under Host/IP remembers up to 6 previously used servers (this device only) so switching between multiple PCs no longer means retyping host and port each time.
- Every button on the Remote page — built-in or custom — can now have its own background color. Opening a button in edit mode reveals "Eigene Farbe verwenden" with a color picker; icon and label switch between black and white automatically for readable contrast. A built-in button's label/icon/action stay fixed; only its color is editable.
- A new upload button next to the touchpad's text field sends a file from the phone to the PC (`POST /files`, same PIN/pairing gate as everything else); it's saved into `Dokumente\YFRemote`, with a Windows tray notification once it arrives. A second file with the same name gets a `(2)`-suffixed name instead of overwriting the first. Size is capped at 200 MB by default (`FileTransfer:MaxFileSizeBytes` in `appsettings.json`).
- A new clipboard button next to the touchpad's text field sends text or an image from the phone's clipboard straight into the PC's clipboard: tap the button, then paste (the browser's own paste gesture — reading the clipboard directly isn't possible without HTTPS). Windows only for now; capped at 200,000 characters / 20 MB by default (`Clipboard:MaxTextLength`/`Clipboard:MaxImageSizeBytes` in `appsettings.json`).

### Fixed

- A built-in button not yet present in a saved layout (e.g. "Vorheriger"/"Stopp"/"Nächster" or "Ruhemodus"/"Neustart"/"Herunterfahren" on a layout saved before they existed) was auto-placed as a tiny 1x1 cell instead of its intended size, rendering with a cut-off label. It now gets its real default size, and an existing layout already stuck with a 1x1 built-in self-heals to the correct size the next time it loads.
- Color swatches in the custom style editor ("Eigener Stil") had square corners despite the app's rounded design language — most visibly on Android, where the native color-picker preview ignores CSS styling entirely. Swatches now show the picked color as their own clipped background instead of relying on the browser to round it. The "Profi: alle Farben einzeln" section also now animates open/closed with a rotating arrow instead of snapping instantly.
- Dialog close buttons (Settings, "Eigener Stil", Button-Editor) showed a plain "x" character instead of an icon; they now use the same X icon as the rest of the app.
- File transfer: a Windows-style path-traversal filename (`..\..\evil.exe`) sent by a client was only sanitized on Windows, since `Path.GetFileName` doesn't treat `\` as a separator on Linux. Filenames are now trimmed at the last `/` or `\` regardless of the server's OS.

## [2.15.0] - 2026-09-21

### Added

- iOS: added to the home screen, YFRemote now starts as a standalone app without the Safari address and tab bars, under the name "YFRemote". The status bar stays transparent over the app background.
- Optional HTTPS. With `Https:Enabled` set in `appsettings.json`, the server additionally listens on port 5443 (`Https:Port`) with a certificate it issues itself. The key material stays on the PC: a local certificate authority is created once under `%LOCALAPPDATA%\YFRemote\ca.pfx`, protected with DPAPI on Windows and with file permissions on Linux. Its public certificate is available at `/ca.crt` over plain HTTP, so it can be installed on a device before that device trusts the server. Once installed, the connection is encrypted without a browser warning, which is also what a browser requires before it will install the page as an app or run a service worker. HTTP on port 5050 stays switched on and unchanged; existing setups are unaffected.
- The server certificate covers every local IPv4 address and is reissued automatically when the network address changes, so a new address from the router does not require installing the certificate again.
- Tray menu: "Zertifikat installieren..." shows a QR code that loads the certificate onto a phone or tablet, together with the steps needed on Android and iOS to actually trust it. The entry only appears when HTTPS is switched on, and the QR code deliberately points at the HTTP address, because the device cannot trust the HTTPS one yet.

## [2.14.0] - 2026-09-20

### Added

- Three power buttons: "Ruhemodus", "Neustart" and "Herunterfahren" put the PC into standby, restart it or shut it down. Because none of that can be taken back from a phone, each one asks for confirmation before it is sent. On Windows they use `shutdown.exe` and the system standby call, on Linux `systemctl`; a command the machine refuses (for example for lack of privileges) is reported as an error instead of silently counting as success.

## [2.13.1] - 2026-09-19

### Fixed

- Button editor: on phones the key picker shows its category headings again (Modifikatoren, Navigation, Funktionstasten, Buchstaben, Zahlen). The compact full-height key grid of the keyboard tab no longer leaks into the editor dialog, where the keys now wrap per category as on a desktop.

## [2.13.0] - 2026-09-19

### Added

- Own styles. Settings → "Neuer Stil" opens an editor for colors (accent, background, surfaces, buttons, text, lines, warning), border thickness, corner rounding, shadows, gradients, background grid, fonts and text size; a "Profi" section sets each of the 36 color tokens on its own. Changes are visible while editing, several styles can be kept side by side, and they can be exported to and imported from a JSON file. An own style brings its own light or dark.
- Three styles, selectable under Settings → "Stil" and combinable with light and dark mode: "Standard" (the existing look), "Futuristisch" (neon cyan and violet, glow, sharper corners, monospace headings, visible grid) and "Minimalistisch" (flat monochrome, no gradients, glow or shadows). The choice is remembered and applied before the page first renders.
- Light mode. Settings → "Darstellung" chooses between "Wie das Gerät (System)" (the default, follows the phone's light/dark setting), "Hell" and "Dunkel". The choice is remembered and applied before the page first renders, so it never flashes the wrong mode on load. The browser bar color follows along.
- Settings: a "Mausbeschleunigung" switch turns the touchpad's pointer acceleration off, so
  cursor movement stays 1:1 regardless of finger speed. It is on by default.

### Fixed

- Phone layout: the touchpad tab no longer runs off the right edge of the screen (the gesture chips, the "Senden" button and "Rechtsklick" were cut off); on phones the gesture hints now sit in the middle of the touchpad. The Live switch shows an on/off indicator.
- Phone layout: the Backspace key on the keyboard tab is labelled "⌫" so it fits its button, and key labels can no longer spill outside their button.
- Settings: the on/off switches are full-width rows like the other fields instead of pills with wrapped text.

## [2.12.0] - 2026-09-19

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
