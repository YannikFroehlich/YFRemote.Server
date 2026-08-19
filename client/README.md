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
[`http://localhost:4200`](http://localhost:4200) erreichbar. Der Client verbindet
sich standardmäßig über WebSocket mit Port `5050` auf demselben Host, von dem die
Seite geladen wurde. In den Einstellungen kann eine andere Serveradresse eingetragen
werden.

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
