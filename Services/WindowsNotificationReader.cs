using Windows.UI.Notifications;
using Windows.UI.Notifications.Management;
using YFRemote.Server.Models;

namespace YFRemote.Server.Services;

// Die neueste Windows-Benachrichtigung (Toast) fuer die Weiterleitung aufs Geraet. Das Ereignis
// NotificationChanged gibt es nur fuer Apps mit Paket-Identitaet (bei YFRemote 0x80070490, gemessen
// am 2026-11-10), daher fragt ein PollingBroadcaster jede Sekunde nach.
public sealed class WindowsNotificationReader : IPcNotifications
{
    private const int MaxTextLength = 500;
    private PcNotificationMessage? newest;

    public async Task<PcNotificationMessage?> ReadNewestAsync()
    {
        var listener = UserNotificationListener.Current;
        var access = listener.GetAccessStatus();
        if (access == UserNotificationListenerAccessStatus.Unspecified)
        {
            access = await listener.RequestAccessAsync();
        }

        if (access != UserNotificationListenerAccessStatus.Allowed)
        {
            return null;
        }

        // Die Kennungen steigen mit jeder Benachrichtigung. Wird die neueste weggeklickt, darf die
        // vorige nicht als neu gelten - es bleibt bei der hoechsten bisher gesehenen.
        var latest = (await listener.GetNotificationsAsync(NotificationKinds.Toast)).MaxBy(toast => toast.Id);
        if (latest is not null && (newest is null || latest.Id > newest.Id))
        {
            newest = ToMessage(latest);
        }

        return newest;
    }

    public void Dismiss(uint id)
    {
        var listener = UserNotificationListener.Current;
        if (listener.GetAccessStatus() == UserNotificationListenerAccessStatus.Allowed)
        {
            listener.RemoveNotification(id);
        }
    }

    private static PcNotificationMessage ToMessage(UserNotification toast)
    {
        var texts = toast.Notification.Visual.GetBinding(KnownNotificationBindings.ToastGeneric)
            ?.GetTextElements()
            .Select(element => element.Text.Trim())
            .Where(text => text.Length > 0)
            .ToList() ?? [];
        string app;
        try
        {
            app = toast.AppInfo?.DisplayInfo.DisplayName ?? "";
        }
        catch (Exception)
        {
            // Manche Absender haben keine lesbare App-Info; dann eben ohne Namen.
            app = "";
        }

        return new PcNotificationMessage(
            toast.Id,
            Truncate(app),
            Truncate(texts.FirstOrDefault() ?? ""),
            Truncate(string.Join("\n", texts.Skip(1))));
    }

    private static string Truncate(string text) => text.Length <= MaxTextLength ? text : text[..MaxTextLength];
}
