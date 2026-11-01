package com.yfremote.android.server

// Wie Services/RemoteActionSession.cs: Zustand einer /ws-Verbindung. mediaOnly gilt fuer die ganze
// Verbindung; systemStats schaltet der Client mit {"type":"systemStats","enabled"} um.
class RemoteActionSession(val mediaOnly: Boolean) {
    @Volatile
    var systemStats = false
}
