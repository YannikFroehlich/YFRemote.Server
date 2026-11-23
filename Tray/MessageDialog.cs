using System.Drawing.Drawing2D;
using System.Media;

namespace YFRemote.Server.Tray;

// Ersatz für MessageBox.Show im YFRemote-Design, mit derselben Parameterreihenfolge. Program.cs
// nutzt weiter die Windows-MessageBox: "läuft bereits" kommt vor der WinForms-Initialisierung, und
// der Startfehler muss auch dann erscheinen, wenn hier etwas schiefgeht.
internal static class MessageDialog
{
    public static DialogResult Show(
        string text,
        string caption,
        MessageBoxButtons buttons = MessageBoxButtons.OK,
        MessageBoxIcon icon = MessageBoxIcon.None) =>
        Show(null, text, caption, buttons, icon);

    public static DialogResult Show(
        IWin32Window? owner,
        string text,
        string caption,
        MessageBoxButtons buttons = MessageBoxButtons.OK,
        MessageBoxIcon icon = MessageBoxIcon.None)
    {
        using var dialog = new MessageForm(text, caption, buttons, icon, hasOwner: owner is not null);
        PlaySound(icon);
        return owner is null ? dialog.ShowDialog() : dialog.ShowDialog(owner);
    }

    private static void PlaySound(MessageBoxIcon icon)
    {
        var sound = icon switch
        {
            MessageBoxIcon.Error => SystemSounds.Hand,
            MessageBoxIcon.Warning => SystemSounds.Exclamation,
            MessageBoxIcon.Question => SystemSounds.Question,
            MessageBoxIcon.Information => SystemSounds.Asterisk,
            _ => null
        };
        sound?.Play();
    }

    private sealed class MessageForm : Form
    {
        public MessageForm(string text, string caption, MessageBoxButtons buttons, MessageBoxIcon icon, bool hasOwner)
        {
            Text = caption;
            Theme.Apply(this);
            AutoSize = true;
            AutoSizeMode = AutoSizeMode.GrowAndShrink;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = hasOwner ? FormStartPosition.CenterParent : FormStartPosition.CenterScreen;
            // Aus dem Tray-Menü heraus gibt es kein Elternfenster: wie die MessageBox nach vorn
            // und in der Taskleiste auffindbar, statt hinter anderen Fenstern zu verschwinden.
            ShowInTaskbar = !hasOwner;
            TopMost = !hasOwner;

            // Erster Absatz als Überschrift, wenn er kurz ist ("HTTPS einschalten?"), der Rest darunter.
            var parts = text.Split("\n\n", 2);
            var heading = parts.Length == 2 && parts[0].Length <= 90 ? parts[0] : null;
            var body = heading is null ? text : parts[1];

            var layout = new TableLayoutPanel
            {
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                ColumnCount = 2,
                Padding = new Padding(22, 20, 22, 18)
            };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

            var textPanel = new FlowLayoutPanel
            {
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                Margin = new Padding(0)
            };
            if (heading is not null)
            {
                textPanel.Controls.Add(new Label
                {
                    AutoSize = true,
                    MaximumSize = new Size(420, 0),
                    Font = new Font("Segoe UI Semibold", 12F),
                    ForeColor = Theme.Text,
                    UseMnemonic = false,
                    Text = heading,
                    Margin = new Padding(0, 4, 0, 8)
                });
            }

            textPanel.Controls.Add(new Label
            {
                AutoSize = true,
                MaximumSize = new Size(420, 0),
                ForeColor = heading is null ? Theme.Text : Theme.Muted,
                UseMnemonic = false,
                Text = body,
                Margin = new Padding(0, heading is null ? 8 : 0, 0, 18)
            });

            var buttonPanel = new FlowLayoutPanel
            {
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                Dock = DockStyle.Right,
                FlowDirection = FlowDirection.RightToLeft,
                WrapContents = false,
                Margin = new Padding(0)
            };
            // Rechts der Abbruch, links davon die Hauptaktion - wie in den übrigen YFRemote-Fenstern.
            ((string, DialogResult) Primary, (string, DialogResult)? Secondary) choice = buttons switch
            {
                MessageBoxButtons.YesNo or MessageBoxButtons.YesNoCancel => (("Ja", DialogResult.Yes), ("Nein", DialogResult.No)),
                MessageBoxButtons.OKCancel => (("OK", DialogResult.OK), ("Abbrechen", DialogResult.Cancel)),
                MessageBoxButtons.RetryCancel => (("Wiederholen", DialogResult.Retry), ("Abbrechen", DialogResult.Cancel)),
                _ => (("OK", DialogResult.OK), null)
            };
            var (primary, secondary) = choice;
            if (buttons == MessageBoxButtons.YesNoCancel)
            {
                buttonPanel.Controls.Add(new PillButton("Abbrechen", ButtonKind.Secondary)
                {
                    DialogResult = DialogResult.Cancel,
                    Margin = new Padding(8, 0, 0, 0)
                });
            }

            PillButton? secondaryButton = null;
            if (secondary is { } second)
            {
                secondaryButton = new PillButton(second.Item1, ButtonKind.Secondary)
                {
                    DialogResult = second.Item2,
                    Margin = new Padding(8, 0, 0, 0)
                };
                buttonPanel.Controls.Add(secondaryButton);
            }

            var primaryButton = new PillButton(primary.Item1, ButtonKind.Primary)
            {
                DialogResult = primary.Item2,
                Margin = new Padding(0)
            };
            buttonPanel.Controls.Add(primaryButton);

            layout.Controls.Add(new MessageIcon(icon), 0, 0);
            layout.Controls.Add(textPanel, 1, 0);
            layout.Controls.Add(buttonPanel, 0, 1);
            layout.SetColumnSpan(buttonPanel, 2);
            Controls.Add(layout);

            AcceptButton = primaryButton;
            // Escape wie bei der MessageBox: Nein/Abbrechen, bei reinem OK eben OK.
            CancelButton = buttons == MessageBoxButtons.YesNoCancel
                ? (IButtonControl)buttonPanel.Controls[0]
                : secondaryButton ?? primaryButton;
            Theme.ScaleToDpi(this);
        }
    }

    // Runder Kreis mit Zeichen in der Farbe der Meldungsart, statt der bunten Windows-Symbole.
    private sealed class MessageIcon : Control
    {
        private readonly Color color;
        private readonly string glyph;

        public MessageIcon(MessageBoxIcon icon)
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
            (color, glyph) = icon switch
            {
                MessageBoxIcon.Error => (Theme.Danger, "✕"),
                MessageBoxIcon.Warning => (Theme.Warning, "!"),
                MessageBoxIcon.Question => (Theme.Accent, "?"),
                MessageBoxIcon.Information => (Theme.Accent, "i"),
                _ => (Color.Empty, string.Empty)
            };
            Size = glyph.Length == 0 ? Size.Empty : new Size(40, 40);
            Margin = glyph.Length == 0 ? new Padding(0) : new Padding(0, 0, 16, 0);
            Font = new Font("Segoe UI Semibold", 15F);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(Parent?.BackColor ?? Theme.Background);
            if (glyph.Length == 0)
            {
                return;
            }

            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            var bounds = new RectangleF(0.5F, 0.5F, Width - 1.5F, Height - 1.5F);
            using var fill = new SolidBrush(Color.FromArgb(40, color));
            using var border = new Pen(Color.FromArgb(110, color));
            e.Graphics.FillEllipse(fill, bounds);
            e.Graphics.DrawEllipse(border, bounds);
            TextRenderer.DrawText(e.Graphics, glyph, Font, ClientRectangle, color,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }
    }
}
