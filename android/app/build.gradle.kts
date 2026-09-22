plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// Von der Release-CI per -PappVersionName/-PappVersionCode gesetzt (siehe release.yml);
// lokale Builds ohne diese Properties bekommen einen unverwechselbaren Dev-Stand.
val appVersionName: String = (project.findProperty("appVersionName") as String?) ?: "0.1-dev"
val appVersionCode: Int = (project.findProperty("appVersionCode") as String?)?.toIntOrNull() ?: 1

android {
    namespace = "com.yfremote.android"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.yfremote.android"
        minSdk = 26
        targetSdk = 34
        versionCode = appVersionCode
        versionName = appVersionName
    }

    signingConfigs {
        // Ohne YFREMOTE_KEYSTORE_PATH (lokaler Dev-Build) bleibt storeFile null - Gradle
        // signiert dann automatisch mit dem eingebauten Debug-Keystore.
        create("release") {
            val storeFilePath = System.getenv("YFREMOTE_KEYSTORE_PATH")
            if (!storeFilePath.isNullOrBlank()) {
                storeFile = file(storeFilePath)
                storePassword = System.getenv("YFREMOTE_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("YFREMOTE_KEY_ALIAS")
                keyPassword = System.getenv("YFREMOTE_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    // Mehrere netty-*-Jars (transitive Abhaengigkeit von ktor-server-netty) bringen alle dieselbe
    // META-INF/INDEX.LIST mit - AGP lehnt doppelte Pfade beim Zusammenfuehren sonst ab.
    packaging {
        resources {
            excludes += "/META-INF/INDEX.LIST"
            excludes += "/META-INF/io.netty.versions.properties"
        }
    }
}

dependencies {
    val ktorVersion = "2.3.12"
    implementation("io.ktor:ktor-server-core:$ktorVersion")
    implementation("io.ktor:ktor-server-netty:$ktorVersion")
    implementation("io.ktor:ktor-server-websockets:$ktorVersion")
    implementation("io.ktor:ktor-server-content-negotiation:$ktorVersion")
    implementation("io.ktor:ktor-serialization-kotlinx-json:$ktorVersion")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")
    // Nur fuer FileProvider (Zwischenablage-Bilder) und NotificationCompat (Foreground-Service-
    // Notification auf API < 33 ohne Channel-Boilerplate) - kein Compose, kein AppCompat.
    implementation("androidx.core:core:1.13.1")

    // PairingRepository braucht nur org.json + java.time/java.util - laeuft daher als reiner
    // JVM-Unit-Test ohne Instrumentierung/Emulator; org.json ist auf dem echten Geraet Teil des
    // Android-SDK, im Unit-Test-Klassenpfad aber nur ein Stub, der bei jedem Aufruf wirft - die
    // echte Implementierung deckt das hier ab (siehe PLAN.md, "Testing").
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}

// Kopiert den Angular-Production-Build ins App-Bundle, analog zum Copy-Item-Schritt in der
// Root-CLAUDE.md. Lokaler Dev-Komfort: die Release-CI befuellt assets/www stattdessen direkt aus
// dem vom Windows-Job hochgeladenen wwwroot-Artefakt (siehe release.yml), ohne diesen Task.
tasks.register<Copy>("copyWebClient") {
    val clientDist = rootProject.file("../client/dist/YFRemote.Client/browser")
    from(clientDist)
    into("src/main/assets/www")
    onlyIf {
        val exists = clientDist.exists()
        if (!exists) {
            logger.warn("Kein Angular-Build unter $clientDist gefunden - assets/www bleibt unveraendert.")
        }
        exists
    }
}

tasks.matching { it.name.startsWith("merge") && it.name.contains("Assets") }.configureEach {
    dependsOn("copyWebClient")
}
