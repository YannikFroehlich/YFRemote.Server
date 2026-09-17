namespace YFRemote.Server.Services;

public sealed class LinuxMouseService(LinuxInputSender inputSender) : IMouseService
{
    public void MoveRelative(int deltaX, int deltaY)
    {
        inputSender.ExecuteSynchronized(() => inputSender.SendMouseMove(deltaX, deltaY));
    }

    public void ClickLeft() => Click(LinuxInputSender.BtnLeft);

    public void ClickRight() => Click(LinuxInputSender.BtnRight);

    public void ClickMiddle() => Click(LinuxInputSender.BtnMiddle);

    public void ButtonDown(string button)
    {
        var buttonCode = ResolveButton(button);
        inputSender.ExecuteSynchronized(() => inputSender.SendMouseButton(buttonCode, down: true));
    }

    public void ButtonUp(string button)
    {
        var buttonCode = ResolveButton(button);
        inputSender.ExecuteSynchronized(() => inputSender.SendMouseButton(buttonCode, down: false));
    }

    public void Scroll(int delta)
    {
        inputSender.ExecuteSynchronized(() => inputSender.SendMouseWheel(delta, horizontal: false));
    }

    public void ScrollHorizontal(int delta)
    {
        inputSender.ExecuteSynchronized(() => inputSender.SendMouseWheel(delta, horizontal: true));
    }

    private static ushort ResolveButton(string button) => button switch
    {
        "left" => LinuxInputSender.BtnLeft,
        "right" => LinuxInputSender.BtnRight,
        "middle" => LinuxInputSender.BtnMiddle,
        _ => throw new ArgumentException($"Unsupported mouse button: {button}", nameof(button))
    };

    private void Click(ushort buttonCode)
    {
        var downSent = false;
        Exception? failure = null;

        inputSender.ExecuteSynchronized(() =>
        {
            try
            {
                inputSender.SendMouseButton(buttonCode, down: true);
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
                        inputSender.SendMouseButton(buttonCode, down: false);
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
