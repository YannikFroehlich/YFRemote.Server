using YFRemote.Server.Services;

namespace YFRemote.Server.Endpoints;

internal static class RequestGuards
{
    // WebSocket-Handshakes unterliegen nicht der Same-Origin-Policy des Browsers, daher muss der
    // Origin-Header hier selbst geprueft werden, um Steuerbefehle von fremden Webseiten zu verhindern.
    internal static bool IsAllowedOrigin(HttpRequest request)
    {
        var origin = request.Headers.Origin.ToString();
        if (string.IsNullOrEmpty(origin))
        {
            return false;
        }

        var expectedOrigin = $"{request.Scheme}://{request.Host}";
        return string.Equals(origin, expectedOrigin, StringComparison.OrdinalIgnoreCase);
    }

    internal static string? GetBearerToken(HttpRequest request)
    {
        const string bearerPrefix = "Bearer ";
        var authorization = request.Headers.Authorization.ToString();

        if (!authorization.StartsWith(bearerPrefix, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var token = authorization[bearerPrefix.Length..].Trim();
        return token.Length == 0 ? null : token;
    }

    internal static Task WriteOriginRejectedAsync(HttpResponse response)
    {
        response.StatusCode = StatusCodes.Status403Forbidden;
        return response.WriteAsync("Origin not allowed.");
    }

    // Gemeinsamer Einlass der Bearer-Token-Endpunkte (/files, /clipboard/*): 403 ohne passenden
    // Origin, 401 ohne gueltiges Token. Liefert die Geraete-ID, oder null, wenn die Ablehnung schon
    // geschrieben ist. originOptional erlaubt einen fehlenden Origin (Same-Origin-GET), nie einen
    // fremden. /ws und DELETE /pair pruefen bewusst selbst (Token-Quelle, Logs, Antworttexte).
    internal static async Task<Guid?> AuthorizePairedDeviceAsync(
        HttpContext context,
        bool originOptional = false)
    {
        var originPresent = context.Request.Headers.Origin.Count > 0;
        if ((originPresent || !originOptional) && !IsAllowedOrigin(context.Request))
        {
            await WriteOriginRejectedAsync(context.Response);
            return null;
        }

        var pairingService = context.RequestServices.GetRequiredService<PairingService>();
        if (!pairingService.TryValidateToken(GetBearerToken(context.Request), out var deviceId))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return null;
        }

        return deviceId;
    }
}
