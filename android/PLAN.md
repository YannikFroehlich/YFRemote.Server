# YFRemote Android-Server — Gesamtplan

Ziel: eine APK, die YFRemote.Server-Funktionalität auf einem Android-Gerät nachbildet, sodass ein
zweites Gerät dieselbe Angular-Oberfläche öffnet und das Android-Gerät fernsteuert — dasselbe
Produktprinzip wie [Linux support](../AGENTS.md#linux-support) (Server läuft *auf* dem Zielgerät),
aber für eine Plattform ohne root-freie Rohtasteninjektion.

Getroffene Grundsatzentscheidungen (siehe [`AGENTS.md`](../AGENTS.md#android-support)),
hier nicht erneut zur Diskussion:

1. **Sichtbares Gerät, kein Screen-Mirroring.** Reine Fernbedienung wie unter Windows/Linux.
2. **Natives Kotlin + Ktor**, kein .NET — `Microsoft.AspNetCore.App` hat kein Runtime-Pack für
   `android-arm64`/`android-x64` (`dotnet/aspnetcore#35077`, `#60259`).
3. **`AccessibilityService` + eigene `InputMethodService`**, kein Root/Shizuku.

Dieses Dokument ist der ausführbare Fahrplan dafür — [`STAGE0.md`](STAGE0.md) ist der erste
Baustein davon und bleibt eigenständig nutzbar (kopierfertig für eine frische Maschine). Für die
Stufen 1–5 unten gilt derselbe Anspruch: wer diesem Dokument folgt, kann jede Stufe unabhängig
bauen und mit einem konkreten Schritt beweisen, dass sie funktioniert, bevor die nächste beginnt.

---

## Architekturüberblick

```
┌─────────────────────────── YFRemote-Android.apk ───────────────────────────┐
│                                                                              │
│  SetupActivity ──(steuert)──> ForegroundService ──(hostet)──> Ktor-Server   │
│  (PIN, Geräte,                       │                         │           │
│   Freigabe-Links)                    │                         ├─ /health  │
│                                       │                         ├─ /pair*  │
│                                       ▼                         ├─ /ws     │
│                          hält Prozess am Leben         ├─ /files  │
│                          (Notification)                         └─ /clipboard/* │
│                                                                    │           │
│                     ┌──────────────────────────────────────────────┘           │
│                     ▼                                                          │
│         RemoteActionRouter (parst JSON, dispatcht wie RemoteActionHandler.cs)  │
│                     │                                                          │
│        ┌────────────┼────────────────┬─────────────────┐                      │
│        ▼            ▼                ▼                 ▼                      │
│  AccessibilityBridge │  ImeBridge  PowerBridge    Clipboard/FileBridge         │
│  (Gesten, Cursor-     │  (Text/Key)  (Lock/Fail)   (ClipboardManager,          │
│   Overlay, Home/       │                            MediaStore)                │
│   Back/Recents)        │                                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

Der Angular-Client bleibt **unverändert** und wird same-origin aus dem Ktor-Server ausgeliefert
(er leitet seine URLs aus `location.origin` ab, siehe `client/src/app/remote/server-config.ts`).
Der Trick für relative Mausdeltas ohne Client-Änderung: Android kennt keinen Systemcursor, also
führt der Server selbst Buch über eine virtuelle Cursorposition und zeigt sie per
`TYPE_ACCESSIBILITY_OVERLAY`-Fenster an.

---

## Protokoll-Kompatibilität

Jede Aktion muss exakt das JSON-Schema von `RemoteActionRequest`/`RemoteActionResponse`
(`Models/RemoteActionRequest.cs`, `Models/RemoteActionResponse.cs`) sprechen — camelCase durch
`JsonSerializerDefaults.Web`, also `requestId`/`deltaX`/`deltaY` usw. Kotlin-Property-Namen in
camelCase matchen das ohne `@SerialName`.

| Client-Aktion | Android-Umsetzung | Einschränkung |
|---|---|---|
| `text` | IME `commitText` | nur bei fokussiertem Feld + aktiver YFRemote-Tastatur |
| `key` (Buchstaben, Enter, Backspace, Pfeile) | IME `sendKeyEvent` | dito |
| `key` (Volume) | `AudioManager.adjustStreamVolume` | funktioniert immer, auch ohne Fokus |
| `hotkey` Ctrl+A/C/X/V/Z | `InputConnection.performContextMenuAction(android.R.id.selectAll/copy/cut/paste)` + eigene Undo-Heuristik | zuverlässig **nur** für diese fünf, nicht generisch |
| `hotkey` (sonstige Kombinationen) | best-effort `sendKeyEvent` mit Meta-State | **praktisch unzuverlässig**, klar so kommunizieren |
| `mouseMove` (relativ) | virtueller Cursor + Overlay | Android hat keinen Systemcursor |
| `mouseClick left` | `dispatchGesture` Tap an Cursorposition | |
| `mouseClick right` | `dispatchGesture` Long-Press | Konvention, keine Android-Entsprechung zu "Rechtsklick" |
| `mouseClick middle` | — | keine sinnvolle Android-Entsprechung → `Fail` mit Erklärung |
| `mouseDown`/`mouseUp` | Gesture-Stroke mit `willContinue`/`continueStroke` | ab API 26 |
| `mouseScroll` | synthetisierte Swipe-Gesture | kein echtes Scroll-Delta, grobkörniger als unter Windows |
| `sleep` | `performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN)` | Sperrbildschirm, kein Standby; ab API 28 |
| `shutdown`/`restart` | — | **unmöglich ohne Root** → `Fail("Auf Android ohne Root nicht möglich.")` |
| `/files` | `MediaStore`/Downloads | Sanitizing wie `FileTransferService.SanitizeFileName` (Zeilen 45–63) nachbauen |
| Clipboard Text | `ClipboardManager.setPrimaryClip` | ab Android 10 nur mit Fokus/als aktive IME lesbar |
| Clipboard Bild | `ClipboardManager` + `FileProvider`-`content://`-URI | Android verlangt eine URI, kein roher Byte-Stream wie unter Windows |

---

## Projektstruktur (Endzustand nach Stufe 5)

```
android/
  STAGE0.md, PLAN.md            (dieses Verzeichnis, Dokumentation)
  settings.gradle.kts
  build.gradle.kts
  gradle.properties
  app/
    build.gradle.kts
    src/main/
      AndroidManifest.xml
      assets/www/                       ← Angular-Production-Build (Stufe 1, nicht eingecheckt)
      java/com/yfremote/android/
        MainActivity.kt (bzw. SetupActivity.kt ab Stufe 5)
        service/
          YFRemoteForegroundService.kt   (Stufe 5)
        server/
          KtorServer.kt                  (Stufe 1)
          PairingRepository.kt           (Stufe 1)
          RemoteActionRouter.kt          (Stufe 1, ab Stufe 2 mit echten Handlern)
          models/ (RemoteActionRequest.kt, RemoteActionResponse.kt, PairRequest.kt, ...)
        accessibility/
          YFRemoteAccessibilityService.kt (Stufe 0 → erweitert in Stufe 2/4)
          VirtualCursorOverlay.kt         (Stufe 2)
        ime/
          YFRemoteInputMethodService.kt   (Stufe 3)
          KeyEventMap.kt                  (Stufe 3, spiegelt keyboard-keys.ts)
      res/...
```

Ab Stufe 1 verlässt das Projekt die Nur-Plattform-SDK-Beschränkung aus Stufe 0: Ktor,
`kotlinx.serialization` und `kotlinx.coroutines` kommen als Abhängigkeiten dazu (jeweils offizielle
JetBrains-Bibliotheken, keine Fremdpakete).

---

## Stufenplan

### Stufe 0 — Beweis: Gesten-Injection funktioniert
Bereits fertig dokumentiert in [`STAGE0.md`](STAGE0.md). Nackte `AccessibilityService`, ein Knopf
tippt in die Bildschirmmitte, eine `TextView` in derselben App bestätigt sichtbar den Empfang.

### Stufe 1 — Server-Grundgerüst
**Ziel:** Pairing und `/ws`-Verbindung funktionieren komplett, jede Aktion antwortet bewusst mit
`Fail`. Beweist den Protokoll-Rundlauf, bevor irgendeine echte Gerätesteuerung entsteht.

**Aufgaben:**
- Ktor mit Netty-Engine im Prozess starten (`embeddedServer(Netty, port = 5050) { ... }`),
  Startport konfigurierbar, Standard `0.0.0.0:5050` wie `ServerOptions` (`Configuration/ServerOptions.cs`).
- Angular-Production-Build (`client/dist/YFRemote.Client/browser/*`) nach `app/src/main/assets/www/`
  kopieren — manuell für die ersten Stufen, als Gradle-Task automatisiert erst in Stufe 5 (siehe
  dort). Statisches Ausliefern mit SPA-Fallback auf `index.html` (Ktor `staticFiles` +
  `intercept`/`default` für unbekannte Pfade), analog zu `app.UseStaticFiles()` +
  `app.MapFallbackToFile("index.html")` in `Program.BuildApplication`.
- `GET /health` → `{"status":"ok","service":"YFRemote.Android"}`.
- `PairingRepository`: 6-stellige PIN (`RandomNumberGenerator`-Äquivalent: `SecureRandom`),
  10-Minuten-Lebensdauer, SHA-256-gehashte Device-Tokens, Geräteliste als JSON in
  `applicationContext.filesDir/devices.json` (App-privater Speicher, kein
  `MANAGE_EXTERNAL_STORAGE` nötig), atomarer Schreibvorgang (Temp-Datei + `File.renameTo` — auf
  demselben Dateisystem atomar, Android-Äquivalent zu `PairingService.PersistDevicesAtomically`).
  PIN rotiert erst nach erfolgreich gespeichertem Pairing (`PairingService.cs:118-121`
  nachbilden). 5 Fehlversuche pro IP → 60s Sperre, in-memory (`PairingService.cs:245-272`).
- Endpunkte: `POST /pair` (Request-Body `{pin, deviceName}` → `PairRequest`), `GET /pair/status`,
  `DELETE /pair` (Bearer-Token). Fehlermeldungen auf Deutsch, wie im .NET-Server.
- Origin-Check wie `RequestGuards.IsAllowedOrigin` (`Endpoints/RequestGuards.cs`) für `/ws` und
  die schreibenden Endpunkte.
- `/ws`: Origin-Check, dann `?token=`-Check gegen `PairingRepository`, dann Ktor-WebSocket-Session,
  die Text-Frames bis 16 KB liest (`YFRemoteWebSocketHandler.cs:17`), als `RemoteActionRequest`
  parst, an `RemoteActionRouter` gibt (jeder Zweig → `RemoteActionResponse.Fail("Not implemented yet.")`,
  `requestId` wird trotzdem durchgereicht), und mit demselben Fixed-Window-Rate-Limit (120
  Nachrichten/Sekunde, `YFRemoteWebSocketHandler.cs:188-205`) schützt.
- PIN-Anzeige: mangels Tray reicht für diese Stufe Logcat (`Log.i`) — die echte UI kommt in Stufe 5.

**Beweis:** Zweites Gerät ruft `http://<Android-IP>:5050/` auf, sieht die Angular-Oberfläche,
koppelt sich mit der in Logcat sichtbaren PIN, WebSocket verbindet. Eine beliebige Aktion (z. B.
Touchpad-Wischen) kommt als sauberes `{success:false, error:"Not implemented yet."}` zurück statt
Verbindungsabbruch, Timeout oder falschem JSON.

### Stufe 2 — Zeigen (virtueller Cursor)
**Ziel:** `mouseMove`/`mouseClick`/`mouseDown`/`mouseUp`/`mouseScroll` funktionieren echt.

**Aufgaben:**
- `YFRemoteAccessibilityService` aus Stufe 0 erweitern: `canPerformGestures` bleibt, zusätzlich
  Konfiguration für Overlay-Fenster.
- `VirtualCursorOverlay`: `WindowManager`-Fenster vom Typ `TYPE_ACCESSIBILITY_OVERLAY` (kein
  `SYSTEM_ALERT_WINDOW` nötig, da von einer `AccessibilityService` aus erzeugt), zeigt einen
  kleinen Cursor-Marker; Position wird bei jedem `mouseMove` aktualisiert und an die Bildschirmränder
  geklemmt.
- `mouseMove`: `deltaX`/`deltaY` im selben Bereich validieren wie der .NET-Server
  (`RemoteActionHandler.cs:11-14`, ±5000), Cursorposition aktualisieren, **kein** Gesture-Dispatch
  (reine Sichtbarkeit).
- `mouseClick left/right`: `dispatchGesture` an aktueller Cursorposition — `left` ein kurzer Tap
  (Stroke-Dauer wie in Stufe 0), `right` ein Long-Press (Stroke-Dauer ~600ms). `middle` liefert
  `Fail` mit Erklärung (keine Android-Entsprechung).
- `mouseDown`/`mouseUp`: `GestureDescription.StrokeDescription` mit `willContinue = true` bei
  `mouseDown` beginnen, bei jedem nachfolgenden `mouseMove` per `continueStroke` fortsetzen, bei
  `mouseUp` mit `willContinue = false` beenden — ergibt einen echten Drag.
- `mouseScroll`: synthetisierte kurze Swipe-Gesture ausgehend von der Cursorposition, Richtung/Länge
  aus `delta`/`deltaX` abgeleitet, gleiche Wertebereichsprüfung wie
  `RemoteActionHandler.cs:13-14` (±1200).

**Beweis:** Touchpad-Bereich der Angular-Oberfläche auf dem zweiten Gerät bewegt sichtbar den
Cursor-Marker auf dem Android-Bildschirm; ein Tap dort klickt tatsächlich, was unter dem Cursor
liegt; Drag funktioniert (z. B. eine App-Liste scrollen per Drag statt Swipe-Aktion).

### Stufe 3 — Tippen (IME)
**Ziel:** `text` und `key` funktionieren in einem fokussierten Textfeld.

**Aufgaben:**
- `YFRemoteInputMethodService : InputMethodService`, in `AndroidManifest.xml` mit
  `BIND_INPUT_METHOD`-Permission deklariert, `res/xml/method.xml` als Meta-Data. Muss vom Nutzer
  einmalig in den System-Einstellungen aktiviert **und** als aktive Tastatur ausgewählt werden —
  Android erlaubt nur eine aktive IME gleichzeitig, das verdrängt währenddessen Gboard & Co. Das
  ist eine echte UX-Einschränkung, kein Bug — in der Setup-UI (Stufe 5) klar kommunizieren.
- `KeyEventMap.kt`: bildet dieselbe Schlüsselmenge wie `client/src/app/remote/keyboard-keys.ts`
  (`SUPPORTED_KEYS`, Zeilen 8–39: Modifier, Navigation, F1–F12, A–Z, 0–9) auf
  `android.view.KeyEvent`-Konstanten ab — analog zu `WindowsInputService.VirtualKeys` und
  `LinuxInputService`'s `KEY_*`-Mapping.
- `text` → `InputConnection.commitText`.
- `key` → `InputConnection.sendKeyEvent` (Down+Up) für Navigations-/Buchstabentasten; Lautstärke-
  Tasten stattdessen über `AudioManager`, damit sie auch ohne Fokus funktionieren.
- `hotkey`: Sonderfälle **Ctrl+A/C/X/V/Z** direkt über
  `InputConnection.performContextMenuAction(android.R.id.selectAll/copy/cut/paste)` bzw. `Undo`
  auflösen — das funktioniert zuverlässig in praktisch jedem Textfeld, anders als rohes
  Key-Event-Passthrough. Alle anderen Hotkey-Kombinationen bleiben best-effort
  `sendKeyEvent`-Meta-State-Versuche mit klar dokumentierter Unzuverlässigkeit (siehe
  Protokoll-Tabelle oben) — kein Versuch, das zu "reparieren", das ist eine Plattformgrenze.

**Beweis:** Vom zweiten Gerät aus Text in ein fokussiertes Android-Textfeld tippen (inkl.
Sonderzeichen/Enter/Backspace); Strg+C in einem Textfeld kopiert tatsächlich in die
Zwischenablage.

### Stufe 4 — Rest der Aktionen
**Ziel:** Navigation, Sleep, Dateien, Zwischenablage; `shutdown`/`restart` liefern eine klare
Fehlermeldung statt eines stillen No-Ops.

**Aufgaben:**
- `sleep` → `performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN)`.
- `shutdown`/`restart` → `RemoteActionResponse(success = false, error = "Auf Android ohne Root nicht möglich.")`.
- **Entschieden:** Home/Back/Recents haben keine Windows-Entsprechung im heutigen Protokoll —
  bestehende, unter Android sonst nutzlose Windows-Tasten werden pragmatisch umgewidmet:
  `WIN`→Home, `ESC`→Back, `TAB`+`WIN`→Recents. Keine Client-Änderung nötig.
- `/files`: Multipart-Empfang wie `Endpoints/FileEndpoints.cs`, Ablage über `MediaStore.Downloads` (Android
  10+, scoped storage) statt direktem Dateisystempfad. Dieselbe Sanitizing-Logik wie
  `FileTransferService.SanitizeFileName` (Zeilen 45–63: auf letzten `/`/`\` abschneiden, ungültige
  Zeichen ersetzen) nachbauen — die dort behobene Pfad-Traversal-Lücke (Commit `c2f5d82`) gilt hier
  genauso. Limit wie `FileTransferOptions.MaxFileSizeBytes` (Default 200 MB).
- Clipboard Text: `ClipboardManager.setPrimaryClip`, Limit wie `ClipboardOptions.MaxTextLength`
  (Default 200.000 Zeichen).
- Clipboard Bild: Bytes zunächst in eine App-private Datei schreiben, per `FileProvider` eine
  `content://`-URI erzeugen, darüber `ClipData.newUri` setzen — Android verlangt eine URI statt
  eines rohen Streams wie unter Windows. Limit wie `ClipboardOptions.MaxImageSizeBytes` (Default 20 MB).
  Ab Android 10 sind Zwischenablage-Zugriffe auf die fokussierte App/aktive IME beschränkt — bei
  Fehlschlag klare Fehlermeldung statt stillem Fail.

**Beweis:** Für jede Aktion ein manueller Einzeltest; `shutdown` vom Client aus liefert eine
sichtbare deutsche Fehlermeldung statt Timeout.

### Stufe 5 — Paketieren
**Ziel:** Aus dem Funktionsprototyp eine installierbare, alleinstehende App machen.

**Aufgaben:**
- `YFRemoteForegroundService`: hält den Prozess am Leben (Android beendet sonst
  Hintergrundprozesse), persistente Notification mit Start/Stopp und PIN-Kurzanzeige.
- `SetupActivity` ersetzt `MainActivity`: Geräteadresse (LAN-IPv4 ermitteln, Android-Äquivalent zu
  `NetworkAddressService`), PIN + "Neu erzeugen", Liste gekoppelter Geräte mit Entkoppeln-Aktion,
  je ein Link zu `Settings.ACTION_ACCESSIBILITY_SETTINGS` und `Settings.ACTION_INPUT_METHOD_SETTINGS`
  (die zwei Berechtigungen, die der Nutzer manuell erteilen muss), Start/Stopp-Schalter für den
  Service.
- Gradle-Task, der `client/dist/YFRemote.Client/browser/*` automatisch nach
  `app/src/main/assets/www/` kopiert (bisher manuell, siehe Stufe 1) — Äquivalent zum
  `Copy-Item`-Schritt in der Root-`CLAUDE.md`.
- `DefaultItemExcludes` in `YFRemote.Server.csproj:23` um `;android\**` erweitern — sonst zieht das
  Web-SDK den Gradle-Baum in den `.NET`-Publish-Output, derselbe Fehlermodus, für den `client\**`
  schon ausgeschlossen ist.
- Release-Signing: Keystore einmalig erzeugen, base64-kodiert in GitHub Secrets ablegen, **bevor**
  der erste Release-Build läuft — ein release-signiertes APK kann ein debug-signiertes auf einem
  Gerät nicht ersetzen, ohne es vorher zu deinstallieren.
- Neuer CI-Job (nicht `build-and-test` nennen — das ist der required Status Check auf `main`, siehe
  "Release automation" in `AGENTS.md`), der auf `ubuntu-latest` (JDK + Android-SDK per
  `actions/setup-java` + `android-actions/setup-android` vorinstallierbar) `./gradlew
  assembleRelease` baut, signiert, und — analog zum `release-linux`-Job, der das vom
  Windows-Job hochgeladene `wwwroot`-Artefakt wiederverwendet — dasselbe Artefakt für
  `assets/www/` herunterlädt statt `npm` erneut laufen zu lassen. APK als zusätzliches Asset am
  selben GitHub Release anhängen.
- **Entschieden:** Ein Android-Release ist Teil des bestehenden `auto-tag.yml`/`release.yml`-Flusses
  — gleiche Versionsnummer wie Server/Client, ein Commit löst ein Release für alle drei aus,
  konsistent zu "ein Client-Only-Change released wie ein Server-Change" (siehe `CLAUDE.md`).

**Beweis:** APK aus dem Release-Workflow heruntergeladen, auf einem frischen Gerät installiert,
beide Berechtigungen über die Setup-UI erteilt, Ende-zu-Ende-Test aus Stufe 1–4 wiederholt — ohne
manuellen `adb`/Android-Studio-Schritt.

---

## Querschnittsthemen

- **Sicherheit:** dieselben Grundsätze wie beim .NET-Server — Origin-Check vor jedem schreibenden
  Endpunkt, Pairing-Token vor jedem `/ws`, gehashte Tokens, keine Aktion ohne gültiges Pairing.
  Keine Abkürzung nur weil es "nur ein Prototyp" ist, da ab Stufe 1 echte Netzwerk-Endpunkte offen
  sind.
- **Persistenz:** App-privater Speicher (`filesDir`) reicht für Geräte-/Pairing-Daten; kein
  Backup-Mechanismus wie `devices.json.bak` nötig in den ersten Stufen (kann in Stufe 5
  nachgezogen werden, falls gewünscht — bislang keine Anforderung dafür).
- **Threading:** Ktor-Routen laufen auf Coroutine-Dispatchern, nicht auf dem Main-Thread; Aufrufe
  in `AccessibilityBridge`/`ImeBridge` müssen auf den Main-Thread zurückwechseln (Android-UI-/
  Service-APIs sind nicht thread-safe) — `withContext(Dispatchers.Main)` an der Grenze zwischen
  Router und Bridge.
- **Testing:** kein Android-Emulator für `AccessibilityService`/IME-Verhalten (siehe Stufe 0) — jede
  Stufe braucht einen Beweis auf echter Hardware. Reine Protokoll-/Parsing-Logik (JSON-Modelle,
  `PairingRepository`, `KeyEventMap`) lässt sich unit-testen (JVM-Tests ohne Android-Gerät).

## Entscheidungen (getroffen)

1. Home/Back/Recents-Tastenzuordnung (Stufe 4): bestehende Windows-Tasten umgewidmet
   (`WIN`→Home, `ESC`→Back, `TAB`+`WIN`→Recents), keine Protokoll-/Client-Änderung.
2. Android-Release (Stufe 5): Teil des bestehenden `auto-tag.yml`-Flusses, kein eigener
   Versionsstand.

## Nächster Schritt

Stufe 0 ist dokumentiert und bereit zum Ausführen (`STAGE0.md`). Stufen 1–5 sind implementiert
(siehe restliche Dateien in diesem Verzeichnis).

**Auf echtem Gerät verifiziert** (Samsung SM-S938B, 2026-09-22, Debug-Build via `adb`):
`/health`, `/` (Angular-Client aus APK-Assets inkl. SPA-Fallback), `POST /pair` mit echter PIN
inkl. Token-Rotation und Ablauf nach 10 Minuten, `GET /pair/status`, `DELETE /pair` (schliesst die
offene `/ws`-Verbindung zwangsweise, Client faellt sauber auf die Pairing-Gate zurueck),
Origin-Check (echter Browser), `/ws`-Verbindungsaufbau + stabile Verbindung bei `Fail`-Antworten,
`AccessibilityService`-Bindung, `VirtualCursorOverlay` folgt echten Touchpad-Drags sichtbar auf dem
Bildschirm, Tap-Geste ohne Absturz, `PairingRepository`-Persistenz ueber App-Neustart,
IME-Texteingabe in einer echten Fremd-App (Chrome-Adressleiste, Zeichen kamen exakt an),
Home/Back/Recents-Umwidmung (`WIN`/`ESC`/`TAB`+`WIN`, jeweils per `dumpsys activity`/Screenshot
bestaetigt), `POST /clipboard/text` (Text kam per System-Paste exakt in einem Fremd-Textfeld an).
Dabei drei echte Kompilierfehler gefunden und gefixt (Ktor-2.3.12-API wich an drei Stellen von der
Annahme beim Schreiben ab: `PartData.FileItem.provider()` statt `streamProvider()`, fehlender
`defaultForFilePath`-Import, `queryParameters` faelschlich importiert) sowie ein
Netty-`META-INF/INDEX.LIST`-Packaging-Konflikt.

**Noch nicht verifiziert:** `POST /files`, `POST /clipboard/image`, `sleep`, `mouseScroll`,
`mouseDown`/`mouseUp`-Drag mit `continueStroke`, der signierte Release-Build
(`release-android`-CI-Job, siehe Stufe 5).
