# YFRemote Client

Dies ist die Angular-Bedienoberfläche von YFRemote. Sie wird beim Release fertig
gebaut und direkt in die Windows-Serveranwendung integriert.

## YFRemote installieren und verwenden

Endnutzer müssen dieses Repository nicht herunterladen und benötigen weder Node.js
noch Angular. Die fertige Anwendung inklusive Client befindet sich im
[`YFRemote.Server`-Release](https://github.com/YannikFroehlich/YFRemote.Server/releases/latest).

Direkte Downloads:

- [`YFRemote-win-Setup.exe`](https://github.com/YannikFroehlich/YFRemote.Server/releases/latest/download/YFRemote-win-Setup.exe) – schnelle One-Click-Installation
- [`YFRemote-win.msi`](https://github.com/YannikFroehlich/YFRemote.Server/releases/latest/download/YFRemote-win.msi) – Installationsassistent mit auswählbarem Installationsort

Die vollständige Anleitung für Installation, Tray-Menü, Verbindung per Smartphone,
Updates und Fehlerbehebung steht im
[`YFRemote.Server`-README](https://github.com/YannikFroehlich/YFRemote.Server#readme).

## Entwicklung

### Voraussetzungen

- Node.js 24
- npm
- ein laufender `YFRemote.Server` auf Port `5050`, wenn die Fernsteuerung getestet
  werden soll

Abhängigkeiten installieren:

```powershell
npm ci
```

Entwicklungsserver starten:

```powershell
npm start
```

Die Oberfläche ist anschließend unter
[`http://localhost:4200`](http://localhost:4200) erreichbar. Der Development-Server
leitet Pairing-, Health- und WebSocket-Anfragen an den lokalen YFRemote-Server auf
Port `5050` weiter.

In Produktions-Builds verwendet der Client immer exakt die HTTP(S)-Origin, von der
die Seite geladen wurde, und wählt passend dazu `ws://` oder `wss://`. Wird in den
Einstellungen eine andere Serveradresse eingetragen, navigiert der Browser vollständig
zu dieser Adresse, damit Pairing und Fernsteuerung weiterhin Same-Origin bleiben.
Mehrschrittige Makros warten nach jeder Aktion auf die Bestätigung des Servers und
brechen bei einer abgelehnten oder nicht bestätigten Aktion ab.

Unter Einstellungen kann das aktuelle Gerät dauerhaft entkoppelt werden; dabei wird
sein Token zuerst auf dem Server widerrufen und anschließend lokal entfernt. Eigene
Buttons, Makros und Anordnungen werden in benannten Layoutprofilen gespeichert. Alle
Profile lassen sich als JSON-Datei exportieren und auf einem anderen Gerät importieren.

### Tests

```powershell
npm test -- --watch=false
```

### Produktions-Build

```powershell
npm run build
```

Die fertigen Dateien liegen danach unter:

```text
dist/YFRemote.Client/browser
```

Beim offiziellen Release kopiert der Workflow des Server-Repositories diese Dateien
automatisch nach `YFRemote.Server/wwwroot`. Installierbare Releases werden deshalb
ausschließlich im Server-Repository veröffentlicht.

Weitere Projekt- und Release-Hinweise stehen in [`AGENTS.md`](AGENTS.md).
