using Microsoft.Extensions.Configuration;

namespace RecordRoom.Api.Infrastructure.Configuration;

/// <summary>
/// A minimal dotenv reader so one <c>.env</c> file next to the app configures
/// the whole deployment (storage root, demo mode, OCR, feature editing…).
/// The deployment story is otherwise split between systemd
/// <c>EnvironmentFile=</c> on the VPS and hand-typed environment variables in
/// docker - both work, but a plain <c>.env</c> is what operators expect to edit,
/// and Windows hosts have no EnvironmentFile equivalent at all.
///
/// Keys use the standard ASP.NET <c>Section__Key</c> spelling (double
/// underscore), the same as environment variables, so
/// <c>FileStorage__RootPath=/data/docs</c> is valid both ways. Values may be
/// bare, single- or double-quoted; <c>#</c> starts a comment; <c>export</c> is
/// accepted for shell-compatibility.
///
/// Precedence: the file is inserted right after the JSON sources, so real
/// environment variables and the command line still win - an env var can always
/// override a value left in <c>.env</c> for a one-off run.
/// </summary>
public sealed class EnvFileConfigurationProvider : ConfigurationProvider
{
    private readonly string path;

    public EnvFileConfigurationProvider(string path) => this.path = path;

    public override void Load()
    {
        if (!File.Exists(path)) return;

        foreach (var rawLine in File.ReadAllLines(path))
        {
            var line = rawLine.Trim();
            if (line.Length == 0 || line.StartsWith('#')) continue;
            if (line.StartsWith("export ", StringComparison.OrdinalIgnoreCase))
                line = line["export ".Length..].TrimStart();

            var separator = line.IndexOf('=');
            if (separator <= 0) continue;

            var key = line[..separator].Trim();
            var value = line[(separator + 1)..].Trim();

            // Strip a trailing comment from unquoted values ("KEY=1 # note").
            if (value.Length >= 2 && (value[0] == '"' || value[0] == '\''))
            {
                var quote = value[0];
                var closing = value.IndexOf(quote, 1);
                if (closing > 0) value = value[1..closing];
            }
            else
            {
                var hash = value.IndexOf(" #");
                if (hash >= 0) value = value[..hash].Trim();
            }

            if (key.Length == 0) continue;
            // Double underscore is the ASP.NET hierarchy separator in env-var
            // spelling; ConfigurationProvider.Set re-maps it onto sections.
            Set(key.Replace("__", ":"), value);
        }
    }
}

public sealed class EnvFileConfigurationSource(string path) : IConfigurationSource
{
    public IConfigurationProvider Build(IConfigurationBuilder builder) =>
        new EnvFileConfigurationProvider(path);
}

public static class EnvFileConfigurationExtensions
{
    /// <summary>
    /// Adds a dotenv file to the configuration. The path defaults to
    /// <c>DOTNET_ENV_FILE</c>, then <c>.env</c> in the current content root.
    /// Missing file is not an error - it just contributes nothing.
    /// </summary>
    public static IConfigurationBuilder AddEnvFile(
        this IConfigurationBuilder builder, string? path = null)
    {
        var resolved = path
            ?? Environment.GetEnvironmentVariable("DOTNET_ENV_FILE")
            ?? Path.Combine(AppContext.BaseDirectory, ".env");
        builder.Add(new EnvFileConfigurationSource(resolved));
        return builder;
    }
}
