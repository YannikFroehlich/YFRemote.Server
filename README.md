# YFRemote

YFRemote verwandelt ein Smartphone, Tablet oder einen zweiten Computer in eine
Fernbedienung für einen Windows-PC. Die Anwendung läuft unauffällig im Infobereich
der Taskleiste und stellt die Bedienoberfläche im lokalen Netzwerk über den Browser
bereit.

Ausführliche Anleitungen stehen im [Wiki](https://github.com/YannikFroehlich/YFRemote.Server/wiki):

- [Installation](https://github.com/YannikFroehlich/YFRemote.Server/wiki/Installation) — Voraussetzungen, Download, Installationsschritte, Deinstallieren
- [Verwendung](https://github.com/YannikFroehlich/YFRemote.Server/wiki/Verwendung) — Bedienung, Verbindung herstellen, Updates
- [Fehlerbehebung](https://github.com/YannikFroehlich/YFRemote.Server/wiki/Fehlerbehebung) — Lösungen für häufige Probleme

Alle fertigen Downloads befinden sich im
[aktuellen GitHub Release](https://github.com/YannikFroehlich/YFRemote.Server/releases/latest).

## Sicherheit

YFRemote besitzt derzeit keine Benutzeranmeldung und keine Gerätefreigabe. Jeder,
der die Serveradresse im lokalen Netzwerk erreicht, kann Steuerbefehle senden.
Verwende YFRemote deshalb nur in einem vertrauenswürdigen privaten Netzwerk und
gib Port `5050` nicht im Router für das Internet frei. Details siehe
[Sicherheit](https://github.com/YannikFroehlich/YFRemote.Server/wiki/Sicherheit) im Wiki.

## Für Entwickler

YFRemote besteht aus zwei öffentlichen Repositories:

- [`YFRemote.Client`](https://github.com/YannikFroehlich/YFRemote.Client): Angular-Oberfläche
- [`YFRemote.Server`](https://github.com/YannikFroehlich/YFRemote.Server): .NET-Server, Tray-App, Installer und Updates

Server starten:

```powershell
dotnet restore
dotnet run
```

Details zu Entwicklungsumgebung, Client-Integration und Endpunkten stehen im Wiki
unter [Entwicklung](https://github.com/YannikFroehlich/YFRemote.Server/wiki/Entwicklung).
Zum Release-Prozess siehe [Release-Prozess](https://github.com/YannikFroehlich/YFRemote.Server/wiki/Release-Prozess)
im Wiki sowie [`AGENTS.md`](AGENTS.md).
