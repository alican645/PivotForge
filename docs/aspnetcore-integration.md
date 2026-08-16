# ASP.NET Core Integration

`PivotForge.AspNetCore` is a `net8.0` Razor Class Library that packages browser assets, typed data-provider registration, minimal API endpoints, large-result caching, drill-down, and Excel export.

## Install

```bash
dotnet add package PivotForge.AspNetCore --version 0.3.0-preview.1
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
<script src="/_content/PivotForge.AspNetCore/js/pivot-layout-state.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-field-designer.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-view-storage.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-drill-down.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-virtual-data-source.js"></script>
```

Load scripts in the order shown: `pivot-table.js`, then `pivot-request-builder.js`, then `pivot-widget.js`, then `pivot-layout-state.js`, then `pivot-field-designer.js`. `pivot-table.js` must load before `pivot-widget.js` because the widget builds its default renderer from `PivotForge.PivotTableRenderer` at construction time, and `pivot-layout-state.js`/`pivot-field-designer.js` must load before `pivot-widget.js` is asked to build a designer (the `fieldDesigner` option), because the widget constructs a `PivotForge.PivotLayoutState` and a `PivotForge.PivotFieldDesigner` at that point. If a Razor helper on the page calls `PivotForge.create` inline (see [Declarative API](#declarative-api) below), load every PivotForge script in `<head>` rather than at the end of `<body>` — the helper's inline script runs while the page body is still being parsed, before a `<body>`-end script block would have executed.

The scripts add these members to `window.PivotForge`:

- `PivotTableRenderer`
- `PivotRequestBuilder`
- `PivotWidget`
- `PivotLayoutState`
- `PivotFieldDesigner`
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

Every field belongs to exactly one of five areas:

| Area | Purpose |
| --- | --- |
| `row` | Placed on the row axis. |
| `column` | Placed on the column axis. |
| `data` | Aggregated as a pivot value. At least one `data` field is required. |
| `filter` | Exposed for filtering without appearing in the row/column layout. |
| `available` | Declared for the [field designer](#field-designer)'s catalog without being placed in the layout. Not used outside a designer. |

Field properties and their defaults (JavaScript field object shape; `PivotFieldBuilder` exposes the same properties as fluent methods):

| Property | Default | Notes |
| --- | --- | --- |
| `dataField` | — | Required, non-empty. |
| `area` | `"data"` | One of `row`, `column`, `data`, `filter`, `available`. |
| `caption` | the `dataField` value | Display label. |
| `role` | inferred from `area` | One of `dimension`, `measure`. **Required** when `area` is `available`, because there is no placement to infer it from. Elsewhere it is inferred (`data` → `measure`, everything else → `dimension`); an explicit `role` that contradicts its `area` — e.g., `measure` outside `data` — is a validation error. See [role rules](#field-designer). |
| `aggregation` | `"sum"` (only on `data` fields) | One of `sum`, `count`, `average`, `min`, `max`. Setting `aggregation` on a non-`data` field is a validation error. |
| `showAs` | `"normal"` (only on `data` fields) | One of `normal`, `percentOfRowTotal`, `percentOfColumnTotal`, `percentOfGrandTotal`, `differenceFromPrevious`, `percentDifferenceFromPrevious`, `runningTotal`. Setting `showAs` on a non-`data` field is a validation error. |
| `format` | `null` | Number formatting for a `data` field's values: `{ type, decimals, useGrouping, currency }`, where `type` is `"number"` (default), `"currency"`, or `"percent"`, `decimals` is the fraction-digit count from 0 to 6 (default `2`), `useGrouping` toggles the thousands separator (default `true`), and `currency` is an ISO code used when `type` is `"currency"` (default `"TRY"`). Values are rendered with `Intl.NumberFormat` in the `tr-TR` locale. Declared from C# with `FormatType`/`FormatDecimals`/`FormatGrouping`/`FormatCurrency`, or from markup with `format-type`/`format-decimals`/`format-grouping`/`format-currency`. Setting a format on a non-`data` field is a validation error. |
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
| `FieldDesigner(string selector)` | — | CSS selector for the [field designer](#field-designer)'s host element. Omit to render the grid without a designer. |

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
`source-row-count`, `css-class`, and `field-designer`. An attribute you do not
write is omitted from the configuration, so the browser default applies —
writing `allow-sorting="false"` disables sorting, but omitting it leaves
sorting on.

`<pivot-field>` attributes are `field` (the source column, required),
`caption`, `area`, `role`, `aggregation`, `show-as`, `format`, and `visible`.
`area` defaults to `Data`, matching `PivotFieldBuilder`.

`area`, `role`, `aggregation`, and `show-as` bind to the `PivotArea`,
`PivotFieldRole`, `PivotAggregation`, and `PivotShowAs` enums, so a misspelled
value such as `area="Roww"` fails the Razor compile rather than surfacing in
the browser.

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
| `fieldDesigner` | `null` | A CSS selector (or element) for a [field designer](#field-designer) host. When set, `PivotWidget` builds a `PivotLayoutState` from `fields` and a `PivotFieldDesigner` bound to it, exposed as `widget.layoutState` and `widget.designer`. Requires `pivot-layout-state.js` and `pivot-field-designer.js` to be loaded before `pivot-widget.js` runs; omitting either throws. |

`create` returns a `PivotWidget` instance and, unless `autoLoad` is `false`, immediately calls `refresh()`.

### `PivotWidget` methods

| Method | Behavior |
| --- | --- |
| `refresh()` | Builds the request from the current fields/filters/sort and loads it. Aborts any request already in flight. |
| `cancel()` | Aborts the in-flight request (if any) and resets loading state, without loading anything new. Prefer this over reaching into `widget.controller` directly. |
| `updateFields(fields)` | Validates and replaces the field set, rebuilds the renderer, and refreshes. |
| `update({ fields, filters, rowSort })` | Applies whichever of `fields`, `filters`, and `rowSort` are given (each is left untouched when omitted) and refreshes exactly once, instead of once per piece the way calling `updateFields`, `setFilter`, and `sortBy` in sequence would. This is what `PivotFieldDesigner` calls after every drag-and-drop mutation. |
| `sortBy(sort)` | Sets `rowSort` and refreshes. Throws if `allowSorting` is `false`. |
| `setFilter(field, values)` | Replaces the filter for `field` (removes it when `values` is empty) and refreshes. Throws if `allowFiltering` is `false`. |
| `clearFilters()` | Clears all filters and refreshes. Throws if `allowFiltering` is `false`. |
| `drillDown({ rowPath, columnPath, valueKey })` | Returns the source records behind a pivot coordinate. Throws if `allowDrillDown` is `false`. |
| `exportToExcel(options)` | Returns `{ blob, fileName }`, not a bare blob. `fileName` comes from the server's `Content-Disposition` header and is `null` when the header is absent or unparseable. Posts the *renderer's* current export model (`getExcelExportModel`), so it throws with a clear message if the widget has no renderer (`renderImpl` was used) or if nothing has been rendered yet. Throws if `allowExcelExport` is `false`. |
| `loadPage(offset)` | Loads a page from an active large-data session (see the limitation below). Throws if `largeData` is disabled or no session is active. Retries once, transparently, after an expired (`410`) session is restarted. |
| `getState()` | Returns a snapshot: `{ fields, request, result, error, loading, filters, rowSort, sessionId, totalRowCount }`. |
| `dispose()` | Aborts any in-flight request, detaches all `on()` handlers, empties the container, and — when the widget built a designer — calls `widget.designer.dispose()` too. After disposal, any method that would issue a network request or trigger a refresh (`refresh`, `sortBy`, `setFilter`, `clearFilters`, `updateFields`, `update`, `drillDown`, `loadPage`, `exportToExcel`) throws; `getState()` remains safe to call for a final snapshot. |

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

### Field designer

An interactive panel that lets a user build the pivot layout by dragging fields between an available-field list and four drop zones (filters, columns, rows, values), instead of the layout being fixed in markup.

Name a host element with `field-designer` (tag helper) / `FieldDesigner(selector)` (builder) / `fieldDesigner` (`PivotForge.create` option), and declare at least one field with `area="Available"` so there is something to drag in:

```cshtml
<div id="designerHost"></div>

<pivot-grid id="pivotGrid" field-designer="#designerHost">
    <pivot-field field="Region"   caption="Bölge"  area="Row" />
    <pivot-field field="Year"     caption="Yıl"    area="Column" />
    <pivot-field field="Amount"   caption="Tutar"  area="Data" aggregation="Sum" />
    <pivot-field field="Quantity" caption="Miktar" area="Available" role="Measure" />
</pivot-grid>
```

When a `fieldDesigner` is configured, `PivotWidget`'s constructor builds a `PivotForge.PivotLayoutState` from the declared fields and a `PivotForge.PivotFieldDesigner` bound to it, exposed as `widget.layoutState` and `widget.designer`.

#### Dragging

Chips are dragged with the mouse, using the HTML5 drag-and-drop API. A drop is **positional**: while dragging over a zone the designer compares the pointer against each chip's midpoint and draws an insertion line at the slot the chip would land in, and the drop places the field exactly there rather than appending it. This works both when a field enters a zone from elsewhere and when a chip is dragged **within its own zone**, which is how row and column order — the pivot's grouping hierarchy — is rearranged. Repositioning a value keeps its aggregation, and repositioning a filter keeps its selected values.

The available-field list is a catalog rather than an ordered layout, so it is not reorderable; fields leave a zone through the chip's remove (`×`) button.

#### Value formats

A chip in the Values zone carries a `⋯` button that expands a format panel beneath it, with controls for the format type, the fraction-digit count, and the thousands separator. The panel writes through `PivotLayoutState.setFormat`, carrying the members it is not editing across, so changing the decimals never drops the currency. It opens showing the format actually in effect — a field that declared none shows the renderer's own defaults rather than empty controls.

The panel expands in flow rather than floating, so it needs no positioning or outside-click handling; the same `⋯` button closes it.

#### Role

Every field has a `role` of `dimension` or `measure`, which constrains where it can be dropped: a `measure` may occupy only the data area; a `dimension` may occupy row, column, and filter. Role is inferred from `area` — `data` implies `measure`, everything else implies `dimension` — **except** for `area="Available"`, where there is no placement to infer from, so `role` (`Role(...)` / `role` attribute) is required. Setting a `role` that contradicts a non-`Available` area (e.g., `Role(PivotFieldRole.Measure)` on a `Row` field) is a validation error, raised by `PivotFieldBuilder.Build()` at render time.

#### `PivotForge.PivotLayoutState`

Pure state — no DOM access. Constructed with `new PivotLayoutState(catalog, layout = null)`, where `catalog` is the full declared field list (every area, including `available`) and `layout` is an optional existing layout to adopt.

| Method | Behavior |
| --- | --- |
| `canDrop(name, area)` | Whether `name` may move into `area` (`"row"`, `"column"`, `"data"`, or `"filter"`), per the role rules above. A field's own area is allowed, because dropping a chip back into its own zone is how repositioning is expressed. |
| `move(name, area, index)` | Moves a catalog field into `area` at `index` (default: end), detaching it from wherever it was. Throws if `canDrop` would be `false`. Placing into `"data"` defaults `aggregation` to `"sum"`; placing into `"filter"` starts with no selected values. When the field is already in `area` this repositions it: `index` is read against the zone as it looks before the move, and the entry keeps its aggregation, showAs, and selected filter values. |
| `remove(name)` | Detaches a field back to the available list. A no-op if the field is already available. Throws if `name` is the only field in the data area — a pivot always needs at least one. |
| `reorder(area, fromIndex, toIndex)` | Reorders a placed field within its own zone. |
| `setFormat(name, format)` | Sets a data field's number format, or clears it with `null`. Validates `type`, `decimals` (0-6), `useGrouping`, and `currency`, throwing rather than coercing, and leaves the existing format untouched when it refuses. Throws if the field is not in the data area. |
| `setAggregation(name, aggregation)` | Sets the aggregation (`"sum"`, `"count"`, `"average"`, `"min"`, `"max"`) of a field already in the data area. Throws otherwise. |
| `field(name)` | Returns the catalog entry for `name`. Throws if unknown. |
| `getState()` | Returns `{ rows, columns, values, filters, available }` — `available` is every catalog field not currently placed. |
| `toFields()` | Converts the current layout into the field-array shape `PivotForge.create`/`updateFields` accept. |
| `toRequestState()` | Returns `{ fields, filters }` shaped for `widget.update(...)` — `filters` is pre-filtered to entries that actually have selected values. |
| `on("change", handler)` | Subscribes to layout mutations; fires once per successful `move`/`remove`/`reorder`/`setAggregation` call, with the current `getState()` as the payload. Returns an unsubscribe function. `remove()` on a field already in `available` is a no-op — it does not fire `change`, because it did not actually move or remove anything. |

The catalog is fixed at construction — it is every field the grid declared, regardless of area — so removing a placed field always returns it to `available`, and it can be dragged back in later.

#### `PivotForge.PivotFieldDesigner`

`new PivotFieldDesigner(host, { state, widget, labels })`:

- `host` — an element or a selector matching one. Throws if nothing matches.
- `state` — a `PivotLayoutState`. Required.
- `widget` — anything exposing an `update()` method (a `PivotWidget` in practice). Required.
- `labels` — optional overrides for the panel's zone headings, the remove-button label, the search placeholder, and aggregation names; unset labels keep the built-in Turkish defaults.

`render()` rebuilds the panel's DOM from the current state — the available-field list (with its search box) and the four drop zones, each showing its placed fields as draggable chips. Every drag-and-drop action, chip removal, and aggregation change calls the state's mutator and then `widget.update(state.toRequestState())`, so the designer never talks to the server directly. `dispose()` empties the host element; it is idempotent.

The designer renders a **search input** above the available-field list that filters it case-insensitively by matching the field's **caption**, not its `dataField` name. Search is a display-only filter — it never touches `PivotLayoutState` and never triggers `widget.update()`.

Removing the last field from the data area is refused by `PivotLayoutState.remove`, and the designer reflects this in the UI: that chip's remove (`×`) button is rendered `disabled`, with a `title` explaining why.

#### Limitations

- **Desktop only, mouse required.** The designer is built on the HTML5 drag-and-drop API, which does not fire on touch devices and has no keyboard equivalent — chips are focusable but not operable without a pointer. It does not work on tablets or phones in this version.
- **No filter value picker.** A field can be dragged into the Filters zone, but there is no UI to choose which values to filter to. A filter with no selected values filters nothing — the same as an unset filter elsewhere in PivotForge — so the Filters zone alone does not yet do anything useful; a consumer must still add value selection.
- **No show-as menu.** The designer edits aggregation and format; changing `showAs` still requires calling `updateFields`/`update` directly.
- **No sort panel.** Sorting is still driven through the widget's `sortBy`, outside the designer.
- **Saved views are not wired up automatically.** `PivotViewStore` and the designer's state are both serializable, so a consumer can persist and restore designer layouts, but connecting the two is the consumer's responsibility — see the MVC demo for one approach.
- **`visible: false` fields never activate through the designer.** `visible` is a catalog-level attribute, fixed at construction, not something the designer's drag-and-drop mutates. A field declared `visible="false"` starts out in the available list rather than its declared area, can still be dragged into a zone and will render as a placed chip, but `toFields()` always reports its catalog `visible` value — so it stays excluded from the pivot request regardless of where the designer places it. To let a user actually turn a field on, do not declare it `visible="false"`; use `area="Available"` instead, which keeps it out of the initial layout while leaving it eligible to be dragged in and included normally.

### Known limitations

- **Large-data paging is not wired to a virtual-scrolling UI.** `loadPage()` exists and is unit-tested, but `PivotWidget` has no page cache, no cache-hit state, and does not pass a `virtualState` to the renderer. Driving an actual virtual-scrolling grid still requires orchestrating `PivotVirtualDataSource` and `PivotTableRenderer` manually — see the MVC demo, which deliberately keeps its own `/large/start` + `/large/page` code for this reason.
- **Batching multiple pieces of state into one refresh needs `update()`.** Calling `updateFields`, `setFilter`, and `sortBy` in sequence still works, but each triggers its own `refresh()`. Use `widget.update({ fields, filters, rowSort })` to change several pieces and refresh exactly once — this is how `PivotFieldDesigner` applies drag-and-drop mutations.
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
