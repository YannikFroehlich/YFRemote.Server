using QRCoder;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tray;

internal sealed class PairingQrCodeDialog : Form
{
    private readonly string deviceAddress;
    private readonly PairingService pairingService;
    private readonly PictureBox qrPictureBox;
    private readonly CheckBox includePairingCheckBox;
    private readonly Label pairingDetailsLabel;
    private readonly Button copyLinkButton;
    private readonly System.Windows.Forms.Timer refreshTimer;

    private string currentPayload = string.Empty;
    private string? renderedPin;

    public PairingQrCodeDialog(string deviceAddress, PairingService pairingService)
    {
        this.deviceAddress = deviceAddress;
        this.pairingService = pairingService;

        Text = "Mit YFRemote verbinden";
        ClientSize = new Size(430, 590);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        BackColor = Color.FromArgb(13, 20, 24);
        ForeColor = Color.FromArgb(242, 247, 248);
        Font = new Font("Segoe UI", 9F);

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
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 322F));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        var titleLabel = new Label
        {
            AutoSize = true,
            Font = new Font(Font, FontStyle.Bold),
            Text = "QR-Code mit dem Mobilgerät scannen",
            Margin = new Padding(0, 0, 0, 6)
        };

        var descriptionLabel = new Label
        {
            AutoSize = true,
            MaximumSize = new Size(382, 0),
            ForeColor = Color.FromArgb(167, 181, 187),
            Text = "Der QR-Code öffnet die YFRemote-Oberfläche direkt im Browser.",
            Margin = new Padding(0, 0, 0, 14)
        };

        qrPictureBox = new PictureBox
        {
            Size = new Size(310, 310),
            Anchor = AnchorStyles.None,
            BackColor = Color.White,
            SizeMode = PictureBoxSizeMode.Zoom,
            AccessibleName = "QR-Code für die YFRemote-Verbindung",
            Margin = new Padding(0, 0, 0, 12)
        };

        var addressTextBox = new TextBox
        {
            Dock = DockStyle.Fill,
            ReadOnly = true,
            Text = deviceAddress,
            TextAlign = HorizontalAlignment.Center,
            Margin = new Padding(0, 0, 0, 12)
        };

        includePairingCheckBox = new CheckBox
        {
            AutoSize = true,
            Text = "Aktuelle Pairing-PIN einschließen",
            ForeColor = ForeColor,
            Margin = new Padding(0, 0, 0, 4)
        };
        includePairingCheckBox.CheckedChanged += (_, _) => RefreshQrCode();

        pairingDetailsLabel = new Label
        {
            AutoSize = true,
            MaximumSize = new Size(382, 0),
            ForeColor = Color.FromArgb(167, 181, 187),
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

        var closeButton = new Button
        {
            AutoSize = true,
            Text = "Schließen",
            DialogResult = DialogResult.Cancel,
            Margin = new Padding(8, 0, 0, 0)
        };

        copyLinkButton = new Button
        {
            AutoSize = true,
            Text = "Link kopieren",
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

        var payload = PairingQrCodePayload.Create(deviceAddress, renderedPin);
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
            MessageBox.Show(
                $"Der Verbindungslink konnte nicht kopiert werden.\n\n{exception.Message}",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }
}
