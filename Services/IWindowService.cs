namespace YFRemote.Server.Services;

public interface IWindowService
{
    // Die Fenster, die auch Alt+Tab zeigt, das vorderste zuerst.
    IReadOnlyList<OpenWindow> ListWindows();

    // false, wenn das Fenster nicht (mehr) in der Liste steht.
    bool TryApply(string id, WindowCommand command);
}

public enum WindowCommand
{
    Focus,
    Minimize,
    Close,
}

// Id ist das Fensterhandle als Dezimalzahl, App der Name des Programms.
public sealed record OpenWindow(string Id, string Title, string App);
