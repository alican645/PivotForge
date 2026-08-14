using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using PivotForge.AspNetCore.Caching;
using PivotForge.AspNetCore.Internal;

namespace PivotForge.AspNetCore.DependencyInjection;

/// <summary>Registers PivotForge services in an ASP.NET Core application.</summary>
public static class PivotForgeServiceCollectionExtensions
{
    /// <summary>Registers PivotForge, its data provider, cache, and JSON enum support.</summary>
    /// <typeparam name="TRecord">The source record type.</typeparam>
    /// <param name="services">The application service collection.</param>
    /// <param name="dataProvider">The delegate that loads source records.</param>
    /// <param name="configure">An optional options configuration delegate.</param>
    /// <returns>The service collection for chaining.</returns>
    public static IServiceCollection AddPivotForge<TRecord>(
        this IServiceCollection services,
        PivotForgeDataProvider<TRecord> dataProvider,
        Action<PivotForgeOptions>? configure = null)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(dataProvider);

        var options = services.AddOptions<PivotForgeOptions>();

        if (configure is not null)
        {
            options.Configure(configure);
        }

        options.Validate(IsValid, "PivotForge limits and cache duration must be positive and internally consistent.");

        services.AddMemoryCache();
        services.Configure<JsonOptions>(json =>
        {
            if (json.SerializerOptions.Converters.All(converter => converter is not JsonStringEnumConverter))
            {
                json.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
            }
        });
        services.AddSingleton(dataProvider);
        services.TryAddSingleton<IPivotForgeDataExecutor, PivotForgeDataExecutor<TRecord>>();
        services.TryAddSingleton<IPivotForgeResultCache, PivotForgeResultCache>();

        return services;
    }

    private static bool IsValid(PivotForgeOptions options) =>
        options.CacheSlidingExpiration > TimeSpan.Zero &&
        options.MinimumLargeDataSourceRowCount > 0 &&
        options.MaximumSourceRowCount >= options.MinimumLargeDataSourceRowCount &&
        options.MinimumPageSize > 0 &&
        options.MaximumPageSize >= options.MinimumPageSize &&
        options.DrillDownRecordLimit > 0 &&
        options.MaximumExcelRows > 0 &&
        options.MaximumExcelCells > 0;
}
