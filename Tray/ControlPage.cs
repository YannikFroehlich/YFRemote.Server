using System.Drawing.Drawing2D;
using System.Net.Http.Json;
using System.Text.Json;
using YFRemote.Server.Models;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tray;

// Seite "Fernzugriff": oben ein Adressfeld zum direkten Verbinden, darunter die gemerkten Geraete
// mit Online-Status aus GET /health und was die Netzwerksuche (NetworkDiscovery) zusaetzlich
// findet. Verbinden oeffnet den Bildschirm des Geraets in einem RemoteDeviceWindow.
internal sealed class ControlPage : TableLayoutPanel
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(1.5) };
    private static readonly TimeSpan SearchDuration = TimeSpan.FromSeconds(1.5);

    private readonly RemoteDeviceStore store = new(RemoteDeviceStore.DefaultFilePath);
    private readonly Icon icon;
    private readonly FlowLayoutPanel savedTiles;
    private readonly Label savedEmptyLabel;
    private readonly FlowLayoutPanel foundTiles;
    private readonly Label foundStatusLabel;
    private readonly PillButton searchButton;
    private readonly TextBox addressBox;
    private readonly PillButton connectButton;
    private readonly Label connectErrorLabel;
    private readonly System.Windows.Forms.Timer pollTimer;
    private readonly Dictionary<string, HealthResponse?> health = [];
    private readonly HashSet<string> caUnavailable = [];
    private List<(string Url, HealthResponse? Health)> found = [];
    private string shownSavedKey = string.Empty;
    private bool polling;
    private bool searching;
    private bool searchedOnce;

    public ControlPage(Icon icon)
    {
        this.icon = icon;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Dock = DockStyle.Fill;
        ColumnCount = 1;
        Margin = new Padding(0);
        ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));

        searchButton = new PillButton("Erneut suchen", ButtonKind.Secondary, () => _ = SearchAsync());
        savedTiles = TileRow();
        foundTiles = TileRow();
        savedEmptyLabel = Theme.Hint("Noch keine Geräte. Gib oben eine Adresse ein oder verbinde ein gefundenes Gerät. "
            + "Beim ersten Verbinden koppelst du es mit der PIN, die das Gerät anzeigt.", 640);
        foundStatusLabel = Theme.Hint(string.Empty, 640);

        addressBox = new TextBox
        {
            Font = new Font("Segoe UI", 12F),
            BackColor = Theme.Card,
            ForeColor = Theme.Text,
            BorderStyle = BorderStyle.None,
            PlaceholderText = "Adresse oder Gerätename, z. B. 192.168.0.24",
            Dock = DockStyle.Fill
        };
        // Abgerundetes Feld wie die Karten; der Windows-Rahmen des Textfelds stand hell im Dunkel.
        var addressField = new Panel
        {
            BackColor = Theme.Card,
            Padding = new Padding(14, 7, 14, 5),
            Height = 40,
            Anchor = AnchorStyles.Left | AnchorStyles.Right,
            Margin = new Padding(0, 0, 10, 0),
            Cursor = Cursors.IBeam
        };
        addressField.Controls.Add(addressBox);
        addressField.Click += (_, _) => addressBox.Focus();
        addressField.Resize += (_, _) => addressField.Invalidate();
        addressField.Paint += (_, e) =>
        {
            e.Graphics.Clear(Theme.Background);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            var bounds = new RectangleF(0.5F, 0.5F, addressField.Width - 1.5F, addressField.Height - 1.5F);
            using var path = Theme.RoundedRectangle(bounds, bounds.Height / 2);
            using var fill = new SolidBrush(Theme.Card);
            using var border = new Pen(addressBox.Focused ? Theme.Accent : Theme.Line);
            e.Graphics.FillPath(fill, path);
            e.Graphics.DrawPath(border, path);
        };
        addressBox.GotFocus += (_, _) => addressField.Invalidate();
        addressBox.LostFocus += (_, _) => addressField.Invalidate();
        addressBox.KeyDown += (_, e) =>
        {
            if (e.KeyCode == Keys.Enter)
            {
                e.SuppressKeyPress = true;
                _ = ConnectAsync();
            }
        };
        connectButton = new PillButton("Verbinden", ButtonKind.Primary, () => _ = ConnectAsync()) { Margin = new Padding(0) };
        var addressRow = new TableLayoutPanel
        {
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Dock = DockStyle.Fill,
            ColumnCount = 2,
            RowCount = 1,
            Margin = new Padding(0, 0, 0, 6)
        };
        addressRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
        addressRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        addressRow.Controls.Add(addressField, 0, 0);
        addressRow.Controls.Add(connectButton, 1, 0);
        connectErrorLabel = Theme.Hint(string.Empty, 640);
        connectErrorLabel.ForeColor = Theme.Danger;
        connectErrorLabel.Visible = false;

        var searchRow = MainWindow.Row(searchButton);
        searchRow.Margin = new Padding(0, 4, 0, 0);
        Theme.AddRows(this,
            addressRow,
            connectErrorLabel,
            new Card("Meine Geräte", savedEmptyLabel, savedTiles),
            new Card("Im Netzwerk gefunden", foundStatusLabel, foundTiles, searchRow),
            Theme.Hint("Gefunden werden Geräte im selben Netzwerk, auf denen YFRemote läuft. Fehlt eins, oben seine Adresse "
                + "eingeben - sie steht auf dem PC unter \"Dieser PC\", in der Android-App unter \"Freigeben\". "
                + "Gastnetze und getrennte VLANs lassen die Suche nicht durch.", 640));

        // Abgefragt wird nur, solange die Seite sichtbar ist - offline gegangene Geraete kosten so
        // nur dann Netz, wenn jemand hinsieht.
        pollTimer = new System.Windows.Forms.Timer { Interval = 3000 };
        pollTimer.Tick += (_, _) => _ = PollAsync();
    }

    protected override void OnVisibleChanged(EventArgs e)
    {
        base.OnVisibleChanged(e);
        if (!Visible)
        {
            pollTimer.Stop();
            return;
        }

        pollTimer.Start();
        RefreshSaved();
        _ = PollAsync();
        if (!searchedOnce)
        {
            searchedOnce = true;
            _ = SearchAsync();
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            pollTimer.Dispose();
        }

        base.Dispose(disposing);
    }

    private async Task PollAsync()
    {
        if (polling)
        {
            return;
        }

        polling = true;
        try
        {
            var devices = store.Load();
            var results = await Task.WhenAll(devices.Select(async device => (Device: device, Health: await GetHealthAsync(device.Url))));
            foreach (var (device, result) in results)
            {
                health[device.Url] = result;
                if (result?.Name is { Length: > 0 } name)
                {
                    store.SetReportedName(device.Url, name);
                }

                await SyncHttpsAsync(device, result);
            }
        }
        finally
        {
            polling = false;
        }

        if (!IsDisposed)
        {
            RefreshSaved();
        }
    }

    // Meldet ein Geraet HTTPS, wird seine CA beim ersten Kontakt ueber HTTP geladen und gemerkt
    // (Vertrauen beim ersten Kontakt); danach prueft das Geraetefenster nur noch gegen diese CA.
    // Der HTTPS-Port wird bei jeder Abfrage nachgefuehrt, ohne ihn oeffnet das Fenster wieder http.
    private async Task SyncHttpsAsync(RemoteDevice device, HealthResponse? result)
    {
        if (result is null)
        {
            return;
        }

        string? ca = null;
        if (device.Ca is null && result.HttpsPort is not null && !caUnavailable.Contains(device.Url))
        {
            ca = await GetAuthorityAsync(device.Url);
            if (ca is null)
            {
                // Erst beim naechsten Start wieder versuchen statt alle 3 Sekunden.
                caUnavailable.Add(device.Url);
            }
        }

        store.SetHttps(device.Url, ca, result.HttpsPort);
    }

    private static async Task<string?> GetAuthorityAsync(string url)
    {
        try
        {
            return PinnedCertificate.ToPinnedAuthority(await Http.GetByteArrayAsync($"{url}/ca.crt"));
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            return null;
        }
    }

    private async Task SearchAsync()
    {
        if (searching)
        {
            return;
        }

        searching = true;
        searchButton.Enabled = false;
        searchButton.Text = "Sucht...";
        foundStatusLabel.Text = "Suche im Netzwerk...";
        try
        {
            var endpoints = await NetworkDiscovery.DiscoverAsync(SearchDuration, CancellationToken.None);
            var urls = endpoints.Select(endpoint => $"http://{endpoint.Address}:{endpoint.Port}").ToList();
            found = [.. await Task.WhenAll(urls.Select(async url => (url, await GetHealthAsync(url))))];
        }
        catch (Exception exception) when (exception is System.Net.Sockets.SocketException or IOException)
        {
            found = [];
            foundStatusLabel.Text = $"Die Suche ist fehlgeschlagen: {exception.Message}";
            return;
        }
        finally
        {
            searching = false;
            if (!IsDisposed)
            {
                searchButton.Enabled = true;
                searchButton.Text = "Erneut suchen";
            }
        }

        if (!IsDisposed)
        {
            RefreshFound();
        }
    }

    private void RefreshSaved()
    {
        var devices = store.Load();
        var key = string.Join("\n", devices.Select(device =>
            $"{device.Url}|{device.Name}|{StatusOf(device.Url)}|{health.GetValueOrDefault(device.Url)?.Platform}|{device.Secure}"));
        if (key == shownSavedKey)
        {
            return;
        }

        shownSavedKey = key;
        savedEmptyLabel.Visible = devices.Count == 0;
        ReplaceTiles(savedTiles, devices.Select(device =>
        {
            var deviceHealth = health.GetValueOrDefault(device.Url);
            var status = StatusOf(device.Url);
            var menu = new ContextMenuStrip();
            Theme.UseDarkMenus(menu);
            menu.Items.Add("Umbenennen...", null, (_, _) => Rename(device));
            menu.Items.Add("Adresse kopieren", null, (_, _) => CopyAddress(device));
            menu.Items.Add("Im Browser öffnen", null, (_, _) =>
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(device.Url) { UseShellExecute = true }));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Entfernen...", null, (_, _) => Remove(device));
            return new DeviceTile(
                device.Name,
                $"{new Uri(device.OpenUrl).Authority}{PlatformSuffix(deviceHealth)}",
                GlyphFor(deviceHealth),
                status,
                status == DeviceStatus.Online ? "Verbinden" : "Nicht erreichbar",
                status == DeviceStatus.Online,
                () => RemoteDeviceWindow.Open(device, store.Load(), icon),
                menu,
                device.Secure);
        }));

        // Ein inzwischen gemerktes Geraet verschwindet aus "gefunden".
        RefreshFound();
    }

    private void RefreshFound()
    {
        var saved = store.Load().Select(device => device.Url).ToHashSet();
        var shown = found.Where(entry => !saved.Contains(entry.Url)).ToList();
        if (!searching)
        {
            foundStatusLabel.Text = shown.Count == 0
                ? found.Count == 0
                    ? "Kein weiteres YFRemote-Gerät gefunden."
                    : "Alle gefundenen Geräte sind schon in deiner Liste."
                : $"Gesucht um {DateTime.Now:HH:mm} Uhr.";
        }

        ReplaceTiles(foundTiles, shown.Select(entry =>
        {
            var address = new Uri(entry.Url).Authority;
            return new DeviceTile(
                entry.Health?.Name ?? address,
                $"{address}{PlatformSuffix(entry.Health)}",
                GlyphFor(entry.Health),
                DeviceStatus.New,
                "Verbinden",
                true,
                () => _ = AddAndOpenAsync(entry.Url, entry.Health),
                null);
        }));
    }

    private DeviceStatus StatusOf(string url) =>
        !health.TryGetValue(url, out var result) ? DeviceStatus.Unknown
        : result is null ? DeviceStatus.Offline
        : DeviceStatus.Online;

    // Nimmt einen Gerätenamen (gemerkt oder gefunden) oder eine Adresse. Eine neue Adresse wird erst
    // gemerkt, wenn dort ein YFRemote auf /health antwortet.
    private async Task ConnectAsync()
    {
        var input = addressBox.Text.Trim();
        if (input.Length == 0 || !connectButton.Enabled)
        {
            return;
        }

        var saved = store.Load();
        var url = saved.FirstOrDefault(device => string.Equals(device.Name, input, StringComparison.OrdinalIgnoreCase))?.Url
            ?? found.FirstOrDefault(entry => string.Equals(entry.Health?.Name, input, StringComparison.OrdinalIgnoreCase)).Url
            ?? RemoteDeviceStore.NormalizeAddress(input);
        if (url is null)
        {
            ShowConnectError("Kein Gerät mit diesem Namen, und keine gültige Adresse. Beispiele: 192.168.0.24 oder pc-name:5060");
            return;
        }

        if (saved.FirstOrDefault(device => device.Url == url) is { } known)
        {
            ShowConnectError(null);
            addressBox.Clear();
            RemoteDeviceWindow.Open(known, saved, icon);
            return;
        }

        connectButton.Enabled = false;
        connectButton.Text = "Verbinde...";
        try
        {
            var result = await GetHealthAsync(url);
            if (result is null)
            {
                ShowConnectError($"Unter {new Uri(url).Authority} antwortet kein YFRemote. Läuft YFRemote dort, und ist das Gerät im selben Netzwerk?");
                return;
            }

            ShowConnectError(null);
            addressBox.Clear();
            await AddAndOpenAsync(url, result);
        }
        finally
        {
            if (!IsDisposed)
            {
                connectButton.Enabled = true;
                connectButton.Text = "Verbinden";
            }
        }
    }

    private void ShowConnectError(string? message)
    {
        connectErrorLabel.Text = message ?? string.Empty;
        connectErrorLabel.Visible = message is not null;
        if (message is not null)
        {
            addressBox.Focus();
        }
    }

    // Vor dem Öffnen die CA holen, damit schon die erste Verbindung verschlüsselt ist.
    private async Task AddAndOpenAsync(string url, HealthResponse? result)
    {
        var device = new RemoteDevice(url, result?.Name ?? new Uri(url).Authority);
        store.Add(device);
        health[url] = result;
        await SyncHttpsAsync(device, result);
        if (IsDisposed)
        {
            return;
        }

        RefreshSaved();
        var devices = store.Load();
        RemoteDeviceWindow.Open(devices.FirstOrDefault(saved => saved.Url == url) ?? device, devices, icon);
    }

    private void Rename(RemoteDevice device)
    {
        using var dialog = new RenameDeviceDialog(device);
        if (dialog.ShowDialog(FindForm()) == DialogResult.OK)
        {
            store.Rename(device.Url, dialog.DeviceName);
            RefreshSaved();
        }
    }

    private void CopyAddress(RemoteDevice device)
    {
        try
        {
            Clipboard.SetText(device.Url);
        }
        catch (System.Runtime.InteropServices.ExternalException)
        {
            // Zwischenablage gerade von einem anderen Programm belegt - ein zweiter Klick genuegt.
        }
    }

    private void Remove(RemoteDevice device)
    {
        if (MessageDialog.Show(
                FindForm(),
                $"{device.Name} aus der Liste entfernen?\n\nDie Kopplung auf dem Gerät bleibt bestehen. Entkoppeln geht dort unter \"Gekoppelte Geräte\".",
                "YFRemote",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question) == DialogResult.Yes)
        {
            store.Remove(device.Url);
            health.Remove(device.Url);
            RefreshSaved();
        }
    }

    internal static async Task<HealthResponse?> GetHealthAsync(string url)
    {
        try
        {
            var result = await Http.GetFromJsonAsync<HealthResponse>($"{url}/health", JsonSerializerOptions.Web);
            return result?.Status == "ok" ? result : null;
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or JsonException or NotSupportedException)
        {
            return null;
        }
    }

    private static string PlatformSuffix(HealthResponse? health) => health?.Platform switch
    {
        "windows" => " · Windows",
        "linux" => " · Linux",
        "android" => " · Android",
        _ => string.Empty
    };

    // Symbole aus "Segoe MDL2 Assets": Monitor, Handy, Eingabeaufforderung.
    private static string GlyphFor(HealthResponse? health) => health?.Platform switch
    {
        "android" => "",
        "linux" => "",
        _ => ""
    };

    // TableLayoutPanel misst mit Mindestbreite (1 Pixel bzw. eine Kachel): Die Höhe reichte dann für
    // untereinander stehende Kacheln, und unter einer Zeile Kacheln blieb eine leere Fläche.
    private sealed class TileFlow : FlowLayoutPanel
    {
        public override Size GetPreferredSize(Size proposedSize) =>
            base.GetPreferredSize(new Size(Math.Max(proposedSize.Width, Width), proposedSize.Height));

        // Mit der neuen Breite passen mehr oder weniger Kacheln in eine Zeile - dann neu messen lassen.
        protected override void OnSizeChanged(EventArgs e)
        {
            base.OnSizeChanged(e);
            if (GetPreferredSize(Size.Empty).Height != Height)
            {
                Parent?.PerformLayout();
            }
        }
    }

    private static FlowLayoutPanel TileRow() => new TileFlow()
    {
        AutoSize = true,
        AutoSizeMode = AutoSizeMode.GrowAndShrink,
        WrapContents = true,
        Dock = DockStyle.Fill,
        Margin = new Padding(0)
    };

    private static void ReplaceTiles(FlowLayoutPanel panel, IEnumerable<DeviceTile> tiles)
    {
        panel.SuspendLayout();
        var old = panel.Controls.Cast<Control>().ToList();
        panel.Controls.Clear();
        old.ForEach(control => control.Dispose());
        panel.Controls.AddRange([.. tiles]);
        panel.ResumeLayout();
    }
}

internal enum DeviceStatus
{
    Unknown,
    Online,
    Offline,
    New
}

// Gerätekarte wie im Mockup: Symbol, Name, Adresse · Plattform, Status und rechts unten der Knopf.
internal sealed class DeviceTile : Control
{
    private readonly string subtitle;
    private readonly string glyph;
    private readonly DeviceStatus status;
    private readonly bool secure;
    private readonly PillButton actionButton;
    private readonly Button? menuButton;
    private readonly Font titleFont = new("Segoe UI Semibold", 10.5F);
    private readonly Font glyphFont = new("Segoe MDL2 Assets", 14F);
    private bool hovered;

    public DeviceTile(
        string title,
        string subtitle,
        string glyph,
        DeviceStatus status,
        string actionText,
        bool actionEnabled,
        Action action,
        ContextMenuStrip? menu,
        bool secure = false)
    {
        this.subtitle = subtitle;
        this.glyph = glyph;
        this.status = status;
        this.secure = secure;
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        Text = title;
        AccessibleName = $"{title}, {subtitle}";
        AutoSize = true;
        // Die Karten entstehen erst nach dem DPI-Skalieren des Fensters, daher selbst umrechnen.
        Margin = new Padding(0, 0, LogicalToDeviceUnits(14), LogicalToDeviceUnits(14));
        // Die Kachel selbst ist Raised; PillButton füllt seine Ecken mit Parent.BackColor - mit Card
        // stand um jeden Knopf ein dunkleres Rechteck.
        BackColor = Theme.Raised;

        // Auch "Hinzufügen" als Akzentknopf: grau auf grauer Kachel ging er unter.
        actionButton = new PillButton(actionText, ButtonKind.Primary, action)
        {
            Enabled = actionEnabled,
            Margin = new Padding(0)
        };
        Controls.Add(actionButton);

        // Die ganze Karte ist der Knopf - wie die Verbindungsliste eines Remotedesktop-Programms.
        if (actionEnabled)
        {
            Cursor = Cursors.Hand;
            Click += (_, _) => action();
        }

        if (menu is not null)
        {
            menuButton = new Button
            {
                Text = "",
                Font = new Font("Segoe MDL2 Assets", 10F),
                FlatStyle = FlatStyle.Flat,
                ForeColor = Theme.Muted,
                BackColor = Theme.Raised,
                Cursor = Cursors.Hand,
                AccessibleName = $"Weitere Aktionen für {title}"
            };
            menuButton.FlatAppearance.BorderSize = 0;
            menuButton.FlatAppearance.MouseOverBackColor = Theme.Hover;
            menuButton.Click += (_, _) => menu.Show(menuButton, new Point(0, menuButton.Height));
            menuButton.Disposed += (_, _) => menu.Dispose();
            Controls.Add(menuButton);
        }
    }

    public override Size GetPreferredSize(Size proposedSize) => new(LogicalToDeviceUnits(300), LogicalToDeviceUnits(132));

    protected override void OnMouseEnter(EventArgs e) { SetHovered(true); base.OnMouseEnter(e); }

    // Auch beim Wechsel auf Knopf oder Menü der Karte kommt MouseLeave - dann bleibt sie markiert.
    protected override void OnMouseLeave(EventArgs e) { SetHovered(ClientRectangle.Contains(PointToClient(MousePosition))); base.OnMouseLeave(e); }

    private void SetHovered(bool value)
    {
        if (hovered != value && Cursor == Cursors.Hand)
        {
            hovered = value;
            Invalidate();
        }
    }

    protected override void OnLayout(LayoutEventArgs levent)
    {
        base.OnLayout(levent);
        var inset = LogicalToDeviceUnits(16);
        var buttonSize = actionButton.GetPreferredSize(Size.Empty);
        actionButton.Bounds = new Rectangle(Width - inset - buttonSize.Width, Height - inset - buttonSize.Height, buttonSize.Width, buttonSize.Height);
        if (menuButton is not null)
        {
            var size = LogicalToDeviceUnits(32);
            menuButton.Bounds = new Rectangle(Width - LogicalToDeviceUnits(10) - size, LogicalToDeviceUnits(10), size, size);
        }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(Parent?.BackColor ?? Theme.Card);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using (var path = Theme.RoundedRectangle(new RectangleF(0.5F, 0.5F, Width - 1.5F, Height - 1.5F), LogicalToDeviceUnits(14)))
        using (var fill = new SolidBrush(Theme.Raised))
        using (var border = new Pen(hovered ? Color.FromArgb(140, Theme.Accent) : Theme.Line))
        {
            g.FillPath(fill, path);
            g.DrawPath(border, path);
        }

        var inset = LogicalToDeviceUnits(16);
        var box = new RectangleF(inset, inset, LogicalToDeviceUnits(42), LogicalToDeviceUnits(42));
        using (var path = Theme.RoundedRectangle(box, LogicalToDeviceUnits(11)))
        using (var fill = new SolidBrush(Color.FromArgb(30, Theme.Accent)))
        {
            g.FillPath(fill, path);
        }

        TextRenderer.DrawText(g, glyph, glyphFont, Rectangle.Round(box), Theme.Accent,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);

        var textLeft = (int)box.Right + LogicalToDeviceUnits(12);
        var textRight = Width - LogicalToDeviceUnits(menuButton is null ? 16 : 46);
        const TextFormatFlags flags = TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine;
        TextRenderer.DrawText(g, Text, titleFont, new Rectangle(textLeft, inset, textRight - textLeft, LogicalToDeviceUnits(22)), Theme.Text, flags);
        // Die Unterzeile liegt unter dem Menüknopf und darf bis zum Rand laufen.
        TextRenderer.DrawText(g, subtitle, Font, new Rectangle(textLeft, inset + LogicalToDeviceUnits(22), Width - inset - textLeft, LogicalToDeviceUnits(20)), Theme.Muted, flags);

        var (statusText, statusColor) = status switch
        {
            // In der Statuszeile ist Platz; in der Unterzeile wurde "verschlüsselt" abgeschnitten.
            DeviceStatus.Online => (secure ? "Online · verschlüsselt" : "Online", Theme.Success),
            DeviceStatus.Offline => ("Offline", Theme.Muted),
            DeviceStatus.New => ("Neu im Netzwerk", Theme.Accent),
            _ => ("Prüfe...", Theme.Muted)
        };
        var dot = LogicalToDeviceUnits(8);
        var statusTop = actionButton.Top;
        var statusHeight = actionButton.Height;
        using (var brush = new SolidBrush(status == DeviceStatus.Offline ? Theme.Disabled : statusColor))
        {
            g.FillEllipse(brush, inset, statusTop + (statusHeight - dot) / 2F, dot, dot);
        }

        TextRenderer.DrawText(g, statusText, Font, new Rectangle(inset + dot + LogicalToDeviceUnits(8), statusTop, actionButton.Left - inset - dot, statusHeight),
            statusColor, TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            titleFont.Dispose();
            glyphFont.Dispose();
        }

        base.Dispose(disposing);
    }
}
