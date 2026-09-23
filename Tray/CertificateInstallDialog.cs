namespace YFRemote.Server.Tray;

internal sealed class CertificateInstallDialog : Form
{
    private readonly string certificateUrl;
    private readonly PictureBox qrPictureBox;
    private readonly Button copyLinkButton;

    public CertificateInstallDialog(string certificateUrl)
    {
        this.certificateUrl = certificateUrl;

        Text = "YFRemote-Zertifikat installieren";
        ClientSize = new Size(430, 640);
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
            ColumnCount = 1,
            RowCount = 7,
            Padding = new Padding(24, 20, 24, 20)
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 292F));
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
            Text = "Der QR-Code lädt die Zertifikatsdatei nur herunter. Installiert wird sie "
                + "danach von Hand in den Systemeinstellungen (siehe unten). Ohne Installation "
                + "ist die Verbindung ebenfalls verschlüsselt - der Browser zeigt dann aber eine "
                + "Zertifikatswarnung, die sich wegklicken lässt.",
            Margin = new Padding(0, 0, 0, 14)
        };

        qrPictureBox = new PictureBox
        {
            Size = new Size(280, 280),
            Anchor = AnchorStyles.None,
            BackColor = Color.White,
            SizeMode = PictureBoxSizeMode.Zoom,
            AccessibleName = "QR-Code für das YFRemote-Zertifikat",
            Image = PairingQrCodeDialog.CreateQrCodeImage(certificateUrl),
            Margin = new Padding(0, 0, 0, 12)
        };

        var addressTextBox = new TextBox
        {
            Dock = DockStyle.Fill,
            ReadOnly = true,
            Text = certificateUrl,
            TextAlign = HorizontalAlignment.Center,
            Margin = new Padding(0, 0, 0, 12)
        };

        var instructionsLabel = new Label
        {
            AutoSize = true,
            MaximumSize = new Size(382, 0),
            ForeColor = Color.FromArgb(167, 181, 187),
            Text = "Android: Einstellungen → Sicherheit → Verschlüsselung & Anmeldedaten → "
                + "Zertifikat installieren → CA-Zertifikat.\n\n"
                + "iPhone/iPad: Profil laden, dann Einstellungen → Allgemein → VPN & "
                + "Geräteverwaltung → Profil installieren. Anschließend Einstellungen → Allgemein "
                + "→ Info → Zertifikatsvertrauen für YFRemote einschalten.\n\n"
                + "Das Zertifikat erlaubt diesem PC, für das Gerät verschlüsselte Verbindungen "
                + "auszustellen. Nur auf eigenen Geräten installieren.",
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
        copyLinkButton.Click += (_, _) => CopyLink();

        buttonPanel.Controls.Add(closeButton);
        buttonPanel.Controls.Add(copyLinkButton);

        layout.Controls.Add(titleLabel, 0, 0);
        layout.Controls.Add(descriptionLabel, 0, 1);
        layout.Controls.Add(qrPictureBox, 0, 2);
        layout.Controls.Add(addressTextBox, 0, 3);
        layout.Controls.Add(instructionsLabel, 0, 4);
        layout.Controls.Add(buttonPanel, 0, 6);

        Controls.Add(layout);
        CancelButton = closeButton;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            qrPictureBox.Image?.Dispose();
        }

        base.Dispose(disposing);
    }

    private void CopyLink()
    {
        try
        {
            Clipboard.SetText(certificateUrl);
            copyLinkButton.Text = "Kopiert";
        }
        catch (Exception exception)
        {
            MessageBox.Show(
                $"Der Link konnte nicht kopiert werden.\n\n{exception.Message}",
                "YFRemote",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }
}
