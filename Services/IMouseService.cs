namespace YFRemote.Server.Services;

public interface IMouseService
{
    void MoveRelative(int deltaX, int deltaY);

    // x und y von 0 bis 1 auf dem Hauptbildschirm, fuer einen Tipp ins Bild des Tabs "Bildschirm".
    void MoveToPrimaryScreen(double x, double y);

    void ClickLeft();

    void ClickRight();

    void ClickMiddle();

    void ButtonDown(string button);

    void ButtonUp(string button);

    void Scroll(int delta);

    void ScrollHorizontal(int delta);
}
