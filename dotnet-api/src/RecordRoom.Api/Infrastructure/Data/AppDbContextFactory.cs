using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace RecordRoom.Api.Infrastructure.Data;

/// <summary>
/// Lets `dotnet ef` build a context without starting the whole host. The app
/// host is not usable at design time: it would try to migrate and seed a real
/// database just to read the model, and its scoped/singleton services cannot be
/// validated outside a request.
/// </summary>
public sealed class AppDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var provider = Environment.GetEnvironmentVariable("RECORDROOM_PROVIDER") ?? "SqlServer";
        var connectionString =
            Environment.GetEnvironmentVariable("RECORDROOM_CONNECTION")
            ?? (string.Equals(provider, "Sqlite", StringComparison.OrdinalIgnoreCase)
                ? "DataSource=RecordRoom.db"
                : "Server=localhost;Database=RecordRoom;Trusted_Connection=True;TrustServerCertificate=True");

        var builder = new DbContextOptionsBuilder<AppDbContext>();
        if (string.Equals(provider, "Sqlite", StringComparison.OrdinalIgnoreCase))
        {
            builder.UseSqlite(connectionString);
        }
        else
        {
            builder.UseSqlServer(connectionString, sql =>
                sql.MigrationsAssembly(typeof(AppDbContext).Assembly.FullName));
        }
        return new AppDbContext(builder.Options);
    }
}