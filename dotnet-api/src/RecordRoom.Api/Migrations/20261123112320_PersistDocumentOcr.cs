using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RecordRoom.Api.Migrations
{
    /// <inheritdoc />
    public partial class PersistDocumentOcr : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "ImportToStudio",
                table: "RecordFileDocuments",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "OcrPagesJson",
                table: "RecordFileDocuments",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "OcrProcessedAt",
                table: "RecordFileDocuments",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "OcrRevision",
                table: "RecordFileDocuments",
                type: "int",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ImportToStudio",
                table: "RecordFileDocuments");

            migrationBuilder.DropColumn(
                name: "OcrPagesJson",
                table: "RecordFileDocuments");

            migrationBuilder.DropColumn(
                name: "OcrProcessedAt",
                table: "RecordFileDocuments");

            migrationBuilder.DropColumn(
                name: "OcrRevision",
                table: "RecordFileDocuments");
        }
    }
}
