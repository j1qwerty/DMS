using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RecordRoom.Api.Infrastructure.Data;

#nullable disable

namespace RecordRoom.Api.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20261118000400_AddFilesFullTextIndex")]
public partial class AddFilesFullTextIndex : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // Full-Text Search is an optional SQL Server component. Install the
        // catalog/index when the target instance supports it; otherwise the
        // application deliberately falls back to the indexed metadata query.
        // The migration is guarded so SQL Server installations without FTS
        // can still start and use the core DMS features.
        migrationBuilder.Sql(
            """
            IF FULLTEXTSERVICEPROPERTY('IsFullTextInstalled') = 1
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM sys.fulltext_catalogs
                    WHERE name = N'FTC_Files'
                )
                BEGIN
                    CREATE FULLTEXT CATALOG [FTC_Files] WITH ACCENT_SENSITIVITY = OFF;
                END;

                IF NOT EXISTS (
                    SELECT 1
                    FROM sys.fulltext_indexes
                    WHERE object_id = OBJECT_ID(N'dbo.Files')
                )
                BEGIN
                    CREATE FULLTEXT INDEX ON dbo.Files
                    (
                        [FileNumber] LANGUAGE 0,
                        [Subject] LANGUAGE 0,
                        [Department] LANGUAGE 0,
                        [LocationDisplay] LANGUAGE 0,
                        [Area] LANGUAGE 0,
                        [EOfficeReference] LANGUAGE 0,
                        [Holder] LANGUAGE 0,
                        [Description] LANGUAGE 0
                    )
                    KEY INDEX [PK_Files]
                    ON [FTC_Files]
                    WITH CHANGE_TRACKING AUTO;
                END;
            END;
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql(
            """
            IF OBJECTPROPERTYEX(OBJECT_ID(N'dbo.Files'), N'TableHasActiveFulltextIndex') = 1
            BEGIN
                DROP FULLTEXT INDEX ON dbo.Files;
            END;

            IF EXISTS (
                SELECT 1
                FROM sys.fulltext_catalogs
                WHERE name = N'FTC_Files'
            )
            AND NOT EXISTS (
                SELECT 1
                FROM sys.fulltext_indexes AS fti
                WHERE fti.fulltext_catalog_id = (
                    SELECT TOP (1) fulltext_catalog_id
                    FROM sys.fulltext_catalogs
                    WHERE name = N'FTC_Files'
                )
            )
            BEGIN
                DROP FULLTEXT CATALOG [FTC_Files];
            END;
            """);
    }
}
