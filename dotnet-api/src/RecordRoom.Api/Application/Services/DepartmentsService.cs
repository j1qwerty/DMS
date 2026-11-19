using Microsoft.EntityFrameworkCore;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Domain;
using RecordRoom.Api.Infrastructure.Auth;
using RecordRoom.Api.Infrastructure.Data;

namespace RecordRoom.Api.Application.Services;

/// <summary>
/// The managed department list (round 3): names and codes maintained in one
/// place, so employee, custody and file forms pick from it instead of everyone
/// typing their own spelling. Deleting a department that employees still use
/// is refused — rename it instead, which keeps history readable.
/// </summary>
public interface IDepartmentsService
{
    Task<DepartmentDto[]> ListAsync(CancellationToken ct = default);
    Task<Result<DepartmentDto>> CreateAsync(DepartmentInput input, CancellationToken ct = default);
    Task<Result<DepartmentDto>> UpdateAsync(int id, DepartmentInput input, CancellationToken ct = default);
    Task<Result<bool>> DeleteAsync(int id, CancellationToken ct = default);
}

public sealed class DepartmentsService(
    AppDbContext db,
    IAuditWriter audit,
    ICurrentUserAccessor current) : IDepartmentsService
{
    private static DepartmentDto ToDto(Department d, int employeeCount) => new(
        d.Id, d.Name, d.Code, d.Remarks, employeeCount, d.CreatedAt);

    public async Task<DepartmentDto[]> ListAsync(CancellationToken ct = default)
    {
        var rows = await db.Departments.AsNoTracking().OrderBy(d => d.Name).ToListAsync(ct);
        // Employee counts in one grouped query; the list is short.
        var counts = await db.Employees.AsNoTracking()
            .GroupBy(e => e.Department)
            .Select(g => new { Department = g.Key, Count = g.Count() })
            .ToListAsync(ct);
        var byName = counts.ToDictionary(c => c.Department, c => c.Count, StringComparer.OrdinalIgnoreCase);
        return [.. rows.Select(d => ToDto(d, byName.GetValueOrDefault(d.Name)))];
    }

    public async Task<Result<DepartmentDto>> CreateAsync(DepartmentInput input, CancellationToken ct = default)
    {
        var name = input.Name.Trim();
        var code = input.Code.Trim().ToUpperInvariant();
        if (name.Length == 0) return Result<DepartmentDto>.Fail("Department name is required.", "name");
        if (code.Length == 0) return Result<DepartmentDto>.Fail("Department code is required.", "code");

        if (await db.Departments.AnyAsync(d => d.Name == name, ct))
            return Result<DepartmentDto>.Fail($"A department named {name} already exists.", "name");
        if (await db.Departments.AnyAsync(d => d.Code == code, ct))
            return Result<DepartmentDto>.Fail($"The code {code} is already in use.", "code");

        var department = new Department { Name = name, Code = code, Remarks = input.Remarks.Trim() };
        db.Departments.Add(department);
        await audit.LogAsync(
            db, AuditAction.Create, "Department", "pending", "-", $"{name} ({code})",
            $"{current.User?.DisplayName ?? current.UserName} added department {name} ({code}).", ct);
        await db.SaveChangesAsync(ct);
        return Result<DepartmentDto>.Ok(ToDto(department, 0));
    }

    public async Task<Result<DepartmentDto>> UpdateAsync(int id, DepartmentInput input, CancellationToken ct = default)
    {
        var department = await db.Departments.FirstOrDefaultAsync(d => d.Id == id, ct);
        if (department is null) return Result<DepartmentDto>.Fail("Department not found.");

        var name = input.Name.Trim();
        var code = input.Code.Trim().ToUpperInvariant();
        if (name.Length == 0) return Result<DepartmentDto>.Fail("Department name is required.", "name");
        if (code.Length == 0) return Result<DepartmentDto>.Fail("Department code is required.", "code");

        if (await db.Departments.AnyAsync(d => d.Id != id && d.Name == name, ct))
            return Result<DepartmentDto>.Fail($"A department named {name} already exists.", "name");
        if (await db.Departments.AnyAsync(d => d.Id != id && d.Code == code, ct))
            return Result<DepartmentDto>.Fail($"The code {code} is already in use.", "code");

        var before = $"{department.Name} ({department.Code})";
        var oldName = department.Name;
        var renamed = name != oldName;
        department.Name = name;
        department.Code = code;
        department.Remarks = input.Remarks.Trim();
        department.ModifiedAt = DateTime.UtcNow;

        // A rename follows the employees, so their history stays grouped under
        // one spelling instead of two.
        if (renamed)
        {
            var employees = await db.Employees.Where(e => e.Department == oldName).ToListAsync(ct);
            foreach (var employee in employees) employee.Department = name;
        }

        var employeeCount = await db.Employees.CountAsync(e => e.Department == name, ct);
        await audit.LogAsync(
            db, AuditAction.Update, "Department", department.Id.ToString(), before, $"{name} ({code})",
            $"{current.User?.DisplayName ?? current.UserName} updated department {before} → {name} ({code}).", ct);
        await db.SaveChangesAsync(ct);
        return Result<DepartmentDto>.Ok(ToDto(department, employeeCount));
    }

    public async Task<Result<bool>> DeleteAsync(int id, CancellationToken ct = default)
    {
        var department = await db.Departments.FirstOrDefaultAsync(d => d.Id == id, ct);
        if (department is null) return Result<bool>.Fail("Department not found.");

        var inUse = await db.Employees.CountAsync(e => e.Department == department.Name, ct);
        if (inUse > 0)
            return Result<bool>.Fail(
                $"{inUse} employee(s) are still filed under {department.Name}; rename the department instead of deleting it.",
                "employees");

        db.Departments.Remove(department);
        await audit.LogAsync(
            db, AuditAction.Delete, "Department", department.Id.ToString(),
            $"{department.Name} ({department.Code})", "-",
            $"{current.User?.DisplayName ?? current.UserName} removed department {department.Name}.", ct);
        await db.SaveChangesAsync(ct);
        return Result<bool>.Ok(true);
    }
}
