using YFRemote.Server.Models;

namespace YFRemote.Server.Tray;

// Ersetzt das Untermenü mit einer Rückfrage je Gerät: Dort schloss sich nach jedem Entkoppeln das
// Tray-Menü, hier lassen sich mehrere Geräte auf einmal auswählen.
internal sealed class UnpairDevicesDialog : Form
{
    private readonly IReadOnlyList<PairedDeviceInfo> devices;
    private readonly CheckedListBox deviceList;

    public UnpairDevicesDialog(IReadOnlyList<(PairedDeviceInfo Device, string Label)> entries)
    {
        devices = entries.Select(entry => entry.Device).ToList();

        Text = "Gekoppelte Geräte";
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleDimensions = new SizeF(96F, 96F);
        AutoScaleMode = AutoScaleMode.Dpi;
        BackColor = Color.FromArgb(13, 20, 24);
        ForeColor = Color.FromArgb(242, 247, 248);
        Font = new Font("Segoe UI", 9F);

        var layout = new TableLayoutPanel
        {
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            ColumnCount = 1,
            RowCount = 3,
            Padding = new Padding(24, 20, 24, 20)
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        for (var row = 0; row < layout.RowCount; row++)
        {
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        }

        var descriptionLabel = new Label
        {
            AutoSize = true,
            MaximumSize = new Size(382, 0),
            ForeColor = Color.FromArgb(167, 181, 187),
            Text = "Geräte anhaken. Entkoppelte Geräte können sich nur mit einer neuen PIN erneut "
                + "verbinden. \"Nur Medien\" erlaubt nur Wiedergabe, Lautstärke und Mixer - kein "
                + "Tippen, keine Maus, kein Ausschalten, keine Dateien und keine Zwischenablage.",
            Margin = new Padding(0, 0, 0, 12)
        };

        deviceList = new CheckedListBox
        {
            Size = new Size(382, 220),
            CheckOnClick = true,
            BorderStyle = BorderStyle.FixedSingle,
            BackColor = Color.FromArgb(22, 32, 38),
            ForeColor = ForeColor,
            Margin = new Padding(0, 0, 0, 12)
        };
        foreach (var (_, label) in entries)
        {
            deviceList.Items.Add(label);
        }

        var buttonPanel = new FlowLayoutPanel
        {
            AutoSize = true,
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.RightToLeft,
            WrapContents = false,
            Margin = new Padding(0)
        };

        var cancelButton = new Button
        {
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Text = "Abbrechen",
            DialogResult = DialogResult.Cancel,
            Margin = new Padding(8, 0, 0, 0)
        };

        var unpairButton = new Button
        {
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Text = "Entkoppeln",
            DialogResult = DialogResult.OK,
            Enabled = false,
            Margin = new Padding(0)
        };
        // Yes/No statt eigener Ergebniswerte: Yes = nur Medien, No = Vollzugriff.
        var mediaOnlyButton = new Button
        {
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Text = "Nur Medien",
            DialogResult = DialogResult.Yes,
            Enabled = false,
            Margin = new Padding(0, 0, 8, 0)
        };

        var fullAccessButton = new Button
        {
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Text = "Vollzugriff",
            DialogResult = DialogResult.No,
            Enabled = false,
            Margin = new Padding(0, 0, 8, 0)
        };

        // ItemCheck kommt vor der Änderung, CheckedIndices zählt also noch den alten Zustand.
        deviceList.ItemCheck += (_, e) =>
        {
            var anyChecked = deviceList.CheckedIndices.Count + (e.NewValue == CheckState.Checked ? 1 : -1) > 0;
            unpairButton.Enabled = mediaOnlyButton.Enabled = fullAccessButton.Enabled = anyChecked;
        };

        buttonPanel.Controls.Add(cancelButton);
        buttonPanel.Controls.Add(unpairButton);
        buttonPanel.Controls.Add(mediaOnlyButton);
        buttonPanel.Controls.Add(fullAccessButton);

        layout.Controls.Add(descriptionLabel, 0, 0);
        layout.Controls.Add(deviceList, 0, 1);
        layout.Controls.Add(buttonPanel, 0, 2);

        Controls.Add(layout);
        AcceptButton = unpairButton;
        CancelButton = cancelButton;
    }

    public IReadOnlyList<PairedDeviceInfo> SelectedDevices =>
        deviceList.CheckedIndices.Cast<int>().Select(index => devices[index]).ToList();
}
