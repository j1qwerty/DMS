using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;
using RecordRoom.Api.Application.Services;

namespace RecordRoom.Api.Infrastructure.Auth;

/// <summary>
/// Permission policies: <c>[Authorize(Policy = "perm:digitization.review")]</c>
/// replaces the old <c>[Authorize(Roles = "Admin,Supervisor")]</c> attributes,
/// so what each role may do is the editable matrix, not a compiled-in string.
/// </summary>
public static class PermissionPolicies
{
    public const string Prefix = "perm:";

    public static string For(string permission) => Prefix + permission;
}

public sealed class PermissionRequirement(string permission) : IAuthorizationRequirement
{
    public string Permission { get; } = permission;
}

/// <summary>
/// Resolves the requirement against the DB-backed matrix. The lookup is cached
/// per role (see <see cref="IPermissionService"/>); permissions are
/// deliberately not embedded in the JWT, because a revoked grant must not stay
/// live until the token expires.
/// </summary>
public sealed class PermissionHandler(IPermissionService permissions) : AuthorizationHandler<PermissionRequirement>
{
    protected override async Task HandleRequirementAsync(
        AuthorizationHandlerContext context, PermissionRequirement requirement)
    {
        if (context.User.Identity?.IsAuthenticated != true) return;

        var role = context.User.FindFirst(ClaimTypes.Role)?.Value;
        if (role is null) return;

        if (await permissions.HasAsync(role, requirement.Permission))
            context.Succeed(requirement);
    }
}

/// <summary>
/// Produces <c>perm:*</c> policies on demand, so no permission needs to be
/// registered in advance and a new key compiles straight into an enforceable
/// policy. Everything else falls through to the default provider.
/// </summary>
public sealed class PermissionPolicyProvider(IOptions<AuthorizationOptions> options)
    : DefaultAuthorizationPolicyProvider(options)
{
    public override Task<AuthorizationPolicy?> GetPolicyAsync(string policyName)
    {
        if (!policyName.StartsWith(PermissionPolicies.Prefix, StringComparison.OrdinalIgnoreCase))
            return base.GetPolicyAsync(policyName);

        var permission = policyName[PermissionPolicies.Prefix.Length..];
        var policy = new AuthorizationPolicyBuilder(JwtBearerDefaults.AuthenticationScheme)
            .RequireAuthenticatedUser()
            .AddRequirements(new PermissionRequirement(permission))
            .Build();
        return Task.FromResult<AuthorizationPolicy?>(policy);
    }
}
