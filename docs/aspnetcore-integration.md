# ASP.NET Core Integration

`PivotForge.AspNetCore` is a `net8.0` Razor Class Library that packages browser assets, typed data-provider registration, minimal API endpoints, large-result caching, drill-down, and Excel export.

## Install

```bash
dotnet add package PivotForge.AspNetCore --version 0.2.0-preview.1
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

For providers that depend on scoped services, implement `IPivotForgeDataProvider<TRecord>`:

```csharp
public sealed class TenantSaleProvider(AppDbContext db, IHttpContextAccessor httpContextAccessor)
    : IPivotForgeDataProvider<Sale>
{
    public async ValueTask<IReadOnlyList<Sale>> GetRecordsAsync(
        PivotForgeDataRequest request,
        CancellationToken cancellationToken)
    {
        var tenantId = httpContextAccessor.HttpContext?.User.FindFirst("tenant_id")?.Value;
        return await db.Sales
            .AsNoTracking()
            .Where(sale => sale.TenantId == tenantId)
            .Take(request.SourceRowCount ?? 500_000)
            .ToListAsync(cancellationToken);
    }
}

builder.Services.AddPivotForge<Sale, TenantSaleProvider>();
```

Typed providers are scoped and can safely consume request-scoped application services.

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
<script src="/_content/PivotForge.AspNetCore/js/pivot-request-builder.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-widget.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-view-storage.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-drill-down.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-virtual-data-source.js"></script>
```

Load scripts in the order shown; `pivot-table.js` must load before `pivot-widget.js` because the widget builds its default renderer from `PivotForge.PivotTableRenderer` at construction time. If a Razor helper on the page calls `PivotForge.create` inline (see [Declarative API](#declarative-api) below), load every PivotForge script in `<head>` rather than at the end of `<body>` — the helper's inline script runs while the page body is still being parsed, before a `<body>`-end script block would have executed.

The scripts add these members to `window.PivotForge`:

- `PivotTableRenderer`
- `PivotRequestBuilder`
- `PivotWidget`
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

## Declarative API

Instead of writing `fetch` calls and driving `PivotTableRenderer` by hand, a grid can be declared as a set of fields — in Razor with `PivotGridBuilder`, or directly in JavaScript with `PivotForge.create`. Both paths validate the field configuration eagerly and translate it into the same `POST /pivot` request shape; the server computes the pivot, the browser only renders it.

### Field model

Every field belongs to exactly one of four areas:

| Area | Purpose |
| --- | --- |
| `row` | Placed on the row axis. |
| `column` | Placed on the column axis. |
| `data` | Aggregated as a pivot value. At least one `data` field is required. |
| `filter` | Exposed for filtering without appearing in the row/column layout. |

Field properties and their defaults (JavaScript field object shape; `PivotFieldBuilder` exposes the same properties as fluent methods):

| Property | Default | Notes |
| --- | --- | --- |
| `dataField` | — | Required, non-empty. |
| `area` | `"data"` | One of `row`, `column`, `data`, `filter`. |
| `caption` | the `dataField` value | Display label. |
| `aggregation` | `"sum"` (only on `data` fields) | One of `sum`, `count`, `average`, `min`, `max`. Setting `aggregation` on a non-`data` field is a validation error. |
| `showAs` | `"normal"` (only on `data` fields) | One of `normal`, `percentOfRowTotal`, `percentOfColumnTotal`, `percentOfGrandTotal`, `differenceFromPrevious`, `percentDifferenceFromPrevious`, `runningTotal`. |
| `format` | `null` | A format identifier understood by the browser renderer. |
| `visible` | `true` | `false` configures a field without including it in the rendered request. |

### `PivotGridBuilder` (Razor)

Obtained from `Html.PivotForge().PivotGrid()`. All setters return the builder for chaining.

| Method | Default | Purpose |
| --- | --- | --- |
| `Id(string id)` | — | Required. The container element id; letters, digits, `-`, and `_` only. |
| `Fields(Action<PivotFieldCollectionBuilder>)` | — | Required. At least one field, added with `fields.Add()...`. |
| `EndpointPrefix(string prefix)` | `/pivotforge` | Server route prefix. |
| `AllowSorting(bool)` | `true` | Enables `sortBy`. |
| `AllowFiltering(bool)` | `true` | Enables `setFilter` / `clearFilters`. |
| `AllowDrillDown(bool)` | `true` | Enables `drillDown`. |
| `AllowExcelExport(bool)` | `false` | Enables `exportToExcel`. |
| `AutoLoad(bool)` | `true` | Set `false` to suppress the initial automatic load, for pages that configure fields at runtime before the first `refresh()`. |
| `LargeData(bool)` | `false` | Routes through the large-data session endpoints instead of `/pivot`. |
| `PageSize(int)` | `40` | Rows per page when `LargeData` is enabled. |
| `SourceRowCount(int)` | `100000` | Source-row hint passed to the data provider. |
| `CssClass(string)` | — | Additional class appended to the container's `pivotforge-grid` class. |

`WriteTo` emits the container `<div>`, a JSON `<script>` block with the serialized configuration, and an inline `<script>PivotForge.create(...)</script>` call. Because that call runs inline as the page is parsed, register any `pivotforge:ready` listener before this markup (see below).

### Tag helpers (Razor)

The same grid can be declared as markup. Register the tag helpers once, in
`_ViewImports.cshtml`:

```cshtml
@addTagHelper *, PivotForge.AspNetCore
```

```cshtml
<pivot-grid id="pivotGrid" allow-sorting="true" allow-excel-export="true">
    <pivot-field field="Region" caption="Bölge" area="Row" />
    <pivot-field field="Amount" caption="Tutar" area="Data" aggregation="Sum" />
</pivot-grid>
```

`<pivot-grid>` attributes mirror the builder methods in kebab-case: `id`,
`endpoint-prefix`, `allow-sorting`, `allow-filtering`, `allow-drill-down`,
`allow-excel-export`, `auto-load`, `large-data`, `page-size`,
`source-row-count`, and `css-class`. An attribute you do not write is omitted
from the configuration, so the browser default applies — writing
`allow-sorting="false"` disables sorting, but omitting it leaves sorting on.

`<pivot-field>` attributes are `field` (the source column, required),
`caption`, `area`, `aggregation`, `show-as`, `format`, and `visible`. `area`
defaults to `Data`, matching `PivotFieldBuilder`.

`area`, `aggregation`, and `show-as` bind to the `PivotArea`,
`PivotAggregation`, and `PivotShowAs` enums, so a misspelled value such as
`area="Roww"` fails the Razor compile rather than surfacing in the browser.

A `<pivot-field>` outside a `<pivot-grid>` throws, as does a grid with no
fields or no `id`. The tag helpers hold no pivot logic of their own — they
collect attributes and delegate to `PivotGridBuilder`, so both Razor forms
emit identical markup.

### `PivotForge.create(target, options)` (JavaScript)

`target` is an element or CSS selector. `options` accepts the same properties as the Razor builder, in camelCase, plus:

| Option | Default | Purpose |
| --- | --- | --- |
| `fields` | `[]` | Required — the field array described above. |
| `filters` | `[]` | Initial filters: `{ field, values }` entries. |
| `rowSort` | `null` | Initial row sort. |
| `rendererOptions` | `null` | Merged into the default `PivotTableRenderer` options. |
| `fetchImpl` | `null` | Override for `fetch`, mainly for tests. |
| `renderImpl` | `null` | Replaces the built-in `PivotTableRenderer` entirely; when set, the widget has no renderer and `exportToExcel` cannot be used. |

`create` returns a `PivotWidget` instance and, unless `autoLoad` is `false`, immediately calls `refresh()`.

### `PivotWidget` methods

| Method | Behavior |
| --- | --- |
| `refresh()` | Builds the request from the current fields/filters/sort and loads it. Aborts any request already in flight. |
| `cancel()` | Aborts the in-flight request (if any) and resets loading state, without loading anything new. Prefer this over reaching into `widget.controller` directly. |
| `updateFields(fields)` | Validates and replaces the field set, rebuilds the renderer, and refreshes. |
| `sortBy(sort)` | Sets `rowSort` and refreshes. Throws if `allowSorting` is `false`. |
| `setFilter(field, values)` | Replaces the filter for `field` (removes it when `values` is empty) and refreshes. Throws if `allowFiltering` is `false`. |
| `clearFilters()` | Clears all filters and refreshes. Throws if `allowFiltering` is `false`. |
| `drillDown({ rowPath, columnPath, valueKey })` | Returns the source records behind a pivot coordinate. Throws if `allowDrillDown` is `false`. |
| `exportToExcel(options)` | Returns `{ blob, fileName }`, not a bare blob. `fileName` comes from the server's `Content-Disposition` header and is `null` when the header is absent or unparseable. Posts the *renderer's* current export model (`getExcelExportModel`), so it throws with a clear message if the widget has no renderer (`renderImpl` was used) or if nothing has been rendered yet. Throws if `allowExcelExport` is `false`. |
| `loadPage(offset)` | Loads a page from an active large-data session (see the limitation below). Throws if `largeData` is disabled or no session is active. Retries once, transparently, after an expired (`410`) session is restarted. |
| `getState()` | Returns a snapshot: `{ fields, request, result, error, loading, filters, rowSort, sessionId, totalRowCount }`. |
| `dispose()` | Aborts any in-flight request, detaches all `on()` handlers, and empties the container. After disposal, any method that would issue a network request or trigger a refresh (`refresh`, `sortBy`, `setFilter`, `clearFilters`, `updateFields`, `drillDown`, `loadPage`, `exportToExcel`) throws; `getState()` remains safe to call for a final snapshot. |

### Events

Register handlers with `widget.on(eventName, handler)`, which returns an unsubscribe function.

| Event | Payload | Fires |
| --- | --- | --- |
| `dataLoading` | `{ request }` | Before each request is sent. |
| `dataLoaded` | `{ result }` | After a request succeeds and the result has been rendered. |
| `error` | the `Error` | When a request fails (network or server-side), after it is shown next to the table. |

In addition, `PivotForge.create` dispatches a plain DOM `CustomEvent` named `pivotforge:ready` on the container element, carrying `{ detail: { widget } }`. This is **not** a `widget.on()` event — it fires synchronously during `create`, before `create` returns the widget. Because of that timing, a listener added to the element by id *after* the helper's markup runs can never see it fire. Register a capture-phase listener on `document` before the markup, as shown in the [root README](../README.md#declarative-quick-start):

```html
<script>
  document.addEventListener(
    "pivotforge:ready",
    event => { window.pivotGridWidget = event.detail.widget; },
    true);
</script>
```

### Known limitations

- **Large-data paging is not wired to a virtual-scrolling UI.** `loadPage()` exists and is unit-tested, but `PivotWidget` has no page cache, no cache-hit state, and does not pass a `virtualState` to the renderer. Driving an actual virtual-scrolling grid still requires orchestrating `PivotVirtualDataSource` and `PivotTableRenderer` manually — see the MVC demo, which deliberately keeps its own `/large/start` + `/large/page` code for this reason.
- **No single call changes multiple pieces of state and refreshes once.** Changing fields, filters, and sort together currently means calling `updateFields`, `setFilter`, and `sortBy` in sequence (each triggering its own `refresh()`), or mutating `widget.options.fields`, `widget.fields` (via `PivotForge.PivotRequestBuilder.normalizeFields(...)`, so `getState().fields` and row headers stay in sync), `widget.filters`, and `widget.rowSort` directly before calling `refresh()` once, as the demo's `syncWidgetRequest` does. Skipping the `widget.fields` reassignment leaves `getState().fields` stale and can leave row headers wrong, since the renderer only reads `rowFields`/`rowFieldLabels` at construction or `updateFields`.
- **Saved views, conditional formatting, and selection/clipboard UI** are not part of the declarative API. They remain lower-level features built on `PivotViewStore`, `PivotTableRenderer`'s `conditionalRules`/`onSelectionChanged`/`onCellCopied` options, and manual request construction — see [Render a Result](#render-a-result) above.

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
The authenticated user identifier, endpoint path, and query string are included in the cache identity so request-scoped data sets do not share large-result sessions.

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
