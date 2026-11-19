using Hangfire;
using Hangfire.MemoryStorage;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using RecordRoom.Api.Application;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Application.Services;
using RecordRoom.Api.Domain;
using RecordRoom.Api.Infrastructure.Auth;
using RecordRoom.Api.Infrastructure.Cache;
using RecordRoom.Api.Infrastructure.Data;
using RecordRoom.Api.Infrastructure.Features;
using RecordRoom.Api.Infrastructure.Imaging;
using RecordRoom.Api.Infrastructure.Jobs;
using RecordRoom.Api.Infrastructure.Ocr;
using RecordRoom.Api.Infrastructure.Realtime;

namespace RecordRoom.Api.Tests;

/// <summary>
/// Round-4 flow tests: the real service classes against a real SQLite database
/// (in memory) and a real on-disk document store, asserting both the database
/// rows and the stored files after each step. SQLite is a test provider;
/// production runs SQL Server and is covered over HTTP by scripts/test-api.ps1.
///
/// Flows: file registration + edit (relocation), the custody chain (intake →
/// reconcile → returns → sign-off), issue → return with movements, and the
/// digitization pipeline (page upload → review → deliverable build → review of
/// the built PDF, with history kept).
/// </summary>
public sealed class Round4FlowTests
{
    // A real 1×1 PNG. The document store checks magic signatures, so test
    // uploads must be genuine files; QuestPDF also needs decodable images to
    // compose the deliverable.
    private static readonly byte[] Png =
        Convert.FromBase64String(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");

    private const string ActorName = "Flow Supervisor";
    private const string ActorUserName = "flowsup";

    // ------------------------------------------------------------ test harness

    private sealed class FakeUser(string displayName, string userName, string role)
        : ICurrentUserAccessor
    {
        public CurrentUser? User => new(7, userName, displayName, role, "EMP-007");
        public string UserName => userName;
        public string Role => role;
        public string Ip => "127.0.0.1";
        public bool IsInRole(Domain.Role role) => Role == role.ToString();
    }

    private sealed class NoopRealtime : IRealtimePublisher
    {
        public Task PublishAsync(string channel, string action, string? entityId, string summary, string actor) =>
            Task.CompletedTask;
    }

    private sealed class FakeOcr : IOcrService
    {
        public const string Text = "Flow test OCR text, plain ASCII so every machine can shape it";

        public Task<OcrExtraction> ExtractAsync(string storageKey, string contentType, CancellationToken ct = default) =>
            Task.FromResult(new OcrExtraction(Text, "fake-engine"));

        public Task<Result<ScanOcrDto>> RunAsync(long scanId, CancellationToken ct = default) =>
            Task.FromResult(Result<ScanOcrDto>.Fail("not used in flow tests"));
    }

    /// <summary>Hindi OCR text: exercises the glyph-fallback path on machines without Devanagari fonts.</summary>
    private sealed class HindiOcr : IOcrService
    {
        public const string Text = "हिंदी ओसीआर पाठ";

        public Task<OcrExtraction> ExtractAsync(string storageKey, string contentType, CancellationToken ct = default) =>
            Task.FromResult(new OcrExtraction(Text, "hindi-fake"));

        public Task<Result<ScanOcrDto>> RunAsync(long scanId, CancellationToken ct = default) =>
            Task.FromResult(Result<ScanOcrDto>.Fail("not used in flow tests"));
    }

    private sealed class FakeEnhancer : IScanEnhancer
    {
        public IReadOnlyCollection<string> Operations => ["deskew", "despeckle", "binarize", "crop", "contrast"];

        public Task<Result<(byte[] Bytes, string Label)>> EnhanceAsync(
            byte[] source, string contentType, string operation, int? pageIndex,
            int degrees = 90, CancellationToken ct = default) =>
            Task.FromResult(Result<(byte[], string)>.Ok((source, $"{operation} (test)")));
    }

    private sealed class TestEnvironment(string contentRoot) : IHostEnvironment
    {
        public string ApplicationName { get; set; } = "RecordRoom.Api.Tests";
        public string EnvironmentName { get; set; } = "Development";
        public string ContentRootPath { get; set; } = contentRoot;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    /// <summary>Writes service logs to the console so test failures show their cause.</summary>
    private sealed class ConsoleLogger<T> : ILogger<T>
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Warning;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter) =>
            Console.Error.WriteLine($"[{typeof(T).Name}] {formatter(state, exception)} {exception}");
    }

    private sealed class Harness : IDisposable
    {
        public SqliteConnection Connection { get; } = new("DataSource=:memory:");
        public AppDbContext Db { get; }
        public string StoreRoot { get; } =
            Path.Combine(Path.GetTempPath(), "rr-flow-" + Guid.NewGuid().ToString("N"));
        public ICurrentUserAccessor User { get; } = new FakeUser(ActorName, ActorUserName, "Supervisor");
        public IFilesService Files { get; }
        public IIssuesService Issues { get; }
        public ICustodyService Custody { get; }
        public IFileScansService Scans { get; }
        public IScanStudioService Studio { get; }

        /// <summary>
        /// Plays the Hangfire worker in tests: ScanProcessingJobs resolves
        /// everything it needs from this provider.
        /// </summary>
        private readonly ServiceProvider _provider;

        public Harness(IOcrService? ocr = null)
        {
            Connection.Open();
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseSqlite(Connection)
                .Options;
            Db = new AppDbContext(options);
            Db.Database.EnsureCreated();

            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["FileStorage:RootPath"] = StoreRoot,
                    ["Ocr:Enabled"] = "true",
                    // No SQL Server here: the LIKE search path keeps the probe
                    // from touching sys.fulltext_indexes.
                    ["Search:UseFullText"] = "false",
                })
                .Build();

            var audit = new AuditWriter(User, new NoopRealtime(), new MemoryCacheService(new MemoryCache(
                new MemoryCacheOptions())));
            var store = new PrivateDocumentStore(configuration, new TestEnvironment(StoreRoot));
            var flags = new FeatureFlags(configuration);
            var fileRefs = new FileRefs(Db, flags);

            // The scan pipeline OCRs in the background: uploads enqueue through
            // a real job client (memory storage, no worker) and the tests call
            // ProcessBackgroundScansAsync to play the worker. The provider
            // carries exactly what ScanProcessingJobs resolves from its scope.
            _provider = new ServiceCollection()
                .AddSingleton<AppDbContext>(Db)
                .AddSingleton<IOcrService>(ocr ?? new FakeOcr())
                .AddSingleton<IAuditWriter>(audit)
                .AddSingleton<IConfiguration>(configuration)
                .BuildServiceProvider();

            Files = new FilesService(Db, audit, User, store, flags, configuration,
                NullLogger<FilesService>.Instance);
            Issues = new IssuesService(Db, audit, User, fileRefs);
            Custody = new CustodyService(Db, audit, User);
            Scans = new FileScansService(Db, audit, User, store, fileRefs, configuration,
                NullLogger<FileScansService>.Instance, new BackgroundJobClient(new MemoryStorage()));
            Studio = new ScanStudioService(Db, audit, User, store, new FakeEnhancer(), fileRefs,
                new ConsoleLogger<ScanStudioService>());
        }

        public void Dispose()
        {
            _provider.Dispose();
            Db.Dispose();
            Connection.Dispose();
            try { Directory.Delete(StoreRoot, recursive: true); } catch { /* temp cleanup is best-effort */ }
        }

        /// <summary>
        /// Runs the background OCR pass for every page still marked
        /// "Processing" — the test stand-in for the Hangfire worker picking up
        /// the jobs the upload enqueued.
        /// </summary>
        public async Task ProcessBackgroundScansAsync()
        {
            var jobs = new ScanProcessingJobs(_provider, NullLogger<ScanProcessingJobs>.Instance);
            var pending = await Db.ScanPages
                .Where(p => p.Status == PageStatus.Processing)
                .ToListAsync();
            foreach (var page in pending)
                await jobs.ExtractOcrAsync(page.Id);
        }

        /// <summary>A room → section → almirah → shelf chain, as the location designer would write it.</summary>
        public async Task<int> SeedShelfAsync(string code = "S-1")
        {
            var room = new Room { Code = "R-1", Name = "Records room", Capacity = 100 };
            Db.Rooms.Add(room);
            await Db.SaveChangesAsync();
            var section = new Section { RoomId = room.Id, Code = "SEC-1", Name = "Main" };
            Db.Sections.Add(section);
            await Db.SaveChangesAsync();
            var unit = new StorageUnit
            {
                RoomId = room.Id, SectionId = section.Id, Barcode = "AL-0001", Code = "A-1", Name = "Almirah 1",
            };
            Db.StorageUnits.Add(unit);
            await Db.SaveChangesAsync();
            var shelf = new Shelf { StorageUnitId = unit.Id, Barcode = "SH-0001", Code = code, Name = code, Capacity = 10 };
            Db.Shelves.Add(shelf);
            await Db.SaveChangesAsync();
            return shelf.Id;
        }

        public async Task<RecordFile> CreateFileAsync(string barcode, int? shelfId = null)
        {
            var result = await Files.CreateAsync(new FileCreateInput(
                FileBarcode: barcode,
                Subject: $"Subject of {barcode}",
                Department: "Revenue",
                Year: 2026,
                FileType: "File",
                ShelfId: shelfId,
                Position: 1,
                Pincode: "",
                Area: "",
                PropertyNo: "",
                PropertyArea: "",
                Dealer: "",
                CodalLife: "25 years",
                Description: "Created by the round-4 flow tests."));
            Assert.True(result.IsSuccess, $"file create failed: {string.Join("; ", result.Errors.Select(e => e.Message))}");
            var row = await Db.Files.FirstAsync(f => f.Barcode == barcode);
            return row;
        }

    }

    private static IFormFile PngFile(string name) =>
        new FormFile(new MemoryStream(Png), 0, Png.Length, "document", name)
        {
            Headers = new HeaderDictionary(),
            ContentType = "image/png",
        };

    // ------------------------------------------------------------ registration

    [Fact]
    public async Task FileRegistration_CreatesRow_Occupancy_Movement_Audit()
    {
        using var h = new Harness();
        var shelfId = await h.SeedShelfAsync();
        var barcode = "RF-00001001";

        var file = await h.CreateFileAsync(barcode, shelfId);

        Assert.Equal(RecordStatus.Available, file.Status);
        Assert.Equal(shelfId, file.ShelfId);
        Assert.Equal("REVENUE/2026/1001", file.FileNumber);

        var shelf = await h.Db.Shelves.FirstAsync(s => s.Id == shelfId);
        Assert.Equal(1, shelf.Occupied);

        Assert.True(await h.Db.Movements.AnyAsync(m =>
            m.RecordFileId == file.Id && m.Kind == MovementKind.FileCreated));

        var audit = await h.Db.Audit.SingleAsync(a => a.Entity == "RecordFile" && a.EntityId == file.Id.ToString());
        Assert.Equal(AuditAction.Create, audit.Action);
        Assert.Equal(ActorUserName, audit.Actor);
    }

    [Fact]
    public async Task DuplicateBarcode_IsRejected_NoRowWritten()
    {
        using var h = new Harness();
        await h.CreateFileAsync("RF-00001002");

        var second = await h.Files.CreateAsync(new FileCreateInput(
            "RF-00001002", "Duplicate subject", "Revenue", 2026, "File", null, 1,
            "", "", "", "", "", "", ""));

        Assert.False(second.IsSuccess);
        Assert.Contains(second.Errors, e => e.Field == "fileBarcode");
        Assert.Equal(1, await h.Db.Files.CountAsync(f => f.Barcode == "RF-00001002"));
    }

    [Fact]
    public async Task FileEdit_Relocation_MovesRowAndWritesTrail()
    {
        using var h = new Harness();
        var shelfA = await h.SeedShelfAsync("S-A");
        var file = await h.CreateFileAsync("RF-00001003", shelfA);

        var room = await h.Db.Rooms.FirstAsync();
        var section = await h.Db.Sections.FirstAsync();
        var unit = await h.Db.StorageUnits.FirstAsync();
        var shelfB = new Shelf { StorageUnitId = unit.Id, Barcode = "SH-0002", Code = "S-B", Name = "S-B", Capacity = 10 };
        h.Db.Shelves.Add(shelfB);
        await h.Db.SaveChangesAsync();

        var result = await h.Files.RelocateAsync(file.Id, new RelocateInput(shelfB.Id, 4, "Reshuffled"));

        Assert.True(result.IsSuccess, string.Join("; ", result.Errors.Select(e => e.Message)));
        var moved = await h.Db.Files.FirstAsync(f => f.Id == file.Id);
        Assert.Equal(shelfB.Id, moved.ShelfId);

        Assert.True(await h.Db.Movements.AnyAsync(m =>
            m.RecordFileId == file.Id && m.Kind == MovementKind.LocationChange));
        Assert.True(await h.Db.Audit.AnyAsync(a =>
            a.Entity == "RecordFile" && a.EntityId == file.Id.ToString() && a.Action == AuditAction.Relocate));
    }

    // ----------------------------------------------------------------- custody

    [Fact]
    public async Task CustodyChain_Intake_Reconcile_Returns_SignOff()
    {
        using var h = new Harness();

        var intake = await h.Custody.RecordAsync(new CustodyRecordInput(
            Direction: "Intake", Department: "Land Records", FileCount: 10,
            BatchRef: "BATCH-A", Vendor: "Vendor X", Remarks: "Handed over for digitization"));
        Assert.True(intake.IsSuccess, string.Join("; ", intake.Errors.Select(e => e.Message)));

        // The actor is the signed-in user — never "system" (round-4 bug).
        Assert.Equal(ActorName, intake.Value.RecordedBy);
        var intakeRow = await h.Db.CustodyEvents.FirstAsync(e => e.Id == intake.Value.Id);
        Assert.Equal(CustodyDirection.In, intakeRow.Direction);
        Assert.Equal(ActorName, intakeRow.RecordedBy);

        // Counted 9 of the declared 10: the variance is recorded, not lost.
        var reconciled = await h.Custody.ReconcileAsync(intake.Value.Id,
            new CustodyReconcileInput(9, "One file missing from the box"));
        Assert.True(reconciled.IsSuccess);
        Assert.Equal(9, reconciled.Value.ReconciledCount);

        // Two partial returns against the intake.
        var first = await h.Custody.ReturnAgainstAsync(intake.Value.Id,
            new CustodyReturnAgainstInput(4, "First box back"));
        Assert.True(first.IsSuccess);
        var second = await h.Custody.ReturnAgainstAsync(intake.Value.Id,
            new CustodyReturnAgainstInput(5, "Remaining files back"));
        Assert.True(second.IsSuccess);

        var rows = await h.Db.CustodyEvents.Where(e => e.SourceCustodyId == intake.Value.Id).ToListAsync();
        Assert.Equal(2, rows.Count);
        Assert.All(rows, r => Assert.Equal(ActorName, r.RecordedBy));

        var list = await h.Custody.ListAsync(new CustodyQuery { Direction = "Intake" });
        var listed = Assert.Single(list.Items);
        Assert.Equal(9, listed.ReturnedCount); // 4 + 5 back of the counted 9

        // Sign-off closes the batch; the actor is whoever signed in.
        var signed = await h.Custody.SignOffAsync(intake.Value.Id, new CustodySignOffInput());
        Assert.True(signed.IsSuccess);
        Assert.Equal(ActorName, signed.Value.SignedOffBy);

        Assert.True(await h.Db.Audit.AnyAsync(a =>
            a.Entity == "CustodyEvent" && a.Action == AuditAction.Create && a.Actor == ActorUserName));
    }

    // ----------------------------------------------------------- issue/return

    [Fact]
    public async Task IssueAndReturn_WritesStatus_Movements_Audit()
    {
        using var h = new Harness();
        var file = await h.CreateFileAsync("RF-00001004");

        var issued = await h.Issues.IssueAsync(new IssueInput(
            BorrowerType: "Employee", BorrowerEmployeeCode: "EMP-042", BorrowerName: "Field Officer",
            Department: "Revenue", Purpose: "Field verification", FileIds: [file.Id],
            DueAt: DateTime.UtcNow.AddDays(3), Remark: ""));
        Assert.True(issued.IsSuccess, string.Join("; ", issued.Errors.Select(e => e.Message)));

        var afterIssue = await h.Db.Files.FirstAsync(f => f.Id == file.Id);
        Assert.Equal(RecordStatus.Issued, afterIssue.Status);

        var receiptRow = await h.Db.Issues.Include(r => r.Lines).FirstAsync(r => r.Id == issued.Value.Id);
        var line = Assert.Single(receiptRow.Lines);
        Assert.Null(line.ReturnedAt);

        Assert.True(await h.Db.Movements.AnyAsync(m =>
            m.RecordFileId == file.Id && m.Kind == MovementKind.Issue));

        var returned = await h.Issues.ReturnAsync(issued.Value.Id, new ReturnInput([file.Id], "Good"));
        Assert.True(returned.IsSuccess, string.Join("; ", returned.Errors.Select(e => e.Message)));

        var afterReturn = await h.Db.Files.FirstAsync(f => f.Id == file.Id);
        Assert.Equal(RecordStatus.Available, afterReturn.Status);

        var returnedLine = await h.Db.IssueLines.FirstAsync(l => l.RecordFileId == file.Id);
        Assert.NotNull(returnedLine.ReturnedAt);

        Assert.True(await h.Db.Movements.AnyAsync(m =>
            m.RecordFileId == file.Id && m.Kind == MovementKind.Return));
        Assert.True(await h.Db.Audit.AnyAsync(a =>
            a.Entity == "IssueRecord" && a.Action == AuditAction.Return));
    }

    // ------------------------------------------------------------- digitization

    [Fact]
    public async Task Digitization_UploadStoresBytesAndOcr_ThenReview()
    {
        using var h = new Harness();
        var file = await h.CreateFileAsync("RF-00001005");

        var added = await h.Scans.AddAsync(file.Id, new ScanAddInput("page-1.png", 1, "A4"));
        Assert.True(added.IsSuccess, string.Join("; ", added.Errors.Select(e => e.Message)));
        Assert.Equal("Pending review", added.Value.Status);
        Assert.False(added.Value.HasDocument);

        var withDoc = await h.Scans.AddDocumentAsync(added.Value.Id, PngFile("scan-1.png"));
        Assert.True(withDoc.IsSuccess, string.Join("; ", withDoc.Errors.Select(e => e.Message)));
        // The upload returns immediately; the background pass lands the text.
        await h.ProcessBackgroundScansAsync();

        var row = await h.Db.ScanPages.FirstAsync(p => p.Id == added.Value.Id);
        Assert.NotNull(row.StorageKey);
        Assert.Equal(Png.Length, row.SizeBytes);
        Assert.Equal(FakeOcr.Text, row.OcrText); // the background OCR pass landed the text

        // The bytes are really on disk under the private store, and round-trip.
        var storedPath = Path.Combine(h.StoreRoot, row.StorageKey!);
        Assert.True(File.Exists(storedPath), $"expected {storedPath} to exist");
        Assert.Equal(Png, await File.ReadAllBytesAsync(storedPath));

        var approved = await h.Scans.ReviewAsync(added.Value.Id, new PageReviewInput("Approved"));
        Assert.True(approved.IsSuccess);
        Assert.Equal("Approved", approved.Value.Status);
    }

    [Fact]
    public async Task Digitization_BuildThenReview_KeepsHistory()
    {
        using var h = new Harness();
        var file = await h.CreateFileAsync("RF-00001006");

        var scanIds = new List<long>();
        foreach (var pageNo in new[] { 1, 2 })
        {
            var added = await h.Scans.AddAsync(file.Id, new ScanAddInput($"page-{pageNo}.png", pageNo, "A4"));
            Assert.True(added.IsSuccess);
            var withDoc = await h.Scans.AddDocumentAsync(added.Value.Id, PngFile($"scan-{pageNo}.png"));
            Assert.True(withDoc.IsSuccess, string.Join("; ", withDoc.Errors.Select(e => e.Message)));
            await h.ProcessBackgroundScansAsync(); // review needs the pass finished
            var reviewed = await h.Scans.ReviewAsync(added.Value.Id, new PageReviewInput("Approved"));
            Assert.True(reviewed.IsSuccess);
            scanIds.Add(added.Value.Id);
        }

        var build = await h.Studio.BuildPdfAsync(file.Id, new DeliverablePdfInput(null));
        Assert.True(build.IsSuccess, string.Join("; ", build.Errors.Select(e => e.Message)));

        // A fresh build is pending approval — it is not the deliverable yet.
        Assert.Equal("Pending approval", build.Value.Status);
        Assert.Equal(2, build.Value.PageCount);
        Assert.True(build.Value.IncludesOcrText);
        Assert.Contains($"#{scanIds[0]}:v1", build.Value.SourceVersions);

        var row = await h.Db.Derivatives.FirstAsync(d => d.Id == build.Value.Id);
        Assert.Equal("Pending approval", row.Status);
        Assert.Null(row.ReviewedBy);

        // The composed PDF is a real file on disk.
        var pdfPath = Path.Combine(h.StoreRoot, row.StorageKey!);
        Assert.True(File.Exists(pdfPath));
        await using var pdf = File.OpenRead(pdfPath);
        var head = new byte[5];
        await pdf.ReadExactlyAsync(head);
        Assert.Equal("%PDF-", System.Text.Encoding.ASCII.GetString(head));

        // Rejection without a reason is refused; with one, the build is kept
        // and marked rejected.
        var noReason = await h.Studio.ReviewPdfAsync(build.Value.Id, new DeliverableReviewInput("Rejected"));
        Assert.False(noReason.IsSuccess);

        var rejected = await h.Studio.ReviewPdfAsync(build.Value.Id,
            new DeliverableReviewInput("Rejected", "Page order is wrong"));
        Assert.True(rejected.IsSuccess, string.Join("; ", rejected.Errors.Select(e => e.Message)));
        Assert.Equal("Rejected", rejected.Value.Status);
        Assert.Equal(ActorName, rejected.Value.ReviewedBy);
        Assert.Equal("Page order is wrong", rejected.Value.ReviewNote);

        // A rejected build cannot be re-reviewed.
        var again = await h.Studio.ReviewPdfAsync(build.Value.Id, new DeliverableReviewInput("Approved"));
        Assert.False(again.IsSuccess);

        // Rebuild after a fix and approve: both builds stay in the history.
        var rebuild = await h.Studio.BuildPdfAsync(file.Id, new DeliverablePdfInput("fixed.pdf"));
        Assert.True(rebuild.IsSuccess);
        var approved = await h.Studio.ReviewPdfAsync(rebuild.Value.Id, new DeliverableReviewInput("Approved"));
        Assert.True(approved.IsSuccess);
        Assert.Equal("Approved", approved.Value.Status);

        var history = await h.Studio.ListPdfsAsync(file.Id);
        Assert.Equal(2, history.Length);
        Assert.Equal("Approved", history[0].Status); // newest first
        Assert.Equal("Rejected", history[1].Status);
        Assert.True(File.Exists(Path.Combine(h.StoreRoot,
            (await h.Db.Derivatives.FirstAsync(d => d.Id == history[1].Id)).StorageKey!)));

        Assert.True(await h.Db.Audit.AnyAsync(a =>
            a.Entity == "DocumentDerivative" && a.Action == AuditAction.Approve));
        Assert.True(await h.Db.Audit.AnyAsync(a =>
            a.Entity == "DocumentDerivative" && a.Action == AuditAction.Reject));
    }

    [Fact]
    public async Task Digitization_ReorderChangesBuildOrder()
    {
        using var h = new Harness();
        var file = await h.CreateFileAsync("RF-00001007");

        var scanIds = new List<long>();
        foreach (var pageNo in new[] { 1, 2, 3 })
        {
            var added = await h.Scans.AddAsync(file.Id, new ScanAddInput($"page-{pageNo}.png", pageNo, "A4"));
            Assert.True(added.IsSuccess);
            Assert.True((await h.Scans.AddDocumentAsync(added.Value.Id, PngFile($"scan-{pageNo}.png"))).IsSuccess);
            await h.ProcessBackgroundScansAsync(); // the pass finishes before review
            Assert.True((await h.Scans.ReviewAsync(added.Value.Id, new PageReviewInput("Approved"))).IsSuccess);
            scanIds.Add(added.Value.Id);
        }

        var reversed = scanIds.ToArray();
        Array.Reverse(reversed);
        var order = await h.Studio.ReorderAsync(file.Id, new ScanOrderInput(reversed));
        Assert.True(order.IsSuccess, string.Join("; ", order.Errors.Select(e => e.Message)));

        var build = await h.Studio.BuildPdfAsync(file.Id, new DeliverablePdfInput(null));
        Assert.True(build.IsSuccess);
        // The provenance string follows the composition order, so the reversed
        // build names page 3's scan first.
        Assert.StartsWith($"#{scanIds[2]}:v1", build.Value.SourceVersions);
    }

    [Fact]
    public async Task Digitization_RescanBecomesNextVersion()
    {
        using var h = new Harness();
        var file = await h.CreateFileAsync("RF-00001008");

        var first = await h.Scans.AddAsync(file.Id, new ScanAddInput("page-1.png", 1, "A4"));
        Assert.True(first.IsSuccess);
        Assert.True((await h.Scans.AddDocumentAsync(first.Value.Id, PngFile("scan-1.png"))).IsSuccess);
        await h.ProcessBackgroundScansAsync(); // the pass finishes before review
        Assert.True((await h.Scans.ReviewAsync(first.Value.Id, new PageReviewInput("Approved"))).IsSuccess);

        // Attaching another document to the same page is a rescan: the next
        // version, which awaits review like any new scan; the approved v1 is
        // untouched (the Duplicate flag is reserved for legacy Active rows).
        // The upload itself answers "Processing"; the background OCR pass
        // lands the page on pending review right after.
        var rescan = await h.Scans.AddDocumentAsync(first.Value.Id, PngFile("scan-1-retry.png"));
        Assert.True(rescan.IsSuccess, string.Join("; ", rescan.Errors.Select(e => e.Message)));
        Assert.Equal(2, rescan.Value.Version);
        Assert.Equal("Processing", rescan.Value.Status);

        await h.ProcessBackgroundScansAsync();

        var rows = await h.Db.ScanPages.Where(p => p.Barcode == file.Barcode && p.PageNo == 1)
            .OrderBy(p => p.Version).ToListAsync();
        Assert.Equal(2, rows.Count);
        Assert.Equal(PageStatus.Approved, rows[0].Status);
        Assert.Equal(PageStatus.PendingReview, rows[1].Status);
    }

    /// <summary>
    /// A glyph gap in the invisible OCR text layer (Hindi text on a machine
    /// without Devanagari fonts) must never lose the deliverable: the build
    /// succeeds either with the text layer (fonts available) or without it.
    /// Both outcomes are valid; the PDF on disk is not.
    /// </summary>
    [Fact]
    public async Task Build_WithHindiOcrText_NeverLosesTheDeliverable()
    {
        using var h = new Harness(new HindiOcr());
        var file = await h.CreateFileAsync("RF-00001009");

        var added = await h.Scans.AddAsync(file.Id, new ScanAddInput("page-1.png", 1, "A4"));
        Assert.True(added.IsSuccess);
        Assert.True((await h.Scans.AddDocumentAsync(added.Value.Id, PngFile("scan-hindi.png"))).IsSuccess);
        await h.ProcessBackgroundScansAsync(); // the Hindi OCR lands in the background
        Assert.True((await h.Scans.ReviewAsync(added.Value.Id, new PageReviewInput("Approved"))).IsSuccess);

        var build = await h.Studio.BuildPdfAsync(file.Id, new DeliverablePdfInput(null));
        Assert.True(build.IsSuccess, string.Join("; ", build.Errors.Select(e => e.Message)));

        var row = await h.Db.Derivatives.FirstAsync(d => d.Id == build.Value.Id);
        var pdfPath = Path.Combine(h.StoreRoot, row.StorageKey!);
        Assert.True(File.Exists(pdfPath));
        await using var pdf = File.OpenRead(pdfPath);
        var head = new byte[5];
        await pdf.ReadExactlyAsync(head);
        Assert.Equal("%PDF-", System.Text.Encoding.ASCII.GetString(head));
    }
}
