using Microsoft.EntityFrameworkCore;
using RecordRoom.Api.Application;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Domain;
using RecordRoom.Api.Infrastructure.Data;
using RecordRoom.Api.Infrastructure.Auth;

namespace RecordRoom.Api.Application.Services;

public interface IDepartmentsService
{
    Task<DepartmentDto[]> ListAsync(bool includeInactive = false, CancellationToken ct = default);
    Task<Result<DepartmentDto>> CreateAsync(DepartmentInput input, CancellationToken ct = default);
    Task<Result<DepartmentDto>> UpdateAsync(int id, DepartmentInput input, CancellationToken ct = default);
}

public sealed class DepartmentsService(AppDbContext db, IAuditWriter audit) : IDepartmentsService
{
    private static DepartmentDto ToDto(Department department) =>
        new(department.Id, department.Code, department.Name, department.Active, department.ModifiedAt);

    public async Task<DepartmentDto[]> ListAsync(bool includeInactive = false, CancellationToken ct = default)
    {
        var query = db.Departments.AsNoTracking().AsQueryable();
        if (!includeInactive) query = query.Where(department => department.Active);
        return (await query.OrderBy(department => department.Name).ToArrayAsync(ct))
            .Select(ToDto).ToArray();
    }

    public async Task<Result<DepartmentDto>> CreateAsync(DepartmentInput input, CancellationToken ct = default)
    {
        var code = input.Code?.Trim().ToUpperInvariant() ?? string.Empty;
        var name = input.Name?.Trim() ?? string.Empty;
        if (code.Length == 0 || code.Length > 32)
            return Result<DepartmentDto>.Fail("Enter a department code of 1–32 characters.", "code");
        if (name.Length == 0 || name.Length > 128)
            return Result<DepartmentDto>.Fail("Enter a department name of 1–128 characters.", "name");
        if (await db.Departments.AnyAsync(department => department.Code == code || department.Name == name, ct))
            return Result<DepartmentDto>.Fail("A department with this code or name already exists.", "code");

        var now = DateTime.UtcNow;
        var department = new Department
        {
            Code = code,
            Name = name,
            Active = input.Active,
            CreatedAt = now,
            ModifiedAt = now,
        };
        db.Departments.Add(department);
        await audit.LogAsync(db, AuditAction.Create, "Department", "pending", "-", $"{code} - {name}",
            $"Department {name} created.", ct);
        await db.SaveChangesAsync(ct);
        await audit.AnnounceAsync(RealtimeChannels.Digitization, "department.created", department.Id.ToString(), $"{code} - {name}");
        return Result<DepartmentDto>.Ok(ToDto(department));
    }

    public async Task<Result<DepartmentDto>> UpdateAsync(int id, DepartmentInput input, CancellationToken ct = default)
    {
        var department = await db.Departments.FirstOrDefaultAsync(item => item.Id == id, ct);
        if (department is null) return Result<DepartmentDto>.Fail("Department not found.", "id");

        var code = input.Code?.Trim().ToUpperInvariant() ?? string.Empty;
        var name = input.Name?.Trim() ?? string.Empty;
        if (code.Length == 0 || code.Length > 32)
            return Result<DepartmentDto>.Fail("Enter a department code of 1–32 characters.", "code");
        if (name.Length == 0 || name.Length > 128)
            return Result<DepartmentDto>.Fail("Enter a department name of 1–128 characters.", "name");
        if (await db.Departments.AnyAsync(item => item.Id != id && (item.Code == code || item.Name == name), ct))
            return Result<DepartmentDto>.Fail("A department with this code or name already exists.", "code");

        var before = $"{department.Code} - {department.Name} (active={department.Active})";
        var previousName = department.Name;
        department.Code = code;
        department.Name = name;
        department.Active = input.Active;
        department.ModifiedAt = DateTime.UtcNow;

        // Preserve historical text while keeping current master data aligned.
        if (!string.Equals(previousName, name, StringComparison.Ordinal))
        {
            var employees = await db.Employees.Where(employee => employee.Department == previousName).ToListAsync(ct);
            foreach (var employee in employees)
            {
                employee.Department = name;
                employee.ModifiedAt = DateTime.UtcNow;
            }
            var files = await db.Files.Where(file => file.Department == previousName).ToListAsync(ct);
            foreach (var file in files)
            {
                file.Department = name;
                file.UpdatedAt = DateTime.UtcNow;
            }
            var custody = await db.CustodyEvents.Where(item => item.Department == previousName).ToListAsync(ct);
            foreach (var item in custody) item.Department = name;
        }

        await audit.LogAsync(db, AuditAction.Update, "Department", id.ToString(), before,
            $"{code} - {name} (active={department.Active})", $"Department {name} updated.", ct);
        await db.SaveChangesAsync(ct);
        await audit.AnnounceAsync(RealtimeChannels.Digitization, "department.updated", id.ToString(), $"{code} - {name}");
        return Result<DepartmentDto>.Ok(ToDto(department));
    }
}
