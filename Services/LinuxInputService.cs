namespace YFRemote.Server.Services;

public sealed class LinuxInputService(LinuxInputSender inputSender) : IInputService
{
    // Linux-Keycodes (KEY_* aus linux/input-event-codes.h) fuer dieselben 74 Namen wie
    // WindowsInputService.VirtualKeys. Es sind physische Tastenpositionen (Scancodes), keine
    // Zeichen - der Compositor uebersetzt sie durch das aktive Tastaturlayout.
    private static readonly IReadOnlyDictionary<string, ushort> KeyCodes =
        new Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase)
        {
            ["CTRL"] = 29,       // KEY_LEFTCTRL
            ["SHIFT"] = 42,      // KEY_LEFTSHIFT
            ["ALT"] = 56,        // KEY_LEFTALT
            ["WIN"] = 125,       // KEY_LEFTMETA
            ["ENTER"] = 28,      // KEY_ENTER
            ["ESC"] = 1,         // KEY_ESC
            ["TAB"] = 15,        // KEY_TAB
            ["SPACE"] = 57,      // KEY_SPACE
            ["BACKSPACE"] = 14,  // KEY_BACKSPACE
            ["DELETE"] = 111,    // KEY_DELETE
            ["UP"] = 103,        // KEY_UP
            ["DOWN"] = 108,      // KEY_DOWN
            ["LEFT"] = 105,      // KEY_LEFT
            ["RIGHT"] = 106,     // KEY_RIGHT
            ["HOME"] = 102,      // KEY_HOME
            ["END"] = 107,       // KEY_END
            ["PAGE_UP"] = 104,   // KEY_PAGEUP
            ["PAGE_DOWN"] = 109, // KEY_PAGEDOWN
            ["PRINT_SCREEN"] = 99, // KEY_SYSRQ
            ["F1"] = 59,
            ["F2"] = 60,
            ["F3"] = 61,
            ["F4"] = 62,
            ["F5"] = 63,
            ["F6"] = 64,
            ["F7"] = 65,
            ["F8"] = 66,
            ["F9"] = 67,
            ["F10"] = 68,
            ["F11"] = 87,
            ["F12"] = 88,
            ["VOLUME_MUTE"] = 113,       // KEY_MUTE
            ["VOLUME_DOWN"] = 114,       // KEY_VOLUMEDOWN
            ["VOLUME_UP"] = 115,         // KEY_VOLUMEUP
            ["MEDIA_PLAY_PAUSE"] = 164,  // KEY_PLAYPAUSE
            ["MEDIA_NEXT"] = 163,        // KEY_NEXTSONG
            ["MEDIA_PREVIOUS"] = 165,    // KEY_PREVIOUSSONG
            ["MEDIA_STOP"] = 166,        // KEY_STOPCD
            ["A"] = 30,
            ["B"] = 48,
            ["C"] = 46,
            ["D"] = 32,
            ["E"] = 18,
            ["F"] = 33,
            ["G"] = 34,
            ["H"] = 35,
            ["I"] = 23,
            ["J"] = 36,
            ["K"] = 37,
            ["L"] = 38,
            ["M"] = 50,
            ["N"] = 49,
            ["O"] = 24,
            ["P"] = 25,
            ["Q"] = 16,
            ["R"] = 19,
            ["S"] = 31,
            ["T"] = 20,
            ["U"] = 22,
            ["V"] = 47,
            ["W"] = 17,
            ["X"] = 45,
            ["Y"] = 21,
            ["Z"] = 44,
            ["0"] = 11,
            ["1"] = 2,
            ["2"] = 3,
            ["3"] = 4,
            ["4"] = 5,
            ["5"] = 6,
            ["6"] = 7,
            ["7"] = 8,
            ["8"] = 9,
            ["9"] = 10
        };

    private static readonly HashSet<string> ModifierKeys =
    [
        "CTRL",
        "SHIFT",
        "ALT",
        "WIN"
    ];

    // TypeText sendet Zeichen ueber Tastenpositionen + Shift statt ueber Unicode - uinput
    // kennt kein Aequivalent zu Windows' KEYEVENTF_UNICODE. Deckt ein US-Layout ab; auf einem
    // anderen aktiven Layout kommen andere Zeichen an oder fehlen ganz (siehe AGENTS.md
    // "Linux support") - das ist die Natur des Verfahrens, nicht ein Bug dieser Zuordnung.
    private static readonly IReadOnlyDictionary<char, (ushort KeyCode, bool Shift)> TypeTextKeys =
        BuildTypeTextKeys();

    internal static IReadOnlyCollection<ushort> AllKeyCodes { get; } = KeyCodes.Values
        .Concat(TypeTextKeys.Values.Select(mapped => mapped.KeyCode))
        .Distinct()
        .ToList();

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
                    SendKeyDown(modifier.KeyCode);
                    pressedModifiers.Add(modifier);
                }

                foreach (var key in resolvedKeys.Where(key => !IsModifier(key.Name)))
                {
                    PressKeyCore(key.KeyCode);
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
                        SendKeyUp(modifier.KeyCode);
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
        inputSender.ExecuteSynchronized(() =>
        {
            foreach (var character in text)
            {
                if (!TypeTextKeys.TryGetValue(character, out var mapped))
                {
                    // Kein Tastenaequivalent im abgedeckten US-Layout - bewusst ausgelassen
                    // statt einer Naeherung, siehe Klassenkommentar oben.
                    continue;
                }

                if (mapped.Shift)
                {
                    SendKeyDown(KeyCodes["SHIFT"]);
                }

                PressKeyCore(mapped.KeyCode);

                if (mapped.Shift)
                {
                    SendKeyUp(KeyCodes["SHIFT"]);
                }
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

    public static bool SupportsKey(string key) => KeyCodes.ContainsKey(NormalizeKey(key));

    public static bool IsModifier(string key) => ModifierKeys.Contains(NormalizeKey(key));

    private static ushort ResolveKey(string key)
    {
        var normalizedKey = NormalizeKey(key);

        if (!KeyCodes.TryGetValue(normalizedKey, out var keyCode))
        {
            throw new UnsupportedKeyException(normalizedKey);
        }

        return keyCode;
    }

    private static string NormalizeKey(string key) => key.Trim().ToUpperInvariant();

    private void PressKeyCore(ushort keyCode)
    {
        var keyDownSent = false;
        Exception? failure = null;

        try
        {
            SendKeyDown(keyCode);
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
                    SendKeyUp(keyCode);
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

    private void SendKeyDown(ushort keyCode) => inputSender.SendKey(keyCode, keyUp: false);

    private void SendKeyUp(ushort keyCode) => inputSender.SendKey(keyCode, keyUp: true);

    private static Dictionary<char, (ushort KeyCode, bool Shift)> BuildTypeTextKeys()
    {
        var map = new Dictionary<char, (ushort KeyCode, bool Shift)>
        {
            [' '] = (57, false),   // KEY_SPACE
            ['-'] = (12, false),   // KEY_MINUS
            ['_'] = (12, true),
            ['='] = (13, false),   // KEY_EQUAL
            ['+'] = (13, true),
            ['['] = (26, false),   // KEY_LEFTBRACE
            ['{'] = (26, true),
            [']'] = (27, false),   // KEY_RIGHTBRACE
            ['}'] = (27, true),
            [';'] = (39, false),   // KEY_SEMICOLON
            [':'] = (39, true),
            ['\''] = (40, false),  // KEY_APOSTROPHE
            ['"'] = (40, true),
            ['`'] = (41, false),   // KEY_GRAVE
            ['~'] = (41, true),
            ['\\'] = (43, false),  // KEY_BACKSLASH
            ['|'] = (43, true),
            [','] = (51, false),   // KEY_COMMA
            ['<'] = (51, true),
            ['.'] = (52, false),   // KEY_DOT
            ['>'] = (52, true),
            ['/'] = (53, false),   // KEY_SLASH
            ['?'] = (53, true),
            ['1'] = (2, false),
            ['!'] = (2, true),
            ['2'] = (3, false),
            ['@'] = (3, true),
            ['3'] = (4, false),
            ['#'] = (4, true),
            ['4'] = (5, false),
            ['$'] = (5, true),
            ['5'] = (6, false),
            ['%'] = (6, true),
            ['6'] = (7, false),
            ['^'] = (7, true),
            ['7'] = (8, false),
            ['&'] = (8, true),
            ['8'] = (9, false),
            ['*'] = (9, true),
            ['9'] = (10, false),
            ['('] = (10, true),
            ['0'] = (11, false),
            [')'] = (11, true)
        };

        foreach (var (name, keyCode) in KeyCodes)
        {
            if (name.Length != 1 || !char.IsAsciiLetterUpper(name[0]))
            {
                continue;
            }

            map[char.ToLowerInvariant(name[0])] = (keyCode, false);
            map[name[0]] = (keyCode, true);
        }

        return map;
    }

    private sealed record ResolvedKey(string Name, ushort KeyCode);
}
