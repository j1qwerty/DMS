using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RecordRoom.Api.Application;
using RecordRoom.Api.Application.Contracts;
using RecordRoom.Api.Application.Services;
using RecordRoom.Api.Infrastructure.Auth;
using RecordRoom.Api.Infrastructure.Features;

namespace RecordRoom.Api.Api.Controllers;

[ApiController]
[Route("api/locations")]
[RequireFeature("recordRoom")]
[Authorize]
[Produces("application/json")]
[Tags("Locations")]
public class LocationsController(ILocationsService locations) : ControllerBase
{
    [HttpGet("rooms")]
    public async Task<IResult> Rooms(CancellationToken ct)
    {
        var rooms = await locations.RoomsAsync(ct);
        return Results.Ok(ApiResponse<RoomDto[]>.Ok(rooms.IsSuccess ? rooms.Value! : []));
    }

    [HttpGet("rooms/{id:int}")]
    public async Task<IResult> Room(int id, CancellationToken ct)
    {
        var room = await locations.RoomAsync(id, ct);
        return room is null ? Results.NotFound() : Results.Ok(ApiResponse<RoomDto>.Ok(room));
    }

    [Authorize(Policy = "perm:locations.edit")]
    [HttpPost("rooms")]
    public async Task<IResult> AddRoom(RoomInput input, CancellationToken ct) =>
        ApiResults.FromResult(await locations.AddRoomAsync(input, ct));

    [Authorize(Policy = "perm:locations.edit")]
    [HttpPut("rooms/{id:int}")]
    public async Task<IResult> UpdateRoom(int id, RoomInput input, CancellationToken ct) =>
        ApiResults.FromResult(await locations.UpdateRoomAsync(id, input, ct));

    [Authorize(Policy = "perm:locations.edit")]
    [HttpDelete("rooms/{id:int}")]
    public async Task<IResult> DeleteRoom(int id, CancellationToken ct) =>
        ApiResults.FromResult(await locations.DeleteRoomAsync(id, ct));

    [HttpGet("areas")]
    public async Task<IResult> Areas(CancellationToken ct) =>
        Results.Ok(ApiResponse<AreaDto[]>.Ok(await locations.AreasAsync(ct)));

    [HttpGet("rooms/{roomId:int}/layout/revisions")]
    public async Task<IResult> Revisions(int roomId, CancellationToken ct) =>
        Results.Ok(ApiResponse<LayoutRevisionDto[]>.Ok(await locations.LayoutRevisionsAsync(roomId, ct)));

    [Authorize(Policy = "perm:locations.edit")]
    [HttpPost("rooms/{roomId:int}/layout")]
    public async Task<IResult> SaveLayout(int roomId, LayoutSaveInput input, CancellationToken ct) =>
        ApiResults.FromResult(await locations.SaveLayoutAsync(roomId, input, ct));

    [Authorize(Policy = "perm:locations.edit")]
    [HttpPost("rooms/{roomId:int}/sections")]
    public async Task<IResult> AddSection(int roomId, SectionInput input, CancellationToken ct) =>
        ApiResults.FromResult(await locations.AddSectionAsync(roomId, input, ct));

    [Authorize(Policy = "perm:locations.edit")]
    [HttpPut("sections/{id:int}")]
    public async Task<IResult> UpdateSection(int id, SectionInput input, CancellationToken ct) =>
        ApiResults.FromResult(await locations.UpdateSectionAsync(id, input, ct));

    [Authorize(Policy = "perm:locations.edit")]
    [HttpDelete("sections/{id:int}")]
    public async Task<IResult> DeleteSection(int id, CancellationToken ct) =>
        ApiResults.FromResult(await locations.DeleteSectionAsync(id, ct));

    [Authorize(Policy = "perm:locations.edit")]
    [HttpPost("sections/{sectionId:int}/almirahs")]
    public async Task<IResult> AddAlmirah(int sectionId, AlmirahInput input, CancellationToken ct) =>
        ApiResults.FromResult(await locations.AddAlmirahAsync(sectionId, input, ct));

    [Authorize(Policy = "perm:locations.edit")]
    [HttpPut("almirahs/{id:int}")]
    public async Task<IResult> UpdateAlmirah(int id, AlmirahInput input, CancellationToken ct) =>
        ApiResults.FromResult(await locations.UpdateAlmirahAsync(id, input, ct));

    [Authorize(Policy = "perm:locations.edit")]
    [HttpDelete("almirahs/{id:int}")]
    public async Task<IResult> DeleteAlmirah(int id, CancellationToken ct) =>
        ApiResults.FromResult(await locations.DeleteAlmirahAsync(id, ct));

    [Authorize(Policy = "perm:locations.edit")]
    [HttpPost("almirahs/{almirahId:int}/shelves")]
    public async Task<IResult> AddShelf(int almirahId, ShelfInput input, CancellationToken ct) =>
        ApiResults.FromResult(await locations.AddShelfAsync(almirahId, input, ct));

    [Authorize(Policy = "perm:locations.edit")]
    [HttpPut("shelves/{id:int}")]
    public async Task<IResult> UpdateShelf(int id, ShelfInput input, CancellationToken ct) =>
        ApiResults.FromResult(await locations.UpdateShelfAsync(id, input, ct));

    [Authorize(Policy = "perm:locations.edit")]
    [HttpDelete("shelves/{id:int}")]
    public async Task<IResult> DeleteShelf(int id, CancellationToken ct) =>
        ApiResults.FromResult(await locations.DeleteShelfAsync(id, ct));
}
