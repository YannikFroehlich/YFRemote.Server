namespace YFRemote.Server.Services;

public interface IPowerService
{
    void Shutdown();

    void Restart();

    void Sleep();
}
