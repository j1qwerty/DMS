using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RecordRoom.Api.Infrastructure.Data;

#nullable disable

namespace RecordRoom.Api.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20261118011000_CustodyReturnChain")]
public partial class CustodyReturnChain : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<long>(
            name: "ParentEventId",
            table: "CustodyEvents",
            type: "bigint",
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "ReconciledBy",
            table: "CustodyEvents",
            type: "nvarchar(64)",
            maxLength: 64,
            nullable: true);

        migrationBuilder.AddColumn<DateTime>(
            name: "ReconciledAt",
            table: "CustodyEvents",
            type: "datetime2",
            nullable: true);

        migrationBuilder.CreateIndex(
            name: "IX_CustodyEvents_ParentEventId",
            table: "CustodyEvents",
            column: "ParentEventId");

        migrationBuilder.AddForeignKey(
            name: "FK_CustodyEvents_CustodyEvents_ParentEventId",
            table: "CustodyEvents",
            column: "ParentEventId",
            principalTable: "CustodyEvents",
            principalColumn: "Id",
            onDelete: ReferentialAction.Restrict);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropForeignKey(
            name: "FK_CustodyEvents_CustodyEvents_ParentEventId",
            table: "CustodyEvents");

        migrationBuilder.DropIndex(
            name: "IX_CustodyEvents_ParentEventId",
            table: "CustodyEvents");

        migrationBuilder.DropColumn(name: "ParentEventId", table: "CustodyEvents");
        migrationBuilder.DropColumn(name: "ReconciledBy", table: "CustodyEvents");
        migrationBuilder.DropColumn(name: "ReconciledAt", table: "CustodyEvents");
    }
}
