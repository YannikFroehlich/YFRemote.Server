using YFRemote.Server.Services;

namespace YFRemote.Server.Tray;

internal sealed class RenameDeviceDialog : Form
{
    private readonly TextBox nameBox;

    public RenameDeviceDialog(RemoteDevice device)
    {
        Text = "Gerät umbenennen";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.CenterParent;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Theme.Apply(this);

        nameBox = new TextBox
        {
            Width = 400,
            Font = new Font("Segoe UI", 11F),
            BackColor = Theme.Inset,
            ForeColor = Theme.Text,
            BorderStyle = BorderStyle.FixedSingle,
            Margin = new Padding(0, 0, 0, 10),
            Text = device.Named ? device.Name : string.Empty,
            PlaceholderText = device.Name
        };
        var saveButton = new PillButton("Speichern", ButtonKind.Primary) { DialogResult = DialogResult.OK };
        var cancelButton = new PillButton("Abbrechen", ButtonKind.Secondary) { DialogResult = DialogResult.Cancel };

        var layout = new TableLayoutPanel
        {
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            ColumnCount = 1,
            Padding = new Padding(24, 20, 24, 16)
        };
        Theme.AddRows(layout,
            Theme.Title("Gerät umbenennen"),
            Theme.Hint("Leer lassen, um den Namen zu übernehmen, den das Gerät selbst meldet.", 400),
            new Label { AutoSize = true, Text = "Name", Font = new Font("Segoe UI Semibold", 9.5F), Margin = new Padding(0, 4, 0, 4) },
            nameBox,
            MainWindow.Row(saveButton, cancelButton));
        Controls.Add(layout);
        AcceptButton = saveButton;
        CancelButton = cancelButton;
        Theme.ScaleToDpi(this);
    }

    public string DeviceName => nameBox.Text;
}
