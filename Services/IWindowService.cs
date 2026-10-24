namespace YFRemote.Server.Services;

public interface IWindowService
{
    // Die Fenster, die auch Alt+Tab zeigt, das vorderste zuerst.
    IReadOnlyList<OpenWindow> ListWindows();

    // false, wenn das Fenster nicht (mehr) in der Liste steht.
    bool TryFocus(string id);
}

// Id ist das Fensterhandle als Dezimalzahl, App der Name des Programms.
public sealed record OpenWindow(string Id, string Title, string App);
