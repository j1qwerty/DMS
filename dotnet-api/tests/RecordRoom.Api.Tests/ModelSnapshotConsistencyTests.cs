using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RecordRoom.Api.Infrastructure.Data;

namespace RecordRoom.Api.Tests;

public sealed class ModelSnapshotConsistencyTests
{
    [Fact]
    public void AppDbContext_model_matches_the_checked_in_migration_snapshot()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlServer("Server=localhost;Database=ModelSnapshotCheck;User Id=sa;Password=NotARealPassword123!;TrustServerCertificate=True;Encrypt=False")
            .Options;

        using var db = new AppDbContext(options);
        var snapshotType = typeof(AppDbContext).Assembly.GetType(
            "RecordRoom.Api.Migrations.AppDbContextModelSnapshot",
            throwOnError: true)!;
        var snapshot = (ModelSnapshot)Activator.CreateInstance(snapshotType, nonPublic: true)!;
        var source = snapshot.Model.GetRelationalModel();
        var target = db.GetService<IDesignTimeModel>().Model.GetRelationalModel();
        var differ = db.GetService<IMigrationsModelDiffer>();
        var operations = differ.GetDifferences(source, target);

        static string Describe(MigrationOperation operation)
        {
            var details = operation.GetType().GetProperties()
                .Where(property => property.Name is "Name" or "Table" or "ColumnName" or "Schema" or "NewName" or "ColumnType" or "IsNullable" or "IsDestructiveChange")
                .Select(property =>
                {
                    try { return property.Name + "=" + property.GetValue(operation); }
                    catch { return property.Name + "=<unavailable>"; }
                });
            return operation.GetType().Name + ": " + string.Join(", ", details);
        }

        Assert.True(
            operations.Count == 0,
            "The current EF model differs from AppDbContextModelSnapshot:\n"
            + string.Join("\n", operations.Select(Describe)));
    }
}
