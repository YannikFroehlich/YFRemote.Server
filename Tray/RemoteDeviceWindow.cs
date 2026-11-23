using System.Diagnostics;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tray;

// Ein Fenster pro gesteuertem Geraet: der unveraenderte Web-Client des Ziels in WebView2. Er koppelt
// selbst per PIN und merkt sich das Token im localStorage - pro Origin, wie im Browser.
internal sealed class RemoteDeviceWindow : Form
{
    private const string RuntimeDownloadUrl = "https://developer.microsoft.com/microsoft-edge/webview2/";

    private static readonly Dictionary<string, RemoteDeviceWindow> OpenWindows = [];
    private static Task<CoreWebView2Environment>? environment;

    private readonly RemoteDevice device;
    private readonly WebView2 webView;
    private bool certificateWarningShown;

    private RemoteDeviceWindow(RemoteDevice device, Icon icon)
    {
        this.device = device;
        Text = $"{device.Name} - YFRemote";
        Icon = icon;
        ClientSize = new Size(1100, 780);
        MinimumSize = new Size(420, 480);
        StartPosition = FormStartPosition.CenterScreen;
        Theme.Apply(this);

        webView = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Theme.Background };

        var nameLabel = new Label
        {
            AutoSize = true,
            Text = device.Name,
            Font = new Font("Segoe UI Semibold", 10F),
            Margin = new Padding(0, 10, 8, 0)
        };
        var addressLabel = new Label
        {
            AutoSize = true,
            Text = device.Secure ? $"{new Uri(device.OpenUrl).Authority} · verschlüsselt" : device.Address,
            ForeColor = Theme.Muted,
            Font = new Font("Consolas", 9.5F),
            Margin = new Padding(0, 11, 16, 0)
        };
        var toolbar = MainWindow.Row(
            nameLabel,
            addressLabel,
            new PillButton("Neu laden", ButtonKind.Secondary, () => webView.CoreWebView2?.Reload()) { Margin = new Padding(0, 4, 8, 4) },
            new PillButton("Im Browser öffnen", ButtonKind.Secondary, () => OpenExternal(webView.Source ?? new Uri(device.OpenUrl))) { Margin = new Padding(0, 4, 0, 4) });
        toolbar.Dock = DockStyle.Top;
        toolbar.Padding = new Padding(14, 4, 14, 4);
        toolbar.BackColor = Theme.Inset;

        // Fill zuerst: angedockt wird in umgekehrter Reihenfolge.
        Controls.Add(webView);
        Controls.Add(toolbar);
        Theme.ScaleToDpi(this);
    }

    public static void Open(RemoteDevice device, IEnumerable<RemoteDevice> knownDevices, Icon icon)
    {
        if (OpenWindows.TryGetValue(device.Url, out var existing) && !existing.IsDisposed)
        {
            if (existing.WindowState == FormWindowState.Minimized)
            {
                existing.WindowState = FormWindowState.Normal;
            }

            existing.Activate();
            return;
        }

        // ponytail: die Liste sicherer Origins gilt fuer den ganzen Prozess. Ein spaeter
        // hinzugefuegtes Geraet laeuft bis zum naechsten Start von YFRemote ohne Zwischenablage-API.
        environment ??= CreateEnvironmentAsync(knownDevices.Select(known => known.OpenUrl).Append(device.OpenUrl));

        var window = new RemoteDeviceWindow(device, icon);
        OpenWindows[device.Url] = window;
        window.FormClosed += (_, _) => OpenWindows.Remove(device.Url);
        window.Show();
    }

    // Der Client prueft fuer Zwischenablage und Diktieren isSecureContext; ueber http://<LAN-IP>
    // waere das falsch. Fuer die eigenen Geraete-Origins darf WebView2 das wie im Android-WebView
    // als sicher behandeln - fremde Seiten oeffnet das Fenster ohnehin nicht (OnNavigationStarting).
    private static Task<CoreWebView2Environment> CreateEnvironmentAsync(IEnumerable<string> origins) =>
        CoreWebView2Environment.CreateAsync(
            browserExecutableFolder: null,
            userDataFolder: Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "YFRemote", "WebView2"),
            options: new CoreWebView2EnvironmentOptions(
                $"--unsafely-treat-insecure-origin-as-secure={string.Join(',', origins.Distinct())}"));

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        Theme.FitToWorkingArea(this);
        try
        {
            await webView.EnsureCoreWebView2Async(await environment!);
            webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            webView.CoreWebView2.NavigationStarting += OnNavigationStarting;
            webView.CoreWebView2.ServerCertificateErrorDetected += OnServerCertificateErrorDetected;
            webView.CoreWebView2.NewWindowRequested += (_, args) =>
            {
                args.Handled = true;
                OpenExternal(new Uri(args.Uri));
            };
            webView.Source = new Uri(device.OpenUrl);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            // Den Prozess ohne Runtime noch einmal versuchen lassen, nachdem sie installiert ist.
            environment = null;
            if (MessageDialog.Show(
                    this,
                    "Für das Gerätefenster fehlt die Microsoft Edge WebView2 Runtime. Unter Windows 11 ist sie vorinstalliert, "
                    + "unter Windows 10 lässt sie sich kostenlos nachinstallieren.\n\nDownload-Seite jetzt öffnen?",
                    "YFRemote",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Information) == DialogResult.Yes)
            {
                OpenExternal(new Uri(RuntimeDownloadUrl));
            }

            Close();
        }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or System.Runtime.InteropServices.COMException)
        {
            environment = null;
            MessageDialog.Show(this, $"Das Gerätefenster konnte nicht geöffnet werden.\n\n{exception.Message}", "YFRemote",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    // Das Zertifikat des Geraets stammt von seiner eigenen, lokalen CA, der Windows nicht vertraut.
    // Durch kommt es nur fuer genau diesen Host und Port und nur, wenn es von der beim ersten
    // Kontakt gemerkten CA (RemoteDevice.Ca) ausgestellt ist - eine andere CA wird nie still
    // uebernommen. AlwaysAllow gilt fuer die Sitzung, also auch fuer den WebSocket.
    private void OnServerCertificateErrorDetected(object? sender, CoreWebView2ServerCertificateErrorDetectedEventArgs args)
    {
        var expected = new Uri(device.OpenUrl);
        var trusted = device.Ca is not null
            && Uri.TryCreate(args.RequestUri, UriKind.Absolute, out var request)
            && string.Equals(request.Host, expected.Host, StringComparison.OrdinalIgnoreCase)
            && request.Port == expected.Port
            && IsFromPinnedAuthority(args.ServerCertificate, expected.Host);
        args.Action = trusted
            ? CoreWebView2ServerCertificateErrorAction.AlwaysAllow
            : CoreWebView2ServerCertificateErrorAction.Cancel;

        if (!trusted && !certificateWarningShown)
        {
            certificateWarningShown = true;
            BeginInvoke(() => MessageDialog.Show(
                this,
                $"Das Zertifikat von {device.Name} stammt nicht von der Stelle, die sich YFRemote beim Hinzufügen gemerkt hat. "
                + "Die Verbindung wurde deshalb abgebrochen.\n\nWurde YFRemote dort neu installiert, entferne das Gerät unter "
                + "\"Steuern\" und füge es neu hinzu. Sonst könnte sich ein anderes Gerät im Netzwerk als dieses ausgeben.",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning));
        }
    }

    private bool IsFromPinnedAuthority(CoreWebView2Certificate certificate, string host)
    {
        try
        {
            using var server = certificate.ToX509Certificate2();
            using var authority = X509CertificateLoader.LoadCertificate(Convert.FromBase64String(device.Ca!));
            return PinnedCertificate.IsIssuedBy(server, authority, host);
        }
        catch (Exception exception) when (exception is CryptographicException or FormatException)
        {
            return false;
        }
    }

    // Im Fenster bleibt nur das Geraet selbst; Links woanders hin gehen in den Standardbrowser.
    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs args)
    {
        if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out var target)
            || string.Equals(target.GetLeftPart(UriPartial.Authority), new Uri(device.OpenUrl).GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        args.Cancel = true;
        OpenExternal(target);
    }

    private static void OpenExternal(Uri uri)
    {
        if (uri.Scheme is "http" or "https")
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }
    }
}
