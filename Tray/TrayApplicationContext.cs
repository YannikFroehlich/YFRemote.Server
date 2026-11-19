using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using Velopack;
using YFRemote.Server.Configuration;
using YFRemote.Server.Diagnostics;
using YFRemote.Server.Models;
using YFRemote.Server.Services;
using YFRemote.Server.Updates;
using YFRemote.Server.WebSockets;

namespace YFRemote.Server.Tray;

internal sealed class TrayApplicationContext : ApplicationContext
{
    private static readonly TimeSpan UpdateCheckInterval = TimeSpan.FromHours(6);
    private const string GamepadDriverUrl = "https://github.com/nefarius/ViGEmBus/releases/latest";

    private readonly UpdateService updateService = new();
    private readonly ILogger<TrayApplicationContext> logger;
    private readonly PairingService pairingService;
    private readonly WebSocketConnectionRegistry connectionRegistry;
    private readonly FileTransferService fileTransferService;
    private readonly FileOfferService fileOfferService;
    private readonly ClipboardReadNotifier clipboardReadNotifier;
    private readonly ScreenViewNotifier screenViewNotifier;
    private readonly IGamepadService gamepadService;
    private readonly Icon trayIcon;
    private readonly NotifyIcon notifyIcon;
    private readonly ToolStripMenuItem updateItem;
    private readonly ToolStripMenuItem statusItem;
    private readonly ToolStripMenuItem pinItem;
    private readonly ToolStripMenuItem pairedDevicesItem;
    private readonly ToolStripMenuItem ringItem;
    private readonly ToolStripMenuItem gamepadDriverItem;
    private readonly ToolStripMenuItem shutdownTimerItem;
    private readonly ToolStripMenuItem httpsItem;
    private readonly ToolStripMenuItem startWithWindowsItem;
    private readonly ShutdownTimer shutdownTimer;
    private readonly System.Windows.Forms.Timer initialUpdateTimer;
    private readonly System.Windows.Forms.Timer periodicUpdateTimer;
    private readonly Control uiDispatcher = new();
    private readonly CancellationTokenSource offerPipeStop = new();
    private readonly string localAddress;
    private readonly string deviceAddress;
    private readonly string? certificateUrl;
    private readonly ServerOptions serverOptions;
    private readonly HttpsOptions httpsOptions;
    private readonly string? authoritySha256;

    private UpdateInfo? availableUpdate;
    private bool updateOperationRunning;
    private bool exiting;
    private MainWindow? mainWindow;
    private IReadOnlySet<string> disabledNotifications = UserSettingsStore.GetDisabledNotifications();

    internal string Version => updateService.CurrentVersion;
    internal string DeviceAddress => deviceAddress;
    internal bool HttpsEnabled => httpsOptions.Enabled;
    internal int HttpsPort => httpsOptions.Port;
    internal bool CertificateAvailable => certificateUrl is not null;
    internal bool GamepadDriverMissing => !gamepadService.IsAvailable;
    internal string StatusText => statusItem.Text ?? string.Empty;
    internal (string Text, bool Enabled) UpdateState => (updateItem.Text ?? string.Empty, updateItem.Enabled);

    public TrayApplicationContext(WebApplication app)
    {
        serverOptions = app.Services.GetRequiredService<ServerOptions>();
        logger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger<TrayApplicationContext>();
        pairingService = app.Services.GetRequiredService<PairingService>();
        connectionRegistry = app.Services.GetRequiredService<WebSocketConnectionRegistry>();
        fileTransferService = app.Services.GetRequiredService<FileTransferService>();
        fileOfferService = app.Services.GetRequiredService<FileOfferService>();
        clipboardReadNotifier = app.Services.GetRequiredService<ClipboardReadNotifier>();
        screenViewNotifier = app.Services.GetRequiredService<ScreenViewNotifier>();
        gamepadService = app.Services.GetRequiredService<IGamepadService>();
        shutdownTimer = app.Services.GetRequiredService<ShutdownTimer>();
        httpsOptions = app.Services.GetRequiredService<HttpsOptions>();
        var scheme = httpsOptions.Enabled ? "https" : "http";
        var port = httpsOptions.Enabled ? httpsOptions.Port : serverOptions.Port;
        localAddress = NetworkAddressService.GetLocalAddress(port, scheme);
        deviceAddress = NetworkAddressService.GetDeviceAddress(port, scheme);
        certificateUrl = httpsOptions.Enabled
            ? NetworkAddressService.GetCertificateUrl(serverOptions.Port)
            : null;
        var authority = httpsOptions.Enabled
            ? app.Services.GetService<ServerCertificateProvider>()?.ExportAuthorityCertificate()
            : null;
        authoritySha256 = authority is null ? null : Convert.ToHexStringLower(SHA256.HashData(authority));

        uiDispatcher.CreateControl();
        fileTransferService.FileReceived += OnFileReceived;
        fileOfferService.Downloaded += OnOfferedFileDownloaded;
        clipboardReadNotifier.Read += OnClipboardRead;
        clipboardReadNotifier.SyncEnabled += OnClipboardSyncEnabled;
        clipboardReadNotifier.NotificationsEnabled += OnNotificationsEnabled;
        screenViewNotifier.Started += OnScreenViewStarted;
        screenViewNotifier.AudioStarted += OnScreenAudioStarted;
        shutdownTimer.Changed += OnShutdownTimerChanged;

        var versionItem = new ToolStripMenuItem($"YFRemote v{updateService.CurrentVersion}")
        {
            Enabled = false
        };
        statusItem = new ToolStripMenuItem("Server läuft")
        {
            Enabled = false
        };
        var addressItem = new ToolStripMenuItem(deviceAddress)
        {
            Enabled = false
        };
        shutdownTimerItem = new ToolStripMenuItem();
        shutdownTimerItem.Click += (_, _) => CancelShutdownTimer();
        var showWindowItem = new ToolStripMenuItem("YFRemote öffnen...")
        {
            Font = new Font(SystemFonts.MenuFont ?? Control.DefaultFont, FontStyle.Bold)
        };
        showWindowItem.Click += (_, _) => ShowMainWindow();
        var openItem = new ToolStripMenuItem("Im Browser öffnen");
        openItem.Click += (_, _) => OpenInBrowser();

        var copyAddressItem = new ToolStripMenuItem("Geräteadresse kopieren");
        copyAddressItem.Click += (_, _) => CopyDeviceAddress();

        var qrCodeItem = new ToolStripMenuItem("QR-Code zum Verbinden...");
        qrCodeItem.Click += (_, _) => ShowPairingQrCode();

        var sendFileItem = new ToolStripMenuItem("Datei an Geräte senden...");
        sendFileItem.Click += (_, _) => OfferFile();

        httpsItem = new ToolStripMenuItem("HTTPS verwenden")
        {
            CheckOnClick = true,
            Checked = httpsOptions.Enabled
        };
        httpsItem.Click += (_, _) => ChangeHttps(httpsItem.Checked);

        var certificateItem = new ToolStripMenuItem("Zertifikat installieren...")
        {
            Visible = certificateUrl is not null
        };
        certificateItem.Click += (_, _) => ShowCertificateInstallDialog();

        gamepadDriverItem = new ToolStripMenuItem("Controller-Treiber installieren...");
        gamepadDriverItem.Click += (_, _) => OpenGamepadDriverDownload();

        var diagnosticsItem = new ToolStripMenuItem("Diagnoseordner öffnen");
        diagnosticsItem.Click += (_, _) => OpenDiagnosticsFolder();

        pinItem = new ToolStripMenuItem(FormatPinText(pairingService.GetCurrentPin()))
        {
            Enabled = false
        };

        var copyPinItem = new ToolStripMenuItem("PIN kopieren");
        copyPinItem.Click += (_, _) => CopyPin();

        var regeneratePinItem = new ToolStripMenuItem("PIN neu erzeugen");
        regeneratePinItem.Click += (_, _) => RegeneratePin();

        pairedDevicesItem = new ToolStripMenuItem("Gekoppelte Geräte");
        pairedDevicesItem.Click += (_, _) => ShowMainWindow();

        ringItem = new ToolStripMenuItem("Gerät klingeln lassen");

        updateItem = new ToolStripMenuItem(
            updateService.CanUpdate
                ? "Nach Updates suchen..."
                : "Updates nach Installation verfügbar");
        updateItem.Enabled = updateService.CanUpdate;
        updateItem.Click += async (_, _) => await HandleUpdateClickAsync();

        startWithWindowsItem = new ToolStripMenuItem("Mit Windows starten")
        {
            CheckOnClick = true,
            Checked = WindowsStartupService.IsEnabled(),
            Enabled = WindowsStartupService.IsAvailable
        };
        startWithWindowsItem.Click += (_, _) => ChangeStartWithWindows(startWithWindowsItem.Checked);

        var exitItem = new ToolStripMenuItem("Beenden");
        exitItem.Click += (_, _) => ExitApplication();

        var contextMenu = new ContextMenuStrip();
        Theme.UseDarkMenus(contextMenu);
        ringItem.DropDown.HandleCreated += (_, _) => Theme.UseRoundedCorners(ringItem.DropDown);
        contextMenu.Items.AddRange(
        [
            showWindowItem,
            new ToolStripSeparator(),
            versionItem,
            statusItem,
            addressItem,
            shutdownTimerItem,
            new ToolStripSeparator(),
            openItem,
            copyAddressItem,
            qrCodeItem,
            sendFileItem,
            httpsItem,
            certificateItem,
            gamepadDriverItem,
            diagnosticsItem,
            new ToolStripSeparator(),
            pinItem,
            copyPinItem,
            regeneratePinItem,
            pairedDevicesItem,
            ringItem,
            new ToolStripSeparator(),
            updateItem,
            new ToolStripSeparator(),
            startWithWindowsItem,
            new ToolStripSeparator(),
            exitItem
        ]);
        connectionRegistry.ConnectionsChanged += OnConnectionsChanged;
        contextMenu.Opening += (_, _) =>
        {
            RefreshPairingMenu();
            // Nach der Treiberinstallation verschwindet der Eintrag ohne Neustart.
            gamepadDriverItem.Visible = !gamepadService.IsAvailable;
            // Ein abgelaufener Termin meldet sich nicht, das Menue holt ihn hier nach.
            RefreshShutdownTimerItem();
            // Das Fenster kann den Autostart geaendert haben.
            startWithWindowsItem.Checked = WindowsStartupService.IsEnabled();
        };
        RefreshPairingMenu();
        gamepadDriverItem.Visible = !gamepadService.IsAvailable;
        RefreshShutdownTimerItem();

        trayIcon = LoadTrayIcon();
        notifyIcon = new NotifyIcon
        {
            ContextMenuStrip = contextMenu,
            Icon = trayIcon,
            Text = "YFRemote - Server läuft",
            Visible = true
        };
        notifyIcon.DoubleClick += (_, _) => ShowMainWindow();

        initialUpdateTimer = new System.Windows.Forms.Timer
        {
            Interval = 1500
        };
        initialUpdateTimer.Tick += async (_, _) =>
        {
            initialUpdateTimer.Stop();
            await CheckForUpdatesAsync(showResult: false);
        };

        periodicUpdateTimer = new System.Windows.Forms.Timer
        {
            Interval = checked((int)UpdateCheckInterval.TotalMilliseconds)
        };
        periodicUpdateTimer.Tick += async (_, _) => await CheckForUpdatesAsync(showResult: false);

        if (updateService.CanUpdate)
        {
            initialUpdateTimer.Start();
            periodicUpdateTimer.Start();
        }

        Notify(TrayNotification.Started, "YFRemote läuft", $"Der Server ist unter {deviceAddress} erreichbar.");
        _ = WindowsExplorerSendMenu.ListenAsync(
            path => uiDispatcher.BeginInvoke(() => OfferPath(path)),
            offerPipeStop.Token);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            offerPipeStop.Cancel();
            offerPipeStop.Dispose();
            fileTransferService.FileReceived -= OnFileReceived;
            fileOfferService.Downloaded -= OnOfferedFileDownloaded;
            clipboardReadNotifier.Read -= OnClipboardRead;
            clipboardReadNotifier.SyncEnabled -= OnClipboardSyncEnabled;
            clipboardReadNotifier.NotificationsEnabled -= OnNotificationsEnabled;
            screenViewNotifier.Started -= OnScreenViewStarted;
            screenViewNotifier.AudioStarted -= OnScreenAudioStarted;
            shutdownTimer.Changed -= OnShutdownTimerChanged;
            connectionRegistry.ConnectionsChanged -= OnConnectionsChanged;
            mainWindow?.Dispose();
            initialUpdateTimer.Dispose();
            periodicUpdateTimer.Dispose();
            notifyIcon.Visible = false;
            notifyIcon.ContextMenuStrip?.Dispose();
            notifyIcon.Dispose();
            trayIcon.Dispose();
            uiDispatcher.Dispose();
        }

        base.Dispose(disposing);
    }

    // Ein einziges Fenster: ein zweiter Doppelklick holt es nur nach vorn.
    internal void ShowMainWindow()
    {
        if (mainWindow is null || mainWindow.IsDisposed)
        {
            mainWindow = new MainWindow(this, pairingService, connectionRegistry, trayIcon);
        }

        mainWindow.Show();
        if (mainWindow.WindowState == FormWindowState.Minimized)
        {
            mainWindow.WindowState = FormWindowState.Normal;
        }

        mainWindow.Activate();
    }

    internal async Task HandleUpdateClickAsync()
    {
        if (updateOperationRunning || exiting)
        {
            return;
        }

        if (availableUpdate is null)
        {
            await CheckForUpdatesAsync(showResult: true);
            return;
        }

        var update = availableUpdate;
        var version = update.TargetFullRelease.Version;
        var answer = MessageDialog.Show(
            $"YFRemote v{version} wird heruntergeladen und anschließend neu gestartet.\n\nUpdate jetzt installieren?",
            "YFRemote-Update",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question);

        if (answer != DialogResult.Yes)
        {
            return;
        }

        updateOperationRunning = true;
        updateItem.Enabled = false;
        updateItem.Text = $"Update v{version} wird heruntergeladen...";

        try
        {
            await updateService.DownloadUpdatesAsync(update, progress =>
            {
                if (uiDispatcher.IsDisposed || !uiDispatcher.IsHandleCreated)
                {
                    return;
                }

                uiDispatcher.BeginInvoke((Action)(() =>
                    updateItem.Text = $"Update v{version}: {progress}%"));
            });

            updateItem.Text = "Update wird installiert...";
            updateService.ApplyAfterExit(update);
            ExitApplication();
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Failed to download or install update v{Version}.", version);
            updateOperationRunning = false;
            updateItem.Enabled = true;
            updateItem.Text = $"Neue Version v{version} verfügbar - installieren";
            ShowUpdateError("Das Update konnte nicht installiert werden.", exception);
        }
    }

    private async Task CheckForUpdatesAsync(bool showResult)
    {
        if (!updateService.CanUpdate || updateOperationRunning || exiting)
        {
            return;
        }

        updateOperationRunning = true;
        updateItem.Enabled = false;
        updateItem.Text = "Suche nach Updates...";

        try
        {
            availableUpdate = await updateService.CheckForUpdatesAsync();

            if (availableUpdate is null)
            {
                updateItem.Text = "Nach Updates suchen...";
                updateItem.Enabled = true;

                if (showResult)
                {
                    Notify(TrayNotification.Confirmations, "YFRemote ist aktuell", $"Installierte Version: v{updateService.CurrentVersion}");
                }

                return;
            }

            var version = availableUpdate.TargetFullRelease.Version;
            updateItem.Text = $"Neue Version v{version} verfügbar - installieren";
            updateItem.Enabled = true;

            Notify(TrayNotification.Update, "YFRemote-Update verfügbar", $"Version v{version} kann über das Tray-Menü installiert werden.");
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Update check failed.");
            updateItem.Text = "Updatesuche fehlgeschlagen - erneut versuchen";
            updateItem.Enabled = true;

            if (showResult)
            {
                ShowUpdateError("Die Updatesuche ist fehlgeschlagen.", exception);
            }
        }
        finally
        {
            updateOperationRunning = false;
        }
    }

    internal void OpenInBrowser()
    {
        try
        {
            Process.Start(new ProcessStartInfo(localAddress)
            {
                UseShellExecute = true
            });
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Failed to open the local web UI.");
            MessageDialog.Show(
                $"Der Browser konnte nicht geöffnet werden.\n\n{exception.Message}",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    // Kommt vom HTTP-Request-Thread des /files-Endpoints, nicht vom UI-Thread - deshalb ueber
    // uiDispatcher.BeginInvoke statt notifyIcon direkt anzufassen.
    private void OnFileReceived(string fileName) =>
        uiDispatcher.BeginInvoke(() =>
            Notify(TrayNotification.FileReceived, "Datei empfangen", fileName));

    // Wie OnFileReceived vom HTTP-Request-Thread aufgerufen, daher ueber den uiDispatcher.
    private void OnOfferedFileDownloaded(string fileName, string deviceName) =>
        uiDispatcher.BeginInvoke(() =>
            Notify(TrayNotification.FileSent, "Datei gesendet", $"\"{fileName}\" wurde an \"{deviceName}\" gesendet."));

    internal void OfferFile()
    {
        using var dialog = new OpenFileDialog { Title = "Datei an Geräte senden" };
        if (dialog.ShowDialog() == DialogResult.OK)
        {
            OfferPath(dialog.FileName);
        }
    }

    // Auch fuer "An YFRemote-Geräte senden" im Explorer, siehe WindowsExplorerSendMenu.
    public void OfferPath(string path)
    {
        try
        {
            var offer = fileOfferService.Offer(path);
            Notify(
                TrayNotification.Confirmations,
                "Datei bereitgestellt",
                $"\"{offer.Name}\" kann jetzt 10 Minuten lang auf den gekoppelten Geräten geladen werden.");
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Failed to offer a file.");
            MessageDialog.Show(
                $"Die Datei konnte nicht bereitgestellt werden.\n\n{exception.Message}",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    // Wie OnFileReceived vom HTTP-Request-Thread aufgerufen, daher ueber den uiDispatcher.
    private void OnClipboardRead(string deviceName) =>
        uiDispatcher.BeginInvoke(() =>
            Notify(TrayNotification.Clipboard, "Zwischenablage gesendet", $"Die Zwischenablage wurde an \"{deviceName}\" gesendet."));

    private void OnClipboardSyncEnabled(string deviceName) =>
        uiDispatcher.BeginInvoke(() =>
            Notify(TrayNotification.Clipboard, "Zwischenablage-Abgleich", $"\"{deviceName}\" bekommt ab jetzt alles, was du kopierst."));

    private void OnNotificationsEnabled(string deviceName) =>
        uiDispatcher.BeginInvoke(() =>
            Notify(
                TrayNotification.PcNotifications,
                "Benachrichtigungen weitergeleitet",
                $"\"{deviceName}\" bekommt ab jetzt die Windows-Benachrichtigungen dieses PCs."));

    private void OnScreenViewStarted(string deviceName) =>
        uiDispatcher.BeginInvoke(() =>
            Notify(TrayNotification.ScreenView, "Bildschirm wird übertragen", $"\"{deviceName}\" sieht deinen Bildschirm."));

    private void OnScreenAudioStarted(string deviceName) =>
        uiDispatcher.BeginInvoke(() =>
            Notify(TrayNotification.ScreenAudio, "PC-Ton wird übertragen", $"\"{deviceName}\" hört den Ton deines PCs."));

    // Ein Geraet plant das Herunterfahren aus der Ferne - wer am PC sitzt, soll das sehen und
    // ueber das Tray-Menue abbrechen koennen, bevor ungespeicherte Arbeit im Weg steht.
    private void OnShutdownTimerChanged(string? deviceName) =>
        uiDispatcher.BeginInvoke(() =>
        {
            RefreshShutdownTimerItem();
            if (deviceName is null)
            {
                return;
            }

            var (noun, announcement) = TimerTexts(shutdownTimer.Action);
            if (shutdownTimer.DueAt is { } dueAt)
            {
                Notify(
                    TrayNotification.ShutdownTimer,
                    $"{noun} geplant",
                    $"\"{deviceName}\" {string.Format(announcement, dueAt)}. Abbrechen über das Tray-Menü.", ToolTipIcon.Warning);
            }
            else
            {
                Notify(TrayNotification.ShutdownTimer, $"{noun} abgebrochen", $"\"{deviceName}\" hat den Termin abgebrochen.");
            }
        });

    private static (string Noun, string Announcement) TimerTexts(TimerAction action) => action switch
    {
        TimerAction.Sleep => ("Ruhemodus", "schickt den PC um {0:HH:mm} Uhr in den Ruhemodus"),
        TimerAction.DisplayOff => ("Bildschirm aus", "schaltet den Bildschirm um {0:HH:mm} Uhr aus"),
        _ => ("Herunterfahren", "fährt den PC um {0:HH:mm} Uhr herunter"),
    };

    internal void CancelShutdownTimer() => shutdownTimer.Cancel(deviceName: null);

    internal string? GetShutdownTimerText()
    {
        if (shutdownTimer.DueAt is not { } dueAt)
        {
            return null;
        }

        var (noun, _) = TimerTexts(shutdownTimer.Action);
        return $"{noun} um {dueAt:HH:mm} Uhr geplant";
    }

    private void RefreshShutdownTimerItem()
    {
        var dueAt = shutdownTimer.DueAt;
        var (noun, _) = TimerTexts(shutdownTimer.Action);
        shutdownTimerItem.Visible = dueAt is not null;
        shutdownTimerItem.Text = $"{noun} um {dueAt:HH:mm} Uhr abbrechen";
    }

    // Kommt vom Thread der WebSocket-Verbindung. Ist das Menue gerade offen, wird die Geraeteanzahl
    // sofort aktualisiert, sonst reicht das naechste Opening.
    private void OnConnectionsChanged() =>
        uiDispatcher.BeginInvoke(() =>
        {
            UpdateConnectionStatus();
            if (notifyIcon.ContextMenuStrip?.Visible == true)
            {
                RefreshPairingMenu();
            }
        });

    private void UpdateConnectionStatus()
    {
        var connected = connectionRegistry.ConnectedDeviceCount;
        var status = connected switch
        {
            0 => "Server läuft",
            1 => "1 Gerät verbunden",
            _ => $"{connected} Geräte verbunden"
        };
        statusItem.Text = status;
        notifyIcon.Text = $"YFRemote - {status}";
    }

    internal void CopyDeviceAddress()
    {
        try
        {
            Clipboard.SetText(deviceAddress);
            Notify(TrayNotification.Confirmations, "Adresse kopiert", deviceAddress);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Failed to copy the device address.");
            MessageDialog.Show(
                $"Die Adresse konnte nicht kopiert werden.\n\n{exception.Message}",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    internal void ShowPairingQrCode()
    {
        try
        {
            using var dialog = new PairingQrCodeDialog(deviceAddress, pairingService, authoritySha256, serverOptions.Port);
            dialog.ShowDialog();
            RefreshPairingMenu();
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Failed to show the pairing QR code dialog.");
            MessageDialog.Show(
                $"Der QR-Code konnte nicht angezeigt werden.\n\n{exception.Message}",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    internal void ShowCertificateInstallDialog()
    {
        if (certificateUrl is null)
        {
            return;
        }

        try
        {
            using var dialog = new CertificateInstallDialog(certificateUrl);
            dialog.ShowDialog();
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Failed to show the certificate install dialog.");
            MessageDialog.Show(
                $"Der QR-Code für das Zertifikat konnte nicht angezeigt werden.\n\n{exception.Message}",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    // ViGEmBus braucht Adminrechte und laesst sich deshalb nicht mit der benutzerbezogenen
    // Velopack-Installation ausliefern - der Nutzer installiert ihn einmalig selbst.
    internal void OpenGamepadDriverDownload()
    {
        var answer = MessageDialog.Show(
            "Für den Controller-Modus braucht Windows den Treiber \"ViGEmBus\". Er macht das Handy "
            + "für Spiele zu einem Xbox-Controller.\n\nAuf der folgenden Seite die Datei "
            + "\"ViGEmBus_…_x64_x86_arm64.exe\" herunterladen und installieren. Ein Neustart von "
            + "YFRemote ist danach nicht nötig.\n\nDownloadseite jetzt öffnen?",
            "YFRemote - Controller-Treiber",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Information);

        if (answer != DialogResult.Yes)
        {
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo(GamepadDriverUrl)
            {
                UseShellExecute = true
            });
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Failed to open the gamepad driver download page.");
            MessageDialog.Show(
                $"Der Browser konnte nicht geöffnet werden.\n\n{GamepadDriverUrl}\n\n{exception.Message}",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    internal void OpenDiagnosticsFolder()
    {
        try
        {
            var logDirectory = DiagnosticPaths.EnsureLogDirectory();
            Process.Start(new ProcessStartInfo(logDirectory)
            {
                UseShellExecute = true
            });
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Failed to open the diagnostics directory.");
            MessageDialog.Show(
                $"Der Diagnoseordner konnte nicht geöffnet werden.\n\n{exception.Message}",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private void RefreshPairingMenu()
    {
        pinItem.Text = FormatPinText(pairingService.GetCurrentPin());

        var pairedDevices = pairingService.GetPairedDevices();
        var connectedCount = pairedDevices.Count(device => connectionRegistry.IsConnected(device.Id));
        pairedDevicesItem.Text = connectedCount == 0
            ? $"Gekoppelte Geräte ({pairedDevices.Count})..."
            : $"Gekoppelte Geräte ({pairedDevices.Count}, {connectedCount} verbunden)...";
        pairedDevicesItem.Enabled = pairedDevices.Count > 0;

        // Nur verbundene Geraete koennen klingeln; die Android-App haelt die Verbindung auch im
        // Hintergrund, ein Browser nur, solange die Seite offen ist.
        ringItem.DropDownItems.Clear();
        foreach (var device in pairedDevices.Where(device => connectionRegistry.IsConnected(device.Id)))
        {
            var deviceItem = new ToolStripMenuItem(device.Name);
            deviceItem.Click += (_, _) => RingDevice(device);
            ringItem.DropDownItems.Add(deviceItem);
        }

        ringItem.Enabled = ringItem.DropDownItems.Count > 0;
    }

    internal void RingDevice(PairedDeviceInfo device)
    {
        if (!connectionRegistry.IsConnected(device.Id))
        {
            return;
        }

        connectionRegistry.Ring(device.Id);
        Notify(TrayNotification.Confirmations, "Gerät klingelt", $"\"{device.Name}\" klingelt, bis es dort gestoppt wird.");
    }

    internal void SetMediaOnly(IReadOnlyList<PairedDeviceInfo> devices, bool mediaOnly)
    {
        var failed = new List<string>();
        foreach (var device in devices)
        {
            if (device.MediaOnly == mediaOnly)
            {
                continue;
            }

            if (!pairingService.SetMediaOnly(device.Id, mediaOnly))
            {
                failed.Add(device.Name);
                continue;
            }

            // Die offene Verbindung hat das alte Recht; der Client verbindet sich gleich neu.
            connectionRegistry.CloseConnections(device.Id);
        }

        if (failed.Count > 0)
        {
            MessageDialog.Show(
                $"Nicht dauerhaft gespeichert: {string.Join(", ", failed)}\n\nBitte erneut versuchen.",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        Notify(TrayNotification.Confirmations, mediaOnly ? "Nur Medien" : "Vollzugriff", string.Join(", ", devices.Select(device => device.Name)));
    }

    internal void UnpairDevices(IReadOnlyList<PairedDeviceInfo> devices)
    {
        var removed = new List<string>();
        var failed = new List<string>();
        foreach (var selected in devices)
        {
            if (pairingService.RemoveDevice(selected.Id))
            {
                connectionRegistry.CloseConnections(selected.Id);
                removed.Add(selected.Name);
                continue;
            }

            logger.LogWarning("Failed to permanently unpair device {DeviceId}.", selected.Id);
            failed.Add(selected.Name);
        }

        if (removed.Count > 0)
        {
            Notify(
                TrayNotification.Confirmations,
                removed.Count == 1 ? "Gerät entkoppelt" : $"{removed.Count} Geräte entkoppelt",
                string.Join(", ", removed));
        }

        if (failed.Count > 0)
        {
            MessageDialog.Show(
                $"Nicht dauerhaft entkoppelt: {string.Join(", ", failed)}\n\nBitte erneut versuchen.",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    internal void CopyPin()
    {
        try
        {
            var (pin, _) = pairingService.GetCurrentPin();
            Clipboard.SetText(pin);
            Notify(TrayNotification.Confirmations, "PIN kopiert", pin);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Failed to copy the pairing PIN.");
            MessageDialog.Show(
                $"Die PIN konnte nicht kopiert werden.\n\n{exception.Message}",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    internal void RegeneratePin()
    {
        var pin = pairingService.RegeneratePin();
        pinItem.Text = FormatPinText(pin);
        Notify(TrayNotification.Confirmations, "Neue PIN erzeugt", pin.Pin);
    }

    // Eine Dauer fuer alle: Windows richtet sich seit Vista ohnehin nach den Systemeinstellungen.
    private void Notify(TrayNotification kind, string title, string text, ToolTipIcon icon = ToolTipIcon.Info)
    {
        if (IsNotificationEnabled(kind))
        {
            notifyIcon.ShowBalloonTip(4000, title, text, icon);
        }
    }

    internal bool IsNotificationEnabled(TrayNotification kind) => !disabledNotifications.Contains(kind.ToString());

    // Gibt wie ChangeStartWithWindows den Zustand zurueck, der jetzt gilt.
    internal bool ChangeNotification(TrayNotification kind, bool enabled)
    {
        try
        {
            UserSettingsStore.SetNotificationEnabled(kind.ToString(), enabled);
            disabledNotifications = UserSettingsStore.GetDisabledNotifications();
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Failed to store the notification setting {Kind}.", kind);
            MessageDialog.Show(
                $"Die Einstellung konnte nicht gespeichert werden.\n\n{exception.Message}",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }

        return IsNotificationEnabled(kind);
    }

    private static string FormatPinText((string Pin, DateTimeOffset ExpiresAtUtc) pin) =>
        $"PIN: {pin.Pin} (gültig bis {pin.ExpiresAtUtc.ToLocalTime():HH:mm})";

    // Gibt den tatsaechlichen Zustand zurueck, damit Menue und Fenster ihren Haken danach setzen.
    internal bool ChangeStartWithWindows(bool requestedState)
    {
        try
        {
            WindowsStartupService.SetEnabled(requestedState);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Failed to change the Windows startup setting.");
            MessageDialog.Show(
                $"Die Autostart-Einstellung konnte nicht gespeichert werden.\n\n{exception.Message}",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }

        return startWithWindowsItem.Checked = WindowsStartupService.IsEnabled();
    }

    // Rueckgabe ist der Zustand, der jetzt gilt. Einrichten und Entfernen laufen in einem erhoehten
    // Prozess, Windows fragt dafuer einmal per UAC.
    internal bool ChangeSecureDesktop(bool requestedState)
    {
        var question = requestedState
            ? "Sperrbildschirm und UAC-Abfragen vom Handy bedienen?\n\n"
                + "Dafür richtet YFRemote einen Windows-Dienst mit SYSTEM-Rechten ein. Gekoppelte Geräte mit "
                + "Vollzugriff sehen dann auch den Sperrbildschirm und UAC-Abfragen und können sie bedienen - "
                + "also den PC entsperren und Programmen Adminrechte geben. Ebenso bedienen sie Fenster, die "
                + "als Administrator laufen (z. B. den Task-Manager).\n\n"
                + "Bitte beachten:\n"
                + "- Ein am Handy getipptes Windows-Passwort geht über das Netzwerk. Ohne HTTPS ist es im "
                + "WLAN nicht verschlüsselt.\n"
                + "- Schadsoftware, die schon unter deinem Benutzer läuft, könnte darüber ihre eigene "
                + "UAC-Abfrage bestätigen.\n\n"
                + "Windows fragt gleich nach Adminrechten."
            : "Den Dienst für Sperrbildschirm und UAC-Abfragen entfernen?\n\nWindows fragt gleich nach Adminrechten.";
        if (MessageDialog.Show(question, "YFRemote", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes)
        {
            return !requestedState;
        }

        if (!WindowsSecureDesktop.ChangeServiceElevated(requestedState))
        {
            logger.LogWarning("Changing the secure desktop service to {State} failed or was cancelled.", requestedState);
        }
        else
        {
            logger.LogInformation("Secure desktop service {State}.", requestedState ? "installed" : "removed");
        }

        return WindowsSecureDesktop.IsServiceInstalled();
    }

    // Wie ChangeStartWithWindows: Rueckgabe ist der Zustand, der jetzt gilt. Bei Erfolg startet
    // YFRemote neu, der Haken spielt dann keine Rolle mehr.
    internal bool ChangeHttps(bool requestedState)
    {
        httpsItem.Checked = !requestedState;
        if (!TryStoreHttps(requestedState))
        {
            return !requestedState;
        }

        httpsItem.Checked = requestedState;
        RestartApplication();
        return requestedState;
    }

    private bool TryStoreHttps(bool requestedState)
    {
        // Mit HTTPS bindet Kestrel die Ports selbst und braucht dafuer eine IP statt eines Namens.
        // Ohne diese Pruefung wuerde der Neustart im Startfehler enden.
        if (requestedState && !IPAddress.TryParse(serverOptions.Host, out _))
        {
            MessageDialog.Show(
                $"HTTPS braucht unter \"Server:Host\" eine IP-Adresse (zum Beispiel 0.0.0.0). "
                    + $"Eingetragen ist \"{serverOptions.Host}\".",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
            return false;
        }

        var question = requestedState
            ? $"HTTPS einschalten?\n\nYFRemote ist danach zusätzlich über Port {httpsOptions.Port} "
                + "erreichbar; Port "
                + $"{serverOptions.Port} bleibt bestehen. Der Browser zeigt dabei eine "
                + "Zertifikatswarnung, die sich wegklicken lässt; wer sie dauerhaft los sein will, "
                + "installiert einmalig das Zertifikat (\"Zertifikat installieren...\" im "
                + "YFRemote-Fenster).\n\n"
                + "Weil sich die Adresse der Seite ändert, müssen alle gekoppelten Geräte neu gekoppelt "
                + "werden.\n\nYFRemote startet dafür neu."
            : "HTTPS ausschalten?\n\nYFRemote ist danach nur noch über HTTP erreichbar. Weil sich die "
                + "Adresse der Seite ändert, müssen alle über HTTPS gekoppelten Geräte neu gekoppelt "
                + "werden.\n\nYFRemote startet dafür neu.";

        if (MessageDialog.Show(
                question,
                "YFRemote",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question) != DialogResult.Yes)
        {
            return false;
        }

        try
        {
            UserSettingsStore.SetHttpsEnabled(requestedState);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Failed to store the HTTPS setting.");
            MessageDialog.Show(
                $"Die HTTPS-Einstellung konnte nicht gespeichert werden.\n\n{exception.Message}",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return false;
        }

        return true;
    }

    private void RestartApplication()
    {
        var executablePath = Environment.ProcessPath;

        if (executablePath is not null)
        {
            try
            {
                Process.Start(new ProcessStartInfo(executablePath)
                {
                    Arguments = Program.RestartWaitArgument,
                    UseShellExecute = true
                });

                ExitApplication();
                return;
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Failed to restart YFRemote after a settings change.");
            }
        }

        MessageDialog.Show(
            "Die Einstellung ist gespeichert. Beende YFRemote und starte es neu, damit sie wirksam wird.",
            "YFRemote",
            MessageBoxButtons.OK,
            MessageBoxIcon.Information);
    }

    private static void ShowUpdateError(string message, Exception exception)
    {
        MessageDialog.Show(
            $"{message}\n\n{exception.Message}",
            "YFRemote-Update",
            MessageBoxButtons.OK,
            MessageBoxIcon.Error);
    }

    private static Icon LoadTrayIcon()
    {
        var iconPath = Path.Combine(AppContext.BaseDirectory, "wwwroot", "favicon.ico");
        return File.Exists(iconPath)
            ? new Icon(iconPath)
            : (Icon)SystemIcons.Application.Clone();
    }

    internal void ExitApplication()
    {
        if (exiting)
        {
            return;
        }

        exiting = true;
        logger.LogInformation("Exit requested from the tray menu.");
        initialUpdateTimer.Stop();
        periodicUpdateTimer.Stop();
        notifyIcon.Visible = false;
        ExitThread();
    }
}

// Arten der Tray-Meldungen, die sich im YFRemote-Fenster einzeln abschalten lassen. Der Name
// landet als Schluessel in settings.json und darf sich deshalb nicht mehr aendern.
internal enum TrayNotification
{
    Started,
    Update,
    FileReceived,
    FileSent,
    Clipboard,
    PcNotifications,
    ScreenView,
    ScreenAudio,
    ShutdownTimer,
    Confirmations
}
