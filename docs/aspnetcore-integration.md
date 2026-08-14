# ASP.NET Core Integration

`PivotForge.AspNetCore` is a `net8.0` Razor Class Library that packages browser assets, typed data-provider registration, minimal API endpoints, large-result caching, drill-down, and Excel export.

## Install

```bash
dotnet add package PivotForge.AspNetCore --version 0.1.0-preview.1
```

`PivotForge.Core` is installed transitively at the same version.

## Register a Data Provider

```csharp
using PivotForge.AspNetCore.DependencyInjection;

builder.Services.AddPivotForge<Sale>(
    async (request, cancellationToken) =>
    {
        var query = db.Sales.AsNoTracking();

        if (request.SourceRowCount is int limit)
        {
            query = query.Take(limit);
        }

        return await query.ToListAsync(cancellationToken);
    },
    options =>
    {
        options.CacheSlidingExpiration = TimeSpan.FromMinutes(5);
        options.MaximumSourceRowCount = 500_000;
        options.DrillDownRecordLimit = 1_000;
    });
```

The provider receives `SourceRowCount = null` for a normal pivot. Large-data and drill-down requests receive a validated, bounded row count.

The provider is responsible for tenant isolation, authorization-aware data access, and applying any application-level source restrictions. Pivot filters are applied by `PivotForge.Core` after records are loaded.

## Map Middleware and Endpoints

```csharp
using PivotForge.AspNetCore.Endpoints;

app.UseStaticFiles();
app.MapPivotForgeEndpoints();
```

Use a custom route prefix when needed:

```csharp
app.MapPivotForgeEndpoints("/reports/pivot");
```

Authentication, authorization, CORS, rate limiting, and antiforgery policy remain owned by the host application. The returned `RouteGroupBuilder` can be configured directly:

```csharp
app.MapPivotForgeEndpoints()
    .RequireAuthorization("ReportingUsers")
    .RequireRateLimiting("reports");
```

## Static Assets

```html
<link rel="stylesheet" href="/_content/PivotForge.AspNetCore/css/pivotforge.css">
<script src="/_content/PivotForge.AspNetCore/js/pivot-table.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-view-storage.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-drill-down.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-virtual-data-source.js"></script>
```

Load scripts in the order shown. They add these members to `window.PivotForge`:

- `PivotTableRenderer`
- `PivotViewStore`
- `PivotDrillDownData`
- `PivotVirtualDataSource`

## Render a Result

```html
<div id="pivotTable"></div>
<script>
  const renderer = new PivotForge.PivotTableRenderer(
    document.getElementById("pivotTable"));

  const response = await fetch("/pivotforge/pivot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rows: ["Region"],
      columns: ["Year"],
      values: [{ field: "Amount", aggregation: "sum", showAs: "normal" }],
      filters: []
    })
  });

  renderer.render(await response.json(), {
    rowFields: ["Region"],
    values: [{ key: "Amount_sum", label: "Amount", aggregation: "sum" }]
  });
</script>
```

`AddPivotForge` registers string-enum JSON conversion for the minimal API contracts.

## Endpoint Contract

| Method and route | Purpose |
| --- | --- |
| `POST /pivotforge/pivot` | Calculate a normal pivot result |
| `POST /pivotforge/large/start` | Calculate/cache a large result and return its first page |
| `POST /pivotforge/large/page` | Return a page from an existing cached session |
| `POST /pivotforge/drill-down` | Return source records matching row and column paths |
| `POST /pivotforge/excel` | Convert a renderer export model into an `.xlsx` response |

A missing or expired large-data session returns HTTP `410 Gone`. Invalid pivot, paging, drill-down, and Excel requests return HTTP `400 Bad Request`. Request cancellation propagates through the provider and Core calculation.

## Large-Data Requests

Start a session:

```json
{
  "rows": ["Region", "Category"],
  "columns": ["Year"],
  "values": [{ "field": "Amount", "aggregation": "sum" }],
  "filters": [],
  "pageSize": 40,
  "sourceRowCount": 100000
}
```

Load another page:

```json
{
  "sessionId": "64-character-session-id",
  "offset": 40,
  "pageSize": 40
}
```

Session identifiers are deterministic hashes of the normalized large-pivot request. Concurrent identical calculations share a keyed lock, and completed results use sliding-expiration memory cache entries.

## Options

| Option | Default |
| --- | ---: |
| `CacheSlidingExpiration` | 5 minutes |
| `MinimumLargeDataSourceRowCount` | 1,000 |
| `MaximumSourceRowCount` | 500,000 |
| `MinimumPageSize` | 10 |
| `MaximumPageSize` | 200 |
| `DrillDownRecordLimit` | 1,000 |
| `MaximumExcelRows` | 20,000 |
| `MaximumExcelCells` | 200,000 |

Options are validated when resolved. Values must be positive and minimums cannot exceed their corresponding maximums.

## Production Notes

- Scope the data provider to the authenticated tenant and user.
- Apply authorization to the endpoint group.
- Add rate limits for large calculations and exports.
- Keep `MaximumSourceRowCount` and export limits appropriate for host memory.
- Use a distributed implementation of `IPivotForgeResultCache` when sessions must survive multiple application instances. The included implementation is process-local.
