using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using YFRemote.Server.Configuration;
using YFRemote.Server.Services;

namespace YFRemote.Server.Tests.Services;

[TestClass]
public sealed class FileTransferServiceTests
{
    private string testDirectory = null!;

    [TestInitialize]
    public void Initialize()
    {
        var testRoot = Path.Combine(Path.GetTempPath(), "YFRemote.Server.Tests");
        testDirectory = Path.Combine(testRoot, Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(testDirectory);
    }

    [TestCleanup]
    public void Cleanup()
    {
        if (Directory.Exists(testDirectory))
        {
            Directory.Delete(testDirectory, recursive: true);
        }
    }

    [TestMethod]
    public async Task SaveFileAsync_WritesFileAndRaisesFileReceived()
    {
        var service = CreateService();
        string? receivedFileName = null;
        service.FileReceived += name => receivedFileName = name;

        var savedFileName = await SaveText(service, "hallo.txt", "Hallo Welt");

        Assert.AreEqual("hallo.txt", savedFileName);
        Assert.AreEqual("hallo.txt", receivedFileName);
        Assert.AreEqual("Hallo Welt", await File.ReadAllTextAsync(Path.Combine(testDirectory, "hallo.txt")));
    }

    [TestMethod]
    public async Task SaveFileAsync_WithExistingFileName_AppendsCounterSuffix()
    {
        var service = CreateService();

        await SaveText(service, "hallo.txt", "erste");
        var secondFileName = await SaveText(service, "hallo.txt", "zweite");

        Assert.AreEqual("hallo (2).txt", secondFileName);
        Assert.AreEqual("erste", await File.ReadAllTextAsync(Path.Combine(testDirectory, "hallo.txt")));
        Assert.AreEqual("zweite", await File.ReadAllTextAsync(Path.Combine(testDirectory, "hallo (2).txt")));
    }

    [TestMethod]
    public async Task SaveFileAsync_WithPathTraversalFileName_KeepsOnlyTheFileNamePart()
    {
        var service = CreateService();

        var savedFileName = await SaveText(service, "..\\..\\evil.txt", "böse");

        Assert.AreEqual("evil.txt", savedFileName);
        Assert.IsTrue(File.Exists(Path.Combine(testDirectory, "evil.txt")));
    }

    [TestMethod]
    public async Task SaveFileAsync_ExceedingMaxSize_ThrowsAndLeavesNoPartialFile()
    {
        var service = CreateService(maxFileSizeBytes: 4);

        await Assert.ThrowsExactlyAsync<FileTooLargeException>(
            () => SaveText(service, "zu-gross.txt", "das ist zu lang"));

        Assert.IsFalse(File.Exists(Path.Combine(testDirectory, "zu-gross.txt")));
    }

    private FileTransferService CreateService(long maxFileSizeBytes = 1024 * 1024) =>
        new(
            new FileTransferOptions { TargetDirectory = testDirectory, MaxFileSizeBytes = maxFileSizeBytes },
            NullLogger<FileTransferService>.Instance);

    private static async Task<string> SaveText(FileTransferService service, string fileName, string content)
    {
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes(content));
        return await service.SaveFileAsync(fileName, stream, CancellationToken.None);
    }
}
