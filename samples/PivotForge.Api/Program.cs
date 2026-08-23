using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http.Json;
using PivotForge.Core;

var builder = WebApplication.CreateBuilder(args);
builder.Services.Configure<JsonOptions>(options =>
{
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
});

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapPost("/api/pivot", (PivotApiRequest request) =>
{
    var engine = new PivotEngine();
    var result = engine.ExecuteRecords(request.Data, new PivotRequest
    {
        Rows = request.Rows,
        Columns = request.Columns,
        Values = request.Values
    });

    return Results.Ok(result);
});

app.Run();

public sealed class PivotApiRequest
{
    // A level is a field name, or {"field","interval"} when it groups dates --
    // PivotFieldRef carries its own converter, so the payloads this sample
    // already accepted keep working.
    public IReadOnlyList<PivotFieldRef> Rows { get; init; } = [];

    public IReadOnlyList<PivotFieldRef> Columns { get; init; } = [];

    public IReadOnlyList<PivotValueDefinition> Values { get; init; } = [];

    public IReadOnlyList<IReadOnlyDictionary<string, object?>> Data { get; init; } = [];
}
