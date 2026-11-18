using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using RecordRoom.Api.Application;
using RecordRoom.Api.Application.Services;
using RecordRoom.Api.Domain;
using RecordRoom.Api.Infrastructure.Features;

namespace RecordRoom.Api.Infrastructure.Auth;

/// <summary>
/// Enforces the server-owned role capability matrix. Frontend navigation checks
/// are presentation only; this filter is evaluated on every protected MVC action.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true, Inherited = true)]
public sealed class RequirePermissionAttribute(string permission) : Attribute, IAsyncAuthorizationFilter
{
    public string Permission { get; } = permission;

    public Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var user = context.HttpContext.User;
        if (user.Identity?.IsAuthenticated != true)
        {
            context.Result = new UnauthorizedResult();
            return Task.CompletedTask;
        }

        var roleValue = user.FindFirst(ClaimTypes.Role)?.Value;
        if (!Enum.TryParse<Role>(roleValue, true, out var role) || !Enum.IsDefined(role))
        {
            context.Result = Forbidden("The signed-in account has no recognized role.");
            return Task.CompletedTask;
        }

        var flags = context.HttpContext.RequestServices.GetService<IFeatureFlags>();
        var permissions = AuthService.WithFeatures(
            AuthService.PermissionsForRole(role),
            barcodeEnabled: flags?.BarcodeEnabled ?? true);

        if (!permissions.Contains(Permission, StringComparer.Ordinal))
            context.Result = Forbidden($"The {role} role is not permitted to perform this action.");

        return Task.CompletedTask;
    }

    private static ObjectResult Forbidden(string message) =>
        new(ApiResponse<bool>.Fail([new FieldError(message, "permission")]))
        {
            StatusCode = StatusCodes.Status403Forbidden,
        };
}
