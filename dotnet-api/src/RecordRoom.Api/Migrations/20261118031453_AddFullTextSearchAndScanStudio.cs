using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RecordRoom.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFullTextSearchAndScanStudio : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Dpi",
                table: "FileScanPages",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Enhancement",
                table: "FileScanPages",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OcrText",
                table: "FileScanPages",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "OrderIndex",
                table: "FileScanPages",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "ProcessedAt",
                table: "FileScanPages",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ProcessedBy",
                table: "FileScanPages",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "ProcessedStorageKey",
                table: "FileScanPages",
                type: "nvarchar(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "DocumentDerivatives",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Barcode = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    FileName = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    StorageKey = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: true),
                    ContentType = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    SizeBytes = table.Column<long>(type: "bigint", nullable: true),
                    Sha256 = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    PageCount = table.Column<int>(type: "int", nullable: false),
                    SourceVersions = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: false),
                    IncludesOcrText = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CreatedBy = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DocumentDerivatives", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DocumentDerivatives_Files_Barcode",
                        column: x => x.Barcode,
                        principalTable: "Files",
                        principalColumn: "Barcode",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_FileScanPages_Barcode_OrderIndex",
                table: "FileScanPages",
                columns: new[] { "Barcode", "OrderIndex" });

            migrationBuilder.CreateIndex(
                name: "IX_DocumentDerivatives_Barcode",
                table: "DocumentDerivatives",
                column: "Barcode");

            // §3.1: full-text catalog + indexes. Guarded on the service being
            // installed (plain SQL Server Express cannot host full-text), so the
            // migration applies everywhere and FilesService falls back to LIKE.
            // Change tracking AUTO keeps the index consistent with writes.
            migrationBuilder.Sql("""
IF FULLTEXTSERVICEPROPERTY('IsFullTextInstalled') > 0
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.fulltext_catalogs WHERE name = 'RecordRoomFt')
        CREATE FULLTEXT CATALOG RecordRoomFt;

    IF NOT EXISTS (SELECT 1 FROM sys.fulltext_indexes i
                   JOIN sys.objects o ON o.object_id = i.object_id
                   WHERE o.name = 'Files')
    BEGIN
        CREATE FULLTEXT INDEX ON Files
            (Subject, Department, LocationDisplay, Area, Holder)
            KEY INDEX PK_Files
            ON RecordRoomFt
            WITH CHANGE_TRACKING AUTO;
    END

    IF NOT EXISTS (SELECT 1 FROM sys.fulltext_indexes i
                   JOIN sys.objects o ON o.object_id = i.object_id
                   WHERE o.name = 'FileScanPages')
    BEGIN
        CREATE FULLTEXT INDEX ON FileScanPages
            (OcrText)
            KEY INDEX PK_FileScanPages
            ON RecordRoomFt
            WITH CHANGE_TRACKING AUTO;
    END
END
""");

            // Existing pages adopt the sheet order as their composition order.
            migrationBuilder.Sql("UPDATE FileScanPages SET OrderIndex = PageNo WHERE OrderIndex = 0;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
IF FULLTEXTSERVICEPROPERTY('IsFullTextInstalled') > 0
BEGIN
    IF EXISTS (SELECT 1 FROM sys.fulltext_indexes i
               JOIN sys.objects o ON o.object_id = i.object_id
               WHERE o.name = 'FileScanPages')
        DROP FULLTEXT INDEX ON FileScanPages;
    IF EXISTS (SELECT 1 FROM sys.fulltext_indexes i
               JOIN sys.objects o ON o.object_id = i.object_id
               WHERE o.name = 'Files')
        DROP FULLTEXT INDEX ON Files;
    IF EXISTS (SELECT 1 FROM sys.fulltext_catalogs WHERE name = 'RecordRoomFt')
        DROP FULLTEXT CATALOG RecordRoomFt;
END
""");

            migrationBuilder.DropTable(
                name: "DocumentDerivatives");

            migrationBuilder.DropIndex(
                name: "IX_FileScanPages_Barcode_OrderIndex",
                table: "FileScanPages");

            migrationBuilder.DropColumn(
                name: "Dpi",
                table: "FileScanPages");

            migrationBuilder.DropColumn(
                name: "Enhancement",
                table: "FileScanPages");

            migrationBuilder.DropColumn(
                name: "OcrText",
                table: "FileScanPages");

            migrationBuilder.DropColumn(
                name: "OrderIndex",
                table: "FileScanPages");

            migrationBuilder.DropColumn(
                name: "ProcessedAt",
                table: "FileScanPages");

            migrationBuilder.DropColumn(
                name: "ProcessedBy",
                table: "FileScanPages");

            migrationBuilder.DropColumn(
                name: "ProcessedStorageKey",
                table: "FileScanPages");
        }
    }
}
