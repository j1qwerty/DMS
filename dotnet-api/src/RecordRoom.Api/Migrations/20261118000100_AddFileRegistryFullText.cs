using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RecordRoom.Api.Migrations;

public partial class AddFileRegistryFullText : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql(
            """
            IF FULLTEXTSERVICEPROPERTY('IsFullTextInstalled') = 1
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM sys.fulltext_catalogs
                    WHERE name = N'DmsFullTextCatalog'
                )
                    CREATE FULLTEXT CATALOG [DmsFullTextCatalog];

                IF OBJECT_ID(N'dbo.Files', N'U') IS NOT NULL
                   AND NOT EXISTS (
                       SELECT 1
                       FROM sys.fulltext_indexes
                       WHERE object_id = OBJECT_ID(N'dbo.Files')
                   )
                BEGIN
                    CREATE FULLTEXT INDEX ON [dbo].[Files]
                    (
                        [FileNumber] LANGUAGE 0,
                        [Subject] LANGUAGE 0,
                        [Department] LANGUAGE 0,
                        [LocationDisplay] LANGUAGE 0,
                        [Area] LANGUAGE 0,
                        [EOfficeReference] LANGUAGE 0,
                        [PropertyNo] LANGUAGE 0,
                        [PropertyArea] LANGUAGE 0,
                        [Dealer] LANGUAGE 0,
                        [CodalLife] LANGUAGE 0,
                        [Holder] LANGUAGE 0,
                        [Description] LANGUAGE 0
                    )
                    KEY INDEX [PK_Files]
                    ON [DmsFullTextCatalog]
                    WITH CHANGE_TRACKING AUTO;
                END
            END
            """,
            suppressTransaction: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql(
            """
            IF OBJECT_ID(N'dbo.Files', N'U') IS NOT NULL
               AND EXISTS (
                   SELECT 1
                   FROM sys.fulltext_indexes
                   WHERE object_id = OBJECT_ID(N'dbo.Files')
               )
                DROP FULLTEXT INDEX ON [dbo].[Files];

            IF EXISTS (
                SELECT 1
                FROM sys.fulltext_catalogs
                WHERE name = N'DmsFullTextCatalog'
            )
                DROP FULLTEXT CATALOG [DmsFullTextCatalog];
            """,
            suppressTransaction: true);
    }
}
