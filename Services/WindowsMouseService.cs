namespace YFRemote.Server.Services;

public sealed class WindowsMouseService(WindowsInputSender inputSender) : IMouseService
{
    public void MoveRelative(int deltaX, int deltaY)
    {
        inputSender.ExecuteSynchronized(() =>
            inputSender.SendMouseInput(deltaX, deltaY, mouseData: 0, WindowsInputFlags.MouseEventMove));
    }

    public void ClickLeft() =>
        Click(WindowsInputFlags.MouseEventLeftDown, WindowsInputFlags.MouseEventLeftUp);

    public void ClickRight() =>
        Click(WindowsInputFlags.MouseEventRightDown, WindowsInputFlags.MouseEventRightUp);

    public void ClickMiddle() =>
        Click(WindowsInputFlags.MouseEventMiddleDown, WindowsInputFlags.MouseEventMiddleUp);

    public void ButtonDown(string button) =>
        SendButtonFlag(button, WindowsInputFlags.MouseEventLeftDown, WindowsInputFlags.MouseEventRightDown, WindowsInputFlags.MouseEventMiddleDown);

    public void ButtonUp(string button) =>
        SendButtonFlag(button, WindowsInputFlags.MouseEventLeftUp, WindowsInputFlags.MouseEventRightUp, WindowsInputFlags.MouseEventMiddleUp);

    public void Scroll(int delta)
    {
        inputSender.ExecuteSynchronized(() =>
            inputSender.SendMouseInput(dx: 0, dy: 0, mouseData: delta, WindowsInputFlags.MouseEventWheel));
    }

    public void ScrollHorizontal(int delta)
    {
        inputSender.ExecuteSynchronized(() =>
            inputSender.SendMouseInput(dx: 0, dy: 0, mouseData: delta, WindowsInputFlags.MouseEventHWheel));
    }

    private void SendButtonFlag(string button, uint leftFlag, uint rightFlag, uint middleFlag)
    {
        var flag = button switch
        {
            "left" => leftFlag,
            "right" => rightFlag,
            "middle" => middleFlag,
            _ => throw new ArgumentException($"Unsupported mouse button: {button}", nameof(button))
        };

        inputSender.ExecuteSynchronized(() =>
            inputSender.SendMouseInput(dx: 0, dy: 0, mouseData: 0, flag));
    }

    private void Click(uint downFlag, uint upFlag)
    {
        var downSent = false;
        Exception? failure = null;

        inputSender.ExecuteSynchronized(() =>
        {
            try
            {
                inputSender.SendMouseInput(dx: 0, dy: 0, mouseData: 0, downFlag);
                downSent = true;
            }
            catch (Exception ex)
            {
                failure = ex;
            }
            finally
            {
                if (downSent)
                {
                    try
                    {
                        inputSender.SendMouseInput(dx: 0, dy: 0, mouseData: 0, upFlag);
                    }
                    catch (Exception ex)
                    {
                        failure ??= ex;
                    }
                }
            }
        });

        if (failure is not null)
        {
            throw failure;
        }
    }
}
