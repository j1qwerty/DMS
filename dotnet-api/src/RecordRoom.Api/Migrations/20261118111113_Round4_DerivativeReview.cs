using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RecordRoom.Api.Migrations
{
    /// <inheritdoc />
    public partial class Round4_DerivativeReview : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ReviewNote",
                table: "DocumentDerivatives",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ReviewedAt",
                table: "DocumentDerivatives",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReviewedBy",
                table: "DocumentDerivatives",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Status",
                table: "DocumentDerivatives",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: false,
                // Existing builds predate the review step; they count as
                // approved so the file's history keeps a usable deliverable.
                defaultValue: "Approved");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ReviewNote",
                table: "DocumentDerivatives");

            migrationBuilder.DropColumn(
                name: "ReviewedAt",
                table: "DocumentDerivatives");

            migrationBuilder.DropColumn(
                name: "ReviewedBy",
                table: "DocumentDerivatives");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "DocumentDerivatives");
        }
    }
}
