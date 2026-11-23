using QRCoder;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tray;

internal sealed class PairingQrCodeDialog : Form
{
    private readonly string deviceAddress;
    private readonly PairingService pairingService;
    private readonly string? caSha256;
    private readonly int? httpPort;
    private readonly PictureBox qrPictureBox;
    private readonly CheckBox includePairingCheckBox;
    private readonly Label pairingDetailsLabel;
    private readonly Button copyLinkButton;
    private readonly System.Windows.Forms.Timer refreshTimer;

    private string currentPayload = string.Empty;
    private string? renderedPin;

    public PairingQrCodeDialog(string deviceAddress, PairingService pairingService, string? caSha256 = null, int? httpPort = null)
    {
        this.deviceAddress = deviceAddress;
        this.pairingService = pairingService;
        this.caSha256 = caSha256;
        this.httpPort = httpPort;

        Text = "Mit YFRemote verbinden";
        ClientSize = new Size(430, 640);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.CenterScreen;
        // Ohne AutoScaleDimensions skaliert WinForms die Pixelmaße nicht mit, nur die Schrift
        // (in Punkt) wächst mit der Windows-Skalierung - bei 4K mit 200-300 % war der QR-Code
        // dann abgeschnitten.
        AutoScaleDimensions = new SizeF(96F, 96F);
        AutoScaleMode = AutoScaleMode.Dpi;
        Theme.Apply(this);

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoSize = false,
            ColumnCount = 1,
            RowCount = 8,
            Padding = new Padding(24, 20, 24, 20)
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        var titleLabel = Theme.Title("QR-Code mit dem Mobilgerät scannen");

        var descriptionLabel = new Label
        {
            AutoSize = true,
            MaximumSize = new Size(382, 0),
            ForeColor = Theme.Muted,
            Text = "Der QR-Code öffnet die YFRemote-Oberfläche direkt im Browser.",
            Margin = new Padding(0, 0, 0, 14)
        };

        qrPictureBox = new PictureBox
        {
            Dock = DockStyle.Fill,
            SizeMode = PictureBoxSizeMode.Zoom,
            AccessibleName = "QR-Code für die YFRemote-Verbindung",
            Margin = new Padding(0, 0, 0, 12)
        };

        var addressTextBox = Theme.ReadOnlyField(deviceAddress);
        addressTextBox.BackColor = Theme.Background;

        includePairingCheckBox = new ToggleSwitch(
            "Aktuelle Pairing-PIN einschließen",
            "Das Gerät ist nach dem Scannen gleich gekoppelt.")
        {
            Margin = new Padding(0, 0, 0, 6)
        };
        includePairingCheckBox.CheckedChanged += (_, _) => RefreshQrCode();

        pairingDetailsLabel = new Label
        {
            AutoSize = true,
            MaximumSize = new Size(382, 0),
            ForeColor = Theme.Muted,
            Margin = new Padding(0, 0, 0, 12)
        };

        var buttonPanel = new FlowLayoutPanel
        {
            AutoSize = true,
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.RightToLeft,
            WrapContents = false,
            Margin = new Padding(0)
        };

        // GrowAndShrink: Mit dem Standard GrowOnly behalten die Buttons die beim DPI-Skalieren
        // ein zweites Mal vergrößerte Höhe (bei 300 % fast 200 px).
        var closeButton = new PillButton("Schließen", ButtonKind.Secondary)
        {
            DialogResult = DialogResult.Cancel,
            Margin = new Padding(8, 0, 0, 0)
        };

        copyLinkButton = new PillButton("Link kopieren", ButtonKind.Primary)
        {
            Margin = new Padding(0)
        };
        copyLinkButton.Click += (_, _) => CopyCurrentLink();

        buttonPanel.Controls.Add(closeButton);
        buttonPanel.Controls.Add(copyLinkButton);

        layout.Controls.Add(titleLabel, 0, 0);
        layout.Controls.Add(descriptionLabel, 0, 1);
        layout.Controls.Add(qrPictureBox, 0, 2);
        layout.Controls.Add(addressTextBox, 0, 3);
        layout.Controls.Add(includePairingCheckBox, 0, 4);
        layout.Controls.Add(pairingDetailsLabel, 0, 5);
        layout.Controls.Add(buttonPanel, 0, 7);

        Controls.Add(layout);
        CancelButton = closeButton;

        refreshTimer = new System.Windows.Forms.Timer
        {
            Interval = 1000
        };
        refreshTimer.Tick += (_, _) => RefreshPairingState();
        Shown += (_, _) => refreshTimer.Start();
        FormClosed += (_, _) => refreshTimer.Stop();

        RefreshQrCode();
    }

    // Kleine Bildschirme (z.B. 1366x768 bei 125 %): Fenster auf den Arbeitsbereich kürzen, der
    // QR-Code schrumpft dann mit, statt unten aus dem Bild zu laufen.
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
            qrPictureBox.Image?.Dispose();
        }

        base.Dispose(disposing);
    }

    private void RefreshPairingState()
    {
        if (!includePairingCheckBox.Checked)
        {
            return;
        }

        var currentPin = pairingService.GetCurrentPin();
        if (!string.Equals(renderedPin, currentPin.Pin, StringComparison.Ordinal))
        {
            RefreshQrCode();
            return;
        }

        UpdatePairingDetails(currentPin);
    }

    private void RefreshQrCode()
    {
        (string Pin, DateTimeOffset ExpiresAtUtc)? currentPin = includePairingCheckBox.Checked
            ? pairingService.GetCurrentPin()
            : null;
        renderedPin = currentPin?.Pin;

        var payload = PairingQrCodePayload.Create(deviceAddress, renderedPin, caSha256, httpPort);
        if (!string.Equals(payload, currentPayload, StringComparison.Ordinal))
        {
            var nextImage = CreateQrCodeImage(payload);
            var previousImage = qrPictureBox.Image;
            qrPictureBox.Image = nextImage;
            previousImage?.Dispose();
            currentPayload = payload;
            copyLinkButton.Text = "Link kopieren";
        }

        if (currentPin is null)
        {
            pairingDetailsLabel.Text = "Enthält nur die Geräteadresse – die PIN wird anschließend manuell eingegeben.";
            return;
        }

        UpdatePairingDetails(currentPin.Value);
    }

    private void UpdatePairingDetails((string Pin, DateTimeOffset ExpiresAtUtc) pin)
    {
        var remaining = pin.ExpiresAtUtc - DateTimeOffset.UtcNow;
        var remainingMinutes = Math.Max(0, (int)Math.Ceiling(remaining.TotalMinutes));
        pairingDetailsLabel.Text =
            $"PIN {pin.Pin} ist im Link vorausgefüllt (noch ca. {remainingMinutes} Min. gültig).";
    }

    internal static Bitmap CreateQrCodeImage(string payload)
    {
        var pngBytes = PngByteQRCodeHelper.GetQRCode(
            payload,
            QRCodeGenerator.ECCLevel.Q,
            12,
            drawQuietZones: true);

        using var stream = new MemoryStream(pngBytes);
        using var image = Image.FromStream(stream);
        return new Bitmap(image);
    }

    private void CopyCurrentLink()
    {
        try
        {
            Clipboard.SetText(currentPayload);
            copyLinkButton.Text = "Kopiert";
        }
        catch (Exception exception)
        {
            MessageDialog.Show(
                $"Der Verbindungslink konnte nicht kopiert werden.\n\n{exception.Message}",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }
}
