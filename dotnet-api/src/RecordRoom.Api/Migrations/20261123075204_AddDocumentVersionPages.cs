using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RecordRoom.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddDocumentVersionPages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DocumentVersionPages",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    DocumentId = table.Column<long>(type: "bigint", nullable: false),
                    PageNo = table.Column<int>(type: "int", nullable: false),
                    OcrText = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    OcrMethod = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OcrRanAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    OcrEditedBy = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: true),
                    OcrEditedAt = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DocumentVersionPages", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DocumentVersionPages_RecordFileDocuments_DocumentId",
                        column: x => x.DocumentId,
                        principalTable: "RecordFileDocuments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DocumentVersionPages_DocumentId_PageNo",
                table: "DocumentVersionPages",
                columns: new[] { "DocumentId", "PageNo" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DocumentVersionPages");
        }
    }
}
