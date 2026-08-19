# YFRemote.Server

YFRemote.Server ist die Windows-Tray-Anwendung fuer YFRemote. Sie stellt den gebauten Angular-Client, einen Health-Endpunkt und den WebSocket fuer Tastatur- und Mausaktionen im lokalen Netzwerk bereit.

## Installation

Ein GitHub Release enthaelt `YFRemote-win-Setup.exe`. Nach der Installation startet YFRemote ohne Konsolenfenster und bleibt im Infobereich der Windows-Taskleiste aktiv.

Das Tray-Menue bietet:

- installierte Version und Serverstatus
- die Adresse fuer andere Geraete im lokalen Netzwerk
- Oeffnen des Clients im Browser
- Kopieren der Geraeteadresse
- manuelle Updatesuche beziehungsweise Installation eines gefundenen Updates
- Beenden des Servers

Beim Start und danach alle sechs Stunden wird automatisch nach einem stabilen GitHub Release gesucht. Ein Update wird erst nach einem Klick im Tray-Menue heruntergeladen und installiert. Anschliessend startet YFRemote automatisch neu.

## Entwicklung

```powershell
dotnet run
```

Auch der Entwicklungsstart verwendet das Tray. Die Updatefunktion ist dabei deaktiviert, weil Velopack-Updates nur aus einer installierten Version heraus angewendet werden koennen.

Der Angular-Client wird fuer einen lokalen kombinierten Build zuerst im Client-Repository gebaut und danach nach `wwwroot` kopiert:

```powershell
cd ..\..\client\YFRemote.Client
npm ci
npm test -- --watch=false
npm run build

cd ..\..\server\YFRemote.Server
New-Item -ItemType Directory -Path wwwroot -Force
Copy-Item ..\..\client\YFRemote.Client\dist\YFRemote.Client\browser\* wwwroot -Recurse -Force
dotnet publish -c Release -r win-x64 --self-contained true -o publish
```

Standardbindung:

```text
http://0.0.0.0:5050
```

Host und Port stehen in `appsettings.json`:

```json
{
  "Server": {
    "Host": "0.0.0.0",
    "Port": 5050
  }
}
```

Per Kommandozeile kann der Port ueberschrieben werden:

```powershell
dotnet run -- Server:Port=5060
```

## Releases und Versionen

Der Workflow `.github/workflows/release.yml` wird durch einen Tag wie `v1.1.0` gestartet. Er:

1. checkt Server und Client aus,
2. testet und baut den Angular-Client,
3. integriert den Client in den Server,
4. veroeffentlicht den Server als selbststaendige Windows-x64-Anwendung,
5. erstellt Installer, Voll- und Delta-Updatepakete mit Velopack,
6. veroeffentlicht alle Dateien als GitHub Release.

Ein Release wird so angestossen:

```powershell
git tag v1.1.0
git push origin v1.1.0
```

Der Tag wird zur angezeigten und installierten Programmversion. Das Server-Repository muss fuer tokenfreie Updateabfragen oeffentlich erreichbar sein. Ist das Client-Repository privat, braucht das Server-Repository fuer den Workflow zusaetzlich ein Actions-Secret namens `CLIENT_REPOSITORY_TOKEN`, das Lesezugriff auf `YFRemote.Client` besitzt.

## Endpunkte

Health:

```text
GET http://localhost:5050/health
```

Antwort:

```json
{"status":"ok","service":"YFRemote.Server"}
```

WebSocket:

```text
ws://localhost:5050/ws
```

Von anderen Geraeten im lokalen Netzwerk wird statt `localhost` die IP-Adresse des Windows-PCs verwendet.

## Actions

Einzelne Taste:

```json
{"type":"key","keys":["SPACE"]}
```

Hotkey:

```json
{"type":"hotkey","keys":["CTRL","TAB"]}
```

Weitere Beispiele:

```json
{"type":"hotkey","keys":["CTRL","SHIFT","TAB"]}
{"type":"key","keys":["F11"]}
{"type":"key","keys":["ENTER"]}
```

Relative Mausbewegung:

```json
{"type":"mouseMove","deltaX":50,"deltaY":0}
```

`deltaX` bewegt die Maus nach rechts/links, `deltaY` nach unten/oben. Erlaubter Bereich pro Nachricht: `-5000` bis `5000`.

Mausklick:

```json
{"type":"mouseClick","button":"left"}
{"type":"mouseClick","button":"right"}
```

Scrollen:

```json
{"type":"mouseScroll","delta":120}
{"type":"mouseScroll","delta":-120}
```

Positives `delta` scrollt nach oben, negatives nach unten. Erlaubter Bereich pro Nachricht: `-1200` bis `1200`.

Erfolg:

```json
{"success":true}
```

Fehler:

```json
{"success":false,"error":"Unsupported key: TEST"}
```

Unterstuetzte Keys: `CTRL`, `SHIFT`, `ALT`, `WIN`, `ENTER`, `ESC`, `TAB`, `SPACE`, `BACKSPACE`, `DELETE`, `UP`, `DOWN`, `LEFT`, `RIGHT`, `F1` bis `F12`, `A` bis `Z`, `0` bis `9`.

## Testseite

Die Datei `test/websocket-test.html` kann direkt im Browser geoeffnet werden. Sie enthaelt Buttons fuer `CTRL+TAB`, `CTRL+SHIFT+TAB`, `SPACE`, `F11`, `ENTER`, Mausbewegungen, Links-/Rechtsklick und Scrollen sowie Status-, Sent- und Response-Ausgaben.

## Windows Input

Die Tastatur- und Mausaktionen werden ueber `SendInput` aus `user32.dll` gesendet. Das funktioniert in einer interaktiven Windows-Sitzung und wirkt auf das aktuell fokussierte Fenster beziehungsweise den aktuellen Mauszeiger. Windows kann Eingaben in hoeher privilegierte Anwendungen blockieren, zum Beispiel wenn der Server nicht als Administrator laeuft, das Zielprogramm aber schon.

Dieser MVP hat absichtlich keine Authentifizierung und ist fuer ein vertrauenswuerdiges lokales Netzwerk gedacht. Je nach Windows-Firewall muss Port `5050` fuer eingehende Verbindungen erlaubt werden.
