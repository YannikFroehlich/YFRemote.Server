using System.Diagnostics;
using Velopack;
using YFRemote.Server.Configuration;
using YFRemote.Server.Diagnostics;
using YFRemote.Server.Models;
using YFRemote.Server.Services;
using YFRemote.Server.Updates;

namespace YFRemote.Server.Tray;

internal sealed class TrayApplicationContext : ApplicationContext
{
    private static readonly TimeSpan UpdateCheckInterval = TimeSpan.FromHours(6);

    private readonly UpdateService updateService = new();
    private readonly ILogger<TrayApplicationContext> logger;
    private readonly PairingService pairingService;
    private readonly Icon trayIcon;
    private readonly NotifyIcon notifyIcon;
    private readonly ToolStripMenuItem updateItem;
    private readonly ToolStripMenuItem pinItem;
    private readonly ToolStripMenuItem pairedDevicesItem;
    private readonly System.Windows.Forms.Timer initialUpdateTimer;
    private readonly System.Windows.Forms.Timer periodicUpdateTimer;
    private readonly Control uiDispatcher = new();
    private readonly string localAddress;
    private readonly string deviceAddress;

    private UpdateInfo? availableUpdate;
    private bool updateOperationRunning;
    private bool exiting;

    public TrayApplicationContext(WebApplication app)
    {
        var serverOptions = app.Services.GetRequiredService<ServerOptions>();
        logger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger<TrayApplicationContext>();
        pairingService = app.Services.GetRequiredService<PairingService>();
        localAddress = NetworkAddressService.GetLocalAddress(serverOptions.Port);
        deviceAddress = NetworkAddressService.GetDeviceAddress(serverOptions.Port);

        uiDispatcher.CreateControl();

        var versionItem = new ToolStripMenuItem($"YFRemote v{updateService.CurrentVersion}")
        {
            Enabled = false
        };
        var statusItem = new ToolStripMenuItem("Server läuft")
        {
            Enabled = false
        };
        var addressItem = new ToolStripMenuItem(deviceAddress)
        {
            Enabled = false
        };
        var openItem = new ToolStripMenuItem("Im Browser öffnen");
        openItem.Click += (_, _) => OpenInBrowser();

        var copyAddressItem = new ToolStripMenuItem("Geräteadresse kopieren");
        copyAddressItem.Click += (_, _) => CopyDeviceAddress();

        var qrCodeItem = new ToolStripMenuItem("QR-Code zum Verbinden...");
        qrCodeItem.Click += (_, _) => ShowPairingQrCode();

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

        updateItem = new ToolStripMenuItem(
            updateService.CanUpdate
                ? "Nach Updates suchen..."
                : "Updates nach Installation verfügbar");
        updateItem.Enabled = updateService.CanUpdate;
        updateItem.Click += async (_, _) => await HandleUpdateClickAsync();

        var startWithWindowsItem = new ToolStripMenuItem("Mit Windows starten")
        {
            CheckOnClick = true,
            Checked = WindowsStartupService.IsEnabled(),
            Enabled = WindowsStartupService.IsAvailable
        };
        startWithWindowsItem.Click += (_, _) =>
            HandleStartWithWindowsClick(startWithWindowsItem);

        var exitItem = new ToolStripMenuItem("Beenden");
        exitItem.Click += (_, _) => ExitApplication();

        var contextMenu = new ContextMenuStrip();
        contextMenu.Items.AddRange(
        [
            versionItem,
            statusItem,
            addressItem,
            new ToolStripSeparator(),
            openItem,
            copyAddressItem,
            qrCodeItem,
            diagnosticsItem,
            new ToolStripSeparator(),
            pinItem,
            copyPinItem,
            regeneratePinItem,
            pairedDevicesItem,
            new ToolStripSeparator(),
            updateItem,
            new ToolStripSeparator(),
            startWithWindowsItem,
            new ToolStripSeparator(),
            exitItem
        ]);
        contextMenu.Opening += (_, _) => RefreshPairingMenu();
        RefreshPairingMenu();

        trayIcon = LoadTrayIcon();
        notifyIcon = new NotifyIcon
        {
            ContextMenuStrip = contextMenu,
            Icon = trayIcon,
            Text = "YFRemote - Server läuft",
            Visible = true
        };
        notifyIcon.DoubleClick += (_, _) => OpenInBrowser();

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

        notifyIcon.ShowBalloonTip(
            5000,
            "YFRemote läuft",
            $"Der Server ist unter {deviceAddress} erreichbar.",
            ToolTipIcon.Info);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
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

    private async Task HandleUpdateClickAsync()
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
        var answer = MessageBox.Show(
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
                    notifyIcon.ShowBalloonTip(
                        4000,
                        "YFRemote ist aktuell",
                        $"Installierte Version: v{updateService.CurrentVersion}",
                        ToolTipIcon.Info);
                }

                return;
            }

            var version = availableUpdate.TargetFullRelease.Version;
            updateItem.Text = $"Neue Version v{version} verfügbar - installieren";
            updateItem.Enabled = true;

            notifyIcon.ShowBalloonTip(
                6000,
                "YFRemote-Update verfügbar",
                $"Version v{version} kann über das Tray-Menü installiert werden.",
                ToolTipIcon.Info);
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

    private void OpenInBrowser()
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
            MessageBox.Show(
                $"Der Browser konnte nicht geöffnet werden.\n\n{exception.Message}",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private void CopyDeviceAddress()
    {
        try
        {
            Clipboard.SetText(deviceAddress);
            notifyIcon.ShowBalloonTip(
                3000,
                "Adresse kopiert",
                deviceAddress,
                ToolTipIcon.Info);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Failed to copy the device address.");
            MessageBox.Show(
                $"Die Adresse konnte nicht kopiert werden.\n\n{exception.Message}",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private void ShowPairingQrCode()
    {
        try
        {
            using var dialog = new PairingQrCodeDialog(deviceAddress, pairingService);
            dialog.ShowDialog();
            RefreshPairingMenu();
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Failed to show the pairing QR code dialog.");
            MessageBox.Show(
                $"Der QR-Code konnte nicht angezeigt werden.\n\n{exception.Message}",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private void OpenDiagnosticsFolder()
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
            MessageBox.Show(
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
        pairedDevicesItem.Text = $"Gekoppelte Geräte ({pairedDevices.Count})";
        pairedDevicesItem.DropDownItems.Clear();

        if (pairedDevices.Count == 0)
        {
            pairedDevicesItem.DropDownItems.Add(new ToolStripMenuItem("Keine gekoppelten Geräte")
            {
                Enabled = false
            });
            return;
        }

        foreach (var device in pairedDevices.OrderByDescending(device => device.LastSeenUtc))
        {
            var deviceItem = new ToolStripMenuItem(
                $"{device.Name} (zuletzt: {FormatLastSeen(device.LastSeenUtc)})");
            deviceItem.Click += (_, _) => HandleRemoveDeviceClick(device);
            pairedDevicesItem.DropDownItems.Add(deviceItem);
        }
    }

    private void HandleRemoveDeviceClick(PairedDeviceInfo device)
    {
        var answer = MessageBox.Show(
            $"Gerät \"{device.Name}\" entkoppeln?\n\nEs kann sich danach nur mit einer neuen PIN erneut verbinden.",
            "YFRemote",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question);

        if (answer != DialogResult.Yes)
        {
            return;
        }

        if (pairingService.RemoveDevice(device.Id))
        {
            notifyIcon.ShowBalloonTip(3000, "Gerät entkoppelt", device.Name, ToolTipIcon.Info);
            return;
        }

        logger.LogWarning("Failed to permanently unpair device {DeviceId}.", device.Id);
        MessageBox.Show(
            "Das Gerät konnte nicht dauerhaft entkoppelt werden. Bitte erneut versuchen.",
            "YFRemote",
            MessageBoxButtons.OK,
            MessageBoxIcon.Error);
    }

    private void CopyPin()
    {
        try
        {
            var (pin, _) = pairingService.GetCurrentPin();
            Clipboard.SetText(pin);
            notifyIcon.ShowBalloonTip(3000, "PIN kopiert", pin, ToolTipIcon.Info);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Failed to copy the pairing PIN.");
            MessageBox.Show(
                $"Die PIN konnte nicht kopiert werden.\n\n{exception.Message}",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private void RegeneratePin()
    {
        var pin = pairingService.RegeneratePin();
        pinItem.Text = FormatPinText(pin);
        notifyIcon.ShowBalloonTip(4000, "Neue PIN erzeugt", pin.Pin, ToolTipIcon.Info);
    }

    private static string FormatPinText((string Pin, DateTimeOffset ExpiresAtUtc) pin) =>
        $"PIN: {pin.Pin} (gültig bis {pin.ExpiresAtUtc.ToLocalTime():HH:mm})";

    private static string FormatLastSeen(DateTimeOffset lastSeenUtc) =>
        lastSeenUtc.ToLocalTime().ToString("dd.MM. HH:mm");

    private void HandleStartWithWindowsClick(ToolStripMenuItem menuItem)
    {
        var requestedState = menuItem.Checked;

        try
        {
            WindowsStartupService.SetEnabled(requestedState);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Failed to change the Windows startup setting.");
            menuItem.Checked = !requestedState;
            MessageBox.Show(
                $"Die Autostart-Einstellung konnte nicht gespeichert werden.\n\n{exception.Message}",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private static void ShowUpdateError(string message, Exception exception)
    {
        MessageBox.Show(
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

    private void ExitApplication()
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
