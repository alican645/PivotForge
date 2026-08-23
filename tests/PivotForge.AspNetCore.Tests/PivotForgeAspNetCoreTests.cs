using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using PivotForge.AspNetCore.Caching;
using PivotForge.AspNetCore.DependencyInjection;
using PivotForge.AspNetCore.Endpoints;
using PivotForge.Core;

namespace PivotForge.AspNetCore.Tests;

public sealed class PivotForgeAspNetCoreTests
{
    [Fact]
    public void AddPivotForge_RegistersProviderCacheAndOptions()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddPivotForge<Sale>(
            (_, _) => ValueTask.FromResult<IReadOnlyList<Sale>>([]),
            options => options.MaximumSourceRowCount = 25_000);

        using var provider = services.BuildServiceProvider();

        Assert.NotNull(provider.GetRequiredService<PivotForgeDataProvider<Sale>>());
        using var scope = provider.CreateScope();
        Assert.NotNull(scope.ServiceProvider.GetRequiredService<IPivotForgeDataProvider<Sale>>());
        Assert.NotNull(provider.GetRequiredService<IPivotForgeResultCache>());
        Assert.Equal(25_000, provider.GetRequiredService<IOptions<PivotForgeOptions>>().Value.MaximumSourceRowCount);
    }

    [Fact]
    public void AddPivotForge_RegistersTypedProviderWithScopedLifetime()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddScoped<ScopedProviderDependency>();
        services.AddPivotForge<Sale, ScopedSaleProvider>();

        using var provider = services.BuildServiceProvider();
        using var firstScope = provider.CreateScope();
        using var secondScope = provider.CreateScope();

        var first = firstScope.ServiceProvider.GetRequiredService<IPivotForgeDataProvider<Sale>>();
        var firstAgain = firstScope.ServiceProvider.GetRequiredService<IPivotForgeDataProvider<Sale>>();
        var second = secondScope.ServiceProvider.GetRequiredService<IPivotForgeDataProvider<Sale>>();

        Assert.Same(first, firstAgain);
        Assert.NotSame(first, second);
        Assert.IsType<ScopedSaleProvider>(first);
    }

    [Fact]
    public async Task ResultCache_ReusesCompletedResultsAndSkipsCancelledResults()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddPivotForge<Sale>((_, _) => ValueTask.FromResult<IReadOnlyList<Sale>>([]));

        await using var provider = services.BuildServiceProvider();
        var cache = provider.GetRequiredService<IPivotForgeResultCache>();
        var factoryCalls = 0;
        var identity = new { Rows = new[] { "Region" } };

        var first = await cache.GetOrCreateAsync(
            identity,
            _ =>
            {
                factoryCalls++;
                return ValueTask.FromResult(new PivotResult());
            },
            CancellationToken.None);
        var second = await cache.GetOrCreateAsync(
            identity,
            _ =>
            {
                factoryCalls++;
                return ValueTask.FromResult(new PivotResult());
            },
            CancellationToken.None);

        Assert.False(first.CacheHit);
        Assert.True(second.CacheHit);
        Assert.Equal(first.SessionId, second.SessionId);
        Assert.Equal(1, factoryCalls);

        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            cache.GetOrCreateAsync(
                new { Rows = new[] { "Cancelled" } },
                token => ValueTask.FromCanceled<PivotResult>(token),
                cancellation.Token));
    }

    [Fact]
    public async Task MapPivotForgeEndpoints_UsesExpectedRouteContract()
    {
        var builder = WebApplication.CreateBuilder();
        builder.Services.AddPivotForge<Sale>((_, _) => ValueTask.FromResult<IReadOnlyList<Sale>>([]));

        await using var app = builder.Build();
        app.MapPivotForgeEndpoints("reports/pivot/");

        var routes = ((IEndpointRouteBuilder)app).DataSources
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Select(endpoint => endpoint.RoutePattern.RawText)
            .ToArray();

        Assert.Contains("/reports/pivot/pivot", routes);
        Assert.Contains("/reports/pivot/large/start", routes);
        Assert.Contains("/reports/pivot/large/page", routes);
        Assert.Contains("/reports/pivot/drill-down", routes);
        Assert.Contains("/reports/pivot/field-values", routes);
        Assert.Contains("/reports/pivot/excel", routes);
    }

    [Fact]
    public async Task LargeStart_ReusesResultAcrossDifferentPageSizes()
    {
        var providerCalls = 0;
        var builder = WebApplication.CreateBuilder();
        builder.Services.AddPivotForge<Sale>((_, _) =>
        {
            providerCalls++;
            return ValueTask.FromResult<IReadOnlyList<Sale>>(
            [
                new("North", 120m),
                new("South", 90m)
            ]);
        });

        await using var app = builder.Build();
        app.MapPivotForgeEndpoints();
        app.Urls.Add("http://127.0.0.1:0");
        await app.StartAsync();

        try
        {
            var address = app.Services.GetRequiredService<IServer>()
                .Features.Get<IServerAddressesFeature>()!
                .Addresses.Single();
            using var client = new HttpClient { BaseAddress = new Uri(address), Timeout = TimeSpan.FromSeconds(5) };

            var first = await PostLargeStartAsync(client, 10);
            var second = await PostLargeStartAsync(client, 20);

            Assert.False(first.GetProperty("cacheHit").GetBoolean());
            Assert.True(second.GetProperty("cacheHit").GetBoolean());
            Assert.Equal(first.GetProperty("sessionId").GetString(), second.GetProperty("sessionId").GetString());
            Assert.Equal(1, providerCalls);
        }
        finally
        {
            await app.StopAsync();
        }
    }

    [Fact]
    public async Task LargeStart_DoesNotReuseResultsAcrossDifferentRequestScopes()
    {
        var providerCalls = 0;
        var builder = WebApplication.CreateBuilder();
        builder.Services.AddPivotForge<Sale>((_, _) =>
        {
            providerCalls++;
            return ValueTask.FromResult<IReadOnlyList<Sale>>([new("North", 120m)]);
        });

        await using var app = builder.Build();
        app.MapPivotForgeEndpoints();
        app.Urls.Add("http://127.0.0.1:0");
        await app.StartAsync();

        try
        {
            var address = app.Services.GetRequiredService<IServer>()
                .Features.Get<IServerAddressesFeature>()!
                .Addresses.Single();
            using var client = new HttpClient { BaseAddress = new Uri(address), Timeout = TimeSpan.FromSeconds(5) };

            var first = await PostLargeStartAsync(client, 10, "?branch=1&period=2026-08");
            var second = await PostLargeStartAsync(client, 10, "?branch=2&period=2026-08");

            Assert.False(first.GetProperty("cacheHit").GetBoolean());
            Assert.False(second.GetProperty("cacheHit").GetBoolean());
            Assert.NotEqual(first.GetProperty("sessionId").GetString(), second.GetProperty("sessionId").GetString());
            Assert.Equal(2, providerCalls);
        }
        finally
        {
            await app.StopAsync();
        }
    }

    [Fact]
    public async Task PivotEndpoint_BindsJsonExecutesProviderAndSerializesResult()
    {
        var builder = WebApplication.CreateBuilder();
        builder.Services.AddPivotForge<Sale>((_, _) => ValueTask.FromResult<IReadOnlyList<Sale>>(
        [
            new("North", 120m),
            new("South", 90m)
        ]));

        await using var app = builder.Build();
        app.MapPivotForgeEndpoints();
        app.Urls.Add("http://127.0.0.1:0");
        var json = """
            {
              "rows": ["Region"],
              "columns": [],
              "values": [{ "field": "Amount", "aggregation": "sum" }],
              "filters": []
            }
            """;

        await app.StartAsync();

        try
        {
            var address = app.Services.GetRequiredService<IServer>()
                .Features.Get<IServerAddressesFeature>()!
                .Addresses.Single();
            using var client = new HttpClient { BaseAddress = new Uri(address), Timeout = TimeSpan.FromSeconds(5) };
            using var content = new StringContent(json, Encoding.UTF8, "application/json");
            using var httpResponse = await client.PostAsync("/pivotforge/pivot", content);
            await using var responseStream = await httpResponse.Content.ReadAsStreamAsync();
            using var response = await JsonDocument.ParseAsync(responseStream);

            Assert.Equal(System.Net.HttpStatusCode.OK, httpResponse.StatusCode);
            Assert.Equal(2, response.RootElement.GetProperty("metadata").GetProperty("sourceRowCount").GetInt32());
            Assert.Equal(2, response.RootElement.GetProperty("rowHeaders").GetArrayLength());
        }
        finally
        {
            await app.StopAsync();
        }
    }

    [Fact]
    public async Task PivotEndpoint_AppliesADeclaredFieldSortToTheRowOrder()
    {
        var builder = WebApplication.CreateBuilder();
        builder.Services.AddPivotForge<Sale>((_, _) => ValueTask.FromResult<IReadOnlyList<Sale>>(
        [
            new("North", 120m),
            new("South", 90m)
        ]));

        await using var app = builder.Build();
        app.MapPivotForgeEndpoints();
        app.Urls.Add("http://127.0.0.1:0");
        // The whole wire path in one assertion: the browser's camelCase payload,
        // the record's constructor binding, the string enum, and the engine.
        var json = """
            {
              "rows": ["Region"],
              "columns": [],
              "values": [{ "field": "Amount", "aggregation": "sum" }],
              "filters": [],
              "fieldSorts": [{ "field": "Region", "direction": "Descending" }]
            }
            """;

        await app.StartAsync();

        try
        {
            var address = app.Services.GetRequiredService<IServer>()
                .Features.Get<IServerAddressesFeature>()!
                .Addresses.Single();
            using var client = new HttpClient { BaseAddress = new Uri(address), Timeout = TimeSpan.FromSeconds(5) };
            using var content = new StringContent(json, Encoding.UTF8, "application/json");
            using var httpResponse = await client.PostAsync("/pivotforge/pivot", content);
            await using var responseStream = await httpResponse.Content.ReadAsStreamAsync();
            using var response = await JsonDocument.ParseAsync(responseStream);

            Assert.Equal(System.Net.HttpStatusCode.OK, httpResponse.StatusCode);
            Assert.Equal(
                ["South", "North"],
                response.RootElement.GetProperty("rowHeaders")
                    .EnumerateArray()
                    .Select(header => header[0].GetString()!)
                    .ToArray());
        }
        finally
        {
            await app.StopAsync();
        }
    }

    [Fact]
    public async Task PivotEndpoint_AppliesAnExcludingFilter()
    {
        var builder = WebApplication.CreateBuilder();
        builder.Services.AddPivotForge<Sale>((_, _) => ValueTask.FromResult<IReadOnlyList<Sale>>(
        [
            new("North", 120m),
            new("South", 90m),
            new("East", 10m)
        ]));

        await using var app = builder.Build();
        app.MapPivotForgeEndpoints();
        app.Urls.Add("http://127.0.0.1:0");
        // The whole wire path for the mode: the browser's camelCase payload, the
        // record's optional constructor parameter, and the string enum.
        var json = """
            {
              "rows": ["Region"],
              "columns": [],
              "values": [{ "field": "Amount", "aggregation": "sum" }],
              "filters": [{ "field": "Region", "values": ["North"], "mode": "Exclude" }]
            }
            """;

        await app.StartAsync();

        try
        {
            var address = app.Services.GetRequiredService<IServer>()
                .Features.Get<IServerAddressesFeature>()!
                .Addresses.Single();
            using var client = new HttpClient { BaseAddress = new Uri(address), Timeout = TimeSpan.FromSeconds(5) };
            using var content = new StringContent(json, Encoding.UTF8, "application/json");
            using var httpResponse = await client.PostAsync("/pivotforge/pivot", content);
            await using var responseStream = await httpResponse.Content.ReadAsStreamAsync();
            using var response = await JsonDocument.ParseAsync(responseStream);

            Assert.Equal(System.Net.HttpStatusCode.OK, httpResponse.StatusCode);
            Assert.Equal(
                ["East", "South"],
                response.RootElement.GetProperty("rowHeaders")
                    .EnumerateArray()
                    .Select(header => header[0].GetString()!)
                    .ToArray());
        }
        finally
        {
            await app.StopAsync();
        }
    }

    [Fact]
    public async Task PivotEndpoint_TreatsAFilterWithNoModeAsIncluding()
    {
        var builder = WebApplication.CreateBuilder();
        builder.Services.AddPivotForge<Sale>((_, _) => ValueTask.FromResult<IReadOnlyList<Sale>>(
        [
            new("North", 120m),
            new("South", 90m)
        ]));

        await using var app = builder.Build();
        app.MapPivotForgeEndpoints();
        app.Urls.Add("http://127.0.0.1:0");
        // A payload written before modes existed, which must keep meaning what it
        // meant when it was written.
        var json = """
            {
              "rows": ["Region"],
              "columns": [],
              "values": [{ "field": "Amount", "aggregation": "sum" }],
              "filters": [{ "field": "Region", "values": ["North"] }]
            }
            """;

        await app.StartAsync();

        try
        {
            var address = app.Services.GetRequiredService<IServer>()
                .Features.Get<IServerAddressesFeature>()!
                .Addresses.Single();
            using var client = new HttpClient { BaseAddress = new Uri(address), Timeout = TimeSpan.FromSeconds(5) };
            using var content = new StringContent(json, Encoding.UTF8, "application/json");
            using var httpResponse = await client.PostAsync("/pivotforge/pivot", content);
            await using var responseStream = await httpResponse.Content.ReadAsStreamAsync();
            using var response = await JsonDocument.ParseAsync(responseStream);

            Assert.Equal(System.Net.HttpStatusCode.OK, httpResponse.StatusCode);
            Assert.Equal(
                ["North"],
                response.RootElement.GetProperty("rowHeaders")
                    .EnumerateArray()
                    .Select(header => header[0].GetString()!)
                    .ToArray());
        }
        finally
        {
            await app.StopAsync();
        }
    }

    [Fact]
    public async Task FieldValuesEndpoint_ReturnsDistinctValuesAndReportsTruncation()
    {
        var builder = WebApplication.CreateBuilder();
        builder.Services.AddPivotForge<Sale>(
            (_, _) => ValueTask.FromResult<IReadOnlyList<Sale>>(
            [
                new("South", 90m),
                new("North", 120m),
                new("North", 40m),
                new("East", 10m)
            ]),
            options => options.FieldValueLimit = 2);

        await using var app = builder.Build();
        app.MapPivotForgeEndpoints();
        app.Urls.Add("http://127.0.0.1:0");
        await app.StartAsync();

        try
        {
            var address = app.Services.GetRequiredService<IServer>()
                .Features.Get<IServerAddressesFeature>()!
                .Addresses.Single();
            using var client = new HttpClient { BaseAddress = new Uri(address), Timeout = TimeSpan.FromSeconds(5) };

            var response = await PostFieldValuesAsync(client, "Region");

            Assert.Equal("Region", response.GetProperty("field").GetString());
            Assert.Equal(
                ["East", "North"],
                response.GetProperty("values").EnumerateArray().Select(value => value.GetString()));
            Assert.Equal(3, response.GetProperty("totalCount").GetInt32());
            Assert.True(response.GetProperty("truncated").GetBoolean());
            Assert.Equal(2, response.GetProperty("limit").GetInt32());
        }
        finally
        {
            await app.StopAsync();
        }
    }

    [Fact]
    public async Task FieldValuesEndpoint_RejectsAnUnknownField()
    {
        var builder = WebApplication.CreateBuilder();
        builder.Services.AddPivotForge<Sale>(
            (_, _) => ValueTask.FromResult<IReadOnlyList<Sale>>([new("North", 120m)]));

        await using var app = builder.Build();
        app.MapPivotForgeEndpoints();
        app.Urls.Add("http://127.0.0.1:0");
        await app.StartAsync();

        try
        {
            var address = app.Services.GetRequiredService<IServer>()
                .Features.Get<IServerAddressesFeature>()!
                .Addresses.Single();
            using var client = new HttpClient { BaseAddress = new Uri(address), Timeout = TimeSpan.FromSeconds(5) };
            var json = """{ "field": "Missing" }""";
            using var content = new StringContent(json, Encoding.UTF8, "application/json");

            using var httpResponse = await client.PostAsync("/pivotforge/field-values", content);

            Assert.Equal(System.Net.HttpStatusCode.BadRequest, httpResponse.StatusCode);
        }
        finally
        {
            await app.StopAsync();
        }
    }

    private static async Task<JsonElement> PostFieldValuesAsync(HttpClient client, string field)
    {
        var json = $$"""{ "field": "{{field}}", "sourceRowCount": 1000 }""";
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using var response = await client.PostAsync("/pivotforge/field-values", content);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync();
        using var document = await JsonDocument.ParseAsync(stream);
        return document.RootElement.Clone();
    }

    private static async Task<JsonElement> PostLargeStartAsync(
        HttpClient client,
        int pageSize,
        string requestScope = "")
    {
        var json = $$"""
            {
              "rows": ["Region"],
              "columns": [],
              "values": [{ "field": "Amount", "aggregation": "sum" }],
              "filters": [],
              "pageSize": {{pageSize}},
              "sourceRowCount": 1000
            }
            """;
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using var response = await client.PostAsync($"/pivotforge/large/start{requestScope}", content);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync();
        using var document = await JsonDocument.ParseAsync(stream);
        return document.RootElement.Clone();
    }

    private sealed record Sale(string Region, decimal Amount);

    private sealed class ScopedProviderDependency;

    private sealed class ScopedSaleProvider(ScopedProviderDependency dependency)
        : IPivotForgeDataProvider<Sale>
    {
        public ValueTask<IReadOnlyList<Sale>> GetRecordsAsync(
            PivotForgeDataRequest request,
            CancellationToken cancellationToken)
        {
            _ = dependency;
            return ValueTask.FromResult<IReadOnlyList<Sale>>([]);
        }
    }
}
