using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RecordRoom.Api.Infrastructure.Data;

#nullable disable

namespace RecordRoom.Api.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20261118000700_AddScanPageOcrText")]
public partial class AddScanPageOcrText : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "OcrError",
            table: "FileScanPages",
            type: "nvarchar(400)",
            maxLength: 400,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "OcrEngine",
            table: "FileScanPages",
            type: "nvarchar(64)",
            maxLength: 64,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "OcrLanguage",
            table: "FileScanPages",
            type: "nvarchar(24)",
            maxLength: 24,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "OcrStatus",
            table: "FileScanPages",
            type: "nvarchar(16)",
            maxLength: 16,
            nullable: false,
            defaultValue: "NotProcessed");

        migrationBuilder.AddColumn<string>(
            name: "OcrText",
            table: "FileScanPages",
            type: "nvarchar(max)",
            nullable: true);

        migrationBuilder.AddColumn<DateTime>(
            name: "OcrUpdatedAt",
            table: "FileScanPages",
            type: "datetime2",
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "OcrUpdatedBy",
            table: "FileScanPages",
            type: "nvarchar(256)",
            maxLength: 256,
            nullable: true);

        // OCR full-text support is optional at the SQL Server instance level.
        // The API keeps a safe LIKE fallback when the component is not installed
        // or index creation is unavailable. DDL is outside EF's migration tx.
        migrationBuilder.Sql(
            """
            IF FULLTEXTSERVICEPROPERTY('IsFullTextInstalled') = 1
            BEGIN
                BEGIN TRY
                    IF NOT EXISTS (
                        SELECT 1
                        FROM sys.fulltext_catalogs
                        WHERE name = N'FTC_ScanPages'
                    )
                    BEGIN
                        CREATE FULLTEXT CATALOG [FTC_ScanPages] WITH ACCENT_SENSITIVITY = OFF;
                    END;

                    IF NOT EXISTS (
                        SELECT 1
                        FROM sys.fulltext_indexes
                        WHERE object_id = OBJECT_ID(N'dbo.FileScanPages')
                    )
                    BEGIN
                        CREATE FULLTEXT INDEX ON dbo.FileScanPages
                        (
                            [OcrText] LANGUAGE 0
                        )
                        KEY INDEX [PK_FileScanPages]
                        ON [FTC_ScanPages]
                        WITH CHANGE_TRACKING AUTO;
                    END;
                END TRY
                BEGIN CATCH
                    PRINT CONCAT(
                        'OCR full-text index was not created; API will use the metadata fallback. ',
                        ERROR_MESSAGE()
                    );
                END CATCH;
            END;
            """,
            suppressTransaction: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql(
            """
            IF OBJECTPROPERTYEX(OBJECT_ID(N'dbo.FileScanPages'), N'TableHasActiveFulltextIndex') = 1
            BEGIN
                DROP FULLTEXT INDEX ON dbo.FileScanPages;
            END;

            IF EXISTS (
                SELECT 1
                FROM sys.fulltext_catalogs
                WHERE name = N'FTC_ScanPages'
            )
            AND NOT EXISTS (
                SELECT 1
                FROM sys.fulltext_indexes AS fti
                WHERE fti.fulltext_catalog_id = (
                    SELECT TOP (1) fulltext_catalog_id
                    FROM sys.fulltext_catalogs
                    WHERE name = N'FTC_ScanPages'
                )
            )
            BEGIN
                DROP FULLTEXT CATALOG [FTC_ScanPages];
            END;
            """,
            suppressTransaction: true);

        migrationBuilder.DropColumn(name: "OcrError", table: "FileScanPages");
        migrationBuilder.DropColumn(name: "OcrEngine", table: "FileScanPages");
        migrationBuilder.DropColumn(name: "OcrLanguage", table: "FileScanPages");
        migrationBuilder.DropColumn(name: "OcrStatus", table: "FileScanPages");
        migrationBuilder.DropColumn(name: "OcrText", table: "FileScanPages");
        migrationBuilder.DropColumn(name: "OcrUpdatedAt", table: "FileScanPages");
        migrationBuilder.DropColumn(name: "OcrUpdatedBy", table: "FileScanPages");
    }
}
