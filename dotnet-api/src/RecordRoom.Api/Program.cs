using System.IdentityModel.Tokens.Jwt;
using System.Text;
using Hangfire;
using Hangfire.MemoryStorage;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi;
using RecordRoom.Api.Application;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Application.Services;
using RecordRoom.Api.Infrastructure.Auth;
using RecordRoom.Api.Infrastructure.Cache;
using RecordRoom.Api.Infrastructure.Configuration;
using RecordRoom.Api.Infrastructure.Data;
using RecordRoom.Api.Infrastructure.Features;
using RecordRoom.Api.Infrastructure.Jobs;
using RecordRoom.Api.Infrastructure.RateLimiting;
using RecordRoom.Api.Infrastructure.Realtime;
using StackExchange.Redis;
using Microsoft.AspNetCore.Authorization;

var builder = WebApplication.CreateBuilder(args);

// ---------------------------------------------------------------- configuration
// A .env file next to the app is the one-file deployment story: storage root,
// demo mode, OCR settings, the feature-edit lock — everything an operator
// should not need a redeploy for. Inserted ahead of the environment-variables
// source so a real env var (or the command line) still overrides the file.
var envFilePath = Environment.GetEnvironmentVariable("DOTNET_ENV_FILE")
                  ?? Path.Combine(builder.Environment.ContentRootPath, ".env");
var envSourceIndex = builder.Configuration.Sources.ToList().FindIndex(
    s => s is Microsoft.Extensions.Configuration.EnvironmentVariables.EnvironmentVariablesConfigurationSource);
if (envSourceIndex >= 0)
    builder.Configuration.Sources.Insert(envSourceIndex, new EnvFileConfigurationSource(envFilePath));
else
    builder.Configuration.AddEnvFile(envFilePath);

var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("ConnectionStrings:Default is required.");

// Database:Provider=Sqlite (with ConnectionStrings:Default=DataSource=rr.db) is
// the local/no-SQL-Server boot: it lets the API run on a laptop — and the
// frontend's live contract tests exercise it — without an instance. SQL Server
// stays the deployment default and the only provider that can use full-text
// search (the probe degrades to LIKE everywhere else).
var databaseProvider = builder.Configuration["Database:Provider"] ?? "SqlServer";

builder.Services.AddDbContext<AppDbContext>(options =>
{
    if (string.Equals(databaseProvider, "Sqlite", StringComparison.OrdinalIgnoreCase))
    {
        options.UseSqlite(connectionString);
    }
    else
    {
        // No EnableRetryOnFailure on purpose: the EF Core retrying execution strategy
        // cannot be combined with user-initiated transactions, and this API relies on
        // explicit transactions for issue/return and location writes. Transaction
        // correctness wins over transient-fault resilience.
        options.UseSqlServer(connectionString, sql =>
            sql.MigrationsAssembly(typeof(AppDbContext).Assembly.FullName));

        if (builder.Environment.IsDevelopment())
            options.EnableDetailedErrors().EnableSensitiveDataLogging();
    }
});

// Bind through the options system so IOptions<JwtOptions> resolves for any service
// that asks for it, and keep a direct instance for startup validation.
builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection("Jwt"));
var jwtOptions = builder.Configuration.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();
if (jwtOptions.SigningKey.Length < 32)
    throw new InvalidOperationException("Jwt:SigningKey must be at least 32 characters.");
builder.Services.AddSingleton(jwtOptions);

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        // Read claims exactly as issued. Without this, JwtBearer rewrites "sub"
        // into ClaimTypes.NameIdentifier on the way in, and any code that looks
        // up "sub" silently gets null.
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtOptions.Issuer,
            ValidAudience = jwtOptions.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtOptions.SigningKey)),
            ClockSkew = TimeSpan.FromSeconds(30),
            // Keep the raw claim names. Without this, JwtBearer rewrites "sub" to
            // ClaimTypes.NameIdentifier on the way in and the accessor has to guess.
            // Identity.Name should be the login, not the numeric id.
            NameClaimType = "preferred_username",
            // The API is the authorization boundary, so the role claim is trusted.
            RoleClaimType = System.Security.Claims.ClaimTypes.Role,
        };
    });

builder.Services.AddAuthorization();

var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
                     ?? ["http://localhost:5173"];
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy
    .WithOrigins(allowedOrigins)
    .AllowAnyHeader()
    .AllowAnyMethod()
    // Required for the SignalR websocket fallback.
    .AllowCredentials()));

// ------------------------------------------------------------------ redis/cache
builder.Services.AddMemoryCache();
var redisConnection = builder.Configuration["Redis:ConnectionString"];

// One multiplexer, shared by the cache, the SignalR backplane and the rate
// limiter. Connecting once avoids three pools and three connection attempts.
// A null result is legitimate and means "no Redis": every consumer degrades.
builder.Services.AddSingleton<IConnectionMultiplexer?>(sp =>
{
    if (string.IsNullOrWhiteSpace(redisConnection)) return null;
    var log = sp.GetRequiredService<ILogger<Program>>();
    try
    {
        // abortConnect=false (set in the connection string on the VPS) means a
        // Redis that is down at boot does not throw: the multiplexer retries in
        // the background and the app starts degraded instead of not at all.
        var mux = ConnectionMultiplexer.Connect(redisConnection);
        log.LogInformation("Redis connected at {Redis}.", redisConnection);
        return mux;
    }
    catch (Exception ex)
    {
        // Only an unusable connection string lands here. Redis is optional, so this
        // must not prevent startup.
        log.LogWarning(ex, "Redis unavailable at {Redis}; running without it.", redisConnection);
        return null;
    }
});

builder.Services.AddSingleton<ICacheService>(sp =>
{
    var memory = sp.GetRequiredService<Microsoft.Extensions.Caching.Memory.IMemoryCache>();
    var log = sp.GetRequiredService<ILogger<Program>>();
    // GetService, not GetRequiredService: the registered factory legitimately
    // returns null when Redis is not configured, and resolving null must mean
    // "degrade to memory", not "throw on every request".
    var mux = sp.GetService<IConnectionMultiplexer>();

    if (mux is null)
    {
        log.LogInformation("No usable Redis connection; using the in-memory cache.");
        return new MemoryCacheService(memory);
    }

    return new RedisCacheService(mux, memory, sp.GetRequiredService<ILogger<RedisCacheService>>());
});

// ----------------------------------------------------------------------- hangfire
// In-memory storage by default so the app runs with no extra infrastructure.
// Set Hangfire:Storage=SqlServer to persist jobs in the same SQL Server.
var hangfireStorage = builder.Configuration["Hangfire:Storage"] ?? "InMemory";
builder.Services.AddHangfire(config =>
{
    if (string.Equals(hangfireStorage, "SqlServer", StringComparison.OrdinalIgnoreCase))
        config.UseSqlServerStorage(connectionString);
    else
        config.UseMemoryStorage();
});

// Cron expressions are configuration, not code: a site may need the overdue
// sweep at a different cadence, and nobody should have to rebuild to change it.
var overdueCron = builder.Configuration["Hangfire:OverdueSweepCron"] ?? "*/15 * * * *";
var pruneCron = builder.Configuration["Hangfire:AuditRetentionCron"] ?? "30 2 * * *";

// Optional features (see FeatureFlags). A singleton that reads configuration on demand,
// so changing Features:BarcodeEnabled needs no restart where configuration reloads.
builder.Services.AddSingleton<IFeatureFlags, FeatureFlags>();
builder.Services.AddScoped<IFileRefs, FileRefs>();

// Scoped, not singleton: it stamps audit rows with the caller identity, which comes from IHttpContextAccessor.
builder.Services.AddScoped<IAuditWriter, AuditWriter>();
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<ICurrentUserAccessor, CurrentUserAccessor>();
builder.Services.AddScoped<ILocationsService, LocationsService>();
builder.Services.AddScoped<IFilesService, FilesService>();
builder.Services.AddScoped<IRecordFileDocumentsService, RecordFileDocumentsService>();
builder.Services.AddSingleton<IPrivateDocumentStore, PrivateDocumentStore>();
builder.Services.AddScoped<IIssuesService, IssuesService>();
builder.Services.AddScoped<IFileScansService, FileScansService>();
builder.Services.AddSingleton<RecordRoom.Api.Infrastructure.Imaging.IScanEnhancer, RecordRoom.Api.Infrastructure.Imaging.ScanEnhancer>();
builder.Services.AddScoped<IScanStudioService, ScanStudioService>();
builder.Services.AddScoped<ICustodyService, CustodyService>();
builder.Services.AddScoped<IFeatureSettingsService, FeatureSettingsService>();
builder.Services.AddScoped<IPermissionService, PermissionService>();
builder.Services.AddScoped<IEmployeesService, EmployeesService>();
builder.Services.AddScoped<IUsersService, UsersService>();
builder.Services.AddScoped<IContentService, ContentService>();
builder.Services.AddScoped<IUploadsService, UploadsService>();
builder.Services.AddScoped<IBulkService, BulkService>();
builder.Services.AddScoped<IBarcodeService, BarcodeService>();
builder.Services.AddScoped<IReadService, ReadService>();
builder.Services.AddScoped<IDepartmentsService, DepartmentsService>();
builder.Services.AddSingleton<RecordRoom.Api.Infrastructure.Ocr.IOcrEngine, RecordRoom.Api.Infrastructure.Ocr.TesseractOcrEngine>();
builder.Services.AddSingleton<RecordRoom.Api.Infrastructure.Ocr.OcrTextExtractor>();
builder.Services.AddScoped<IOcrService, OcrService>();
builder.Services.AddScoped<IReportsService, ReportsService>();
builder.Services.AddScoped<RecordRoomJobs>();
builder.Services.AddScoped<ScanProcessingJobs>();
builder.Services.AddScoped<DocumentOcrJobs>();
// The background worker: it dequeues both the recurring definitions below and
// the fire-and-forget jobs the request paths enqueue (the scan OCR pass after
// an upload), so it is registered unconditionally — EnableScheduling gates
// only the cron definitions, not enqueued work.
builder.Services.AddHangfireServer(options =>
{
    // Short polling so a fresh deployment does not idle until the next tick.
    options.SchedulePollingInterval = TimeSpan.FromSeconds(15);
});
builder.Services.AddSingleton<IRealtimePublisher, RealtimePublisher>();
builder.Services.AddHttpContextAccessor();

// Permission policies (§3.7): [Authorize(Policy = "perm:...")] resolves against
// the editable matrix, so a revoked grant is enforced on the next request, not
// just hidden in the UI. The provider manufactures perm:* policies on demand;
// the handler consults the cached matrix per role.
builder.Services.AddSingleton<IAuthorizationPolicyProvider, PermissionPolicyProvider>();
builder.Services.AddScoped<IAuthorizationHandler, PermissionHandler>();
// Enums must serialize as strings: the frontend contract uses readable status
// values ("Issued", "Partially returned"), and numbers would make the client's
// StatusBadge fall through to its neutral default.
//
// Both option sets are needed. The controller actions return IResult, and
// Results.Ok(...) resolves to a minimal-API JsonHttpResult, which formats with
// HttpJsonOptions rather than MVC's JsonOptions. Configuring only one of the two
// leaves enums as integers on half the endpoints.
builder.Services.AddControllers()
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(
        new System.Text.Json.Serialization.JsonStringEnumConverter()));

builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(
    new System.Text.Json.Serialization.JsonStringEnumConverter()));
var signalR = builder.Services.AddSignalR();

// Redis backplane for SignalR. Without it, realtime events raised on one API
// node never reach a client connected to another, so a second node silently
// halves delivery.
//
// Registered only when a connection string is present: a deployment without
// Redis must keep working with node-local hub groups rather than throwing.
// This package builds its own multiplexer, so the backplane tolerates Redis
// being down independently of the shared one used by the cache and rate limiter.
if (!string.IsNullOrWhiteSpace(redisConnection))
{
    signalR.AddStackExchangeRedis(redisConnection, options =>
    {
        // Namespaced so the backplane's pub/sub channels cannot collide with the
        // other applications sharing this Redis instance.
        options.Configuration.ChannelPrefix = RedisChannel.Literal("recordroom:signalr:");
    });
}
builder.Services.AddEndpointsApiExplorer();

const string BearerScheme = "bearer";
// Fixed-window limits on the write endpoints, shared across nodes via Redis.
builder.Services.AddRecordRoomRateLimiting(builder.Configuration);

builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo { Title = AppInfo.ApiTitle, Version = "v1" });
    c.AddSecurityDefinition(BearerScheme, new OpenApiSecurityScheme
    {
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "Paste the token returned by /api/auth/login.",
    });
    c.AddSecurityRequirement(_ => new OpenApiSecurityRequirement
    {
        [new OpenApiSecuritySchemeReference(BearerScheme, null)] = []
    });
});

var app = builder.Build();

// -------------------------------------------------------------- migrate + seed
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();

    // Where every uploaded scan, map and built deliverable PDF lives on disk.
    // The database stores only generated storage keys — never paths — so moving
    // this directory (set FileStorage__RootPath here or as an environment
    // variable) never touches the data.
    var documentStore = scope.ServiceProvider.GetRequiredService<IPrivateDocumentStore>();
    logger.LogInformation(
        "Document storage root: {Root} (override with FileStorage__RootPath; default App_Data/documents)",
        documentStore.RootPath);

    if (app.Configuration.GetValue("Database:MigrateOnStartup", true))
    {
        try
        {
            if (string.Equals(databaseProvider, "Sqlite", StringComparison.OrdinalIgnoreCase))
            {
                // The migrations are scaffolded with SQL Server column types, so
                // applying them under SQLite would rewrite every column. The
                // SQLite boot creates the schema straight from the model
                // instead — the same approach the integration tests use.
                await db.Database.EnsureCreatedAsync();
                logger.LogInformation("SQLite database created from the model.");
            }
            else
            {
                await db.Database.MigrateAsync();
                logger.LogInformation("Database migrations applied.");
            }
        }
        catch (Exception ex)
        {
            // A database that is not reachable must not crash the process.
            // /api/health reports the degradation and the app still starts.
            logger.LogError(ex, "Database migration failed. The API starts but data endpoints will error.");
        }
    }

    if (app.Configuration.GetValue("Database:SeedOnStartup", true))
    {
        try
        {
            // Demo mode (App:DemoMode, .env key App__DemoMode) decides whether a
            // fresh database gets the demo registry. With it off, a production
            // install still gets its bootstrap rows — permission matrix, feature
            // switch defaults and the standard users — but no demo files.
            var demoMode = app.Configuration.GetValue("App:DemoMode", true);
            await DatabaseSeeder.SeedAsync(db, logger, demoMode, default, app.Configuration);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Seeding failed.");
        }
    }

    // The Admin's feature-switch choices are rows; overlay them onto the
    // singleton so endpoint gating sees the live state from the first request.
    try
    {
        var flags = scope.ServiceProvider.GetRequiredService<IFeatureFlags>();
        var rows = await db.FeatureSettings.AsNoTracking()
            .ToDictionaryAsync(s => s.FeatureKey, s => s.Enabled);
        flags.Apply(rows);
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Could not load feature settings; configuration defaults apply.");
    }
}

if (app.Environment.IsDevelopment() || app.Configuration.GetValue("Swagger:Enabled", true))
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Ahead of authentication on purpose: the endpoints that matter for abuse are
// the anonymous credential ones, and a limit applied after auth would never see
// an unauthenticated attempt.
app.UseRecordRoomRateLimiting();

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<RecordRoomHub>("/hubs/recordroom");

// ------------------------------------------------------------------ scheduling
// Guarded by configuration: a test run or a read-only replica should not start
// sweeping the registry behind the operator's back. The worker itself is
// registered with the services above (AddHangfireServer) so enqueued jobs run
// even when the cron definitions are off.
if (app.Configuration.GetValue("Hangfire:EnableScheduling", true))
{
    // IRecurringJobManager from DI, not the static RecurringJob helper: the
    // static API reads JobStorage.Current, which is only set once the service
    // provider has been built, so calling it here would throw at startup.
    var recurring = app.Services.GetRequiredService<IRecurringJobManager>();

    recurring.AddOrUpdate<RecordRoomJobs>(
        "mark-overdue-receipts",
        job => job.MarkOverdueReceiptsAsync(),
        overdueCron,
        new RecurringJobOptions { TimeZone = TimeZoneInfo.Utc });

    recurring.AddOrUpdate<RecordRoomJobs>(
        "prune-old-audit",
        job => job.PruneOldAuditAsync(),
        pruneCron,
        new RecurringJobOptions { TimeZone = TimeZoneInfo.Utc });

    app.Logger.LogInformation(
        "Hangfire recurring jobs scheduled: overdue receipts '{OverdueCron}', audit retention '{PruneCron}' (UTC).",
        overdueCron,
        pruneCron);
}
else
{
    app.Logger.LogInformation("Hangfire scheduling is disabled by configuration.");
}

app.MapGet("/api/health", async (AppDbContext db, ICacheService cache) =>
{
    var dbOk = true;
    var dbError = "Connected";
    try
    {
        dbOk = await db.Database.CanConnectAsync();
        if (!dbOk) dbError = "Not reachable";

        // Reachability is not the same as a usable schema. A migration that fails
        // on boot leaves the process alive and the port open, so without this the
        // deploy health check passes while every data endpoint returns 500.
        // The SQLite boot creates its schema from the model (there is no
        // __EFMigrationsHistory under EnsureCreated), so its usable-schema
        // proof is that its tables exist at all.
        if (dbOk && !string.Equals(databaseProvider, "Sqlite", StringComparison.OrdinalIgnoreCase))
        {
            var pending = (await db.Database.GetPendingMigrationsAsync()).ToArray();
            if (pending.Length > 0)
            {
                dbOk = false;
                dbError = $"{pending.Length} pending migration(s): {string.Join(", ", pending)}";
            }
        }
    }
    catch (Exception ex)
    {
        dbOk = false;
        dbError = ex.Message;
    }

    return Results.Ok(new HealthDto(
        dbOk ? "Healthy" : "Degraded",
        dbError,
        // Only claim the distributed cache when it is genuinely reachable. With
        // abortConnect=false the multiplexer is constructed even if Redis is
        // down, so IsDistributed alone would report a healthy cache that caches
        // nothing. A cache failure is not a reason to fail the whole app, so it
        // is surfaced here rather than folded into the overall status.
        cache.IsDistributed && cache.IsReachable,
        string.Equals(hangfireStorage, "SqlServer", StringComparison.OrdinalIgnoreCase)
            ? "SqlServer"
            : "InMemory",
        DateTime.UtcNow));
}).WithTags("Health").AllowAnonymous();

app.Run();

/// <summary>Exposed so the integration tests can boot the real pipeline.</summary>
public partial class Program;
