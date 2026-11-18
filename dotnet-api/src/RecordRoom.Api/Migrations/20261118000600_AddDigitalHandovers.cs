using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RecordRoom.Api.Infrastructure.Data;

#nullable disable

namespace RecordRoom.Api.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20261118000600_AddDigitalHandovers")]
public partial class AddDigitalHandovers : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "DigitalHandoverBatches",
            columns: table => new
            {
                Id = table.Column<long>(type: "bigint", nullable: false)
                    .Annotation("SqlServer:Identity", "1, 1"),
                BatchRef = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                Department = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: false),
                Notes = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                Status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                ManifestJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                ManifestSha256 = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                PreparedBy = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                PreparedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                DeliveredBy = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                DeliveredAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                AcceptedBy = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: true),
                AcceptedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                DecisionNotes = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false)
            },
            constraints: table => table.PrimaryKey("PK_DigitalHandoverBatches", x => x.Id));

        migrationBuilder.CreateTable(
            name: "DigitalHandoverItems",
            columns: table => new
            {
                Id = table.Column<long>(type: "bigint", nullable: false)
                    .Annotation("SqlServer:Identity", "1, 1"),
                DigitalHandoverBatchId = table.Column<long>(type: "bigint", nullable: false),
                RecordFileId = table.Column<int>(type: "int", nullable: false),
                RecordFileDocumentId = table.Column<long>(type: "bigint", nullable: false),
                FileNumber = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                Department = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: false),
                FileName = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                Version = table.Column<int>(type: "int", nullable: false),
                ContentType = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                SizeBytes = table.Column<long>(type: "bigint", nullable: false),
                PageCount = table.Column<int>(type: "int", nullable: true),
                Sha256 = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_DigitalHandoverItems", x => x.Id);
                table.ForeignKey(
                    name: "FK_DigitalHandoverItems_DigitalHandoverBatches_DigitalHandoverBatchId",
                    column: x => x.DigitalHandoverBatchId,
                    principalTable: "DigitalHandoverBatches",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
                table.ForeignKey(
                    name: "FK_DigitalHandoverItems_Files_RecordFileId",
                    column: x => x.RecordFileId,
                    principalTable: "Files",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
                table.ForeignKey(
                    name: "FK_DigitalHandoverItems_RecordFileDocuments_RecordFileDocumentId",
                    column: x => x.RecordFileDocumentId,
                    principalTable: "RecordFileDocuments",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateIndex(
            name: "IX_DigitalHandoverBatches_BatchRef",
            table: "DigitalHandoverBatches",
            column: "BatchRef",
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_DigitalHandoverBatches_PreparedAt",
            table: "DigitalHandoverBatches",
            column: "PreparedAt");

        migrationBuilder.CreateIndex(
            name: "IX_DigitalHandoverBatches_Status",
            table: "DigitalHandoverBatches",
            column: "Status");

        migrationBuilder.CreateIndex(
            name: "IX_DigitalHandoverItems_DigitalHandoverBatchId_RecordFileDocumentId",
            table: "DigitalHandoverItems",
            columns: new[] { "DigitalHandoverBatchId", "RecordFileDocumentId" },
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_DigitalHandoverItems_RecordFileDocumentId",
            table: "DigitalHandoverItems",
            column: "RecordFileDocumentId");

        migrationBuilder.CreateIndex(
            name: "IX_DigitalHandoverItems_RecordFileId",
            table: "DigitalHandoverItems",
            column: "RecordFileId");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "DigitalHandoverItems");
        migrationBuilder.DropTable(name: "DigitalHandoverBatches");
    }
}
