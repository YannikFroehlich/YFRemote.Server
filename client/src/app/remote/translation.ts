export type Lang = 'de' | 'en';

export const LANGUAGE_STORAGE_KEY = 'yfremote.language';

export const TRANSLATIONS = {
  'common.cancel': { de: 'Abbrechen', en: 'Cancel' },
  'common.save': { de: 'Speichern', en: 'Save' },
  'common.close': { de: 'Schließen', en: 'Close' },
  'common.delete': { de: 'Löschen', en: 'Delete' },
  'common.edit': { de: 'Bearbeiten', en: 'Edit' },
  'common.new': { de: 'Neu', en: 'New' },
  'common.yes': { de: 'Ja', en: 'Yes' },
  'common.no': { de: 'Nein', en: 'No' },
  'common.reset': { de: 'Zurücksetzen', en: 'Reset' },
  'common.unknownError': { de: 'Unbekannter Fehler', en: 'Unknown error' },

  'status.connected': { de: 'Verbunden', en: 'Connected' },
  'status.connecting': { de: 'Verbinde', en: 'Connecting' },
  'status.disconnected': { de: 'Getrennt', en: 'Disconnected' },

  'shell.editLayout': { de: 'Layout bearbeiten', en: 'Edit layout' },
  'shell.settings': { de: 'Einstellungen', en: 'Settings' },
  'shell.activeComputer': { de: 'Aktiver Computer', en: 'Active computer' },
  'shell.activeShort': { de: 'Aktiv', en: 'Active' },
  'shell.reconnect': { de: 'Neu verbinden', en: 'Reconnect' },
  'shell.disconnect': { de: 'Verbindung trennen', en: 'Disconnect' },
  'shell.viewTabsAriaLabel': { de: 'Ansicht', en: 'View' },
  'shell.tabKeyboard': { de: 'Tastatur', en: 'Keyboard' },
  'shell.done': { de: 'Fertig', en: 'Done' },
  'shell.add': { de: 'Hinzufügen', en: 'Add' },
  'shell.snapToGrid': { de: 'Raster', en: 'Snap to grid' },
  'shell.confirmResetLayout': { de: 'Wirklich zurücksetzen?', en: 'Really reset?' },
  'shell.hiddenButtons': { de: 'Ausgeblendete Buttons', en: 'Hidden buttons' },
  'shell.restoreAriaLabel': {
    de: 'Wiederherstellen: {{label}}',
    en: 'Restore: {{label}}',
  },

  'buttonCanvas.ariaLabel': { de: 'Tastenfeld', en: 'Button grid' },
  'buttonCanvas.removeAriaLabel': { de: 'Entfernen: {{label}}', en: 'Remove: {{label}}' },

  'button.up.label': { de: 'Hoch', en: 'Up' },
  'button.up.ariaLabel': { de: 'Nach oben', en: 'Move up' },
  'button.left.label': { de: 'Links', en: 'Left' },
  'button.left.ariaLabel': { de: 'Nach links', en: 'Move left' },
  'button.right.label': { de: 'Rechts', en: 'Right' },
  'button.right.ariaLabel': { de: 'Nach rechts', en: 'Move right' },
  'button.down.label': { de: 'Runter', en: 'Down' },
  'button.down.ariaLabel': { de: 'Nach unten', en: 'Move down' },
  'button.previous-tab.label': { de: 'Tab zurück', en: 'Previous tab' },
  'button.previous-tab.ariaLabel': { de: 'Vorheriger Tab', en: 'Previous tab' },
  'button.next-tab.label': { de: 'Tab weiter', en: 'Next tab' },
  'button.next-tab.ariaLabel': { de: 'Nächster Tab', en: 'Next tab' },
  'button.close-tab.label': { de: 'Tab schließen', en: 'Close tab' },
  'button.close-tab.ariaLabel': { de: 'Tab schließen', en: 'Close tab' },
  'button.restore-tab.label': { de: 'Tab wiederherstellen', en: 'Restore tab' },
  'button.restore-tab.ariaLabel': {
    de: 'Geschlossenen Tab wiederherstellen',
    en: 'Restore closed tab',
  },
  'button.home.label': { de: 'Home', en: 'Home' },
  'button.home.ariaLabel': { de: 'Zum Startbildschirm', en: 'Go to home screen' },
  'button.recents.label': { de: 'Übersicht', en: 'Overview' },
  'button.recents.ariaLabel': { de: 'Zuletzt genutzte Apps', en: 'Recent apps' },
  'button.lock.label': { de: 'Sperren', en: 'Lock' },
  'button.lock.ariaLabel': { de: 'Bildschirm sperren', en: 'Lock the screen' },
  'button.back.label': { de: 'Zurück', en: 'Back' },
  'button.back.ariaLabel': { de: 'Zurück', en: 'Back' },
  'button.fullscreen.label': { de: 'Vollbild', en: 'Fullscreen' },
  'button.fullscreen.ariaLabel': { de: 'Vollbild umschalten', en: 'Toggle fullscreen' },
  'button.play-pause.ariaLabel': { de: 'Play Pause', en: 'Play/Pause' },
  'button.volume-down.label': { de: 'Leiser', en: 'Quieter' },
  'button.volume-down.ariaLabel': { de: 'Leiser', en: 'Volume down' },
  'button.volume-up.label': { de: 'Lauter', en: 'Louder' },
  'button.volume-up.ariaLabel': { de: 'Lauter', en: 'Volume up' },
  'button.mute.label': { de: 'Stumm', en: 'Mute' },
  'button.mute.ariaLabel': { de: 'Stumm', en: 'Mute' },
  'button.previous-track.label': { de: 'Vorheriger', en: 'Previous' },
  'button.previous-track.ariaLabel': { de: 'Vorheriger Titel', en: 'Previous track' },
  'button.stop.label': { de: 'Stopp', en: 'Stop' },
  'button.stop.ariaLabel': { de: 'Wiedergabe stoppen', en: 'Stop playback' },
  'button.next-track.label': { de: 'Nächster', en: 'Next' },
  'button.next-track.ariaLabel': { de: 'Nächster Titel', en: 'Next track' },
  'button.sleep.label': { de: 'Ruhemodus', en: 'Sleep' },
  'button.sleep.ariaLabel': {
    de: 'Rechner in den Ruhemodus versetzen',
    en: 'Put the computer to sleep',
  },
  'button.sleep.confirm': {
    de: 'Rechner wirklich in den Ruhemodus versetzen?',
    en: 'Really put the computer to sleep?',
  },
  'button.restart.label': { de: 'Neustart', en: 'Restart' },
  'button.restart.ariaLabel': { de: 'Rechner neu starten', en: 'Restart the computer' },
  'button.restart.confirm': {
    de: 'Rechner wirklich neu starten? Nicht gespeicherte Arbeit geht verloren.',
    en: 'Really restart the computer? Unsaved work will be lost.',
  },
  'button.shutdown.label': { de: 'Herunterfahren', en: 'Shut down' },
  'button.shutdown.ariaLabel': { de: 'Rechner herunterfahren', en: 'Shut down the computer' },
  'button.shutdown.confirm': {
    de: 'Rechner wirklich herunterfahren? Nicht gespeicherte Arbeit geht verloren.',
    en: 'Really shut down the computer? Unsaved work will be lost.',
  },

  'keyGroup.modifiers': { de: 'Modifikatoren', en: 'Modifiers' },
  'keyGroup.functionKeys': { de: 'Funktionstasten', en: 'Function keys' },
  'keyGroup.letters': { de: 'Buchstaben', en: 'Letters' },
  'keyGroup.numbers': { de: 'Zahlen', en: 'Numbers' },

  'key.home': { de: 'Pos1', en: 'Home' },
  'key.end': { de: 'Ende', en: 'End' },
  'key.pageUp': { de: 'Bild ↑', en: 'Page ↑' },
  'key.pageDown': { de: 'Bild ↓', en: 'Page ↓' },
  'key.printScreen': { de: 'Druck', en: 'Print' },

  'touchpad.eyebrow': { de: 'Präzise Steuerung', en: 'Precise control' },
  'touchpad.gestureHelpAriaLabel': { de: 'Gestenhilfe', en: 'Gesture help' },
  'touchpad.hint.oneFinger': { de: '1 Finger · Bewegen', en: '1 finger · Move' },
  'touchpad.hint.twoFinger': { de: '2 Finger · Scrollen', en: '2 fingers · Scroll' },
  'touchpad.placeholder.live': {
    de: 'Live: Tasten gehen sofort an das Gerät…',
    en: 'Live: keys go straight to the device…',
  },
  'touchpad.placeholder.default': { de: 'Text eingeben…', en: 'Enter text…' },
  'touchpad.mic.title': { de: 'Text diktieren', en: 'Dictate text' },
  'touchpad.mic.ariaLabel': { de: 'Diktieren', en: 'Dictate' },
  'touchpad.live.title': {
    de: 'Live-Eingabe: jede Taste sofort an das Gerät senden',
    en: 'Live typing: send every key to the device immediately',
  },
  'touchpad.send.ariaLabel': { de: 'Text senden', en: 'Send text' },
  'touchpad.send.label': { de: 'Senden', en: 'Send' },
  'touchpad.surface.ariaLabel': { de: 'Touchpad-Fläche', en: 'Touchpad area' },
  'touchpad.center.title': { de: 'Zum Steuern bewegen', en: 'Move to control' },
  'touchpad.center.hint1': {
    de: '1 Finger: Bewegen · 2 Finger: Scrollen',
    en: '1 finger: move · 2 fingers: scroll',
  },
  'touchpad.center.hint2': {
    de: 'Tippen: Linksklick · 2 Finger: Rechtsklick · 3 Finger: Mittelklick',
    en: 'Tap: left click · 2 fingers: right click · 3 fingers: middle click',
  },
  'touchpad.center.hint3': { de: 'Tippen, dann halten: Ziehen', en: 'Tap, then hold: drag' },
  'touchpad.buttons.ariaLabel': { de: 'Maustasten', en: 'Mouse buttons' },
  'touchpad.button.left': { de: 'Linksklick', en: 'Left click' },
  'touchpad.button.middle': { de: 'Mittelklick', en: 'Middle click' },
  'touchpad.button.right': { de: 'Rechtsklick', en: 'Right click' },
  'touchpad.dictationError.notAllowed': {
    de: 'Mikrofonzugriff wurde verweigert.',
    en: 'Microphone access was denied.',
  },
  'touchpad.dictationError.insecureOrigin': {
    de: 'Diktieren geht nur über HTTPS. Setze dafür in der appsettings.json des Servers "Https": { "Enabled": true } und starte ihn neu.',
    en: 'Dictation needs HTTPS. Set "Https": { "Enabled": true } in the server\'s appsettings.json and restart it.',
  },
  'touchpad.dictationError.noSpeech': { de: 'Kein Ton erkannt.', en: 'No sound detected.' },
  'touchpad.dictationError.failed': { de: 'Diktat fehlgeschlagen.', en: 'Dictation failed.' },
  'touchpad.file.title': { de: 'Datei senden', en: 'Send file' },
  'touchpad.file.ariaLabel': { de: 'Datei senden', en: 'Send file' },
  'touchpad.file.success': { de: 'Datei gesendet: {{fileName}}', en: 'File sent: {{fileName}}' },
  'touchpad.file.error': {
    de: 'Datei konnte nicht gesendet werden.',
    en: 'The file could not be sent.',
  },
  'touchpad.clipboard.title': { de: 'Zwischenablage senden', en: 'Send clipboard' },
  'touchpad.clipboard.ariaLabel': { de: 'Zwischenablage senden', en: 'Send clipboard' },
  'touchpad.clipboard.hint': { de: 'Jetzt einfügen', en: 'Paste now' },
  'touchpad.clipboard.success': { de: 'Zwischenablage gesendet.', en: 'Clipboard sent.' },
  'touchpad.clipboard.error': {
    de: 'Zwischenablage konnte nicht gesendet werden.',
    en: 'The clipboard could not be sent.',
  },

  'keyboardPad.eyebrow': { de: 'Direkte Eingabe', en: 'Direct input' },
  'keyboardPad.title': { de: 'Virtuelle Tastatur', en: 'Virtual keyboard' },
  'keyboardPad.hint': {
    de: 'Modifier auswählen, dann Taste senden',
    en: 'Choose a modifier, then send a key',
  },
  'keyboardPad.srLabel': { de: 'Tastatur', en: 'Keyboard' },
  'keyboardPad.winKeyAriaLabel': {
    de: 'Windows-Taste allein senden (öffnet das Startmenü)',
    en: 'Send the Windows key alone (opens the Start menu)',
  },
  'keyboardPad.armedSummary': { de: 'Bereit: {{armed}}', en: 'Ready: {{armed}}' },
  'keyboardPad.idleSummary': {
    de: 'Optional: Modifikator wählen, dann Taste antippen.',
    en: 'Optional: choose a modifier, then tap a key.',
  },

  'settings.host.error': {
    de: 'Nur Hostname oder IPv4 ohne Protokoll/Pfad.',
    en: 'Only a hostname or IPv4 address, without protocol or path.',
  },
  'settings.port.error': {
    de: 'Port muss zwischen 1 und 65535 liegen.',
    en: 'Port must be between 1 and 65535.',
  },
  'settings.recentServers.label': { de: 'Zuletzt verbunden', en: 'Recently connected' },
  'settings.recentServers.removeAriaLabel': {
    de: '{{host}} aus der Liste entfernen',
    en: 'Remove {{host}} from the list',
  },
  'settings.mouseSensitivity.label': { de: 'Mausgeschwindigkeit', en: 'Mouse speed' },
  'settings.slow': { de: 'Langsam', en: 'Slow' },
  'settings.fast': { de: 'Schnell', en: 'Fast' },
  'settings.rangeError': {
    de: 'Wert muss zwischen {{min}} und {{max}} liegen.',
    en: 'Value must be between {{min}} and {{max}}.',
  },
  'settings.pointerAcceleration': {
    de: 'Mausbeschleunigung (schnelle Wischer bewegen weiter)',
    en: 'Pointer acceleration (fast swipes move further)',
  },
  'settings.scrollSpeed.label': { de: 'Scroll-Geschwindigkeit', en: 'Scroll speed' },
  'settings.invertScroll': { de: 'Scrollrichtung umkehren', en: 'Invert scroll direction' },
  'settings.haptics': {
    de: 'Vibration bei Tastendruck (Android)',
    en: 'Vibration on key press (Android)',
  },
  'settings.language.label': { de: 'Sprache', en: 'Language' },
  'settings.themeMode.label': { de: 'Darstellung', en: 'Appearance' },
  'settings.themeMode.system': { de: 'Wie das Gerät (System)', en: 'Same as device (System)' },
  'settings.themeMode.dark': { de: 'Dunkel', en: 'Dark' },
  'settings.themeMode.light': { de: 'Hell', en: 'Light' },
  'settings.themeMode.customHint': {
    de: 'Ein eigener Stil legt Hell oder Dunkel selbst fest.',
    en: 'A custom style decides light or dark itself.',
  },
  'settings.style.legend': { de: 'Stil', en: 'Style' },
  'settings.style.standard.hint': { de: 'Weiche Verläufe, Türkis', en: 'Soft gradients, teal' },
  'settings.style.futuristic.name': { de: 'Futuristisch', en: 'Futuristic' },
  'settings.style.futuristic.hint': { de: 'Neon, Leuchten, kantig', en: 'Neon, glow, angular' },
  'settings.style.minimal.name': { de: 'Minimalistisch', en: 'Minimal' },
  'settings.style.minimal.hint': {
    de: 'Flach, schlicht, ohne Effekte',
    en: 'Flat, plain, no effects',
  },
  'settings.style.editAriaLabel': { de: 'Stil {{name}} bearbeiten', en: 'Edit {{name}} style' },
  'settings.style.new': { de: 'Neuer Stil', en: 'New style' },
  'settings.style.export': { de: 'Stile exportieren', en: 'Export styles' },
  'settings.style.import': { de: 'Stile importieren', en: 'Import styles' },
  'settings.profiles.title': { de: 'Profile und Sicherung', en: 'Profiles and backup' },
  'settings.profiles.active.label': { de: 'Aktives Profil', en: 'Active profile' },
  'settings.profiles.new.label': { de: 'Neues Profil', en: 'New profile' },
  'settings.profiles.new.placeholder': { de: 'z. B. Präsentation', en: 'e.g. Presentation' },
  'settings.profiles.new.error': {
    de: 'Bitte einen Namen mit höchstens 40 Zeichen eingeben.',
    en: 'Please enter a name with at most 40 characters.',
  },
  'settings.profiles.create': { de: 'Erstellen', en: 'Create' },
  'settings.profiles.exportJson': { de: 'JSON exportieren', en: 'Export JSON' },
  'settings.profiles.importJson': { de: 'JSON importieren', en: 'Import JSON' },
  'settings.profiles.importHint': {
    de: 'Der Import ersetzt alle lokalen Profile. Eigene Buttons und Makros sind enthalten.',
    en: 'Importing replaces all local profiles. Custom buttons and macros are included.',
  },
  'settings.profiles.confirmDelete': {
    de: 'Aktives Profil wirklich löschen?',
    en: 'Really delete the active profile?',
  },
  'settings.profiles.delete': { de: 'Aktives Profil löschen', en: 'Delete active profile' },
  'settings.device.eyebrow': { de: 'Kopplung', en: 'Pairing' },
  'settings.device.title': { de: 'Dieses Gerät', en: 'This device' },
  'settings.device.hint': {
    de: 'Der Server widerruft die Kopplung dauerhaft. Für eine erneute Verbindung ist eine neue PIN erforderlich.',
    en: 'The server revokes the pairing permanently. A new PIN is required to reconnect.',
  },
  'settings.device.confirmUnpair': {
    de: 'Dieses Gerät wirklich entkoppeln?',
    en: 'Really unpair this device?',
  },
  'settings.device.unpairing': { de: 'Entkopple…', en: 'Unpairing…' },
  'settings.device.unpair': { de: 'Entkoppeln', en: 'Unpair' },
  'settings.device.requestUnpair': { de: 'Dieses Gerät entkoppeln', en: 'Unpair this device' },
  'settings.msg.stylesExported': {
    de: 'Eigene Stile wurden exportiert.',
    en: 'Custom styles were exported.',
  },
  'settings.msg.importTooLarge': {
    de: 'Die Importdatei darf höchstens 1 MB groß sein.',
    en: 'The import file may be at most 1 MB.',
  },
  'settings.msg.noValidStyles': {
    de: 'Die Datei enthält keine gültigen Stile.',
    en: 'The file does not contain valid styles.',
  },
  'settings.msg.stylesImported': {
    de: '{{count}} Stil(e) importiert.',
    en: '{{count}} style(s) imported.',
  },
  'settings.msg.importUnreadable': {
    de: 'Die Importdatei konnte nicht gelesen werden.',
    en: 'The import file could not be read.',
  },
  'settings.msg.profileLoaded': { de: 'Profil geladen.', en: 'Profile loaded.' },
  'settings.msg.profileLoadFailed': {
    de: 'Profil konnte nicht geladen werden.',
    en: 'Profile could not be loaded.',
  },
  'settings.msg.profileCreated': {
    de: 'Profil aus dem aktuellen Layout erstellt.',
    en: 'Profile created from the current layout.',
  },
  'settings.msg.profileCreateFailed': {
    de: 'Profil konnte nicht erstellt werden.',
    en: 'Profile could not be created.',
  },
  'settings.msg.profileDeleted': { de: 'Profil gelöscht.', en: 'Profile deleted.' },
  'settings.msg.profileDeleteFailed': {
    de: 'Profil konnte nicht gelöscht werden.',
    en: 'Profile could not be deleted.',
  },
  'settings.msg.profilesExported': {
    de: 'Layoutprofile wurden exportiert.',
    en: 'Layout profiles were exported.',
  },
  'settings.msg.profilesImported': {
    de: 'Layoutprofile wurden importiert.',
    en: 'Layout profiles were imported.',
  },
  'settings.msg.importFailed': { de: 'Import fehlgeschlagen.', en: 'Import failed.' },
  'settings.msg.unpairFailed': {
    de: 'Entkopplung fehlgeschlagen. Die Kopplung bleibt erhalten.',
    en: 'Unpairing failed. The pairing remains in place.',
  },

  'themeEditor.title': { de: 'Eigener Stil', en: 'Custom style' },
  'themeEditor.defaultName': { de: 'Eigener Stil {{n}}', en: 'Custom style {{n}}' },
  'themeEditor.hint.livePreview': {
    de: 'Änderungen sind sofort sichtbar. Abbrechen verwirft sie.',
    en: 'Changes are visible immediately. Cancel discards them.',
  },
  'themeEditor.name.error': {
    de: 'Bitte einen Namen mit höchstens {{max}} Zeichen eingeben.',
    en: 'Please enter a name with at most {{max}} characters.',
  },
  'themeEditor.base.label': { de: 'Grundstil', en: 'Base style' },
  'themeEditor.baseMode.label': { de: 'Grundlage', en: 'Foundation' },
  'themeEditor.hint.baseChange': {
    de: 'Grundstil oder Grundlage zu ändern setzt Farben und Formen auf dessen Werte zurück.',
    en: 'Changing the base style or foundation resets colors and shapes to its values.',
  },
  'themeEditor.colors.title': { de: 'Farben', en: 'Colors' },
  'themeEditor.shape.title': { de: 'Form und Effekte', en: 'Shape and effects' },
  'themeEditor.pillCorners': {
    de: 'Runde Pillen (Status, Schalter, Hinweise)',
    en: 'Rounded pills (status, switches, hints)',
  },
  'themeEditor.font.title': { de: 'Schrift', en: 'Font' },
  'themeEditor.font.headings.label': { de: 'Überschriften', en: 'Headings' },
  'themeEditor.advanced.summary': {
    de: 'Profi: alle Farben einzeln',
    en: 'Advanced: all colors individually',
  },
  'themeEditor.advanced.changedCount': { de: '({{count}} geändert)', en: '({{count}} changed)' },
  'themeEditor.advanced.reset': { de: 'Profi-Farben zurücksetzen', en: 'Reset advanced colors' },
  'themeEditor.confirmDelete': { de: 'Stil wirklich löschen?', en: 'Really delete this style?' },
  'themeEditor.delete': { de: 'Stil löschen', en: 'Delete style' },
  'themeEditor.saveError': {
    de: 'Es sind höchstens {{max}} eigene Stile möglich.',
    en: 'At most {{max}} custom styles are allowed.',
  },

  'themeShape.borderWidth': { de: 'Rahmendicke', en: 'Border width' },
  'themeShape.radius': { de: 'Eckenrundung', en: 'Corner rounding' },
  'themeShape.shadow': { de: 'Schatten', en: 'Shadow' },
  'themeShape.decor': { de: 'Verläufe und Leuchten', en: 'Gradients and glows' },
  'themeShape.grid': { de: 'Hintergrundgitter', en: 'Background grid' },
  'themeShape.fontScale': { de: 'Schriftgröße', en: 'Font size' },

  'themeColor.accent': { de: 'Akzent', en: 'Accent' },
  'themeColor.background': { de: 'Hintergrund', en: 'Background' },
  'themeColor.surface': { de: 'Flächen', en: 'Surfaces' },
  'themeColor.raised': { de: 'Knöpfe', en: 'Buttons' },
  'themeColor.muted': { de: 'Gedämpfter Text', en: 'Muted text' },
  'themeColor.line': { de: 'Linien', en: 'Lines' },
  'themeColor.danger': { de: 'Warnfarbe', en: 'Warning color' },

  'themeFont.rounded': { de: 'Rund', en: 'Rounded' },

  'themeToken.appBg': { de: 'Seitenhintergrund', en: 'Page background' },
  'themeToken.appBgStart': { de: 'Hintergrund-Verlauf Anfang', en: 'Background gradient start' },
  'themeToken.appBgEnd': { de: 'Hintergrund-Verlauf Ende', en: 'Background gradient end' },
  'themeToken.panelBgMobile': { de: 'Hintergrund Handy', en: 'Background (phone)' },
  'themeToken.surfaceSolid': { de: 'Fläche', en: 'Surface' },
  'themeToken.surfaceRaised': { de: 'Knopf', en: 'Button' },
  'themeToken.surfaceHover': { de: 'Knopf beim Überfahren', en: 'Button on hover' },
  'themeToken.surfaceSoft': { de: 'Fläche gedämpft', en: 'Surface muted' },
  'themeToken.surfaceSunken': { de: 'Fläche vertieft', en: 'Surface recessed' },
  'themeToken.surfaceFocus': { de: 'Eingabefeld mit Fokus', en: 'Input field focus' },
  'themeToken.surfaceWell': { de: 'Touchpad-Fläche', en: 'Touchpad area' },
  'themeToken.surfaceBar': { de: 'Touchpad-Textleiste', en: 'Touchpad text bar' },
  'themeToken.textSoft': { de: 'Text weich', en: 'Soft text' },
  'themeToken.muted': { de: 'Gedämpft', en: 'Muted' },
  'themeToken.mutedStrong': { de: 'Gedämpft stark', en: 'Strongly muted' },
  'themeToken.textFaint': { de: 'Text blass', en: 'Faint text' },
  'themeToken.textDisabled': { de: 'Text deaktiviert', en: 'Disabled text' },
  'themeToken.accent': { de: 'Akzent', en: 'Accent' },
  'themeToken.accentStrong': { de: 'Akzent stark', en: 'Strong accent' },
  'themeToken.accentText': { de: 'Akzent-Text', en: 'Accent text' },
  'themeToken.accentGradientStart': {
    de: 'Hauptknopf Verlauf Anfang',
    en: 'Primary button gradient start',
  },
  'themeToken.accentGradientEnd': {
    de: 'Hauptknopf Verlauf Ende',
    en: 'Primary button gradient end',
  },
  'themeToken.onAccent': { de: 'Text auf Akzent', en: 'Text on accent' },
  'themeToken.buttonDisabledBg': { de: 'Knopf deaktiviert', en: 'Disabled button' },
  'themeToken.buttonDisabledText': { de: 'Knopftext deaktiviert', en: 'Disabled button text' },
  'themeToken.switchTrack': { de: 'Schalter aus', en: 'Switch off' },
  'themeToken.switchKnob': { de: 'Schalterknopf', en: 'Switch knob' },
  'themeToken.danger': { de: 'Warnung', en: 'Warning' },
  'themeToken.dangerText': { de: 'Warnungstext', en: 'Warning text' },
  'themeToken.dangerTextHover': { de: 'Warnungstext beim Überfahren', en: 'Warning text on hover' },
  'themeToken.dangerSurface': { de: 'Warnungsfläche', en: 'Warning surface' },
  'themeToken.dangerSurfaceHover': {
    de: 'Warnungsfläche beim Überfahren',
    en: 'Warning surface on hover',
  },
  'themeToken.warning': { de: 'Hinweis', en: 'Notice' },
  'themeToken.success': { de: 'Erfolg', en: 'Success' },

  'buttonEditor.eyebrow.builtin': { de: 'Eingebaut', en: 'Built-in' },
  'buttonEditor.title.details': { de: 'Button-Details', en: 'Button details' },
  'buttonEditor.title.custom': { de: 'Eigener Button', en: 'Custom button' },
  'buttonEditor.label.field': { de: 'Beschriftung', en: 'Label' },
  'buttonEditor.label.error': {
    de: 'Beschriftung erforderlich (max. {{max}} Zeichen).',
    en: 'Label required (max. {{max}} characters).',
  },
  'buttonEditor.icon.field': { de: 'Symbol', en: 'Icon' },
  'buttonEditor.icon.ariaLabel': { de: 'Symbol: {{icon}}', en: 'Icon: {{icon}}' },
  'buttonEditor.color.toggle': { de: 'Eigene Farbe verwenden', en: 'Use a custom color' },
  'buttonEditor.color.field': { de: 'Farbe', en: 'Color' },
  'buttonEditor.steps.field': { de: 'Schritte', en: 'Steps' },
  'buttonEditor.steps.empty': {
    de: 'Noch keine Schritte hinzugefügt.',
    en: 'No steps added yet.',
  },
  'buttonEditor.step.moveUp': { de: 'Schritt nach oben', en: 'Move step up' },
  'buttonEditor.step.moveDown': { de: 'Schritt nach unten', en: 'Move step down' },
  'buttonEditor.step.remove': { de: 'Schritt entfernen', en: 'Remove step' },
  'buttonEditor.tab.keys': { de: 'Tasten', en: 'Keys' },
  'buttonEditor.tab.click': { de: 'Klick', en: 'Click' },
  'buttonEditor.stepTypeAriaLabel': { de: 'Schritttyp', en: 'Step type' },
  'buttonEditor.mouseLeft': { de: 'Links', en: 'Left' },
  'buttonEditor.mouseRight': { de: 'Rechts', en: 'Right' },
  'buttonEditor.delay.label': {
    de: 'Verzögerung vor diesem Schritt (ms)',
    en: 'Delay before this step (ms)',
  },
  'buttonEditor.addStep': { de: 'Schritt hinzufügen', en: 'Add step' },
  'buttonEditor.needStep': {
    de: 'Füge mindestens einen Schritt hinzu.',
    en: 'Add at least one step.',
  },
  'buttonEditor.describeStep.key': { de: 'Taste: {{key}}', en: 'Key: {{key}}' },
  'buttonEditor.describeStep.hotkey': { de: 'Hotkey: {{keys}}', en: 'Hotkey: {{keys}}' },
  'buttonEditor.describeStep.mouseLeft': { de: 'Klick: links', en: 'Click: left' },
  'buttonEditor.describeStep.mouseRight': { de: 'Klick: rechts', en: 'Click: right' },

  'pairingGate.tagline': { de: 'Sicher verbinden', en: 'Secure connection' },
  'pairingGate.regionAriaLabel': { de: 'YFRemote Kopplung', en: 'YFRemote pairing' },
  'pairingGate.eyebrow': { de: 'Einmalige Kopplung', en: 'One-time pairing' },
  'pairingGate.title': { de: 'Mit deinem PC verbinden', en: 'Connect to your PC' },
  'pairingGate.copy': {
    de: 'Gib die sechsstellige PIN aus dem YFRemote-Symbol im Infobereich des Ziel-PCs ein.',
    en: "Enter the six-digit PIN from the YFRemote icon in the target PC's system tray.",
  },
  'pairingGate.title.android': {
    de: 'Mit deinem Android-Gerät verbinden',
    en: 'Connect to your Android device',
  },
  'pairingGate.copy.android': {
    de: 'Gib die sechsstellige PIN aus der YFRemote-App auf dem Ziel-Gerät ein.',
    en: 'Enter the six-digit PIN shown in the YFRemote app on the target device.',
  },
  'pairingGate.copy.linux': {
    de: 'Gib die sechsstellige PIN ein, die YFRemote im Terminal des Ziel-PCs ausgibt. Läuft YFRemote als Dienst, steht sie im Journal: journalctl --user -u yfremote.',
    en: 'Enter the six-digit PIN that YFRemote prints in the terminal of the target PC. If YFRemote runs as a service, it is in the journal: journalctl --user -u yfremote.',
  },
  'pairingGate.pin.error': {
    de: 'PIN muss aus 6 Ziffern bestehen.',
    en: 'PIN must consist of 6 digits.',
  },
  'pairingGate.deviceName.label': { de: 'Gerätename', en: 'Device name' },
  'pairingGate.deviceName.error': {
    de: 'Gerätename darf nicht leer sein.',
    en: 'Device name must not be empty.',
  },
  'pairingGate.remember': {
    de: 'Gerät auf diesem Browser merken',
    en: 'Remember this device on this browser',
  },
  'pairingGate.connecting': { de: 'Verbinde…', en: 'Connecting…' },
  'pairingGate.submit': { de: 'Koppeln', en: 'Pair' },

  'pairing.device.android': { de: 'Android-Gerät', en: 'Android device' },
  'pairing.device.windows': { de: 'Windows-PC', en: 'Windows PC' },
  'pairing.device.linux': { de: 'Linux-Gerät', en: 'Linux device' },
  'pairing.device.default': { de: 'Mein Gerät', en: 'My device' },

  'remoteService.error.unpairFailed': {
    de: 'Entkopplung fehlgeschlagen.',
    en: 'Unpairing failed.',
  },
  'remoteService.error.invalidServerConfig': {
    de: 'Serveradresse oder Port ist ungültig.',
    en: 'Server address or port is invalid.',
  },
  'remoteService.error.serverChangeFailed': {
    de: 'Serverwechsel fehlgeschlagen: {{message}}',
    en: 'Server change failed: {{message}}',
  },
  'remoteService.error.invalidMouseSensitivity': {
    de: 'Mausgeschwindigkeit ist ungültig.',
    en: 'Mouse speed is invalid.',
  },
  'remoteService.error.invalidScrollSpeed': {
    de: 'Scroll-Geschwindigkeit ist ungültig.',
    en: 'Scroll speed is invalid.',
  },
  'remoteService.error.noConfirmation': {
    de: 'Keine Bestätigung vom Server erhalten.',
    en: 'No confirmation received from the server.',
  },
  'remoteService.error.noConnection': {
    de: 'Keine Verbindung zum Server.',
    en: 'No connection to the server.',
  },
  'remoteService.error.sendFailed': {
    de: 'Senden fehlgeschlagen: {{message}}',
    en: 'Sending failed: {{message}}',
  },
  'remoteService.error.connectFailed': {
    de: 'Verbindung fehlgeschlagen: {{message}}',
    en: 'Connection failed: {{message}}',
  },
  'remoteService.error.socketError': {
    de: 'WebSocket-Fehler. Verbindung wird neu aufgebaut.',
    en: 'WebSocket error. Reconnecting.',
  },
  'remoteService.error.disconnected': {
    de: 'Verbindung zum Server wurde getrennt.',
    en: 'Connection to the server was closed.',
  },
  'remoteService.error.invalidResponse': {
    de: 'Ungültige Serverantwort.',
    en: 'Invalid server response.',
  },
  'remoteService.error.actionRejected': {
    de: 'Aktion wurde vom Server abgelehnt.',
    en: 'The server rejected the action.',
  },

  'pairingService.error.connectFailed': {
    de: 'Verbindung zum Server fehlgeschlagen: {{message}}',
    en: 'Connection to the server failed: {{message}}',
  },
  'pairingService.error.pinRejected': {
    de: 'PIN wurde vom Server abgelehnt.',
    en: 'The server rejected the PIN.',
  },
  'pairingService.error.unpairFailed': {
    de: 'Entkopplung fehlgeschlagen: {{message}}',
    en: 'Unpairing failed: {{message}}',
  },
  'pairingService.error.unpairRejected': {
    de: 'Entkopplung wurde vom Server abgelehnt.',
    en: 'The server rejected unpairing.',
  },

  'buttonLayoutService.error.invalidName': {
    de: 'Profilname darf 1 bis 40 Zeichen lang sein.',
    en: 'Profile name must be 1 to 40 characters long.',
  },
  'buttonLayoutService.error.duplicateName': {
    de: 'Ein Profil mit diesem Namen ist bereits vorhanden.',
    en: 'A profile with this name already exists.',
  },
  'buttonLayoutService.error.tooManyProfiles': {
    de: 'Es sind höchstens {{max}} Profile möglich.',
    en: 'At most {{max}} profiles are allowed.',
  },
  'buttonLayoutService.error.profileNotFound': {
    de: 'Das ausgewählte Profil ist nicht vorhanden.',
    en: 'The selected profile does not exist.',
  },
  'buttonLayoutService.error.lastProfile': {
    de: 'Mindestens ein Profil muss erhalten bleiben.',
    en: 'At least one profile must remain.',
  },
  'buttonLayoutService.error.invalidImport': {
    de: 'Die Datei enthält keine gültigen YFRemote-Layoutprofile.',
    en: 'The file does not contain valid YFRemote layout profiles.',
  },
} as const satisfies Record<string, Readonly<Record<Lang, string>>>;

export type TranslationKey = keyof typeof TRANSLATIONS;

export function parseStoredLang(value: string | null): Lang {
  return value === 'en' ? 'en' : 'de';
}

/** Faellt auf den Key selbst zurueck - fuer Werte, die in beiden Sprachen gleich sind (z. B.
 *  "OK" oder Tastennamen wie "F1"), gibt es bewusst keinen Dictionary-Eintrag. */
export function translate(
  lang: Lang,
  key: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  const entry = (TRANSLATIONS as Record<string, Record<Lang, string> | undefined>)[key];
  const text = entry?.[lang] ?? key;

  if (params === undefined) {
    return text;
  }

  return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(params[name] ?? ''));
}
