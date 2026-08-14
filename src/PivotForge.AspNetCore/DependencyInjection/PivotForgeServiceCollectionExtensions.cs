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

        AddPivotForgeServices(services, configure);
        services.AddSingleton(dataProvider);
        services.TryAddScoped<IPivotForgeDataProvider<TRecord>, DelegatePivotForgeDataProvider<TRecord>>();
        services.TryAddScoped<IPivotForgeDataExecutor, PivotForgeDataExecutor<TRecord>>();

        return services;
    }

    /// <summary>Registers PivotForge with a dependency-injection-aware scoped data provider.</summary>
    /// <typeparam name="TRecord">The source record type.</typeparam>
    /// <typeparam name="TProvider">The scoped data provider implementation.</typeparam>
    /// <param name="services">The application service collection.</param>
    /// <param name="configure">An optional options configuration delegate.</param>
    /// <returns>The service collection for chaining.</returns>
    public static IServiceCollection AddPivotForge<TRecord, TProvider>(
        this IServiceCollection services,
        Action<PivotForgeOptions>? configure = null)
        where TProvider : class, IPivotForgeDataProvider<TRecord>
    {
        ArgumentNullException.ThrowIfNull(services);

        AddPivotForgeServices(services, configure);
        services.TryAddScoped<IPivotForgeDataProvider<TRecord>, TProvider>();
        services.TryAddScoped<IPivotForgeDataExecutor, PivotForgeDataExecutor<TRecord>>();

        return services;
    }

    private static void AddPivotForgeServices(
        IServiceCollection services,
        Action<PivotForgeOptions>? configure)
    {
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
        services.TryAddSingleton<IPivotForgeResultCache, PivotForgeResultCache>();
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
