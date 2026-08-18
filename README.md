# YFRemote.Server

YFRemote.Server ist der erste MVP eines lokalen Windows-Servers fuer Tastatur- und Mausaktionen im Netzwerk. Er laeuft aktuell als Konsolenanwendung, stellt einen Health-Endpunkt bereit und nimmt JSON-Actions per WebSocket entgegen.

## Start

```powershell
dotnet run
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
