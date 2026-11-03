namespace YFRemote.Server.Models;

// Platform sagt dem Client, welche Aktionen die Gegenstelle ueberhaupt ausfuehren kann
// ("windows", "linux", "android") - der Remote-Tab blendet danach sein Layout um. Gamepad sagt,
// ob der Controller-Modus verfuegbar ist (nur Windows mit installiertem ViGEmBus-Treiber).
// MacAddress merkt sich die Android-App, um den PC spaeter per Wake-on-LAN zu wecken - im LAN ist
// sie ohnehin per ARP sichtbar, deshalb ohne Kopplung. MacAddressWireless: die Karte ist WLAN, dann
// klappt Wake-on-LAN meist nicht - die App weist darauf hin. Voicemeeter: installiert, der Client
// zeigt dann den Tab "Mixer". Name: der Rechnername, den die Android-App in "Steuern" statt der IP
// zeigt - im LAN ohnehin sichtbar (NetBIOS/mDNS). Screen: GET /screen gibt es, der Client zeigt
// dann den Tab "Bildschirm" - aeltere Server antworteten dort mit der Startseite. Audio: GET
// /screen/audio gibt es, der Tab zeigt dann den Schalter "Ton".
public sealed record HealthResponse(
    string Status,
    string Service,
    string Platform,
    bool Gamepad = false,
    string? MacAddress = null,
    bool MacAddressWireless = false,
    bool Voicemeeter = false,
    string? Name = null,
    bool Screen = false,
    bool Audio = false);
