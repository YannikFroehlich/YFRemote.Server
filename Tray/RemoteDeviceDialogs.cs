using YFRemote.Server.Models;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tray;

// "Gerät hinzufügen...": nimmt eine Adresse erst, wenn dort ein YFRemote auf /health antwortet.
internal sealed class AddDeviceDialog : Form
{
    private readonly Func<string, Task<HealthResponse?>> checkHealth;
    private readonly TextBox addressBox;
    private readonly TextBox nameBox;
    private readonly Label errorLabel;
    private readonly PillButton addButton;

    public AddDeviceDialog(Func<string, Task<HealthResponse?>> checkHealth)
    {
        this.checkHealth = checkHealth;
        Text = "Gerät hinzufügen";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.CenterParent;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Theme.Apply(this);

        addressBox = DarkTextBox();
        nameBox = DarkTextBox();
        errorLabel = new Label { AutoSize = true, MaximumSize = new Size(400, 0), ForeColor = Theme.Danger, Visible = false, Margin = new Padding(0, 0, 0, 10) };
        addButton = new PillButton("Prüfen und hinzufügen", ButtonKind.Primary, () => _ = AddAsync());
        var cancelButton = new PillButton("Abbrechen", ButtonKind.Secondary) { DialogResult = DialogResult.Cancel };

        Controls.Add(DialogLayout(
            Theme.Title("Gerät hinzufügen"),
            Theme.Hint("Adresse eingeben, wie sie auf dem Gerät unter \"Dieser PC\" bzw. \"Freigeben\" steht. Ohne Port wird 5050 verwendet.", 400),
            FieldLabel("Adresse"),
            addressBox,
            errorLabel,
            FieldLabel("Name (optional)"),
            nameBox,
            Theme.Hint("Gekoppelt wird erst beim Öffnen: Das Gerät fragt nach seiner PIN.", 400),
            MainWindow.Row(addButton, cancelButton)));
        AcceptButton = addButton;
        CancelButton = cancelButton;
        Theme.ScaleToDpi(this);
    }

    public (RemoteDevice Device, HealthResponse Health)? Result { get; private set; }

    private async Task AddAsync()
    {
        var url = RemoteDeviceStore.NormalizeAddress(addressBox.Text);
        if (url is null)
        {
            ShowError("Das ist keine gültige Adresse. Beispiele: 192.168.0.24 oder pc-name:5060");
            return;
        }

        addButton.Enabled = false;
        addButton.Text = "Prüfe Verbindung...";
        var health = await checkHealth(url);
        addButton.Enabled = true;
        addButton.Text = "Prüfen und hinzufügen";
        if (health is null)
        {
            ShowError($"Unter {url} antwortet kein YFRemote. Läuft YFRemote dort, und ist das Gerät im selben Netzwerk?");
            return;
        }

        var name = nameBox.Text.Trim();
        var address = new Uri(url).Authority;
        Result = (new RemoteDevice(url, name.Length > 0 ? name : health.Name ?? address, Named: name.Length > 0), health);
        DialogResult = DialogResult.OK;
    }

    private void ShowError(string message)
    {
        errorLabel.Text = message;
        errorLabel.Visible = true;
        addressBox.Focus();
    }

    internal static TextBox DarkTextBox() => new()
    {
        Width = 400,
        Font = new Font("Segoe UI", 11F),
        BackColor = Theme.Inset,
        ForeColor = Theme.Text,
        BorderStyle = BorderStyle.FixedSingle,
        Margin = new Padding(0, 0, 0, 10)
    };

    internal static Label FieldLabel(string text) => new()
    {
        AutoSize = true,
        Text = text,
        Font = new Font("Segoe UI Semibold", 9.5F),
        Margin = new Padding(0, 4, 0, 4)
    };

    internal static TableLayoutPanel DialogLayout(params Control[] controls)
    {
        var layout = new TableLayoutPanel
        {
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            ColumnCount = 1,
            Padding = new Padding(24, 20, 24, 16)
        };
        Theme.AddRows(layout, controls);
        return layout;
    }
}

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

        nameBox = AddDeviceDialog.DarkTextBox();
        nameBox.Text = device.Named ? device.Name : string.Empty;
        nameBox.PlaceholderText = device.Name;
        var saveButton = new PillButton("Speichern", ButtonKind.Primary) { DialogResult = DialogResult.OK };
        var cancelButton = new PillButton("Abbrechen", ButtonKind.Secondary) { DialogResult = DialogResult.Cancel };

        Controls.Add(AddDeviceDialog.DialogLayout(
            Theme.Title("Gerät umbenennen"),
            Theme.Hint("Leer lassen, um den Namen zu übernehmen, den das Gerät selbst meldet.", 400),
            AddDeviceDialog.FieldLabel("Name"),
            nameBox,
            MainWindow.Row(saveButton, cancelButton)));
        AcceptButton = saveButton;
        CancelButton = cancelButton;
        Theme.ScaleToDpi(this);
    }

    public string DeviceName => nameBox.Text;
}
