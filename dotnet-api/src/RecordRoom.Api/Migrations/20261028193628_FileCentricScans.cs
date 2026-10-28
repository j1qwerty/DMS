using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RecordRoom.Api.Migrations
{
    /// <inheritdoc />
    public partial class FileCentricScans : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "FileScanPages",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Barcode = table.Column<string>(type: "nvarchar(64)", nullable: false),
                    FileName = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    PageNo = table.Column<int>(type: "int", nullable: false),
                    Version = table.Column<int>(type: "int", nullable: false),
                    DocumentSize = table.Column<string>(type: "nvarchar(8)", maxLength: 8, nullable: false),
                    Status = table.Column<int>(type: "int", nullable: false),
                    Note = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    UploadedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UploadedBy = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    StorageKey = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: true),
                    ContentType = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    SizeBytes = table.Column<long>(type: "bigint", nullable: true),
                    Sha256 = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    PageCount = table.Column<int>(type: "int", nullable: true),
                    PageIndex = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FileScanPages", x => x.Id);
                    table.ForeignKey(
                        name: "FK_FileScanPages_Files_Barcode",
                        column: x => x.Barcode,
                        principalTable: "Files",
                        principalColumn: "Barcode",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_FileScanPages_Barcode_PageNo_Version",
                table: "FileScanPages",
                columns: new[] { "Barcode", "PageNo", "Version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_FileScanPages_Status",
                table: "FileScanPages",
                column: "Status");

            // Keep every existing scan page: it already belongs to a file by
            // barcode, which is all the file-centric model needs. The batch
            // linkage and the bulk flag are dropped; the document size comes
            // from the file itself.
            migrationBuilder.Sql(
                """
                INSERT INTO FileScanPages
                    (Barcode, FileName, PageNo, Version, DocumentSize, Status, Note,
                     UploadedAt, UploadedBy, StorageKey, ContentType, SizeBytes, Sha256, PageCount, PageIndex)
                SELECT
                    p.Barcode, p.FileName, p.PageNo, p.Version,
                    ISNULL(f.DocumentSize, N'Other'), p.Status, p.Note,
                    p.UploadedAt, p.UploadedBy, p.StorageKey, p.ContentType, p.SizeBytes, p.Sha256, p.PageCount, p.PageIndex
                FROM DigitizationPages p
                JOIN Files f ON f.Barcode = p.Barcode;
                """);

            migrationBuilder.DropTable(
                name: "DigitizationPages");

            migrationBuilder.DropTable(
                name: "DigitizationBatches");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FileScanPages");

            migrationBuilder.CreateTable(
                name: "DigitizationBatches",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    EmployeeCode = table.Column<string>(type: "nvarchar(32)", nullable: false),
                    Code = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CreatedBy = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Department = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    EmployeeName = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Folder = table.Column<int>(type: "int", nullable: false),
                    Status = table.Column<int>(type: "int", nullable: false),
                    SubmittedAt = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DigitizationBatches", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DigitizationBatches_Employees_EmployeeCode",
                        column: x => x.EmployeeCode,
                        principalTable: "Employees",
                        principalColumn: "EmployeeCode",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DigitizationPages",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Barcode = table.Column<string>(type: "nvarchar(64)", nullable: false),
                    BatchId = table.Column<long>(type: "bigint", nullable: false),
                    Bulk = table.Column<bool>(type: "bit", nullable: false),
                    ContentType = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    FileName = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Note = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    PageCount = table.Column<int>(type: "int", nullable: true),
                    PageIndex = table.Column<int>(type: "int", nullable: true),
                    PageNo = table.Column<int>(type: "int", nullable: false),
                    Sha256 = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    SizeBytes = table.Column<long>(type: "bigint", nullable: true),
                    Status = table.Column<int>(type: "int", nullable: false),
                    StorageKey = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: true),
                    UploadedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UploadedBy = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Version = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DigitizationPages", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DigitizationPages_DigitizationBatches_BatchId",
                        column: x => x.BatchId,
                        principalTable: "DigitizationBatches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_DigitizationPages_Files_Barcode",
                        column: x => x.Barcode,
                        principalTable: "Files",
                        principalColumn: "Barcode",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DigitizationBatches_Code",
                table: "DigitizationBatches",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DigitizationBatches_EmployeeCode_Folder_Status",
                table: "DigitizationBatches",
                columns: new[] { "EmployeeCode", "Folder", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_DigitizationPages_Barcode_PageNo_Version",
                table: "DigitizationPages",
                columns: new[] { "Barcode", "PageNo", "Version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DigitizationPages_BatchId",
                table: "DigitizationPages",
                column: "BatchId");
        }
    }
}
