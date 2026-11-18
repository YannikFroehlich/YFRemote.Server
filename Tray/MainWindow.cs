using System.Drawing.Drawing2D;
using YFRemote.Server.Models;
using YFRemote.Server.Services;
using YFRemote.Server.WebSockets;

namespace YFRemote.Server.Tray;

// Fasst Status, Koppeln, Geräte und Einstellungen in einem Fenster zusammen. Die Aktionen selbst
// bleiben in TrayApplicationContext, damit Menü und Fenster dasselbe tun.
internal sealed class MainWindow : Form
{
    private readonly TrayApplicationContext tray;
    private readonly PairingService pairingService;
    private readonly WebSocketConnectionRegistry connectionRegistry;
    private readonly Panel scrollPanel;
    private readonly TableLayoutPanel layout;
    private readonly Label statusLabel;
    private readonly FlowLayoutPanel shutdownTimerRow;
    private readonly Label shutdownTimerLabel;
    private readonly Label pinLabel;
    private readonly Label pinExpiryLabel;
    private readonly ListView deviceList;
    private readonly PillButton ringButton;
    private readonly PillButton mediaOnlyButton;
    private readonly PillButton fullAccessButton;
    private readonly PillButton unpairButton;
    private readonly ToggleSwitch httpsSwitch;
    private readonly ToggleSwitch startWithWindowsSwitch;
    private readonly PillButton gamepadDriverButton;
    private readonly PillButton updateButton;
    private readonly System.Windows.Forms.Timer refreshTimer;

    private readonly Font headerFont = new("Segoe UI Semibold", 8F);
    private readonly Font nameFont = new("Segoe UI Semibold", 9.5F);
    private readonly Font badgeFont = new("Segoe UI Semibold", 8.5F);

    private string shownDevicesKey = string.Empty;
    private int hoveredRow = -1;

    public MainWindow(
        TrayApplicationContext tray,
        PairingService pairingService,
        WebSocketConnectionRegistry connectionRegistry,
        Icon icon)
    {
        this.tray = tray;
        this.pairingService = pairingService;
        this.connectionRegistry = connectionRegistry;

        Text = "YFRemote";
        Icon = icon;
        ClientSize = new Size(600, 780);
        MinimumSize = new Size(520, 480);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleDimensions = new SizeF(96F, 96F);
        AutoScaleMode = AutoScaleMode.Dpi;
        Theme.Apply(this);

        // Gescrollt wird ein Panel um das Layout: Ein TableLayoutPanel mit AutoScroll zählt seinen
        // unteren Innenabstand nicht mit, der letzte Knopf war dann nicht ganz erreichbar.
        scrollPanel = new Panel { Dock = DockStyle.Fill, AutoScroll = true };
        layout = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            ColumnCount = 1,
            Padding = new Padding(20, 18, 20, 20)
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));

        // Kopf
        var titleLabel = new Label
        {
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 20F),
            Text = "YFRemote",
            Margin = new Padding(0)
        };
        var versionLabel = new Label
        {
            AutoSize = true,
            ForeColor = Theme.Muted,
            Text = $"v{tray.Version}",
            Margin = new Padding(6, 14, 0, 0)
        };
        statusLabel = new Label
        {
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 9F),
            Margin = new Padding(0, 4, 0, 14)
        };

        // Verbindung
        var addressTextBox = new TextBox
        {
            ReadOnly = true,
            // Sonst bekommt das Feld beim Öffnen den Fokus und die Adresse steht markiert da.
            TabStop = false,
            Text = tray.DeviceAddress,
            Font = new Font("Segoe UI", 11F),
            BorderStyle = BorderStyle.None,
            BackColor = Theme.Card,
            ForeColor = Theme.Text,
            Width = 420,
            Margin = new Padding(0, 0, 0, 10)
        };
        shutdownTimerLabel = new Label
        {
            AutoSize = true,
            ForeColor = Theme.Warning,
            Font = new Font("Segoe UI Semibold", 9.5F),
            Margin = new Padding(0, 9, 10, 0)
        };
        shutdownTimerRow = Row(shutdownTimerLabel, new PillButton("Abbrechen", ButtonKind.Danger, tray.CancelShutdownTimer));

        // Koppeln
        pinLabel = new Label
        {
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 30F),
            ForeColor = Theme.Accent,
            Margin = new Padding(0, 0, 0, 0)
        };
        pinExpiryLabel = new Label { AutoSize = true, ForeColor = Theme.Muted, Margin = new Padding(2, 0, 0, 12) };

        // Geräte
        deviceList = new ListView
        {
            View = View.Details,
            FullRowSelect = true,
            HideSelection = false,
            MultiSelect = true,
            OwnerDraw = true,
            Dock = DockStyle.Fill,
            Height = 170,
            BackColor = Theme.Card,
            ForeColor = Theme.Text,
            BorderStyle = BorderStyle.None,
            Margin = new Padding(0, 0, 0, 12),
            // Die Zeilenhöhe richtet sich in WinForms nach der Bildliste - ein leeres 1-Pixel-Bild
            // macht die Zeilen so luftig wie die Listen der Weboberfläche.
            SmallImageList = new ImageList { ImageSize = new Size(1, LogicalToDeviceUnits(50)) }
        };
        deviceList.Columns.Add("GERÄT", 215);
        deviceList.Columns.Add("STATUS", 175);
        deviceList.Columns.Add("ZUGRIFF", 100);
        // Selbst gezeichnet: Kopfzeile und Auswahl blieben sonst hell bzw. Windows-blau.
        deviceList.DrawColumnHeader += DrawDeviceHeader;
        deviceList.DrawItem += (_, _) => { };
        deviceList.DrawSubItem += DrawDeviceCell;
        deviceList.MouseMove += (_, e) => SetHoveredRow(deviceList.HitTest(e.Location).Item?.Index ?? -1);
        deviceList.MouseLeave += (_, _) => SetHoveredRow(-1);
        deviceList.SelectedIndexChanged += (_, _) => UpdateDeviceButtons();
        // -2 füllt die letzte Spalte bis zum Rand, sonst bleibt dort ein heller Kopfzeilenrest.
        deviceList.Resize += (_, _) => deviceList.Columns[^1].Width = -2;

        ringButton = new PillButton("Klingeln", ButtonKind.Secondary, () => SelectedDevices().ForEach(tray.RingDevice));
        mediaOnlyButton = new PillButton("Nur Medien", ButtonKind.Secondary, () => ChangeDevices(devices => tray.SetMediaOnly(devices, true)));
        fullAccessButton = new PillButton("Vollzugriff", ButtonKind.Secondary, () => ChangeDevices(devices => tray.SetMediaOnly(devices, false)));
        unpairButton = new PillButton("Entkoppeln", ButtonKind.Danger, UnpairSelected);

        // Einstellungen
        httpsSwitch = new ToggleSwitch("HTTPS verwenden", $"Zusätzlich verschlüsselt über Port {tray.HttpsPort}. YFRemote startet dafür neu.");
        httpsSwitch.Click += (_, _) => httpsSwitch.Checked = tray.ChangeHttps(httpsSwitch.Checked);
        startWithWindowsSwitch = new ToggleSwitch(
            "Mit Windows starten",
            WindowsStartupService.IsAvailable ? "YFRemote startet bei der Anmeldung im Hintergrund." : "Nur in der installierten Version verfügbar.")
        {
            Enabled = WindowsStartupService.IsAvailable
        };
        startWithWindowsSwitch.Click += (_, _) =>
            startWithWindowsSwitch.Checked = tray.ChangeStartWithWindows(startWithWindowsSwitch.Checked);
        var certificateButton = new PillButton("Zertifikat installieren...", ButtonKind.Secondary, tray.ShowCertificateInstallDialog)
        {
            Visible = tray.CertificateAvailable
        };
        gamepadDriverButton = new PillButton("Controller-Treiber installieren...", ButtonKind.Secondary, tray.OpenGamepadDriverDownload);

        updateButton = new PillButton(string.Empty, ButtonKind.Primary, () => _ = tray.HandleUpdateClickAsync());

        Theme.AddRows(layout,
            Row(titleLabel, versionLabel),
            statusLabel,
            new Card("Verbindung",
                Theme.Hint("Diese Adresse auf dem Handy, Tablet oder einem anderen PC im selben Netzwerk öffnen."),
                addressTextBox,
                Row(
                    new PillButton("Im Browser öffnen", ButtonKind.Primary, tray.OpenInBrowser),
                    new PillButton("Adresse kopieren", ButtonKind.Secondary, tray.CopyDeviceAddress)),
                shutdownTimerRow),
            new Card("Neues Gerät koppeln",
                Theme.Hint("Diese PIN auf dem neuen Gerät eingeben oder den QR-Code scannen."),
                pinLabel,
                pinExpiryLabel,
                Row(
                    new PillButton("QR-Code anzeigen", ButtonKind.Primary, () => { tray.ShowPairingQrCode(); RefreshState(); }),
                    new PillButton("PIN kopieren", ButtonKind.Secondary, tray.CopyPin),
                    new PillButton("Neue PIN", ButtonKind.Secondary, () => { tray.RegeneratePin(); RefreshState(); }))),
            new Card("Gekoppelte Geräte",
                Theme.Hint("\"Nur Medien\" erlaubt nur Wiedergabe, Lautstärke und Mixer - kein Tippen, keine Maus, "
                    + "kein Ausschalten, keine Dateien und keine Zwischenablage. Mehrere Geräte mit Strg auswählen."),
                deviceList,
                Row(ringButton, mediaOnlyButton, fullAccessButton, unpairButton)),
            new Card("Dateien",
                Theme.Hint("Die Datei steht danach 10 Minuten lang auf den gekoppelten Geräten zum Laden bereit."),
                Row(new PillButton("Datei an Geräte senden...", ButtonKind.Secondary, tray.OfferFile))),
            new Card("Einstellungen",
                httpsSwitch,
                startWithWindowsSwitch,
                Row(
                    certificateButton,
                    gamepadDriverButton,
                    new PillButton("Diagnoseordner öffnen", ButtonKind.Secondary, tray.OpenDiagnosticsFolder))),
            new Card("Benachrichtigungen",
                [
                    Theme.Hint("Welche Meldungen YFRemote unten rechts am Bildschirm anzeigt."),
                    .. NotificationSwitches()
                ]),
            new Card("Updates",
                Theme.Hint($"Installiert ist v{tray.Version}. YFRemote sucht alle 6 Stunden selbst nach Updates."),
                Row(updateButton)),
            Row(new PillButton("YFRemote beenden", ButtonKind.Secondary, tray.ExitApplication)));

        scrollPanel.Controls.Add(layout);
        Controls.Add(scrollPanel);

        // ponytail: Abfrage im Sekundentakt statt Events fuer jede Quelle; alles liest nur Speicher.
        refreshTimer = new System.Windows.Forms.Timer { Interval = 1000 };
        refreshTimer.Tick += (_, _) => RefreshState();
        refreshTimer.Start();
        RefreshState();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Theme.UseDarkScrollBars(scrollPanel);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            refreshTimer.Dispose();
            deviceList.SmallImageList?.Dispose();
            headerFont.Dispose();
            nameFont.Dispose();
            badgeFont.Dispose();
        }

        base.Dispose(disposing);
    }

    private void DrawDeviceHeader(object? sender, DrawListViewColumnHeaderEventArgs e)
    {
        using var background = new SolidBrush(Theme.Card);
        using var line = new Pen(Theme.Line);
        e.Graphics.FillRectangle(background, e.Bounds);
        e.Graphics.DrawLine(line, e.Bounds.Left, e.Bounds.Bottom - 1, e.Bounds.Right, e.Bounds.Bottom - 1);
        TextRenderer.DrawText(e.Graphics, e.Header?.Text, headerFont, Rectangle.Inflate(e.Bounds, -10, 0), Theme.Muted,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter);
    }

    // Name kräftig, Status mit farbigem Punkt, Zugriff als Plakette - wie die Gerätekarten im Client.
    private void DrawDeviceCell(object? sender, DrawListViewSubItemEventArgs e)
    {
        if (e.Item is null)
        {
            return;
        }

        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var row = e.Item.Selected ? Theme.Selection : e.ItemIndex == hoveredRow ? Theme.Raised : Theme.Card;
        using (var background = new SolidBrush(row))
        using (var line = new Pen(Theme.Line))
        {
            g.FillRectangle(background, e.Bounds);
            g.DrawLine(line, e.Bounds.Left, e.Bounds.Bottom - 1, e.Bounds.Right, e.Bounds.Bottom - 1);
        }

        // Akzentstreifen links an markierten Zeilen.
        if (e.ColumnIndex == 0 && e.Item.Selected)
        {
            using var accent = new SolidBrush(Theme.Accent);
            g.FillRectangle(accent, e.Bounds.Left, e.Bounds.Top + 6, LogicalToDeviceUnits(3), e.Bounds.Height - 12);
        }

        var cell = Rectangle.Inflate(e.Bounds, -10, 0);
        const TextFormatFlags flags = TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix;
        if (e.Item.Tag is not PairedDeviceInfo device)
        {
            if (e.ColumnIndex == 0)
            {
                TextRenderer.DrawText(g, e.Item.Text, Font, new Rectangle(cell.X, cell.Y, deviceList.ClientSize.Width, cell.Height), Theme.Muted, flags);
            }

            return;
        }

        var connected = connectionRegistry.IsConnected(device.Id);
        switch (e.ColumnIndex)
        {
            case 0:
                // Zweizeilig: Name, darunter klein das Kopplungsdatum.
                var middle = cell.Top + cell.Height / 2;
                TextRenderer.DrawText(g, device.Name, nameFont, Rectangle.FromLTRB(cell.Left, cell.Top, cell.Right, middle + 1), Theme.Text,
                    (flags & ~TextFormatFlags.VerticalCenter) | TextFormatFlags.Bottom);
                TextRenderer.DrawText(g, $"Gekoppelt am {device.PairedAtUtc.ToLocalTime():dd.MM.yyyy}", headerFont,
                    Rectangle.FromLTRB(cell.Left, middle + 2, cell.Right, cell.Bottom), Theme.Muted, flags & ~TextFormatFlags.VerticalCenter);
                break;
            case 1:
                var dot = LogicalToDeviceUnits(8);
                using (var brush = new SolidBrush(connected ? Theme.Success : Theme.Disabled))
                {
                    g.FillEllipse(brush, cell.X, cell.Y + (cell.Height - dot) / 2, dot, dot);
                }

                var text = connected ? "Verbunden" : $"Zuletzt {device.LastSeenUtc.ToLocalTime():dd.MM. HH:mm}";
                TextRenderer.DrawText(g, text, Font, Rectangle.FromLTRB(cell.X + dot + 8, cell.Top, cell.Right, cell.Bottom),
                    connected ? Theme.Success : Theme.Muted, flags);
                break;
            default:
                var label = device.MediaOnly ? "Nur Medien" : "Vollzugriff";
                var color = device.MediaOnly ? Theme.Warning : Theme.Accent;
                var size = TextRenderer.MeasureText(label, badgeFont);
                var badge = new RectangleF(cell.X, cell.Y + (cell.Height - size.Height - 6) / 2F, size.Width + 14, size.Height + 6);
                using (var path = Theme.RoundedRectangle(badge, badge.Height / 2))
                using (var fill = new SolidBrush(Color.FromArgb(36, color)))
                using (var border = new Pen(Color.FromArgb(80, color)))
                {
                    g.FillPath(fill, path);
                    g.DrawPath(border, path);
                }

                TextRenderer.DrawText(g, label, badgeFont, Rectangle.Round(badge), color,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
                break;
        }
    }

    private void SetHoveredRow(int index)
    {
        if (index == hoveredRow)
        {
            return;
        }

        hoveredRow = index;
        deviceList.Invalidate();
    }

    public void RefreshState()
    {
        var connected = connectionRegistry.ConnectedDeviceCount;
        statusLabel.Text = $"●  {tray.StatusText}";
        statusLabel.ForeColor = connected > 0 ? Theme.Success : Theme.Accent;

        var timerText = tray.GetShutdownTimerText();
        shutdownTimerRow.Visible = timerText is not null;
        shutdownTimerLabel.Text = timerText ?? string.Empty;

        var (pin, expiresAtUtc) = pairingService.GetCurrentPin();
        pinLabel.Text = pin.Length == 6 ? $"{pin[..3]} {pin[3..]}" : pin;
        pinExpiryLabel.Text = $"Gültig bis {expiresAtUtc.ToLocalTime():HH:mm} Uhr";

        httpsSwitch.Checked = tray.HttpsEnabled;
        startWithWindowsSwitch.Checked = WindowsStartupService.IsEnabled();
        gamepadDriverButton.Visible = tray.GamepadDriverMissing;

        var (updateText, updateEnabled) = tray.UpdateState;
        updateButton.Text = updateText;
        updateButton.Enabled = updateEnabled;

        RefreshDevices();
    }

    // Die Liste wird nur neu aufgebaut, wenn sich etwas geändert hat - sonst ginge die Auswahl
    // jede Sekunde verloren.
    private void RefreshDevices()
    {
        var devices = pairingService.GetPairedDevices()
            .OrderByDescending(device => connectionRegistry.IsConnected(device.Id))
            .ThenByDescending(device => device.LastSeenUtc)
            .ToList();
        var rows = devices.Select(device => new[]
        {
            device.Name,
            connectionRegistry.IsConnected(device.Id)
                ? "● verbunden"
                : $"zuletzt {device.LastSeenUtc.ToLocalTime():dd.MM. HH:mm}",
            device.MediaOnly ? "Nur Medien" : "Vollzugriff"
        }).ToList();
        var key = string.Join("\n", devices.Zip(rows, (device, row) => $"{device.Id}|{string.Join("|", row)}"));
        if (key == shownDevicesKey)
        {
            return;
        }

        var selectedIds = SelectedDevices().Select(device => device.Id).ToHashSet();
        deviceList.BeginUpdate();
        deviceList.Items.Clear();
        if (devices.Count == 0)
        {
            deviceList.Items.Add(new ListViewItem(["Noch kein Gerät gekoppelt", "", ""]) { ForeColor = Theme.Muted });
        }

        foreach (var (device, row) in devices.Zip(rows))
        {
            deviceList.Items.Add(new ListViewItem(row)
            {
                Tag = device,
                Selected = selectedIds.Contains(device.Id),
                ForeColor = connectionRegistry.IsConnected(device.Id) ? Theme.Text : Theme.Muted
            });
        }

        deviceList.EndUpdate();
        deviceList.Columns[^1].Width = -2;
        shownDevicesKey = key;
        UpdateDeviceButtons();
    }

    private List<PairedDeviceInfo> SelectedDevices() =>
        deviceList.SelectedItems.Cast<ListViewItem>()
            .Select(item => item.Tag)
            .OfType<PairedDeviceInfo>()
            .ToList();

    private void UpdateDeviceButtons()
    {
        var selected = SelectedDevices();
        ringButton.Enabled = selected.Any(device => connectionRegistry.IsConnected(device.Id));
        mediaOnlyButton.Enabled = selected.Any(device => !device.MediaOnly);
        fullAccessButton.Enabled = selected.Any(device => device.MediaOnly);
        unpairButton.Enabled = selected.Count > 0;
        deviceList.Invalidate();
    }

    private void ChangeDevices(Action<IReadOnlyList<PairedDeviceInfo>> change)
    {
        change(SelectedDevices());
        RefreshState();
    }

    private void UnpairSelected()
    {
        var selected = SelectedDevices();
        if (selected.Count == 0)
        {
            return;
        }

        var names = string.Join(", ", selected.Select(device => device.Name));
        if (MessageDialog.Show(
                this,
                $"{names} entkoppeln?\n\nEntkoppelte Geräte können sich nur mit einer neuen PIN erneut verbinden.",
                "YFRemote",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question) != DialogResult.Yes)
        {
            return;
        }

        ChangeDevices(tray.UnpairDevices);
    }

    private static readonly (TrayNotification Kind, string Title, string Description)[] Notifications =
    [
        (TrayNotification.Started, "YFRemote gestartet", "Mit der Adresse, unter der der Server erreichbar ist."),
        (TrayNotification.Update, "Update verfügbar", "Wenn die automatische Suche eine neue Version findet."),
        (TrayNotification.FileReceived, "Datei empfangen", "Ein Gerät hat eine Datei an diesen PC geschickt."),
        (TrayNotification.FileSent, "Datei gesendet", "Ein Gerät hat eine angebotene Datei geladen."),
        (TrayNotification.Clipboard, "Zwischenablage", "Ein Gerät liest die Zwischenablage oder gleicht sie ab."),
        (TrayNotification.PcNotifications, "Benachrichtigungen weitergeleitet", "Ein Gerät bekommt ab jetzt die Windows-Benachrichtigungen."),
        (TrayNotification.ScreenView, "Bildschirm wird übertragen", "Ein Gerät sieht deinen Bildschirm."),
        (TrayNotification.ScreenAudio, "PC-Ton wird übertragen", "Ein Gerät hört den Ton deines PCs."),
        (TrayNotification.ShutdownTimer, "Ausschalt-Timer", "Ein Gerät plant Herunterfahren, Ruhemodus oder Bildschirm aus."),
        (TrayNotification.Confirmations, "Bestätigungen", "Rückmeldung auf eigene Aktionen wie \"PIN kopiert\"."),
    ];

    private IEnumerable<Control> NotificationSwitches() => Notifications.Select(entry =>
    {
        var toggle = new ToggleSwitch(entry.Title, entry.Description) { Checked = tray.IsNotificationEnabled(entry.Kind) };
        toggle.Click += (_, _) => toggle.Checked = tray.ChangeNotification(entry.Kind, toggle.Checked);
        return (Control)toggle;
    });

    private static FlowLayoutPanel Row(params Control[] controls)
    {
        var row = new FlowLayoutPanel
        {
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            WrapContents = true,
            Dock = DockStyle.Fill,
            Margin = new Padding(0)
        };
        row.Controls.AddRange(controls);
        return row;
    }
}
