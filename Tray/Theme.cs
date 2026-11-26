using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace YFRemote.Server.Tray;

// Farben aus client/src/styles.scss, damit die Fenster wie Weboberfläche und Android-App aussehen.
internal static class Theme
{
    public static readonly Color Background = Color.FromArgb(0x0b, 0x12, 0x20);
    public static readonly Color Card = Color.FromArgb(0x15, 0x1f, 0x31);
    public static readonly Color Raised = Color.FromArgb(0x1a, 0x25, 0x39);
    public static readonly Color Hover = Color.FromArgb(0x1e, 0x2b, 0x42);
    public static readonly Color Inset = Color.FromArgb(0x0f, 0x18, 0x28);
    public static readonly Color Line = Color.FromArgb(0x26, 0x31, 0x44);
    public static readonly Color Selection = Color.FromArgb(0x16, 0x32, 0x4a);
    public static readonly Color Text = Color.FromArgb(0xe8, 0xee, 0xf8);
    public static readonly Color Muted = Color.FromArgb(0x9a, 0xac, 0xc6);
    public static readonly Color Disabled = Color.FromArgb(0x5e, 0x6e, 0x86);
    public static readonly Color Accent = Color.FromArgb(0x38, 0xbd, 0xf8);
    public static readonly Color AccentStart = Color.FromArgb(0x5c, 0xcb, 0xfa);
    public static readonly Color AccentEnd = Color.FromArgb(0x22, 0xad, 0xef);
    public static readonly Color OnAccent = Color.FromArgb(0x04, 0x11, 0x1c);
    public static readonly Color Danger = Color.FromArgb(0xf8, 0x71, 0x71);
    public static readonly Color DangerSoft = Color.FromArgb(0x2a, 0x1b, 0x26);
    public static readonly Color Warning = Color.FromArgb(0xfb, 0xbf, 0x24);
    public static readonly Color Success = Color.FromArgb(0x4a, 0xde, 0x80);
    public static readonly Color Track = Color.FromArgb(0x2a, 0x37, 0x4d);

    // Grundeinstellungen für jedes YFRemote-Fenster: dunkel, Segoe UI, dunkle Titelleiste.
    public static void Apply(Form form)
    {
        form.BackColor = Background;
        form.ForeColor = Text;
        form.Font = new Font("Segoe UI", 9.5F);
        form.HandleCreated += (_, _) => UseDarkTitleBar(form);
    }

    // Am Ende des Konstruktors aufrufen, wenn alle Steuerelemente im Fenster sind: WinForms rechnet
    // Breiten, Abstände und MaximumSize genau einmal um, sobald AutoScaleMode gesetzt ist. Am Anfang
    // gesetzt wuchs bei 250 % nur das Fenster, Seitenleiste und Texte darin blieben 100 %-Pixel.
    public static void ScaleToDpi(Form form)
    {
        form.AutoScaleDimensions = new SizeF(96F, 96F);
        form.AutoScaleMode = AutoScaleMode.Dpi;
    }

    // 4K-Fernseher mit 300 % hat nur 1280x720 logische Pixel: ein Fenster, das größer als der
    // Arbeitsbereich ist, ragte unten aus dem Bild. Aufrufen in OnLoad, nach dem DPI-Skalieren.
    public static void FitToWorkingArea(Form form)
    {
        var workingArea = Screen.FromControl(form).WorkingArea;
        form.Size = new Size(Math.Min(form.Width, workingArea.Width), Math.Min(form.Height, workingArea.Height));
        form.Location = new Point(
            Math.Max(workingArea.Left, workingArea.Left + (workingArea.Width - form.Width) / 2),
            Math.Max(workingArea.Top, workingArea.Top + (workingArea.Height - form.Height) / 2));
    }

    // Ältere Windows-Versionen ignorieren beides einfach.
    public static void UseDarkTitleBar(Form form)
    {
        var enabled = 1;
        _ = DwmSetWindowAttribute(form.Handle, 20, ref enabled, sizeof(int));
    }

    public static void UseDarkScrollBars(Control control) =>
        _ = SetWindowTheme(control.Handle, "DarkMode_Explorer", null);

    // Runde Ecken wie die Windows-11-Menüs; unter Windows 10 bleibt es eckig.
    public static void UseRoundedCorners(Control control)
    {
        var round = 2;
        _ = DwmSetWindowAttribute(control.Handle, 33, ref round, sizeof(int));
    }

    // Dunkles Tray-Menü samt Untermenüs. Gesetzt über ToolStripManager.Renderer, damit auch die
    // Untermenüs ("Gerät klingeln lassen") es bekommen.
    public static void UseDarkMenus(ContextMenuStrip menu)
    {
        ToolStripManager.Renderer = new DarkMenuRenderer();
        menu.ForeColor = Text;
        menu.HandleCreated += (_, _) => UseRoundedCorners(menu);
    }

    public static Label Title(string text) => new()
    {
        AutoSize = true,
        Font = new Font("Segoe UI Semibold", 14F),
        ForeColor = Text,
        Text = text,
        Margin = new Padding(0, 0, 0, 6)
    };

    public static Label Hint(string text, int maximumWidth = 500) => new()
    {
        AutoSize = true,
        MaximumSize = new Size(maximumWidth, 0),
        ForeColor = Muted,
        Text = text,
        Margin = new Padding(0, 0, 0, 10)
    };

    // Schreibgeschützte Adresse auf einer Kartenfläche statt eines hellen Eingabefelds.
    public static TextBox ReadOnlyField(string text) => new()
    {
        ReadOnly = true,
        TabStop = false,
        Text = text,
        Font = new Font("Segoe UI", 10.5F),
        BorderStyle = BorderStyle.None,
        BackColor = Card,
        ForeColor = Text,
        TextAlign = HorizontalAlignment.Center,
        Dock = DockStyle.Fill,
        Margin = new Padding(0, 0, 0, 12)
    };

    public static void AddRows(TableLayoutPanel panel, params Control[] controls)
    {
        panel.RowCount = controls.Length;
        foreach (var control in controls)
        {
            panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            panel.Controls.Add(control);
        }
    }

    public static GraphicsPath RoundedRectangle(RectangleF bounds, float radius)
    {
        var diameter = Math.Min(radius * 2, Math.Min(bounds.Width, bounds.Height));
        var path = new GraphicsPath();
        path.AddArc(bounds.X, bounds.Y, diameter, diameter, 180, 90);
        path.AddArc(bounds.Right - diameter, bounds.Y, diameter, diameter, 270, 90);
        path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(bounds.X, bounds.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    [DllImport("uxtheme.dll", CharSet = CharSet.Unicode)]
    private static extern int SetWindowTheme(IntPtr hwnd, string? appName, string? idList);
}

// Abgerundete Karte wie .card in der Weboberfläche, mit Überschrift.
internal sealed class Card : TableLayoutPanel
{
    public Card(string title, params Control[] controls)
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Dock = DockStyle.Fill;
        ColumnCount = 1;
        BackColor = Theme.Card;
        Padding = new Padding(18, 14, 18, 14);
        Margin = new Padding(0, 0, 0, 14);
        ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));

        var heading = new Label
        {
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 12F),
            ForeColor = Theme.Text,
            Text = title,
            Margin = new Padding(0, 0, 0, 8)
        };
        Theme.AddRows(this, [heading, .. controls]);
        foreach (Control control in Controls)
        {
            control.BackColor = Theme.Card;
        }
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        e.Graphics.Clear(Parent?.BackColor ?? Theme.Background);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var path = Theme.RoundedRectangle(new RectangleF(0.5F, 0.5F, Width - 1.5F, Height - 1.5F), 16 * DeviceDpi / 96F);
        using var fill = new SolidBrush(Theme.Card);
        using var border = new Pen(Theme.Line);
        e.Graphics.FillPath(fill, path);
        e.Graphics.DrawPath(border, path);
    }
}

internal enum ButtonKind
{
    Primary,
    Secondary,
    Danger
}

// Wie .primary-button/.secondary-button der Weboberfläche: Pille, Akzentverlauf oder dunkle Fläche.
internal sealed class PillButton : Button
{
    private readonly ButtonKind kind;
    private bool hovered;
    private bool pressed;

    public PillButton(string text, ButtonKind kind, Action? action = null)
    {
        this.kind = kind;
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
        Text = text;
        AutoSize = true;
        // GrowOnly behielte die beim DPI-Skalieren ein zweites Mal vergrößerte Höhe.
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Cursor = Cursors.Hand;
        Font = new Font("Segoe UI Semibold", 9.5F);
        Margin = new Padding(0, 0, 8, 6);
        if (action is not null)
        {
            Click += (_, _) => action();
        }
    }

    public override Size GetPreferredSize(Size proposedSize)
    {
        var text = TextRenderer.MeasureText(Text, Font);
        return new Size(text.Width + LogicalToDeviceUnits(32), text.Height + LogicalToDeviceUnits(16));
    }

    protected override void OnMouseEnter(EventArgs e) { hovered = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hovered = pressed = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnMouseDown(MouseEventArgs e) { pressed = true; Invalidate(); base.OnMouseDown(e); }
    protected override void OnMouseUp(MouseEventArgs e) { pressed = false; Invalidate(); base.OnMouseUp(e); }
    protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }
    protected override void OnTextChanged(EventArgs e) { Invalidate(); base.OnTextChanged(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(Parent?.BackColor ?? Theme.Card);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var bounds = new RectangleF(0.5F, 0.5F, Width - 1.5F, Height - 1.5F);
        using var path = Theme.RoundedRectangle(bounds, bounds.Height / 2);

        Color textColor;
        if (!Enabled)
        {
            using var fill = new SolidBrush(Theme.Inset);
            g.FillPath(fill, path);
            textColor = Theme.Disabled;
        }
        else if (kind == ButtonKind.Primary)
        {
            using var fill = new LinearGradientBrush(bounds,
                pressed ? Theme.AccentEnd : Theme.AccentStart,
                hovered ? Theme.Accent : Theme.AccentEnd,
                LinearGradientMode.Vertical);
            g.FillPath(fill, path);
            textColor = Theme.OnAccent;
        }
        else
        {
            var danger = kind == ButtonKind.Danger;
            using var fill = new SolidBrush(danger
                ? Theme.DangerSoft
                : pressed ? Theme.Inset : hovered ? Theme.Hover : Theme.Raised);
            using var border = new Pen(danger ? Color.FromArgb(90, Theme.Danger) : hovered ? Color.FromArgb(70, Theme.Accent) : Theme.Line);
            g.FillPath(fill, path);
            g.DrawPath(border, path);
            textColor = danger ? Theme.Danger : Theme.Text;
        }

        if (Focused && ShowFocusCues)
        {
            using var focus = new Pen(Theme.Accent, 2);
            g.DrawPath(focus, path);
        }

        TextRenderer.DrawText(g, Text, Font, ClientRectangle, textColor,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
    }
}

// Schalter wie .snap-switch der Weboberfläche: Pille mit Knopf, darunter eine Erklärung.
internal sealed class ToggleSwitch : CheckBox
{
    private readonly string description;
    private readonly Font titleFont = new("Segoe UI Semibold", 9.5F);

    public ToggleSwitch(string title, string description)
    {
        this.description = description;
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
        Text = title;
        AutoSize = true;
        Cursor = Cursors.Hand;
        Margin = new Padding(0, 0, 0, 10);
    }

    // Die Erklärung bricht an der Breite der Karte um; einzeilig gemessen lief sie rechts aus der Karte.
    public override Size GetPreferredSize(Size proposedSize)
    {
        var textX = LogicalToDeviceUnits(52);
        var width = proposedSize.Width is > 1 and < int.MaxValue / 2 ? proposedSize.Width
            : Parent is null ? int.MaxValue / 2
            : Parent.DisplayRectangle.Width - Margin.Horizontal;
        var title = TextRenderer.MeasureText(Text, titleFont);
        var hint = MeasureDescription(Math.Max(LogicalToDeviceUnits(120), width - textX));
        return new Size(
            textX + Math.Max(title.Width, hint.Width),
            title.Height + hint.Height + LogicalToDeviceUnits(4));
    }

    private Size MeasureDescription(int width) =>
        TextRenderer.MeasureText(description, Font, new Size(width, int.MaxValue), TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix);

    protected override void OnCheckedChanged(EventArgs e) { Invalidate(); base.OnCheckedChanged(e); }
    protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(Parent?.BackColor ?? Theme.Card);
        g.SmoothingMode = SmoothingMode.AntiAlias;

        var track = new RectangleF(0.5F, LogicalToDeviceUnits(2), LogicalToDeviceUnits(38), LogicalToDeviceUnits(22));
        using (var path = Theme.RoundedRectangle(track, track.Height / 2))
        using (var fill = new SolidBrush(!Enabled ? Theme.Inset : Checked ? Theme.AccentEnd : Theme.Track))
        {
            g.FillPath(fill, path);
        }

        var inset = LogicalToDeviceUnits(3);
        var knobSize = track.Height - inset * 2;
        var knobX = Checked ? track.Right - inset - knobSize : track.X + inset;
        using (var knob = new SolidBrush(!Enabled ? Theme.Disabled : Checked ? Theme.OnAccent : Theme.Muted))
        {
            g.FillEllipse(knob, knobX, track.Y + inset, knobSize, knobSize);
        }

        var textX = LogicalToDeviceUnits(52);
        var titleHeight = TextRenderer.MeasureText(Text, titleFont).Height;
        TextRenderer.DrawText(g, Text, titleFont, new Point(textX, 0), Enabled ? Theme.Text : Theme.Disabled, TextFormatFlags.NoPrefix);
        var descriptionTop = titleHeight + LogicalToDeviceUnits(2);
        TextRenderer.DrawText(g, description, Font, new Rectangle(textX, descriptionTop, Width - textX, Height - descriptionTop), Theme.Muted,
            TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            titleFont.Dispose();
        }

        base.Dispose(disposing);
    }
}

internal sealed class DarkMenuRenderer() : ToolStripProfessionalRenderer(new DarkMenuColors())
{
    protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
    {
        e.TextColor = e.Item.Enabled ? Theme.Text : Theme.Muted;
        base.OnRenderItemText(e);
    }

    protected override void OnRenderArrow(ToolStripArrowRenderEventArgs e)
    {
        e.ArrowColor = e.Item?.Enabled == false ? Theme.Disabled : Theme.Muted;
        base.OnRenderArrow(e);
    }

    // Akzentfarbener Haken statt des schwarzen Standardhakens, der auf Dunkel unsichtbar wäre.
    protected override void OnRenderItemCheck(ToolStripItemImageRenderEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var size = Math.Min(e.ImageRectangle.Width, e.ImageRectangle.Height) + 2;
        var box = new RectangleF(
            e.ImageRectangle.X + (e.ImageRectangle.Width - size) / 2F,
            e.ImageRectangle.Y + (e.ImageRectangle.Height - size) / 2F,
            size,
            size);
        using var path = Theme.RoundedRectangle(box, 4);
        using var fill = new SolidBrush(Theme.AccentEnd);
        using var pen = new Pen(Theme.OnAccent, 2F) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        g.FillPath(fill, path);
        g.DrawLines(pen,
        [
            new PointF(box.X + box.Width * 0.25F, box.Y + box.Height * 0.52F),
            new PointF(box.X + box.Width * 0.43F, box.Y + box.Height * 0.70F),
            new PointF(box.X + box.Width * 0.76F, box.Y + box.Height * 0.32F)
        ]);
    }
}

internal sealed class DarkMenuColors : ProfessionalColorTable
{
    public DarkMenuColors()
    {
        UseSystemColors = false;
    }

    public override Color ToolStripDropDownBackground => Theme.Card;
    public override Color ImageMarginGradientBegin => Theme.Card;
    public override Color ImageMarginGradientMiddle => Theme.Card;
    public override Color ImageMarginGradientEnd => Theme.Card;
    public override Color MenuBorder => Theme.Line;
    public override Color MenuItemBorder => Theme.Hover;
    public override Color MenuItemSelected => Theme.Hover;
    public override Color MenuItemSelectedGradientBegin => Theme.Hover;
    public override Color MenuItemSelectedGradientEnd => Theme.Hover;
    public override Color MenuItemPressedGradientBegin => Theme.Raised;
    public override Color MenuItemPressedGradientEnd => Theme.Raised;
    public override Color SeparatorDark => Theme.Line;
    public override Color SeparatorLight => Theme.Card;
    public override Color CheckBackground => Theme.Card;
    public override Color CheckSelectedBackground => Theme.Hover;
    public override Color CheckPressedBackground => Theme.Hover;
}
