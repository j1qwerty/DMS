using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RecordRoom.Api.Infrastructure.Data;

#nullable disable

namespace RecordRoom.Api.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20261028000000_AddFileSearchIndexes")]
public partial class AddFileSearchIndexes : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // D1 (work plan §2.1): the registry search seeks into FileNumber and
        // EOfficeReference on prefix matches; without these indexes those
        // branches are also table scans.
        migrationBuilder.CreateIndex(
            name: "IX_Files_FileNumber",
            table: "Files",
            column: "FileNumber");

        migrationBuilder.CreateIndex(
            name: "IX_Files_EOfficeReference",
            table: "Files",
            column: "EOfficeReference");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(
            name: "IX_Files_FileNumber",
            table: "Files");

        migrationBuilder.DropIndex(
            name: "IX_Files_EOfficeReference",
            table: "Files");
    }
}
