using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RecordRoom.Api.Infrastructure.Data;

#nullable disable

namespace RecordRoom.Api.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20261118010000_AddDepartmentMaster")]
public partial class AddDepartmentMaster : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "Departments",
            columns: table => new
            {
                Id = table.Column<int>(type: "int", nullable: false)
                    .Annotation("SqlServer:Identity", "1, 1"),
                Code = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                Name = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: false),
                Active = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                ModifiedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
            },
            constraints: table => table.PrimaryKey("PK_Departments", x => x.Id));

        migrationBuilder.CreateIndex(
            name: "IX_Departments_Code",
            table: "Departments",
            column: "Code",
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_Departments_Name",
            table: "Departments",
            column: "Name",
            unique: true);

        // Create a master entry for each department already used by an employee,
        // registry record or custody event so existing text remains selectable.
        migrationBuilder.Sql(
            """
            ;WITH Names AS
            (
                SELECT NULLIF(LTRIM(RTRIM([Department])), N'') AS [Name] FROM [Employees]
                UNION
                SELECT NULLIF(LTRIM(RTRIM([Department])), N'') AS [Name] FROM [Files]
                UNION
                SELECT NULLIF(LTRIM(RTRIM([Department])), N'') AS [Name] FROM [CustodyEvents]
            ),
            Clean AS
            (
                SELECT [Name] FROM Names WHERE [Name] IS NOT NULL
            ),
            Numbered AS
            (
                SELECT [Name], ROW_NUMBER() OVER (ORDER BY [Name]) AS [Number] FROM Clean
            )
            INSERT INTO [Departments] ([Code], [Name], [Active], [CreatedAt], [ModifiedAt])
            SELECT
                CONCAT(N'DEPT-', RIGHT(CONCAT(N'000000', CONVERT(varchar(12), [Number])), 6)),
                [Name],
                1,
                SYSUTCDATETIME(),
                SYSUTCDATETIME()
            FROM Numbered;
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "Departments");
    }
}
