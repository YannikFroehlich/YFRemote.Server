using System.Drawing.Drawing2D;
using System.Net.Http.Json;
using System.Text.Json;
using YFRemote.Server.Models;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tray;

// Seite "Steuern": gemerkte Geraete mit Online-Status aus GET /health, darunter, was die
// Netzwerksuche (NetworkDiscovery) zusaetzlich findet. Geoeffnet wird ein Geraet in einem
// RemoteDeviceWindow.
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
    private readonly System.Windows.Forms.Timer pollTimer;
    private readonly Dictionary<string, HealthResponse?> health = [];
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
        savedEmptyLabel = Theme.Hint("Noch keine Geräte. Füge ein gefundenes Gerät unten hinzu oder gib eine Adresse ein. "
            + "Beim ersten Öffnen koppelst du es mit der PIN, die das Gerät anzeigt.", 640);
        foundStatusLabel = Theme.Hint(string.Empty, 640);

        Theme.AddRows(this,
            MainWindow.Row(searchButton, new PillButton("Gerät hinzufügen...", ButtonKind.Primary, AddManually)),
            new Card("Meine Geräte", savedEmptyLabel, savedTiles),
            new Card("Im Netzwerk gefunden", foundStatusLabel, foundTiles),
            Theme.Hint("Gefunden werden Geräte im selben Netzwerk, auf denen YFRemote läuft. Fehlt eins, über \"Gerät hinzufügen\" "
                + "die Adresse eingeben - sie steht auf dem PC unter \"Dieser PC\", in der Android-App unter \"Freigeben\". "
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
            var results = await Task.WhenAll(devices.Select(async device => (device.Url, Health: await GetHealthAsync(device.Url))));
            foreach (var (url, result) in results)
            {
                health[url] = result;
                if (result?.Name is { Length: > 0 } name)
                {
                    store.SetReportedName(url, name);
                }
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
            $"{device.Url}|{device.Name}|{StatusOf(device.Url)}|{health.GetValueOrDefault(device.Url)?.Platform}"));
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
                $"{device.Address}{PlatformSuffix(deviceHealth)}",
                GlyphFor(deviceHealth),
                status,
                status == DeviceStatus.Online ? "Öffnen" : "Nicht erreichbar",
                status == DeviceStatus.Online,
                () => RemoteDeviceWindow.Open(device, store.Load(), icon),
                menu);
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
                "Hinzufügen",
                true,
                () =>
                {
                    store.Add(new RemoteDevice(entry.Url, entry.Health?.Name ?? address));
                    health[entry.Url] = entry.Health;
                    RefreshSaved();
                },
                null);
        }));
    }

    private DeviceStatus StatusOf(string url) =>
        !health.TryGetValue(url, out var result) ? DeviceStatus.Unknown
        : result is null ? DeviceStatus.Offline
        : DeviceStatus.Online;

    private void AddManually()
    {
        using var dialog = new AddDeviceDialog(GetHealthAsync);
        if (dialog.ShowDialog(FindForm()) != DialogResult.OK || dialog.Result is not { } result)
        {
            return;
        }

        store.Add(result.Device);
        health[result.Device.Url] = result.Health;
        RefreshSaved();
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

    private static FlowLayoutPanel TileRow() => new()
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
    private readonly PillButton actionButton;
    private readonly Button? menuButton;
    private readonly Font titleFont = new("Segoe UI Semibold", 10.5F);
    private readonly Font glyphFont = new("Segoe MDL2 Assets", 14F);

    public DeviceTile(
        string title,
        string subtitle,
        string glyph,
        DeviceStatus status,
        string actionText,
        bool actionEnabled,
        Action action,
        ContextMenuStrip? menu)
    {
        this.subtitle = subtitle;
        this.glyph = glyph;
        this.status = status;
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        Text = title;
        AccessibleName = $"{title}, {subtitle}";
        AutoSize = true;
        Margin = new Padding(0, 0, 14, 14);
        BackColor = Theme.Card;

        actionButton = new PillButton(actionText, status == DeviceStatus.New ? ButtonKind.Secondary : ButtonKind.Primary, action)
        {
            Enabled = actionEnabled,
            Margin = new Padding(0)
        };
        Controls.Add(actionButton);

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
        using (var border = new Pen(Theme.Line))
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
            DeviceStatus.Online => ("Online", Theme.Success),
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
