using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RecordRoom.Api.Migrations
{
    /// <inheritdoc />
    public partial class Round3_CustodyReturnsDepartmentsFileViews : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ReconciledAt",
                table: "CustodyEvents",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReconciledBy",
                table: "CustodyEvents",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "SourceCustodyId",
                table: "CustodyEvents",
                type: "bigint",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Departments",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: false),
                    Code = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Remarks = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    ModifiedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Departments", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CustodyEvents_SourceCustodyId",
                table: "CustodyEvents",
                column: "SourceCustodyId");

            migrationBuilder.CreateIndex(
                name: "IX_Departments_Code",
                table: "Departments",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Departments_Name",
                table: "Departments",
                column: "Name",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Departments");

            migrationBuilder.DropIndex(
                name: "IX_CustodyEvents_SourceCustodyId",
                table: "CustodyEvents");

            migrationBuilder.DropColumn(
                name: "ReconciledAt",
                table: "CustodyEvents");

            migrationBuilder.DropColumn(
                name: "ReconciledBy",
                table: "CustodyEvents");

            migrationBuilder.DropColumn(
                name: "SourceCustodyId",
                table: "CustodyEvents");
        }
    }
}
