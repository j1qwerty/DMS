using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using RecordRoom.Api.Application;
using RecordRoom.Api.Application.Services;
using RecordRoom.Api.Infrastructure.Features;
using RecordRoom.Api.Infrastructure.Auth;
using RecordRoom.Api.Domain;

namespace RecordRoom.Api.Tests;

/// <summary>
/// The barcode switch (<c>Features:BarcodeEnabled</c>). Everything here is pure logic:
/// the HTTP behaviour and the database-backed lookups are covered by scripts/test-api.ps1.
/// </summary>
public class FeatureSwitchTests
{
    private sealed class Flags(bool barcode, bool movement = false, bool support = false, bool bulkImport = false) : IFeatureFlags
    {
        public bool BarcodeEnabled { get; } = barcode;
        public bool MovementEnabled { get; } = movement;
        public bool SupportEnabled { get; } = support;
        public bool BulkImportEnabled { get; } = bulkImport;
    }

    [Theory]
    [InlineData(null, true)]
    [InlineData("", true)]
    [InlineData("   ", true)]
    [InlineData("true", true)]
    [InlineData("TRUE", true)]
    [InlineData("1", true)]
    [InlineData("on", true)]
    [InlineData("yes", true)]
    [InlineData("enabled", true)]
    [InlineData("false", false)]
    [InlineData("False", false)]
    [InlineData("0", false)]
    [InlineData("off", false)]
    [InlineData("OFF", false)]
    [InlineData("no", false)]
    [InlineData("disabled", false)]
    [InlineData(" off ", false)]
    public void Parse_is_lenient_and_defaults_to_on(string? text, bool expected) =>
        Assert.Equal(expected, FeatureFlags.Parse(text, fallback: true));

    [Fact]
    public void Unrecognised_text_keeps_the_fallback_instead_of_throwing()
    {
        Assert.True(FeatureFlags.Parse("maybe", fallback: true));
        Assert.False(FeatureFlags.Parse("maybe", fallback: false));
    }

    [Fact]
    public void Flags_read_the_configuration_key_and_default_to_off()
    {
        var empty = new ConfigurationBuilder().Build();
        Assert.False(new FeatureFlags(empty).BarcodeEnabled);

        var off = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { [FeatureFlags.BarcodeKey] = "false" })
            .Build();
        Assert.False(new FeatureFlags(off).BarcodeEnabled);
    }

    [Fact]
    public void Flags_follow_a_changed_setting_without_a_restart()
    {
        var source = new Dictionary<string, string?> { [FeatureFlags.BarcodeKey] = "true" };
        var config = new ConfigurationBuilder().AddInMemoryCollection(source).Build();
        var flags = new FeatureFlags(config);
        Assert.True(flags.BarcodeEnabled);

        config[FeatureFlags.BarcodeKey] = "off";
        Assert.False(flags.BarcodeEnabled);
    }

    private static ActionExecutingContext ContextWith(bool barcodeOn)
    {
        var services = new ServiceCollection().AddSingleton<IFeatureFlags>(new Flags(barcodeOn)).BuildServiceProvider();
        var http = new DefaultHttpContext { RequestServices = services };
        return new ActionExecutingContext(
            new ActionContext(http, new RouteData(), new ActionDescriptor()),
            new List<IFilterMetadata>(),
            new Dictionary<string, object?>(),
            controller: new object());
    }


    [Fact]
    public void Non_scope_features_are_off_by_default_and_can_be_enabled_by_configuration()
    {
        var defaults = new FeatureFlags(new ConfigurationBuilder().Build());
        Assert.False(defaults.BarcodeEnabled);
        Assert.False(defaults.MovementEnabled);
        Assert.False(defaults.SupportEnabled);
        Assert.False(defaults.BulkImportEnabled);

        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            [FeatureFlags.MovementKey] = "true",
            [FeatureFlags.SupportKey] = "on",
            [FeatureFlags.BulkImportKey] = "1",
        }).Build();
        var flags = new FeatureFlags(config);
        Assert.True(flags.MovementEnabled);
        Assert.True(flags.SupportEnabled);
        Assert.True(flags.BulkImportEnabled);
    }

    [Fact]
    public void Config_payload_includes_all_optional_feature_switches()
    {
        var dto = new RecordRoom.Api.Application.Contracts.FeaturesDto(
            Barcode: false, Movement: true, Support: false, BulkImport: true);
        Assert.False(dto.Barcode);
        Assert.True(dto.Movement);
        Assert.False(dto.Support);
        Assert.True(dto.BulkImport);
    }


    private static ActionExecutingContext ContextWithOptionalFeatures(bool movement, bool support, bool bulkImport)
    {
        var services = new ServiceCollection()
            .AddSingleton<IFeatureFlags>(new Flags(false, movement, support, bulkImport))
            .BuildServiceProvider();
        var http = new DefaultHttpContext { RequestServices = services };
        return new ActionExecutingContext(
            new ActionContext(http, new RouteData(), new ActionDescriptor()),
            new List<IFilterMetadata>(),
            new Dictionary<string, object?>(),
            controller: new object());
    }

    [Fact]
    public void Disabled_optional_modules_are_hidden_with_not_found()
    {
        foreach (var feature in new[]
        {
            OptionalProductFeature.Movement,
            OptionalProductFeature.Support,
            OptionalProductFeature.BulkImport,
        })
        {
            var context = ContextWithOptionalFeatures(movement: false, support: false, bulkImport: false);
            new RequireOptionalFeatureAttribute(feature).OnActionExecuting(context);
            var result = Assert.IsType<ObjectResult>(context.Result);
            Assert.Equal(StatusCodes.Status404NotFound, result.StatusCode);
        }
    }

    [Fact]
    public void Enabled_optional_modules_pass_the_feature_filter()
    {
        foreach (var (feature, context) in new[]
        {
            (OptionalProductFeature.Movement, ContextWithOptionalFeatures(true, false, false)),
            (OptionalProductFeature.Support, ContextWithOptionalFeatures(false, true, false)),
            (OptionalProductFeature.BulkImport, ContextWithOptionalFeatures(false, false, true)),
        })
        {
            new RequireOptionalFeatureAttribute(feature).OnActionExecuting(context);
            Assert.Null(context.Result);
        }
    }

    [Fact]
    public void Access_is_a_distinct_append_only_audit_action()
    {
        Assert.Equal(11, (int)RecordRoom.Api.Domain.AuditAction.Access);
        Assert.Equal(10, (int)RecordRoom.Api.Domain.AuditAction.Export);
    }

    [Fact]
    public void Barcode_endpoints_answer_404_while_the_switch_is_off()
    {
        var context = ContextWith(barcodeOn: false);
        new RequireBarcodeFeatureAttribute().OnActionExecuting(context);

        var result = Assert.IsType<ObjectResult>(context.Result);
        Assert.Equal(StatusCodes.Status404NotFound, result.StatusCode);
        var body = Assert.IsType<ApiResponse<bool>>(result.Value);
        Assert.False(body.Success);
        Assert.Contains(RequireBarcodeFeatureAttribute.OffMessage, body.Errors!.Select(e => e.Message));
    }

    [Fact]
    public void Barcode_endpoints_run_normally_while_the_switch_is_on()
    {
        var context = ContextWith(barcodeOn: true);
        new RequireBarcodeFeatureAttribute().OnActionExecuting(context);
        Assert.Null(context.Result);
    }

    [Fact]
    public void Barcode_print_permission_is_withheld_while_the_switch_is_off()
    {
        var admin = AuthService.PermissionsForRole(RecordRoom.Api.Domain.Role.Admin);
        Assert.Contains("barcodes.print", admin);

        var off = AuthService.WithFeatures(admin, barcodeEnabled: false);
        Assert.DoesNotContain("barcodes.print", off);
        // Everything else is untouched.
        Assert.Equal(admin.Length - 1, off.Length);

        Assert.Equal(admin, AuthService.WithFeatures(admin, barcodeEnabled: true));
    }


    private static AuthorizationFilterContext PermissionContext(Role role, bool barcodeOn = false)
    {
        var services = new ServiceCollection()
            .AddSingleton<IFeatureFlags>(new Flags(barcodeOn))
            .BuildServiceProvider();
        var http = new DefaultHttpContext { RequestServices = services };
        http.User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.Role, role.ToString())], authenticationType: "test"));
        return new AuthorizationFilterContext(
            new ActionContext(http, new RouteData(), new ActionDescriptor()),
            new List<IFilterMetadata>());
    }

    [Theory]
    [InlineData(Role.Admin, "files.documentDelete", true)]
    [InlineData(Role.Admin, "custody.manage", true)]
    [InlineData(Role.Supervisor, "custody.manage", true)]
    [InlineData(Role.Supervisor, "users.view", true)]
    [InlineData(Role.Operator, "files.create", true)]
    [InlineData(Role.Operator, "issue.issue", true)]
    [InlineData(Role.Operator, "custody.view", true)]
    [InlineData(Role.Employee, "files.view", true)]
    [InlineData(Role.Employee, "custody.view", true)]
    [InlineData(Role.Employee, "custody.manage", false)]
    [InlineData(Role.Operator, "files.documentDelete", false)]
    [InlineData(Role.Supervisor, "users.edit", false)]
    [InlineData(Role.Employee, "issue.issue", false)]
    [InlineData(Role.Employee, "employees.view", false)]
    public async Task Server_permission_filter_enforces_the_capability_matrix(
        Role role, string permission, bool expected)
    {
        var context = PermissionContext(role);
        await new RequirePermissionAttribute(permission).OnAuthorizationAsync(context);

        if (expected)
            Assert.Null(context.Result);
        else
        {
            var result = Assert.IsType<ObjectResult>(context.Result);
            Assert.Equal(StatusCodes.Status403Forbidden, result.StatusCode);
        }
    }

    [Fact]
    public async Task Barcode_capability_is_rejected_by_server_when_barcode_module_is_hidden()
    {
        var context = PermissionContext(Role.Admin, barcodeOn: false);
        await new RequirePermissionAttribute("barcodes.print").OnAuthorizationAsync(context);
        var result = Assert.IsType<ObjectResult>(context.Result);
        Assert.Equal(StatusCodes.Status403Forbidden, result.StatusCode);
    }

    [Fact]
    public async Task Unauthenticated_users_receive_401_from_permission_filter()
    {
        var services = new ServiceCollection()
            .AddSingleton<IFeatureFlags>(new Flags(false))
            .BuildServiceProvider();
        var http = new DefaultHttpContext { RequestServices = services };
        var context = new AuthorizationFilterContext(
            new ActionContext(http, new RouteData(), new ActionDescriptor()),
            new List<IFilterMetadata>());

        await new RequirePermissionAttribute("files.view").OnAuthorizationAsync(context);

        Assert.IsType<UnauthorizedResult>(context.Result);
    }

    [Fact]
    public void Config_payload_names_the_product_and_reports_the_flag()
    {
        var dto = new RecordRoom.Api.Application.Contracts.AppConfigDto(
            AppInfo.Name, new RecordRoom.Api.Application.Contracts.FeaturesDto(false, false, false, false));
        Assert.Equal("Document Management System", dto.AppName);
        Assert.False(dto.Features.Barcode);
    }
}
