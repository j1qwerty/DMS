using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RecordRoom.Api.Application;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Application.Services;

namespace RecordRoom.Api.Api.Controllers;

/// <summary>
/// The managed department list (round 3): names and codes in one place, picked
/// from on the employee, custody and file forms instead of free text. Reads
/// sit with the employee master; writes with the ability to edit it.
/// </summary>
[ApiController]
[Route("api/departments")]
[Authorize]
[Produces("application/json")]
[Tags("Employees")]
public class DepartmentsController(IDepartmentsService departments) : ControllerBase
{
    /// <summary>All departments with their employee counts, alphabetical.</summary>
    [HttpGet]
    public async Task<IResult> List(CancellationToken ct) =>
        Results.Ok(ApiResponse<DepartmentDto[]>.Ok(await departments.ListAsync(ct)));

    [Authorize(Policy = "perm:employees.edit")]
    [HttpPost]
    public async Task<IResult> Create(DepartmentInput input, CancellationToken ct) =>
        ApiResults.FromResult(await departments.CreateAsync(input, ct));

    [Authorize(Policy = "perm:employees.edit")]
    [HttpPut("{id:int}")]
    public async Task<IResult> Update(int id, DepartmentInput input, CancellationToken ct) =>
        ApiResults.FromResult(await departments.UpdateAsync(id, input, ct));

    /// <summary>Refused while any employee is still filed under the department.</summary>
    [Authorize(Policy = "perm:employees.edit")]
    [HttpDelete("{id:int}")]
    public async Task<IResult> Delete(int id, CancellationToken ct) =>
        ApiResults.FromResult(await departments.DeleteAsync(id, ct));
}
