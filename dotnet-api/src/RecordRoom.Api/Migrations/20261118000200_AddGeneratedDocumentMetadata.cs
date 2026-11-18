using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RecordRoom.Api.Migrations;

public partial class AddGeneratedDocumentMetadata : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "DocumentKind",
            table: "RecordFileDocuments",
            type: "nvarchar(24)",
            maxLength: 24,
            nullable: false,
            defaultValue: "Attachment");

        migrationBuilder.AddColumn<string>(
            name: "SourceManifest",
            table: "RecordFileDocuments",
            type: "nvarchar(max)",
            nullable: false,
            defaultValue: "");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(name: "DocumentKind", table: "RecordFileDocuments");
        migrationBuilder.DropColumn(name: "SourceManifest", table: "RecordFileDocuments");
    }
}
