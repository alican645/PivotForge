using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using PivotForge.AspNetCore.DependencyInjection;
using PivotForge.AspNetCore.Endpoints;

namespace PivotForge.AspNetCore.Tests;

public sealed class PivotFieldAccessTests
{
    // A record type with something on it that belongs to the application rather than to
    // the report. Without a list, the browser can name it and get it back.
    private sealed record Employee(string Department, decimal Salary, string PasswordHash);

    private static readonly Employee[] People =
    [
        new("Sales", 100m, "secret-one"),
        new("Support", 200m, "secret-two")
    ];

    private static async Task WithAppAsync(
        string[]? allowed,
        Func<HttpClient, Task> body)
    {
        var builder = WebApplication.CreateBuilder();
        builder.Services.AddPivotForge<Employee>(
            (_, _) => ValueTask.FromResult<IReadOnlyList<Employee>>(People),
            options =>
            {
                foreach (var field in allowed ?? [])
                {
                    options.AllowedFields.Add(field);
                }
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
            await body(client);
        }
        finally
        {
            await app.StopAsync();
        }
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    private static string Pivot(string rowField) => $$"""
        {
          "rows": ["{{rowField}}"],
          "columns": [],
          "values": [{ "field": "Salary", "aggregation": "sum" }],
          "filters": []
        }
        """;

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage response)
    {
        await using var stream = await response.Content.ReadAsStreamAsync();
        using var document = await JsonDocument.ParseAsync(stream);
        return document.RootElement.Clone();
    }

    [Fact]
    public async Task WithoutAListEveryFieldOnTheRecordIsReachable()
    {
        // The default has to stay what it was, or every application upgrading to this
        // version loses the fields it never thought to declare.
        await WithAppAsync(null, async client =>
        {
            using var response = await client.PostAsync("/pivotforge/pivot", Json(Pivot("PasswordHash")));

            response.EnsureSuccessStatusCode();
        });
    }

    [Fact]
    public async Task AListedFieldStillWorks()
    {
        await WithAppAsync(["Department", "Salary"], async client =>
        {
            using var response = await client.PostAsync("/pivotforge/pivot", Json(Pivot("Department")));

            response.EnsureSuccessStatusCode();
            var result = await ReadAsync(response);
            Assert.Equal(2, result.GetProperty("rowHeaders").GetArrayLength());
        });
    }

    [Fact]
    public async Task AnUnlistedRowFieldIsRefused()
    {
        await WithAppAsync(["Department", "Salary"], async client =>
        {
            using var response = await client.PostAsync("/pivotforge/pivot", Json(Pivot("PasswordHash")));

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        });
    }

    [Fact]
    public async Task TheRefusalDoesNotSayWhichFieldItWas()
    {
        // Naming it would turn a rejection into an answer: ask for a field, learn from the
        // wording whether the record type carries it.
        await WithAppAsync(["Department"], async client =>
        {
            using var response = await client.PostAsync("/pivotforge/pivot", Json(Pivot("PasswordHash")));
            var body = await response.Content.ReadAsStringAsync();

            Assert.DoesNotContain("PasswordHash", body, StringComparison.OrdinalIgnoreCase);
        });
    }

    [Fact]
    public async Task CasingDoesNotDecideWhatIsAllowed()
    {
        // Not a hole -- a case-sensitive list would fail closed -- but a trap: the record
        // readers resolve names without regard to case, so a list spelled differently from
        // the grid would refuse a field the application meant to allow.
        await WithAppAsync(["department", "salary"], async client =>
        {
            using var listed = await client.PostAsync("/pivotforge/pivot", Json(Pivot("Department")));
            using var unlisted = await client.PostAsync("/pivotforge/pivot", Json(Pivot("passwordhash")));

            listed.EnsureSuccessStatusCode();
            Assert.Equal(HttpStatusCode.BadRequest, unlisted.StatusCode);
        });
    }

    [Fact]
    public async Task AnUnlistedValueOrFilterFieldIsRefusedToo()
    {
        // Every place a request names a source field is a way in, not just the row axis.
        await WithAppAsync(["Department", "Salary"], async client =>
        {
            using var byValue = await client.PostAsync("/pivotforge/pivot", Json("""
                {
                  "rows": ["Department"],
                  "values": [{ "field": "PasswordHash", "aggregation": "count" }],
                  "filters": []
                }
                """));
            using var byFilter = await client.PostAsync("/pivotforge/pivot", Json("""
                {
                  "rows": ["Department"],
                  "values": [{ "field": "Salary", "aggregation": "sum" }],
                  "filters": [{ "field": "PasswordHash", "values": ["secret-one"] }]
                }
                """));

            Assert.Equal(HttpStatusCode.BadRequest, byValue.StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, byFilter.StatusCode);
        });
    }

    [Fact]
    public async Task TheValuePickerCannotListAnUnlistedFieldsValues()
    {
        // The shortest route to the data: no pivot at all, just ask what the column holds.
        await WithAppAsync(["Department", "Salary"], async client =>
        {
            using var refused = await client.PostAsync(
                "/pivotforge/field-values", Json("""{ "field": "PasswordHash" }"""));
            using var allowed = await client.PostAsync(
                "/pivotforge/field-values", Json("""{ "field": "Department" }"""));

            Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
            allowed.EnsureSuccessStatusCode();
        });
    }

    [Fact]
    public async Task TheLargeDataEndpointIsGuardedAsWell()
    {
        await WithAppAsync(["Department", "Salary"], async client =>
        {
            using var response = await client.PostAsync("/pivotforge/large/start", Json("""
                {
                  "rows": ["PasswordHash"],
                  "values": [{ "field": "Salary", "aggregation": "sum" }],
                  "pageSize": 10,
                  "sourceRowCount": 1000
                }
                """));

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        });
    }

    [Fact]
    public async Task AnUnlistedColumnFieldIsRefused()
    {
        // The column axis is a second way to name a field, and it reads the record
        // exactly as the row axis does.
        await WithAppAsync(["Department", "Salary"], async client =>
        {
            using var response = await client.PostAsync("/pivotforge/pivot", Json("""
                {
                  "rows": ["Department"],
                  "columns": ["PasswordHash"],
                  "values": [{ "field": "Salary", "aggregation": "sum" }],
                  "filters": []
                }
                """));

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        });
    }

    [Fact]
    public async Task DrillDownRefusesAnUnlistedFieldBeforeItProjects()
    {
        // The projection strips the response, but the request itself still has to be
        // refused: grouping the detail list by a field is a way of reading it.
        await WithAppAsync(["Department", "Salary"], async client =>
        {
            using var response = await client.PostAsync("/pivotforge/drill-down", Json("""
                {
                  "rows": ["PasswordHash"],
                  "values": [{ "field": "Salary", "aggregation": "sum" }],
                  "rowPath": ["secret-one"],
                  "columnPath": [],
                  "sourceRowCount": 100
                }
                """));

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        });
    }

    [Fact]
    public async Task DrillDownHandsBackOnlyTheListedFields()
    {
        // The detail list is the leak the guard alone would not close: the request names
        // nothing forbidden, and the whole record comes back anyway.
        await WithAppAsync(["Department", "Salary"], async client =>
        {
            using var response = await client.PostAsync("/pivotforge/drill-down", Json("""
                {
                  "rows": ["Department"],
                  "values": [{ "field": "Salary", "aggregation": "sum" }],
                  "rowPath": ["Sales"],
                  "columnPath": [],
                  "sourceRowCount": 100
                }
                """));

            response.EnsureSuccessStatusCode();
            var record = (await ReadAsync(response)).GetProperty("records")[0];

            Assert.Equal("Sales", record.GetProperty("Department").GetString());
            Assert.Equal(100m, record.GetProperty("Salary").GetDecimal());
            Assert.False(record.TryGetProperty("PasswordHash", out _));
        });
    }

    [Fact]
    public async Task DrillDownWithoutAListStillReturnsTheWholeRecord()
    {
        // The other half of the default: an application relying on the detail modal to show
        // fields it never put on the grid keeps getting them.
        await WithAppAsync(null, async client =>
        {
            using var response = await client.PostAsync("/pivotforge/drill-down", Json("""
                {
                  "rows": ["Department"],
                  "values": [{ "field": "Salary", "aggregation": "sum" }],
                  "rowPath": ["Sales"],
                  "columnPath": [],
                  "sourceRowCount": 100
                }
                """));

            response.EnsureSuccessStatusCode();
            var record = (await ReadAsync(response)).GetProperty("records")[0];

            Assert.Equal("secret-one", record.GetProperty("passwordHash").GetString());
        });
    }
}
