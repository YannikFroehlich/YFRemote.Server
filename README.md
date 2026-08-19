# YFRemote

YFRemote verwandelt ein Smartphone, Tablet oder einen zweiten Computer in eine
Fernbedienung für einen Windows-PC. Die Anwendung läuft unauffällig im Infobereich
der Taskleiste und stellt die Bedienoberfläche im lokalen Netzwerk über den Browser
bereit.

## Für Nutzer

### Voraussetzungen

- Windows 10 oder Windows 11 (64 Bit)
- ein aktueller Webbrowser
- für die Fernsteuerung von einem anderen Gerät: beide Geräte im selben lokalen
  Netzwerk beziehungsweise WLAN

Node.js, Angular und das .NET SDK werden **nicht** benötigt. Der Angular-Client ist
bereits fertig gebaut und im Installer enthalten. Auch die benötigte .NET-Laufzeit
wird mitgeliefert.

### Herunterladen

Alle fertigen Downloads befinden sich im
[aktuellen GitHub Release](https://github.com/YannikFroehlich/YFRemote.Server/releases/latest).

Es gibt zwei Installer:

| Datei                                                                                                                          | Verwendung                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| [`YFRemote-win-Setup.exe`](https://github.com/YannikFroehlich/YFRemote.Server/releases/latest/download/YFRemote-win-Setup.exe) | Schnelle Installation für den aktuellen Benutzer ohne Einrichtungsassistenten      |
| [`YFRemote-win.msi`](https://github.com/YannikFroehlich/YFRemote.Server/releases/latest/download/YFRemote-win.msi)             | Windows-Installationsassistent mit Auswahl von Installationsbereich und Zielordner |

Für eine normale Installation reicht `YFRemote-win-Setup.exe`. Wer den
Installationsort auswählen oder YFRemote systemweit installieren möchte, verwendet
`YFRemote-win.msi`.

### Installieren

1. Den gewünschten Installer aus dem aktuellen Release herunterladen.
2. Die heruntergeladene Datei öffnen.
3. Beim MSI bei Bedarf Installationsart und Zielordner auswählen.
4. Die Installation abschließen. YFRemote startet anschließend und erscheint unten
   rechts im Infobereich der Windows-Taskleiste.

Die Builds sind derzeit nicht mit einem kostenpflichtigen Code-Signing-Zertifikat
signiert. Windows kann deshalb `Unbekannter Herausgeber` oder eine
Microsoft-Defender-SmartScreen-Warnung anzeigen. Fahre nur fort, wenn die Datei aus
dem oben verlinkten offiziellen GitHub-Release stammt.

Standardpfade:

- One-Click-Setup: `%LOCALAPPDATA%\YFRemote`
- systemweite MSI-Installation: `C:\Program Files\YFRemote`
- tatsächliche Programmdatei: `<Installationsordner>\current\YFRemote.Server.exe`

Der Ordner `current` wird bei Updates automatisch ausgetauscht und sollte nicht
manuell verändert werden.

### Auf dem Windows-PC verwenden

YFRemote öffnet kein Terminalfenster. Nach dem Start läuft das Programm als
Tray-Symbol im Infobereich der Taskleiste. Falls das Symbol nicht sofort sichtbar
ist, auf den Pfeil für ausgeblendete Symbole klicken.

- Doppelklick auf das Tray-Symbol: Bedienoberfläche im Browser öffnen
- Rechtsklick: Status, Version, Geräteadresse und weitere Aktionen anzeigen
- `Im Browser öffnen`: Oberfläche auf dem Windows-PC öffnen
- `Geräteadresse kopieren`: Adresse für Smartphone oder Tablet kopieren
- `Mit Windows starten`: automatischen Start für den aktuellen Windows-Benutzer
  ein- oder ausschalten
- `Beenden`: Server und Tray-Anwendung vollständig schließen

Die lokale Oberfläche ist normalerweise unter folgender Adresse erreichbar:

```text
http://localhost:5050
```

YFRemote funktioniert nur, solange das Tray-Programm läuft.

### Mit Smartphone, Tablet oder anderem Computer verbinden

1. Sicherstellen, dass beide Geräte im selben WLAN beziehungsweise lokalen Netzwerk
   sind.
2. Auf dem Windows-PC mit der rechten Maustaste auf das YFRemote-Tray-Symbol klicken.
3. `Geräteadresse kopieren` auswählen.
4. Die angezeigte Adresse auf dem anderen Gerät im Browser öffnen, zum Beispiel:

```text
http://192.168.1.25:5050
```

Auf einem anderen Gerät darf nicht `localhost` verwendet werden, weil sich
`localhost` dort auf das andere Gerät selbst bezieht.

Beim ersten Start kann Windows nach einer Firewall-Freigabe fragen. Für den Zugriff
aus dem Heimnetz muss YFRemote für **private Netzwerke** zugelassen werden.

### Bedienung

Die Browseroberfläche bietet unter anderem:

- Navigationstasten und OK/Enter
- Zurück und Vollbild
- vorherigen, nächsten, geschlossenen oder wiederhergestellten Browser-Tab
- ein Touchpad mit Links- und Rechtsklick
- einstellbare Mausgeschwindigkeit

Einige Medientasten sind in der aktuellen Version noch deaktiviert und entsprechend
gekennzeichnet.

### Updates

YFRemote prüft kurz nach dem Start und danach alle sechs Stunden auf neue stabile
Versionen. Wenn ein Update verfügbar ist, steht im Tray-Menü beispielsweise:

```text
Neue Version v1.0.3 verfügbar - installieren
```

Nach einem Klick wird das Update heruntergeladen, YFRemote beendet, aktualisiert und
automatisch neu gestartet. Das funktioniert sowohl für EXE- als auch für
MSI-Installationen. Der gewählte Installationsordner bleibt erhalten.

### Deinstallieren

YFRemote kann über Windows deinstalliert werden:

```text
Einstellungen > Apps > Installierte Apps > YFRemote > Deinstallieren
```

### Fehlerbehebung

**Das Tray-Symbol fehlt**

- Im Bereich der ausgeblendeten Taskleistensymbole nachsehen.
- YFRemote über das Startmenü erneut starten.
- Es kann immer nur eine YFRemote-Instanz gleichzeitig laufen.

**Die Seite öffnet sich auf dem Smartphone nicht**

- Prüfen, ob beide Geräte im selben Netzwerk sind.
- Die Geräteadresse aus dem Tray verwenden, nicht `localhost`.
- In der Windows-Firewall den Zugriff für private Netzwerke erlauben.
- Prüfen, ob ein Gast-WLAN die Kommunikation zwischen Geräten blockiert.

**Port 5050 ist bereits belegt**

- Andere laufende YFRemote-Instanzen oder Anwendungen auf Port `5050` beenden.
- Entwickler können den Port in `appsettings.json` ändern.

**YFRemote startet nicht**

Startfehler werden hier protokolliert:

```text
%LOCALAPPDATA%\YFRemote\Logs\startup-error.log
```

## Sicherheit

YFRemote besitzt derzeit keine Benutzeranmeldung und keine Gerätefreigabe. Jeder,
der die Serveradresse im lokalen Netzwerk erreicht, kann Steuerbefehle senden.
Verwende YFRemote deshalb nur in einem vertrauenswürdigen privaten Netzwerk und
gib Port `5050` nicht im Router für das Internet frei.

## Für Entwickler

YFRemote besteht aus zwei öffentlichen Repositories:

- [`YFRemote.Client`](https://github.com/YannikFroehlich/YFRemote.Client): Angular-Oberfläche
- [`YFRemote.Server`](https://github.com/YannikFroehlich/YFRemote.Server): .NET-Server, Tray-App, Installer und Updates

### Entwicklungsumgebung

- Node.js 24 und npm
- .NET SDK 10
- Windows für Tray-App und Eingabesimulation

Server starten:

```powershell
dotnet restore
dotnet run
```

Der Entwicklungsstart verwendet ebenfalls das Tray. Velopack-Updates sind dabei
deaktiviert, weil sie nur aus einer installierten Version angewendet werden können.

Client testen und bauen:

```powershell
cd ..\..\client\YFRemote.Client
npm ci
npm test -- --watch=false
npm run build
```

Client in den Server integrieren und Windows-Build erstellen:

```powershell
cd ..\..\server\YFRemote.Server
New-Item -ItemType Directory -Path wwwroot -Force | Out-Null
Copy-Item ..\..\client\YFRemote.Client\dist\YFRemote.Client\browser\* wwwroot -Recurse -Force
dotnet publish -c Release -r win-x64 --self-contained true -o publish
```

Die Standardbindung steht in `appsettings.json`:

```json
{
  "Server": {
    "Host": "0.0.0.0",
    "Port": 5050
  }
}
```

Ein anderer Port kann beim Entwicklungsstart so gesetzt werden:

```powershell
dotnet run -- Server:Port=5060
```

### Endpunkte

```text
GET http://localhost:5050/health
ws://localhost:5050/ws
```

Beispielaktionen:

```json
{"type":"key","keys":["ENTER"]}
{"type":"hotkey","keys":["CTRL","TAB"]}
{"type":"mouseMove","deltaX":50,"deltaY":0}
{"type":"mouseClick","button":"left"}
{"type":"mouseScroll","delta":-120}
```

Die Tastatur- und Mausaktionen werden über `SendInput` aus `user32.dll` an die
interaktive Windows-Sitzung gesendet. Windows kann Eingaben in höher privilegierte
Programme blockieren, wenn YFRemote selbst nicht mit denselben Rechten läuft.

### Releases

Ein Tag im Server-Repository startet den GitHub-Actions-Workflow:

```powershell
git tag -a v1.0.3 -m "YFRemote v1.0.3"
git push origin v1.0.3
```

Der Workflow testet und baut den aktuellen Client, integriert ihn in den Server und
veröffentlicht EXE, MSI, portable ZIP-Datei sowie Velopack-Voll- und Delta-Pakete im
Server-Repository. Bei reinen Client-Änderungen muss der Client zuerst nach `master`
gemergt und erst danach der neue Server-Tag erstellt werden.

Weitere verbindliche Projekt- und Release-Hinweise stehen in [`AGENTS.md`](AGENTS.md).
