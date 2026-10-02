namespace YFRemote.Server.Configuration;

public sealed class InputOptions
{
    public const string SectionName = "Input";

    // Pause je Zeichen bei Texteingabe (Windows), siehe WindowsInputService.TypeText.
    public int TypeTextCharacterDelayMs { get; init; } = 30;

    public void Validate()
    {
        if (TypeTextCharacterDelayMs is < 0 or > 1000)
        {
            throw new InvalidOperationException("Input:TypeTextCharacterDelayMs must be between 0 and 1000.");
        }
    }
}
