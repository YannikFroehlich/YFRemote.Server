namespace YFRemote.Server.Services;

public sealed class WindowsInputService(WindowsInputSender inputSender) : IInputService
{
    private static readonly IReadOnlyDictionary<string, ushort> VirtualKeys =
        new Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase)
        {
            ["CTRL"] = 0x11,
            ["SHIFT"] = 0x10,
            ["ALT"] = 0x12,
            ["WIN"] = 0x5B,
            ["ENTER"] = 0x0D,
            ["ESC"] = 0x1B,
            ["TAB"] = 0x09,
            ["SPACE"] = 0x20,
            ["BACKSPACE"] = 0x08,
            ["DELETE"] = 0x2E,
            ["UP"] = 0x26,
            ["DOWN"] = 0x28,
            ["LEFT"] = 0x25,
            ["RIGHT"] = 0x27,
            ["F1"] = 0x70,
            ["F2"] = 0x71,
            ["F3"] = 0x72,
            ["F4"] = 0x73,
            ["F5"] = 0x74,
            ["F6"] = 0x75,
            ["F7"] = 0x76,
            ["F8"] = 0x77,
            ["F9"] = 0x78,
            ["F10"] = 0x79,
            ["F11"] = 0x7A,
            ["F12"] = 0x7B,
            ["VOLUME_MUTE"] = 0xAD,
            ["VOLUME_DOWN"] = 0xAE,
            ["VOLUME_UP"] = 0xAF,
            ["MEDIA_PLAY_PAUSE"] = 0xB3,
            ["A"] = 0x41,
            ["B"] = 0x42,
            ["C"] = 0x43,
            ["D"] = 0x44,
            ["E"] = 0x45,
            ["F"] = 0x46,
            ["G"] = 0x47,
            ["H"] = 0x48,
            ["I"] = 0x49,
            ["J"] = 0x4A,
            ["K"] = 0x4B,
            ["L"] = 0x4C,
            ["M"] = 0x4D,
            ["N"] = 0x4E,
            ["O"] = 0x4F,
            ["P"] = 0x50,
            ["Q"] = 0x51,
            ["R"] = 0x52,
            ["S"] = 0x53,
            ["T"] = 0x54,
            ["U"] = 0x55,
            ["V"] = 0x56,
            ["W"] = 0x57,
            ["X"] = 0x58,
            ["Y"] = 0x59,
            ["Z"] = 0x5A,
            ["0"] = 0x30,
            ["1"] = 0x31,
            ["2"] = 0x32,
            ["3"] = 0x33,
            ["4"] = 0x34,
            ["5"] = 0x35,
            ["6"] = 0x36,
            ["7"] = 0x37,
            ["8"] = 0x38,
            ["9"] = 0x39
        };

    private static readonly HashSet<string> ModifierKeys =
    [
        "CTRL",
        "SHIFT",
        "ALT",
        "WIN"
    ];

    public void PressKey(string key)
    {
        inputSender.ExecuteSynchronized(() => PressKeyCore(ResolveKey(key)));
    }

    public void PressHotkey(IReadOnlyList<string> keys)
    {
        var resolvedKeys = keys.Select(key => new ResolvedKey(NormalizeKey(key), ResolveKey(key))).ToList();
        var pressedModifiers = new List<ResolvedKey>();
        Exception? failure = null;

        inputSender.ExecuteSynchronized(() =>
        {
            try
            {
                foreach (var modifier in resolvedKeys.Where(key => IsModifier(key.Name)))
                {
                    SendKeyDown(modifier.VirtualKey);
                    pressedModifiers.Add(modifier);
                }

                foreach (var key in resolvedKeys.Where(key => !IsModifier(key.Name)))
                {
                    PressKeyCore(key.VirtualKey);
                }
            }
            catch (Exception ex)
            {
                failure = ex;
            }
            finally
            {
                foreach (var modifier in pressedModifiers.AsEnumerable().Reverse())
                {
                    try
                    {
                        SendKeyUp(modifier.VirtualKey);
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

    public void TypeText(string text)
    {
        // Zeichen statt Tasten senden (KEYEVENTF_UNICODE): deckt Satzzeichen, Umlaute und
        // Groß-/Kleinschreibung ab, die die VirtualKeys-Allowlist oben nicht abbilden kann.
        inputSender.ExecuteSynchronized(() =>
        {
            foreach (var character in text)
            {
                inputSender.SendUnicodeInput(character, keyUp: false);
                inputSender.SendUnicodeInput(character, keyUp: true);
            }
        });
    }

    public void KeyDown(string key)
    {
        inputSender.ExecuteSynchronized(() => SendKeyDown(ResolveKey(key)));
    }

    public void KeyUp(string key)
    {
        inputSender.ExecuteSynchronized(() => SendKeyUp(ResolveKey(key)));
    }

    public static bool SupportsKey(string key) => VirtualKeys.ContainsKey(NormalizeKey(key));

    public static bool IsModifier(string key) => ModifierKeys.Contains(NormalizeKey(key));

    private static ushort ResolveKey(string key)
    {
        var normalizedKey = NormalizeKey(key);

        if (!VirtualKeys.TryGetValue(normalizedKey, out var virtualKey))
        {
            throw new UnsupportedKeyException(normalizedKey);
        }

        return virtualKey;
    }

    private static string NormalizeKey(string key) => key.Trim().ToUpperInvariant();

    private void PressKeyCore(ushort virtualKey)
    {
        var keyDownSent = false;
        Exception? failure = null;

        try
        {
            SendKeyDown(virtualKey);
            keyDownSent = true;
        }
        catch (Exception ex)
        {
            failure = ex;
        }
        finally
        {
            if (keyDownSent)
            {
                try
                {
                    SendKeyUp(virtualKey);
                }
                catch (Exception ex)
                {
                    failure ??= ex;
                }
            }
        }

        if (failure is not null)
        {
            throw failure;
        }
    }

    private void SendKeyDown(ushort virtualKey) => inputSender.SendKeyboardInput(virtualKey, keyUp: false);

    private void SendKeyUp(ushort virtualKey) => inputSender.SendKeyboardInput(virtualKey, keyUp: true);

    private sealed record ResolvedKey(string Name, ushort VirtualKey);
}
