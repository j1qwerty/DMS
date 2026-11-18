using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RecordRoom.Api.Migrations;

public partial class AddScanPageSide : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(
            name: "IX_FileScanPages_Barcode_PageNo_Version",
            table: "FileScanPages");

        migrationBuilder.AddColumn<string>(
            name: "Side",
            table: "FileScanPages",
            type: "nvarchar(8)",
            maxLength: 8,
            nullable: false,
            defaultValue: "Front");

        migrationBuilder.CreateIndex(
            name: "IX_FileScanPages_Barcode_PageNo_Side_Version",
            table: "FileScanPages",
            columns: new[] { "Barcode", "PageNo", "Side", "Version" },
            unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(
            name: "IX_FileScanPages_Barcode_PageNo_Side_Version",
            table: "FileScanPages");

        migrationBuilder.DropColumn(
            name: "Side",
            table: "FileScanPages");

        migrationBuilder.CreateIndex(
            name: "IX_FileScanPages_Barcode_PageNo_Version",
            table: "FileScanPages",
            columns: new[] { "Barcode", "PageNo", "Version" },
            unique: true);
    }
}
