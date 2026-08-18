namespace YFRemote.Server.Services;

public interface IMouseService
{
    void MoveRelative(int deltaX, int deltaY);

    void ClickLeft();

    void ClickRight();

    void Scroll(int delta);
}
