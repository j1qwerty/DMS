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

namespace RecordRoom.Api.Tests;

/// <summary>
/// The grouped feature switches (ZILA_PANCHAYAT_CC §F). Everything here is pure
/// logic: the HTTP behaviour and the database-backed lookups are covered by
/// scripts/test-api.ps1.
/// </summary>
public class FeatureSwitchTests
{
    private sealed class Flags(bool barcode, bool recordRoom = false, bool maps = false, bool support = false)
        : IFeatureFlags
    {
        public bool BarcodeEnabled { get; } = barcode;
        public bool RecordRoomEnabled { get; } = recordRoom;
        public bool MapsEnabled { get; } = maps;
        public bool SupportEnabled { get; } = support;
        public bool IsEnabled(string featureKey) => featureKey switch
        {
            "barcode" => BarcodeEnabled,
            "recordRoom" => RecordRoomEnabled,
            "maps" => MapsEnabled,
            "support" => SupportEnabled,
            _ => false,
        };
        public IReadOnlyDictionary<string, bool> Snapshot() => new Dictionary<string, bool>
        {
            ["barcode"] = BarcodeEnabled,
            ["recordRoom"] = RecordRoomEnabled,
            ["maps"] = MapsEnabled,
            ["support"] = SupportEnabled,
        };
        public void Apply(IReadOnlyDictionary<string, bool> overrides) { }
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
    public void Parse_is_lenient_and_honours_the_fallback(string? text, bool expected) =>
        Assert.Equal(expected, FeatureFlags.Parse(text, fallback: expected));

    [Fact]
    public void Unrecognised_text_keeps_the_fallback_instead_of_throwing()
    {
        Assert.True(FeatureFlags.Parse("maybe", fallback: true));
        Assert.False(FeatureFlags.Parse("maybe", fallback: false));
    }

    [Fact]
    public void Every_group_defaults_to_hidden_without_configuration()
    {
        // The Zila Panchayat profile: all four groups off until an Admin
        // switches one on. A different deployment sets Features:{Key}Enabled.
        var empty = new ConfigurationBuilder().Build();
        var flags = new FeatureFlags(empty);
        foreach (var key in FeatureFlags.KnownKeys)
            Assert.False(flags.IsEnabled(key));
        Assert.False(flags.BarcodeEnabled);
        Assert.False(flags.RecordRoomEnabled);
        Assert.False(flags.MapsEnabled);
        Assert.False(flags.SupportEnabled);
    }

    [Theory]
    [InlineData("barcode")]
    [InlineData("recordRoom")]
    [InlineData("maps")]
    [InlineData("support")]
    public void Groups_read_their_configuration_key(string key)
    {
        var on = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { [$"Features:{key}Enabled"] = "true" })
            .Build();
        Assert.True(new FeatureFlags(on).IsEnabled(key));

        var off = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { [$"Features:{key}Enabled"] = "off" })
            .Build();
        Assert.False(new FeatureFlags(off).IsEnabled(key));
    }

    [Fact]
    public void Unknown_keys_read_as_off()
    {
        var flags = new FeatureFlags(new ConfigurationBuilder().Build());
        Assert.False(flags.IsEnabled("teleport"));
        Assert.False(flags.IsEnabled(""));
    }

    [Fact]
    public void Database_overlays_win_over_configuration()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Features:barcodeEnabled"] = "true" })
            .Build();
        var flags = new FeatureFlags(config);
        Assert.True(flags.BarcodeEnabled);

        // The Admin turned it off at runtime: the row beats the config file.
        flags.Apply(new Dictionary<string, bool> { ["barcode"] = false });
        Assert.False(flags.BarcodeEnabled);
        Assert.False(flags.Snapshot()["barcode"]);
    }

    [Fact]
    public void Snapshot_lists_every_known_group()
    {
        var flags = new FeatureFlags(new ConfigurationBuilder().Build());
        flags.Apply(new Dictionary<string, bool> { ["maps"] = true });

        var snapshot = flags.Snapshot();
        Assert.Equal(FeatureFlags.KnownKeys.Length, snapshot.Count);
        foreach (var key in FeatureFlags.KnownKeys)
            Assert.Contains(key, snapshot.Keys);
        Assert.True(snapshot["maps"]);
        Assert.False(snapshot["barcode"]);
    }

    [Fact]
    public void Flags_follow_a_changed_setting_without_a_restart()
    {
        var source = new Dictionary<string, string?> { ["Features:recordRoomEnabled"] = "true" };
        var config = new ConfigurationBuilder().AddInMemoryCollection(source).Build();
        var flags = new FeatureFlags(config);
        Assert.True(flags.RecordRoomEnabled);

        config["Features:recordRoomEnabled"] = "off";
        Assert.False(flags.RecordRoomEnabled);
    }

    private static ActionExecutingContext ContextWith(IFeatureFlags flags)
    {
        var services = new ServiceCollection().AddSingleton(flags).BuildServiceProvider();
        var http = new DefaultHttpContext { RequestServices = services };
        return new ActionExecutingContext(
            new ActionContext(http, new RouteData(), new ActionDescriptor()),
            new List<IFilterMetadata>(),
            new Dictionary<string, object?>(),
            controller: new object());
    }

    [Fact]
    public void Hidden_groups_answer_404()
    {
        foreach (var key in FeatureFlags.KnownKeys)
        {
            var context = ContextWith(new Flags(false));
            new RequireFeatureAttribute(key).OnActionExecuting(context);

            var result = Assert.IsType<ObjectResult>(context.Result);
            Assert.Equal(StatusCodes.Status404NotFound, result.StatusCode);
            var body = Assert.IsType<ApiResponse<bool>>(result.Value);
            Assert.False(body.Success);
            Assert.Contains(RequireFeatureAttribute.OffMessage, body.Errors!.Select(e => e.Message));
        }
    }

    [Fact]
    public void Enabled_groups_run_normally()
    {
        var context = ContextWith(new Flags(barcode: true, recordRoom: true, maps: true, support: true));
        foreach (var key in FeatureFlags.KnownKeys)
        {
            new RequireFeatureAttribute(key).OnActionExecuting(context);
            Assert.Null(context.Result);
        }
    }

    [Fact]
    public void Barcode_spelling_still_gates_the_same_group()
    {
        var off = ContextWith(new Flags(false));
        new RequireBarcodeFeatureAttribute().OnActionExecuting(off);
        Assert.NotNull(off.Result);

        var on = ContextWith(new Flags(true));
        new RequireBarcodeFeatureAttribute().OnActionExecuting(on);
        Assert.Null(on.Result);
    }

    [Fact]
    public void Permissions_whose_group_is_hidden_are_not_offered()
    {
        var admin = AuthService.PermissionsForRole(RecordRoom.Api.Domain.Role.Admin);
        Assert.Contains("barcodes.print", admin);
        Assert.Contains("locations.view", admin);

        var allOff = AuthService.WithFeatures(admin, barcodeEnabled: false, recordRoomEnabled: false);
        Assert.DoesNotContain("barcodes.print", allOff);
        Assert.DoesNotContain("locations.view", allOff);
        Assert.DoesNotContain("locations.edit", allOff);
        Assert.Equal(admin.Length - 3, allOff.Length);

        // Barcode off alone keeps locations; record room off alone keeps barcodes.
        Assert.DoesNotContain("barcodes.print", AuthService.WithFeatures(admin, barcodeEnabled: false));
        Assert.Contains("locations.view", AuthService.WithFeatures(admin, barcodeEnabled: false));
        Assert.Contains("barcodes.print", AuthService.WithFeatures(admin, barcodeEnabled: true, recordRoomEnabled: false));

        Assert.Equal(admin, AuthService.WithFeatures(admin, barcodeEnabled: true, recordRoomEnabled: true));
    }

    [Fact]
    public void Config_payload_names_the_product_and_reports_every_group()
    {
        var dto = new RecordRoom.Api.Application.Contracts.AppConfigDto(
            AppInfo.Name,
            new RecordRoom.Api.Application.Contracts.FeaturesDto(
                Barcode: false, RecordRoom: true, Maps: false, Support: false),
            SettingsEditable: true,
            DemoMode: false,
            Ocr: new RecordRoom.Api.Application.Contracts.OcrStatusDto(
                Enabled: true, Available: true, Engine: "tesseract", Languages: "hin+eng", Note: "ready"));
        Assert.Equal("Document Management System", dto.AppName);
        Assert.False(dto.Features.Barcode);
        Assert.True(dto.Features.RecordRoom);
        Assert.False(dto.Features.Maps);
        Assert.False(dto.Features.Support);
    }
}
