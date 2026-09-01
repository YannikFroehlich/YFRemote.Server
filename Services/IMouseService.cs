namespace YFRemote.Server.Services;

public interface IMouseService
{
    void MoveRelative(int deltaX, int deltaY);

    void ClickLeft();

    void ClickRight();

    void ClickMiddle();

    void ButtonDown(string button);

    void ButtonUp(string button);

    void Scroll(int delta);

    void ScrollHorizontal(int delta);
}
