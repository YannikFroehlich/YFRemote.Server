# Stufe 0: Beweis, dass Gesten-Injection funktioniert

Ziel dieser Stufe (siehe [`AGENTS.md`](../AGENTS.md#android-support-planned-not-yet-implemented),
Abschnitt "Android support"): eine nackte Kotlin-App mit `AccessibilityService`, die per Knopfdruck
einen synthetischen Tipp auslöst — und ein zweites Element in derselben App, das diesen Tipp
sichtbar empfängt. Kein Server, kein Netzwerk, keine IME, nichts von YFRemote selbst — nur der
Beweis, dass `dispatchGesture` auf dem echten Zielgerät ankommt, bevor irgendetwas Größeres darauf
aufgebaut wird.

**Warum die App sich selbst antippt statt eine andere App:** So ist der Test in sich geschlossen
und eindeutig beobachtbar (Zähler hochzählen + Hintergrundfarbe wechseln), ohne zu raten, ob ein
Symbol auf dem Homescreen getroffen wurde.

**Warum kein Emulator:** `AccessibilityService`-Verhalten (insbesondere `dispatchGesture`) ist auf
Emulatoren nicht durchgehend zuverlässig — siehe AGENTS.md. Diese Stufe zählt nur auf einem echten
Gerät als bewiesen.

---

## 1. Voraussetzungen installieren

**Empfohlen: Android Studio** (bündelt JDK, Android SDK, `adb`, Emulator-Tooling, Gradle):

1. [developer.android.com/studio](https://developer.android.com/studio) herunterladen, installieren.
2. Beim ersten Start den Standard-Setup-Assistenten durchlaufen (installiert automatisch ein
   aktuelles SDK-Platform-Paket, `platform-tools` inkl. `adb`, und eine passende Build-Tools-Version).
3. Kein manueller Gradle-Install nötig: Android Studio erzeugt beim ersten Öffnen eines Projekts
   ohne vorhandenen `gradlew`-Wrapper diesen automatisch bzw. nutzt sein eingebautes Gradle.

**Alternative (ohne Android Studio, nur Kommandozeile):** JDK 17 (z. B. Eclipse Temurin), die
[Android-Kommandozeilen-Tools](https://developer.android.com/studio#command-tools) (`sdkmanager`,
`platform-tools`), und ein lokal installiertes Gradle (oder `gradle wrapper` einmal mit einer
System-Gradle-Installation ausführen, um `gradlew`/`gradlew.bat` zu erzeugen). Deutlich mehr manuelle
Schritte — nur nehmen, wenn Android Studio explizit nicht gewünscht ist.

**Testgerät vorbereiten** (physisches Android-Gerät, kein Emulator):

1. Einstellungen → Über das Telefon → 7× auf "Build-Nummer" tippen → Entwickleroptionen freigeschaltet.
2. Einstellungen → Entwickleroptionen → "USB-Debugging" aktivieren.
3. Gerät per USB anschließen, Verbindung am Gerät bestätigen ("Debugging zulassen?").
4. Prüfen: `adb devices` zeigt das Gerät als `device` (nicht `unauthorized`).

---

## 2. Projekt anlegen

Ordnerstruktur unter einem neuen `android/`-Verzeichnis (im Repo neben `client/`, sobald das hier
committet wird):

```
android/
  settings.gradle.kts
  build.gradle.kts
  gradle.properties
  app/
    build.gradle.kts
    src/main/
      AndroidManifest.xml
      java/com/yfremote/stage0/MainActivity.kt
      java/com/yfremote/stage0/TapAccessibilityService.kt
      res/values/strings.xml
      res/xml/accessibility_service_config.xml
```

Lege jede Datei mit exakt diesem Inhalt an:

### `settings.gradle.kts`

```kotlin
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "YFRemoteAndroidStage0"
include(":app")
```

### `build.gradle.kts` (Root)

```kotlin
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}
```

> Falls Android Studio beim Sync eine neuere Android-Gradle-Plugin- oder Kotlin-Version vorschlägt
> ("Upgrade Assistant"): annehmen. Diese Versionsnummern sind nur ein bekannter Startpunkt, kein
> hartes Muss.

### `gradle.properties`

```properties
org.gradle.jvmargs=-Xmx2048m
android.useAndroidX=false
```

### `app/build.gradle.kts`

```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.yfremote.stage0"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.yfremote.stage0"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1-stage0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}
```

Bewusst **keine** Abhängigkeiten (kein AndroidX, kein Compose) — Stufe 0 braucht nur eine `Activity`
und einen `AccessibilityService` aus dem reinen Android-SDK. Kleinstmögliche Angriffsfläche für
Build-Fehler auf einer frischen Maschine.

### `app/src/main/AndroidManifest.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application
        android:allowBackup="false"
        android:label="@string/app_name"
        android:icon="@android:drawable/sym_def_app_icon"
        android:theme="@android:style/Theme.Material.Light">

        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <service
            android:name=".TapAccessibilityService"
            android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"
            android:exported="true">
            <intent-filter>
                <action android:name="android.accessibilityservice.AccessibilityService" />
            </intent-filter>
            <meta-data
                android:name="android.accessibilityservice"
                android:resource="@xml/accessibility_service_config" />
        </service>

    </application>
</manifest>
```

### `app/src/main/res/values/strings.xml`

```xml
<resources>
    <string name="app_name">YFRemote Stage0</string>
    <string name="accessibility_service_description">Sendet einen Testtipp in die Bildschirmmitte, um zu pruefen, dass Gesten-Injection auf diesem Geraet funktioniert.</string>
</resources>
```

### `app/src/main/res/xml/accessibility_service_config.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<accessibility-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:accessibilityEventTypes="typeAllMask"
    android:canPerformGestures="true"
    android:accessibilityFlags="flagDefault"
    android:description="@string/accessibility_service_description"
    android:notificationTimeout="100" />
```

### `app/src/main/java/com/yfremote/stage0/TapAccessibilityService.kt`

```kotlin
package com.yfremote.stage0

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.util.Log
import android.view.accessibility.AccessibilityEvent

class TapAccessibilityService : AccessibilityService() {

    companion object {
        var instance: TapAccessibilityService? = null
            private set
        private const val TAG = "TapAccessibilityService"
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i(TAG, "Accessibility-Dienst verbunden.")
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Stufe 0 braucht keine Events, nur die Faehigkeit, Gesten zu senden.
    }

    override fun onInterrupt() {}

    fun tap(x: Float, y: Float) {
        val path = Path().apply { moveTo(x, y) }
        val stroke = GestureDescription.StrokeDescription(path, 0, 50)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()

        dispatchGesture(
            gesture,
            object : GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    Log.i(TAG, "Testtipp bei ($x, $y) gesendet.")
                }

                override fun onCancelled(gestureDescription: GestureDescription?) {
                    Log.w(TAG, "Testtipp abgebrochen.")
                }
            },
            null,
        )
    }
}
```

### `app/src/main/java/com/yfremote/stage0/MainActivity.kt`

```kotlin
package com.yfremote.stage0

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {

    private var tapCount = 0
    private lateinit var targetArea: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        val triggerButton = Button(this).apply {
            text = "Testtipp ausloesen"
            setOnClickListener { triggerTap() }
        }
        root.addView(triggerButton)

        targetArea = TextView(this).apply {
            text = "0 Tipps empfangen"
            gravity = Gravity.CENTER
            textSize = 24f
            setBackgroundColor(Color.LTGRAY)
            setOnClickListener { onTargetTapped() }
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f,
            )
        }
        root.addView(targetArea)

        setContentView(root)
    }

    private fun onTargetTapped() {
        tapCount++
        targetArea.text = "$tapCount Tipps empfangen"
        targetArea.setBackgroundColor(
            if (tapCount % 2 == 0) Color.LTGRAY else Color.parseColor("#4CAF50"),
        )
    }

    private fun triggerTap() {
        val service = TapAccessibilityService.instance
        if (service == null) {
            Toast.makeText(
                this,
                "Bedienungshilfe 'YFRemote Stage0' ist nicht aktiv - bitte in den Einstellungen aktivieren.",
                Toast.LENGTH_LONG,
            ).show()
            return
        }

        val location = IntArray(2)
        targetArea.getLocationOnScreen(location)
        val x = location[0] + targetArea.width / 2f
        val y = location[1] + targetArea.height / 2f

        service.tap(x, y)
    }
}
```

---

## 3. Bauen und installieren

**Mit Android Studio:** Ordner `android/` als Projekt öffnen ("Open"), Gradle-Sync abwarten, Gerät
in der Geräteliste oben auswählen, ▶ Run drücken.

**Über die Kommandozeile** (falls `gradlew` vorhanden ist bzw. mit installiertem Gradle):

```powershell
cd android
.\gradlew.bat installDebug
```

---

## 4. Bedienungshilfe aktivieren

Ohne diesen Schritt bleibt `TapAccessibilityService.instance` `null` und der Knopf zeigt nur den
Toast-Hinweis:

1. Auf dem Gerät: Einstellungen → Eingabehilfen/Bedienungshilfe → Installierte Dienste (oder
   "Heruntergeladene Apps", je nach Android-Version) → **YFRemote Stage0**.
2. Dienst aktivieren, Sicherheitswarnung bestätigen (erwartungsgemäß — genau das ist die Fähigkeit,
   die später gebraucht wird).

---

## 5. Prüfschritt (das eigentliche Ziel dieser Stufe)

1. App **YFRemote Stage0** öffnen.
2. Auf "Testtipp ausloesen" tippen.
3. **Erwartung:** die graue Fläche darunter wird grün und der Text wechselt zu "1 Tipps empfangen" —
   ganz ohne dass man die Fläche selbst berührt hat.
4. Erneut drücken → Fläche wird wieder grau, "2 Tipps empfangen", usw.

Erscheint das zuverlässig: **Stufe 0 ist bewiesen**, Gesten-Injection funktioniert auf diesem
Gerät. Optional in Logcat gegenprüfen (`adb logcat -s TapAccessibilityService`) — sollte pro Tipp
eine Zeile `Testtipp bei (...) gesendet.` zeigen.

Bleibt die Fläche grau: zuerst prüfen, ob die Bedienungshilfe wirklich aktiv ist (Schritt 4) und ob
Logcat `onServiceConnected` überhaupt geloggt hat.

---

## Was das *nicht* beweist

Kein Server, keine Netzwerkverbindung, kein Pairing, kein Tippen in echte Textfelder (IME kommt
erst in Stufe 3), kein Scroll/Drag. Nur: der reine `dispatchGesture`-Signalweg funktioniert auf
echter Hardware. Die nächsten Stufen (Ktor-Server + Pairing-Protokoll, virtueller Cursor +
Overlay, IME) stehen in [`AGENTS.md`](../AGENTS.md#android-support-planned-not-yet-implemented).
