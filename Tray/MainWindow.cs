using System.ComponentModel;
using System.Drawing.Drawing2D;
using YFRemote.Server.Configuration;
using YFRemote.Server.Models;
using YFRemote.Server.Services;
using YFRemote.Server.WebSockets;

namespace YFRemote.Server.Tray;

// Das App-Fenster: links die Seitenleiste, rechts die gewählte Seite ("Fernzugriff", "Dieser PC",
// "Einstellungen"). Die Aktionen selbst bleiben in TrayApplicationContext, damit Menü und Fenster
// dasselbe tun.
internal sealed class MainWindow : Form
{
    internal const string ControlPageId = "control";
    internal const string PcPageId = "pc";
    internal const string SettingsPageId = "settings";

    private readonly TrayApplicationContext tray;
    private readonly PairingService pairingService;
    private readonly WebSocketConnectionRegistry connectionRegistry;
    private readonly List<(string Id, NavButton Button, Control Page)> pages = [];
    private readonly Label sidebarStatusLabel;
    private readonly Label sidebarConnectionsLabel;
    private readonly FlowLayoutPanel shutdownTimerRow;
    private readonly Label shutdownTimerLabel;
    private readonly Label pinLabel;
    private readonly Label pinExpiryLabel;
    private readonly PictureBox pinQrCode;
    private readonly ListView deviceList;
    private readonly PillButton ringButton;
    private readonly PillButton mediaOnlyButton;
    private readonly PillButton fullAccessButton;
    private readonly PillButton unpairButton;
    private readonly ToggleSwitch httpsSwitch;
    private readonly ToggleSwitch startWithWindowsSwitch;
    private readonly ToggleSwitch secureDesktopSwitch;
    private readonly PillButton gamepadDriverButton;
    private readonly PillButton updateButton;
    private readonly System.Windows.Forms.Timer refreshTimer;

    private readonly Font headerFont = new("Segoe UI Semibold", 8F);
    private readonly Font nameFont = new("Segoe UI Semibold", 9.5F);
    private readonly Font badgeFont = new("Segoe UI Semibold", 8.5F);

    private string shownDevicesKey = string.Empty;
    private string shownQrPayload = string.Empty;
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
        ClientSize = new Size(980, 720);
        MinimumSize = new Size(760, 520);
        StartPosition = FormStartPosition.CenterScreen;
        Theme.Apply(this);

        // Seitenleiste
        var logo = new PictureBox
        {
            Image = new Icon(icon, 48, 48).ToBitmap(),
            SizeMode = PictureBoxSizeMode.Zoom,
            Size = new Size(36, 36),
            Margin = new Padding(0, 0, 10, 0)
        };
        var brand = new TableLayoutPanel { AutoSize = true, ColumnCount = 2, RowCount = 2, Margin = new Padding(6, 0, 0, 22) };
        brand.Controls.Add(logo, 0, 0);
        brand.SetRowSpan(logo, 2);
        brand.Controls.Add(new Label { AutoSize = true, Text = "YFRemote", Font = new Font("Segoe UI Semibold", 12F), Margin = new Padding(0) }, 1, 0);
        brand.Controls.Add(new Label { AutoSize = true, Text = $"v{tray.Version}", ForeColor = Theme.Muted, Margin = new Padding(1, 0, 0, 0) }, 1, 1);

        sidebarStatusLabel = new Label { AutoSize = true, Font = new Font("Segoe UI Semibold", 9F), Margin = new Padding(6, 0, 0, 2) };
        var sidebarAddressLabel = new Label
        {
            AutoSize = true,
            Text = tray.DeviceAddress.Replace("http://", string.Empty).Replace("https://", string.Empty),
            Font = new Font("Consolas", 9.5F),
            Margin = new Padding(6, 0, 0, 2)
        };
        sidebarConnectionsLabel = new Label { AutoSize = true, ForeColor = Theme.Muted, Margin = new Padding(6, 0, 0, 14) };

        var navigation = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            Padding = new Padding(12, 20, 12, 16),
            BackColor = Theme.Inset
        };
        navigation.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
        var sidebar = new Panel { Dock = DockStyle.Left, Width = 228, BackColor = Theme.Inset };
        sidebar.Controls.Add(navigation);

        // Dieser PC
        var addressTextBox = new TextBox
        {
            ReadOnly = true,
            // Sonst bekommt das Feld beim Öffnen den Fokus und die Adresse steht markiert da.
            TabStop = false,
            Text = tray.DeviceAddress,
            Font = new Font("Consolas", 12F),
            BorderStyle = BorderStyle.None,
            BackColor = Theme.Card,
            ForeColor = Theme.Text,
            Width = 420,
            Margin = new Padding(0, 0, 0, 12)
        };
        shutdownTimerLabel = new Label
        {
            AutoSize = true,
            ForeColor = Theme.Warning,
            Font = new Font("Segoe UI Semibold", 9.5F),
            Margin = new Padding(0, 9, 10, 0)
        };
        shutdownTimerRow = Row(shutdownTimerLabel, new PillButton("Abbrechen", ButtonKind.Danger, tray.CancelShutdownTimer));

        pinLabel = new Label
        {
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 30F),
            ForeColor = Theme.Accent,
            Margin = new Padding(0)
        };
        pinExpiryLabel = new Label { AutoSize = true, ForeColor = Theme.Muted, Margin = new Padding(2, 0, 0, 12) };
        pinQrCode = new PictureBox
        {
            SizeMode = PictureBoxSizeMode.Zoom,
            Size = new Size(128, 128),
            AccessibleName = "QR-Code zum Koppeln",
            Margin = new Padding(24, 0, 0, 12)
        };
        // TableLayoutPanel statt FlowLayoutPanel: eine umbrechende FlowLayout-Zeile reservierte die
        // Höhe für QR-Code unter der PIN, auch wenn beides nebeneinander stand.
        var pinColumn = new TableLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, ColumnCount = 1, Margin = new Padding(0) };
        Theme.AddRows(pinColumn, Theme.Hint("PIN auf dem neuen Gerät eingeben oder den QR-Code scannen - das Gerät ist danach gleich gekoppelt.", 320), pinLabel, pinExpiryLabel);
        var pinRow = new TableLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, ColumnCount = 2, RowCount = 1, Margin = new Padding(0) };
        pinRow.Controls.Add(pinColumn, 0, 0);
        pinRow.Controls.Add(pinQrCode, 1, 0);

        deviceList = new ListView
        {
            View = View.Details,
            FullRowSelect = true,
            HideSelection = false,
            MultiSelect = true,
            OwnerDraw = true,
            Dock = DockStyle.Fill,
            BackColor = Theme.Card,
            ForeColor = Theme.Text,
            BorderStyle = BorderStyle.None,
            Margin = new Padding(0, 0, 0, 12),
            // Die Zeilenhöhe richtet sich in WinForms nach der Bildliste - ein leeres 1-Pixel-Bild
            // macht die Zeilen so luftig wie die Listen der Weboberfläche.
            SmallImageList = new ImageList { ImageSize = new Size(1, LogicalToDeviceUnits(50)) }
        };
        // Spaltenbreiten skaliert WinForms nicht mit - ohne LogicalToDeviceUnits waren sie bei 300 %
        // ein Drittel so breit wie gedacht.
        deviceList.Columns.Add("GERÄT", deviceList.LogicalToDeviceUnits(240));
        deviceList.Columns.Add("STATUS", deviceList.LogicalToDeviceUnits(190));
        deviceList.Columns.Add("ZUGRIFF", deviceList.LogicalToDeviceUnits(100));
        // Selbst gezeichnet: Kopfzeile und Auswahl blieben sonst hell bzw. Windows-blau.
        deviceList.DrawColumnHeader += DrawDeviceHeader;
        deviceList.DrawItem += (_, _) => { };
        deviceList.DrawSubItem += DrawDeviceCell;
        deviceList.MouseMove += (_, e) => SetHoveredRow(deviceList.HitTest(e.Location).Item?.Index ?? -1);
        deviceList.MouseLeave += (_, _) => SetHoveredRow(-1);
        deviceList.SelectedIndexChanged += (_, _) => UpdateDeviceButtons();
        deviceList.HandleCreated += (_, _) =>
        {
            Theme.UseDarkScrollBars(deviceList);
            // Die Zeilen legt die ListView erst nach diesem Ereignis im Fenster an.
            BeginInvoke(FitDeviceListHeight);
        };
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
            WindowsStartupService.IsAvailable ? "Startet bei der Anmeldung still im Infobereich, ohne Fenster." : "Nur in der installierten Version verfügbar.")
        {
            Enabled = WindowsStartupService.IsAvailable
        };
        startWithWindowsSwitch.Click += (_, _) =>
            startWithWindowsSwitch.Checked = tray.ChangeStartWithWindows(startWithWindowsSwitch.Checked);
        secureDesktopSwitch = new ToggleSwitch(
            "Sperrbildschirm und UAC vom Handy bedienen",
            WindowsSecureDesktop.IsAvailable
                ? "Ein Windows-Dienst zeigt und bedient beides, dazu Admin-Fenster wie den Task-Manager. Einrichten braucht einmal Adminrechte."
                : "Nur bei Installation für alle Benutzer (MSI unter \"Program Files\") verfügbar.")
        {
            Enabled = WindowsSecureDesktop.IsAvailable
        };
        secureDesktopSwitch.Click += (_, _) =>
            secureDesktopSwitch.Checked = tray.ChangeSecureDesktop(secureDesktopSwitch.Checked);
        var certificateButton = new PillButton("Zertifikat installieren...", ButtonKind.Secondary, tray.ShowCertificateInstallDialog)
        {
            Visible = tray.CertificateAvailable
        };
        gamepadDriverButton = new PillButton("Controller-Treiber installieren...", ButtonKind.Secondary, tray.OpenGamepadDriverDownload);
        var deviceFullscreenSwitch = new ToggleSwitch(
            "Im Vollbild starten",
            "Beim Verbinden füllt der Bildschirm des Geräts den ganzen Monitor. Zurück ins Fenster über das Logo im Bild.")
        {
            Checked = UserSettingsStore.GetDeviceFullscreen()
        };
        deviceFullscreenSwitch.Click += (_, _) =>
            deviceFullscreenSwitch.Checked = tray.ChangeDeviceFullscreen(deviceFullscreenSwitch.Checked);

        updateButton = new PillButton(string.Empty, ButtonKind.Primary, () => _ = tray.HandleUpdateClickAsync());

        var content = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Background };
        AddPage(content, ControlPageId, "Fernzugriff", "", Page(
            "Fernzugriff",
            "Den Bildschirm deiner anderen Geräte öffnen und mit Maus und Tastatur bedienen.",
            new ControlPage(icon)));
        AddPage(content, PcPageId, "Dieser PC", "", Page(
            "Dieser PC",
            "So erreichen andere Geräte diesen PC - und wer ihn gerade steuern darf.",
            new Card("Verbindung",
                Theme.Hint("Diese Adresse auf dem Handy, Tablet oder einem anderen PC im selben Netzwerk öffnen."),
                addressTextBox,
                Row(
                    new PillButton("Im Browser öffnen", ButtonKind.Primary, tray.OpenInBrowser),
                    new PillButton("Adresse kopieren", ButtonKind.Secondary, tray.CopyDeviceAddress)),
                shutdownTimerRow),
            new Card("Neues Gerät koppeln",
                pinRow,
                Row(
                    new PillButton("PIN kopieren", ButtonKind.Secondary, tray.CopyPin),
                    new PillButton("Neue PIN", ButtonKind.Secondary, () => { tray.RegeneratePin(); RefreshState(); }),
                    new PillButton("QR-Code vergrößern", ButtonKind.Secondary, () => { tray.ShowPairingQrCode(); RefreshState(); }))),
            new Card("Gekoppelte Geräte",
                Theme.Hint("\"Nur Medien\" erlaubt nur Wiedergabe, Lautstärke und Mixer - kein Tippen, keine Maus, "
                    + "kein Ausschalten, keine Dateien und keine Zwischenablage. Mehrere Geräte mit Strg auswählen.", 640),
                deviceList,
                Row(ringButton, mediaOnlyButton, fullAccessButton, unpairButton)),
            new Card("Dateien",
                Theme.Hint("Die Datei steht danach 10 Minuten lang auf den gekoppelten Geräten zum Laden bereit.", 640),
                Row(new PillButton("Datei an Geräte senden...", ButtonKind.Secondary, tray.OfferFile)))));
        AddPage(content, SettingsPageId, "Einstellungen", "", Page(
            "Einstellungen",
            "Server, Start, Fernzugriff, Meldungen und Updates.",
            new Card("Server und Start",
                httpsSwitch,
                startWithWindowsSwitch,
                secureDesktopSwitch,
                Row(
                    certificateButton,
                    gamepadDriverButton,
                    new PillButton("Diagnoseordner öffnen", ButtonKind.Secondary, tray.OpenDiagnosticsFolder))),
            new Card("Fernzugriff", deviceFullscreenSwitch),
            new Card("Benachrichtigungen",
                [
                    Theme.Hint("Welche Meldungen YFRemote unten rechts am Bildschirm anzeigt."),
                    .. NotificationSwitches()
                ]),
            new Card("Updates",
                Theme.Hint($"Installiert ist v{tray.Version}. YFRemote sucht alle 6 Stunden selbst nach Updates."),
                Row(updateButton)),
            Row(
                new PillButton("YFRemote beenden", ButtonKind.Danger, tray.ExitApplication),
                Theme.Hint("Beendet den Server. Andere Geräte können diesen PC dann nicht mehr steuern.", 420))));

        Theme.AddRows(navigation,
        [
            brand,
            .. pages.Select(page => (Control)page.Button),
            new Panel { Dock = DockStyle.Fill, Margin = new Padding(0) },
            sidebarStatusLabel,
            sidebarAddressLabel,
            sidebarConnectionsLabel,
            Theme.Hint("Fenster schließen: YFRemote läuft im Infobereich weiter.", 190)
        ]);
        // Der Platzhalter vor dem Serverstatus schiebt diesen nach unten.
        navigation.RowStyles[pages.Count + 1] = new RowStyle(SizeType.Percent, 100F);

        // Fill zuerst: angedockt wird in umgekehrter Reihenfolge, die Leiste nimmt sich so ihren Rand.
        Controls.Add(content);
        Controls.Add(sidebar);
        Theme.ScaleToDpi(this);

        // ponytail: Abfrage im Sekundentakt statt Events fuer jede Quelle; alles liest nur Speicher.
        refreshTimer = new System.Windows.Forms.Timer { Interval = 1000 };
        refreshTimer.Tick += (_, _) => RefreshState();
        refreshTimer.Start();
        RefreshState();
        // Das Fenster ist vor allem zum Fernzugriff da - es öffnet immer dort.
        ShowPage(ControlPageId);
        // Fokus nicht im Adressfeld, sonst verschwindet dessen Platzhalter mit dem Beispiel.
        ActiveControl = pages[0].Button;
    }

    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        Theme.FitToWorkingArea(this);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            refreshTimer.Dispose();
            deviceList.SmallImageList?.Dispose();
            pinQrCode.Image?.Dispose();
            headerFont.Dispose();
            nameFont.Dispose();
            badgeFont.Dispose();
        }

        base.Dispose(disposing);
    }

    internal void ShowPage(string id)
    {
        if (!pages.Any(page => page.Id == id))
        {
            id = ControlPageId;
        }

        foreach (var (pageId, button, page) in pages)
        {
            button.Active = pageId == id;
            page.Visible = pageId == id;
        }
    }

    private void AddPage(Panel content, string id, string title, string glyph, Control page)
    {
        content.Controls.Add(page);
        pages.Add((id, new NavButton(title, glyph, () => ShowPage(id)), page));
    }

    private static Control Page(string title, string subtitle, params Control[] controls)
    {
        // Gescrollt wird ein Panel um das Layout: Ein TableLayoutPanel mit AutoScroll zählt seinen
        // unteren Innenabstand nicht mit, der letzte Knopf war dann nicht ganz erreichbar.
        var scrollPanel = new Panel { Dock = DockStyle.Fill, AutoScroll = true, Visible = false };
        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            ColumnCount = 1,
            Padding = new Padding(28, 22, 28, 24)
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
        var heading = new Label
        {
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 20F),
            Text = title,
            // Zeichnet ohne den Innenabstand, den WinForms großer Schrift links mitgibt - sonst stand
            // der Titel sichtbar rechts von Untertitel und Karten.
            FlatStyle = FlatStyle.System,
            Margin = new Padding(0)
        };
        var subtitleLabel = Theme.Hint(subtitle, 640);
        subtitleLabel.Margin = new Padding(0, 0, 0, 16);
        Theme.AddRows(layout, [heading, subtitleLabel, .. controls]);
        scrollPanel.Controls.Add(layout);
        scrollPanel.HandleCreated += (_, _) => Theme.UseDarkScrollBars(scrollPanel);
        return scrollPanel;
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
        // Die Zahl der Verbindungen steht darunter - hier reicht, dass der Server läuft.
        sidebarStatusLabel.Text = "●  Server läuft";
        sidebarStatusLabel.ForeColor = connected > 0 ? Theme.Success : Theme.Accent;
        sidebarConnectionsLabel.Text = connected switch
        {
            0 => "Kein Gerät verbunden",
            1 => "1 Gerät verbunden",
            _ => $"{connected} Geräte verbunden"
        };
        pages.First(page => page.Id == PcPageId).Button.Badge = connected > 0 ? connected.ToString() : null;

        var timerText = tray.GetShutdownTimerText();
        shutdownTimerRow.Visible = timerText is not null;
        shutdownTimerLabel.Text = timerText ?? string.Empty;

        var (pin, expiresAtUtc) = pairingService.GetCurrentPin();
        pinLabel.Text = pin.Length == 6 ? $"{pin[..3]} {pin[3..]}" : pin;
        pinExpiryLabel.Text = $"Gültig bis {expiresAtUtc.ToLocalTime():HH:mm} Uhr";
        var qrPayload = tray.CreatePairingQrPayload(pin);
        if (qrPayload != shownQrPayload)
        {
            var previous = pinQrCode.Image;
            pinQrCode.Image = PairingQrCodeDialog.CreateQrCodeImage(qrPayload);
            previous?.Dispose();
            shownQrPayload = qrPayload;
        }

        httpsSwitch.Checked = tray.HttpsEnabled;
        startWithWindowsSwitch.Checked = WindowsStartupService.IsEnabled();
        secureDesktopSwitch.Checked = WindowsSecureDesktop.IsServiceInstalled();
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
        FitDeviceListHeight();
        deviceList.Columns[^1].Width = -2;
        shownDevicesKey = key;
        UpdateDeviceButtons();
    }

    // So hoch wie alle Zeilen: gescrollt wird die Seite, nicht zusätzlich die Liste darin.
    private void FitDeviceListHeight()
    {
        if (!deviceList.IsHandleCreated || deviceList.Items.Count == 0)
        {
            return;
        }

        var firstRow = deviceList.GetItemRect(0);
        deviceList.Height = firstRow.Top + deviceList.Items.Count * firstRow.Height + 1;
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

    internal static FlowLayoutPanel Row(params Control[] controls)
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

// Eintrag der Seitenleiste: Symbol aus "Segoe MDL2 Assets" (Windows 10 und 11), Name und rechts
// optional eine Zahl - wie die Navigation der Weboberfläche.
internal sealed class NavButton : Button
{
    private readonly string glyph;
    private readonly Font glyphFont = new("Segoe MDL2 Assets", 12F);
    private bool active;
    private bool hovered;
    private string? badge;

    public NavButton(string text, string glyph, Action action)
    {
        this.glyph = glyph;
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
        Text = text;
        Font = new Font("Segoe UI Semibold", 10F);
        Cursor = Cursors.Hand;
        Anchor = AnchorStyles.Left | AnchorStyles.Right;
        Height = 42;
        Margin = new Padding(0, 0, 0, 4);
        Click += (_, _) => action();
    }

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    public bool Active
    {
        get => active;
        set { active = value; AccessibleDescription = value ? "Aktuelle Seite" : null; Invalidate(); }
    }

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    public string? Badge
    {
        get => badge;
        set { if (badge != value) { badge = value; Invalidate(); } }
    }

    protected override void OnMouseEnter(EventArgs e) { hovered = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hovered = false; Invalidate(); base.OnMouseLeave(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(Parent?.BackColor ?? Theme.Inset);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var bounds = new RectangleF(0.5F, 0.5F, Width - 1.5F, Height - 1.5F);
        if (active || hovered)
        {
            using var path = Theme.RoundedRectangle(bounds, LogicalToDeviceUnits(10));
            using var fill = new SolidBrush(active ? Color.FromArgb(40, Theme.Accent) : Theme.Hover);
            g.FillPath(fill, path);
        }

        if (Focused && ShowFocusCues)
        {
            using var path = Theme.RoundedRectangle(bounds, LogicalToDeviceUnits(10));
            using var focus = new Pen(Theme.Accent, 2);
            g.DrawPath(focus, path);
        }

        const TextFormatFlags flags = TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix;
        var glyphWidth = LogicalToDeviceUnits(40);
        TextRenderer.DrawText(g, glyph, glyphFont, new Rectangle(0, 0, glyphWidth, Height), active ? Theme.Accent : Theme.Muted,
            flags | TextFormatFlags.HorizontalCenter);
        TextRenderer.DrawText(g, Text, Font, new Rectangle(glyphWidth, 0, Width - glyphWidth, Height), active ? Theme.Text : Theme.Muted, flags);

        if (badge is not null)
        {
            var size = TextRenderer.MeasureText(badge, Font);
            var height = LogicalToDeviceUnits(20);
            var width = Math.Max(height, size.Width + LogicalToDeviceUnits(8));
            var pill = new RectangleF(Width - width - LogicalToDeviceUnits(10), (Height - height) / 2F, width, height);
            using var path = Theme.RoundedRectangle(pill, height / 2F);
            using var fill = new SolidBrush(Color.FromArgb(40, Theme.Success));
            g.FillPath(fill, path);
            TextRenderer.DrawText(g, badge, Font, Rectangle.Round(pill), Theme.Success, flags | TextFormatFlags.HorizontalCenter);
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            glyphFont.Dispose();
        }

        base.Dispose(disposing);
    }
}
