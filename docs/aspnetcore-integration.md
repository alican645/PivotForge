# ASP.NET Core Integration

`PivotForge.AspNetCore` is a `net8.0` Razor Class Library that packages browser assets, typed data-provider registration, minimal API endpoints, large-result caching, drill-down, and Excel export.

## Install

```bash
dotnet add package PivotForge.AspNetCore --version 0.6.0-preview.1
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
<script src="/_content/PivotForge.AspNetCore/js/pivot-filter-picker.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-view-storage.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-drill-down.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-drill-down-modal.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-virtual-data-source.js"></script>

<!-- Optional: the language every component shows. English needs nothing. -->
<script src="/_content/PivotForge.AspNetCore/js/pivot-locale-tr.js"></script>
```

A locale pack only registers itself, so it may load in any position as long as it precedes the `PivotForge.create` call that names it. Load the rest in the order shown: `pivot-table.js`, then `pivot-request-builder.js`, then `pivot-widget.js`, then `pivot-layout-state.js`, then `pivot-field-designer.js`. `pivot-table.js` must load before `pivot-widget.js` because the widget builds its default renderer from `PivotForge.PivotTableRenderer` at construction time, and `pivot-layout-state.js`/`pivot-field-designer.js` must load before `pivot-widget.js` is asked to build a designer (the `fieldDesigner` option), because the widget constructs a `PivotForge.PivotLayoutState` and a `PivotForge.PivotFieldDesigner` at that point. If a Razor helper on the page calls `PivotForge.create` inline (see [Declarative API](#declarative-api) below), load every PivotForge script in `<head>` rather than at the end of `<body>` — the helper's inline script runs while the page body is still being parsed, before a `<body>`-end script block would have executed.

The scripts add these members to `window.PivotForge`:

- `PivotTableRenderer`
- `PivotRequestBuilder`
- `PivotWidget`
- `PivotLayoutState`
- `PivotFieldDesigner`
- `PivotFilterPicker`
- `PivotViewStore`
- `PivotDrillDownData`
- `PivotDrillDownModal`
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
| `format` | `null` | Number formatting for a `data` field's values: `{ type, decimals, useGrouping, currency }`, where `type` is `"number"` (default), `"currency"`, or `"percent"`, `decimals` is the fraction-digit count from 0 to 6 (default `2`), `useGrouping` toggles the thousands separator (default `true`), and `currency` is an ISO code used when `type` is `"currency"` (default `"TRY"`). Values are rendered with `Intl.NumberFormat` in the reader's own locale unless the grid declares a `culture` — see [Localization](#localization). Declared from C# with `FormatType`/`FormatDecimals`/`FormatGrouping`/`FormatCurrency`, or from markup with `format-type`/`format-decimals`/`format-grouping`/`format-currency`. Setting a format on a non-`data` field is a validation error. |
| `visible` | `true` | `false` configures a field without including it in the rendered request. |
| `expanded` | `true` | Only on `row` fields. `false` collapses this level's groups at the grid's **first** render; after that the state belongs to the user, and a restored `state-storing` view wins. Declaring it on the deepest row field does nothing — that level's rows are the detail rows and have no groups. |
| `showTotals` | `true` | Only on `row` fields. `false` leaves the group header in place without its sums, which is the same shape the grid uses when `subtotals` is off entirely — so a deep hierarchy can total the levels worth totalling and nowhere else. The grid-wide `subtotals="false"` still wins. |

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
`source-row-count`, `css-class`, `field-designer`, `state-storing`, and
`state-key`. An attribute you do not
write is omitted from the configuration, so the browser default applies —
writing `allow-sorting="false"` disables sorting, but omitting it leaves
sorting on.

#### Presentation options

These configure the browser renderer rather than the widget, and travel to it in a
nested `rendererOptions` object. Anything left undeclared is omitted entirely, so
the renderer keeps its own default.

| Attribute | Builder | Default | Purpose |
| --- | --- | --- | --- |
| `selection-mode` | `SelectionMode(PivotSelectionMode)` | `Single` | `Single` selects the clicked cell; `None` disables selection. |
| `layout-mode` | `LayoutMode(PivotGridLayoutMode)` | `Tabular` | `Tabular` gives each row field its own column; `Compact` indents them into one. |
| `context-menu` | `ContextMenu(bool)` | `true` | The right-click cell menu. |
| `subtotals` | `Subtotals(bool)` | `true` | Subtotal rows. |
| `show-grand-total` | `ShowGrandTotal(bool)` | `true` | The grand total row. |
| `repeat-row-labels` | `RepeatRowLabels(bool)` | `false` | Repeats a row label on every row it spans instead of only the first. |
| `min-column-width` | `MinColumnWidth(int)` | `72` | Narrowest a column may be rendered or resized to, in pixels. Must be positive. |
| `max-column-width` | `MaxColumnWidth(int)` | `420` | Widest a column may be, in pixels. Must be positive. |
| `empty-text` | `EmptyText(string)` | `-` | Shown in a cell with no value. May be empty to render nothing. |
| `total-text` | `TotalText(string)` | `Toplam` | Caption for total rows and columns. Must not be blank. |
| `aria-label` | `AriaLabel(string)` | `Pivot tablosu` | Accessible name announced for the grid. Must not be blank. Give two pivots on one page two different names, or a screen reader cannot tell them apart. |
| `culture` | `Culture(string)` | the reader's own locale | BCP 47 tag used to format numbers in the browser. Must not be blank. Server-side collation is separate — see [Localization](#localization). |
| `hide-empty-summary-cells` | `HideEmptySummaryCells(bool)` | `false` | Drops rows and columns holding no values at all. The column axis is the product of its levels, so sparse data leaves whole columns that never occurred; a row is empty when its values all aggregated to nothing. Dropped in the engine, so paging, Excel export and drill-down all agree on which rows exist. |
| `locale` | `Locale(string)` | the request's UI culture | Name of the locale pack supplying every on-screen string. Must not be blank. `en` is the built-in English and loads nothing — see [Localization](#localization). |

`selection-mode` and `layout-mode` are non-nullable enums so Razor accepts the
unqualified member name; whether the attribute was written is recovered from
`TagHelperContext.AllAttributes`, so an unwritten attribute is not mistaken for a
deliberate `Single`/`Tabular`.

#### Initial state

Four child elements declare the state a grid starts in. Each has a
`PivotGridBuilder` equivalent.

```html
<pivot-grid id="pivotGrid">
  <pivot-field field="Region" area="Row" />
  <pivot-field field="Amount" area="Data" aggregation="Sum" />

  <pivot-filter field="Region" values="Marmara, Ege" />
  <pivot-filter field="Year" type="Exclude" values="2019" />
  <pivot-top-n field="Region" count="3" />
  <pivot-sort mode="RowTotalValue" value-field="Amount" direction="Descending" />
  <pivot-conditional-rule value-field="Amount" operator="GreaterThanOrEqual"
                          threshold="900000" color="Green" id="high" />
</pivot-grid>
```

| Element | Builder | Notes |
| --- | --- | --- |
| `pivot-filter` | `Filter(string, params string[])`, `Filter(string, PivotFilterMode, params string[])`, `Filter(string, PivotFilterMode, PivotFilterOperator, params string[])` | `values` is comma separated and entries are trimmed. A value containing a comma has to go through the builder. `type="Exclude"` turns the list into the values to drop; the default `Include` keeps only the listed ones. `operator` turns the list into a condition's arguments — see [Filter operators](#filter-operators). |
| `pivot-top-n` | `TopN(string, int)`, `TopN(string, int, string?, PivotTopNMode)` | Repeatable, one per row level. Runs after aggregation — see [Top-N](#top-n). |
| `pivot-sort` | `RowSort(PivotSort)` | At most one per grid — rows order one way, so a second is refused rather than merged. |
| `pivot-conditional-rule` | `ConditionalRule(...)` | Repeatable. Later rules win over earlier ones on the same cell. |

Anything naming a value takes either `value-key` directly, or `value-field` with
`value-aggregation` (default `Sum`) and lets the key be built — the browser keys
cells as `Field_aggregation`, and `PivotValueKey.For` is the same convention in
C#. An explicit `value-key` wins.

`operator` accepts `GreaterThan`, `GreaterThanOrEqual`, `LessThan`,
`LessThanOrEqual`, `Equal` and `Between`; `Between` requires `threshold2` and is
refused without it, because the browser would otherwise match nothing and look
broken rather than incomplete. `color` accepts `Green`, `Amber`, `Red` and `Blue`.

The emitted configuration is serialized in key order, so the same configuration
produces the same bytes whichever API declared it and in whatever order.

#### State persistence

`state-storing="Local|Session"` (`StateStoring(PivotStateStorage)`) persists what
the user arrives at — field layout, renamed captions, filter selections,
aggregations, number formats and row sort — and restores it on the next load. It
is off by default; persistence is something a page opts into.

```cshtml
<pivot-grid id="pivotGrid"
            field-designer="#designerHost"
            state-storing="Session"
            state-key="satisRaporu">
```

`state-key` names the storage entry (`pivotforge:state:satisRaporu`). Leave it
out and the grid's `id` stands in. With **neither**, nothing is persisted and the
grid works from its declared configuration — a shared default key would let two
grids on a page overwrite each other's layouts, which is worse than not saving.

`Local` survives closing the browser; `Session` lasts for the tab.

What is stored is a preference, never a contract. **A stored payload can never
break the page:** unparseable JSON, a payload from another version, a layout the
field catalog can no longer honour (a field that was removed, or one whose role
no longer allows where it sat) and a filter naming a field that no longer exists
are each discarded, and the grid falls back to what it declared. A stored layout
that was rejected takes its filters down with it, rather than leaving the grid
filtering by a layout it just refused.

Persistence works without a field designer too — there is simply no layout to
save, so only the filters and the sort are.

`available` is deliberately not stored: it is derived from the catalog on every
read, so a stale copy could only contradict it.

#### Events

Every event is delivered two ways, and both always fire — naming a handler does
not switch the DOM event off, and vice versa.

| Attribute | Builder | Payload |
| --- | --- | --- |
| `on-data-loading` | `OnDataLoading(string)` | `{ request }` |
| `on-data-loaded` | `OnDataLoaded(string)` | `{ result }` |
| `on-error` | `OnError(string)` | the `Error` |
| `on-selection-changed` | `OnSelectionChanged(string)` | the selection, or `null` |
| `on-cell-double-click` | `OnCellDoubleClick(string)` | the cell selection |
| `on-cell-copied` | `OnCellCopied(string)` | `{ text, copied, kind }` |
| `on-cell-filter-requested` | `OnCellFilterRequested(string)` | the cell selection |
| `on-view-state-changed` | `OnViewStateChanged(string)` | the renderer view state |

The attribute names a function on the page, optionally as a dotted path
(`app.handlers.onLoaded`). It is resolved when the event fires rather than when
the grid is created: a Razor helper starts the grid inline, where its markup
sits, which is before a `<script>` block further down the page has run.
Declaring a handler that never appears therefore throws when the event first
fires, not at startup.

```html
<pivot-grid id="pivotGrid" on-selection-changed="pivotSelectionChanged">
  <pivot-field field="Amount" area="Data" aggregation="Sum" />
</pivot-grid>

<script>
  function pivotSelectionChanged(selection) { /* ... */ }
</script>
```

The same events are dispatched on the grid container as bubbling `CustomEvent`s
named `pivotforge:` plus the lowercased event name, with the payload on
`event.detail`:

```javascript
document.getElementById("pivotGrid")
  .addEventListener("pivotforge:selectionchanged", event => {
    console.log(event.detail);
  });
```

A consumer that supplies its own `rendererOptions` callback still receives it;
the widget's event fires alongside. The one exception is
`onCellDoubleClick`, where supplying a callback also suppresses the packaged
detail modal, so a page with its own modal does not get two.

Anything not listed here still needs `rendererOptions` through
`PivotForge.create`, or the `pivotforge:ready` event — see
[Known limitations](#known-limitations).


`<pivot-field>` attributes are `field` (the source column, required),
`caption`, `area`, `role`, `aggregation`, `show-as`, the four `format-*`
attributes, `visible`, `area-index`, `sort-order`, `group-interval`, and — on
`Row` fields only — `expanded` and `show-totals`. `area` defaults to `Data`, matching
`PivotFieldBuilder`.

`area-index` gives the field an explicit position among the fields sharing its
area, instead of taking the declaration order. It is the opening order only:
once the user moves a chip the layout owns the order, and a restored
`state-storing` view is loaded as it was saved.

`sort-order` (`Ascending` / `Descending`, valid on `Row` and `Column` fields)
orders that field's own header level inside its parent group, so the hierarchy
survives the ordering. The two axes differ in what "undeclared" means: the row
axis is ascending unless told otherwise, while an undeclared column level keeps
the order the data arrived in — a query that ordered months by month number
would be ruined by alphabetical ordering, so the engine does not impose one. A
sort the user applies by clicking a header still wins over the declaration.

`group-interval` (`Year`, `Quarter`, `Month`, `Day`, `DayOfWeek`) collapses a
date column into header groups — see [Date grouping](#date-grouping).

`area`, `role`, `aggregation`, `show-as`, `sort-order`, and `group-interval`
bind to the `PivotArea`, `PivotFieldRole`, `PivotAggregation`, `PivotShowAs`,
`PivotSortDirection`, and `PivotGroupInterval` enums, so a misspelled value such as `area="Roww"` fails
the Razor compile rather than surfacing in the browser.

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
| `drillDownModal` | `true` | Wires cell activation to the packaged `PivotDrillDownModal`. Set to `false` to keep `drillDown()` available while supplying your own detail UI. Ignored when `allowDrillDown` is `false`, and silently inert when `pivot-drill-down-modal.js` was not loaded. |
| `drillDownModalOptions` | `null` | Passed to the `PivotDrillDownModal` constructor: `columns`, `labels`, `host`. |
| `stateStoring` | `null` | `"local"`, `"session"`, or `null`. See [State persistence](#state-persistence). Any other value throws. |
| `stateKey` | `null` | Names the storage entry. Falls back to the container's `id`; with neither, nothing is persisted. |

`create` returns a `PivotWidget` instance and, unless `autoLoad` is `false`, immediately calls `refresh()`.

### `PivotWidget` methods

| Method | Behavior |
| --- | --- |
| `refresh()` | Builds the request from the current fields/filters/sort and loads it. Aborts any request already in flight. |
| `cancel()` | Aborts the in-flight request (if any) and resets loading state, without loading anything new. Prefer this over reaching into `widget.controller` directly. |
| `updateFields(fields)` | Validates and replaces the field set, rebuilds the renderer, and refreshes. |
| `update({ fields, filters, rowSort })` | Applies whichever of `fields`, `filters`, and `rowSort` are given (each is left untouched when omitted) and refreshes exactly once, instead of once per piece the way calling `updateFields`, `setFilter`, and `sortBy` in sequence would. This is what `PivotFieldDesigner` calls after every drag-and-drop mutation. |
| `sortBy(sort)` | Sets `rowSort` and refreshes. Throws if `allowSorting` is `false`. |
| `setFilter(field, values, mode = "Include")` | Replaces the filter for `field` (removes it when `values` is empty, in either mode) and refreshes. Under `"Exclude"` the list names the values to drop instead of the ones to keep. Throws if `allowFiltering` is `false`. With a `fieldDesigner` attached the write goes through the layout state, so the designer's chips and a header funnel always agree — and the filter survives the next drag. |
| `clearFilters()` | Clears all filters and refreshes. Throws if `allowFiltering` is `false`. |
| `drillDown({ rowPath, columnPath, valueKey })` | Returns the source records behind a pivot coordinate. Throws if `allowDrillDown` is `false`. |
| `saveState()` / `clearState()` / `readState()` | Write, forget, and read the persisted state by hand. All three return `false`/`null` rather than throwing when persistence is off or storage is unavailable. |
| `fieldValues(field)` | Returns `{ field, values, totalCount, truncated, limit }`: the distinct values a filter on `field` can accept, in value order. Deliberately unaffected by the pivot layout and by the filters already applied — a list narrowed by the current filter could never offer back a value the user had excluded. Throws if `allowFiltering` is `false`. |
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

Chips are moved by pointer or by keyboard. A drop is **positional**: while dragging over a zone the designer compares the pointer against each chip's midpoint and draws an insertion line at the slot the chip would land in, and the release places the field exactly there rather than appending it. Releasing outside every zone cancels the move rather than removing the field. This works both when a field enters a zone from elsewhere and when a chip is dragged **within its own zone**, which is how row and column order — the pivot's grouping hierarchy — is rearranged. Repositioning a value keeps its aggregation, and repositioning a filter keeps its selected values.

The available-field list is a catalog rather than an ordered layout, so it is not reorderable; fields leave a zone through the chip's remove (`×`) button.

#### Field settings

Every placed chip carries a `⋯` button that opens a settings modal. Naming (rename / reset) and position (move up / move down) apply to any field; a chip in the Values zone also gets aggregation, show-as, and number format. Controls used to expand inside the chip, but a chip that grows to hold them dwarfs its neighbours and makes a zone's drop geometry jump around mid-drag, so they live in a modal instead.

The format controls write through `PivotLayoutState.setFormat`, carrying the members they are not editing across, so changing the decimals never drops the currency. The modal opens showing the format actually in effect — a field that declared none shows the renderer's own defaults rather than empty controls.

#### Role

Every field has a `role` of `dimension` or `measure`, which constrains where it can be dropped: a `measure` may occupy only the data area; a `dimension` may occupy row, column, and filter. Role is inferred from `area` — `data` implies `measure`, everything else implies `dimension` — **except** for `area="Available"`, where there is no placement to infer from, so `role` (`Role(...)` / `role` attribute) is required. Setting a `role` that contradicts a non-`Available` area (e.g., `Role(PivotFieldRole.Measure)` on a `Row` field) is a validation error, raised by `PivotFieldBuilder.Build()` at render time.

#### `PivotForge.PivotLayoutState`

Pure state — no DOM access. Constructed with `new PivotLayoutState(catalog, layout = null)`, where `catalog` is the full declared field list (every area, including `available`) and `layout` is an optional existing layout to adopt.

| Method | Behavior |
| --- | --- |
| `canDrop(name, area)` | Whether `name` may move into `area` (`"row"`, `"column"`, `"data"`, or `"filter"`), per the role rules above. A field's own area is allowed, because dropping a chip back into its own zone is how repositioning is expressed. |
| `move(name, area, index)` | Moves a catalog field into `area` at `index` (default: end), detaching it from wherever it was. Throws if `canDrop` would be `false`. Placing into `"data"` defaults `aggregation` to `"sum"`; placing into `"filter"` starts with no selected values. When the field is already in `area` this repositions it: `index` is read against the zone as it looks before the move, and the entry keeps its aggregation, showAs, and selected filter values. A filtered field carries its filter along, whichever area it moves to; only `remove` drops it. |
| `remove(name)` | Detaches a field back to the available list. A no-op if the field is already available. Throws if `name` is the only field in the data area — a pivot always needs at least one. |
| `reorder(area, fromIndex, toIndex)` | Reorders a placed field within its own zone. |
| `setFormat(name, format)` | Sets a data field's number format, or clears it with `null`. Validates `type`, `decimals` (0-6), `useGrouping`, and `currency`, throwing rather than coercing, and leaves the existing format untouched when it refuses. Throws if the field is not in the data area. |
| `setAggregation(name, aggregation)` | Sets the aggregation (`"sum"`, `"count"`, `"average"`, `"min"`, `"max"`) of a field already in the data area. Throws otherwise. |
| `setFilterValues(name, values)` | Sets the values a filter accepts. The field does not have to be in the filter area: a filter belongs to the field, so a row or column field can be filtered where it stands (which is what the table's header funnel does), and it keeps its seat. Values are stringified, with `null` stored as `""` — the form the engine compares a null source value as. An empty array means no restriction, which is also how an untouched filter starts, so clearing a filter and never setting one are the same state. Throws if `name` is a measure or `values` is not an array. |
| `setFilterMode(name, mode)` | Sets `"Include"` or `"Exclude"` for the field's filter, under the same ownership rule as `setFilterValues`. Throws on an unknown mode or a measure. |
| `field(name)` | Returns the catalog entry for `name`. Throws if unknown. |
| `getState()` | Returns `{ rows, columns, values, filters, available, captions }` — `available` is every catalog field not currently placed, and `captions` holds the renames applied through `setCaption`. The whole object can be passed straight back to the constructor to restore it. `filters` holds every filter, including those on fields seated in another area; the designer's Filters zone shows only the entries whose field is not seated elsewhere. |
| `toFields()` | Converts the current layout into the field-array shape `PivotForge.create`/`updateFields` accept. |
| `toRequestState()` | Returns `{ fields, filters }` shaped for `widget.update(...)` — `filters` is pre-filtered to entries that actually have selected values. |
| `on("change", handler)` | Subscribes to layout mutations; fires once per successful `move`/`remove`/`reorder`/`setAggregation` call, with the current `getState()` as the payload. Returns an unsubscribe function. `remove()` on a field already in `available` is a no-op — it does not fire `change`, because it did not actually move or remove anything. |

The catalog is fixed at construction — it is every field the grid declared, regardless of area — so removing a placed field always returns it to `available`, and it can be dragged back in later.

#### `PivotForge.PivotFieldDesigner`

`new PivotFieldDesigner(host, { state, widget, labels })`:

- `host` — an element or a selector matching one. Throws if nothing matches.
- `state` — a `PivotLayoutState`. Required.
- `widget` — anything exposing an `update()` method (a `PivotWidget` in practice). Required.
- `labels` — optional overrides for the panel's zone headings, the remove-button label, the search placeholder, and aggregation names; unset labels keep the locale pack's, and failing that the built-in English. A widget builds its designer with the pack's labels merged under `designerLabels` — see [Localization](#localization).

`render()` rebuilds the panel's DOM from the current state — the available-field list (with its search box) and the four drop zones, each showing its placed fields as draggable chips. Every drag-and-drop action, chip removal, and aggregation change calls the state's mutator and then `widget.update(state.toRequestState())`, so the designer never talks to the server directly. `dispose()` empties the host element; it is idempotent.

The designer renders a **search input** above the available-field list that filters it case-insensitively by matching the field's **caption**, not its `dataField` name. Search is a display-only filter — it never touches `PivotLayoutState` and never triggers `widget.update()`.

### Top-N

`pivot-top-n` limits one row header level to its highest or lowest ranking groups:

```html
<pivot-grid id="pivotGrid">
  <pivot-field field="Region" area="Row" />
  <pivot-field field="Category" area="Row" />
  <pivot-field field="Amount" area="Data" aggregation="Sum" />

  <!-- The best three regions, and the best two categories inside each of them -->
  <pivot-top-n field="Region" count="3" />
  <pivot-top-n field="Category" count="2" />
</pivot-grid>
```

| Attribute | Default | Meaning |
| --- | --- | --- |
| `field` | required | The row field, or `field:interval` level key, being limited. |
| `count` | required | How many groups survive **in each parent group**. |
| `value-key` | first declared value | The measure that ranks them, as `Field_aggregation`. |
| `mode` | `Top` | `Bottom` keeps the other end of the same ranking. |

Three things separate this from a filter:

- **It runs after aggregation.** A filter decides which source records take part;
  the groups a ranking compares do not exist until those records have been summed.
  So a ranking always sees what the filters left behind, never the other way round.
- **It counts inside the parent group.** `count="2"` on an inner level keeps two
  groups per outer group, the same way a per-level `sort-order` orders one. Otherwise
  a single large region would fill the whole quota.
- **The rows it drops leave the result entirely, totals included.** The grand total
  equals the rows printed above it. That is the one number a reader checks by hand,
  and the cost of getting it right is one extra pass over the source records — taken
  only by a request that declared a ranking, because a subset's average cannot be
  recovered from the averages of its parts.

A group that aggregated to nothing has no rank, so it sits last in both directions
rather than winning a `Bottom` ranking by being empty. Ties break on the label, so
the same data always produces the same rows — which is what lets the large-data
endpoint cache a ranked result.

A ranking naming no row level, keeping fewer than one group, or ranked by an
undeclared value is refused rather than quietly showing every row.

A chip in the **Filters** zone carries a third control, `▼`, which opens the packaged `PivotFilterPicker`. The button is rendered only when the widget exposes `fieldValues()` and `pivot-filter-picker.js` was loaded, so an older host gets no control rather than a broken one. Once a filter accepts fewer than all values, its chip shows the count — `Çeyrek (3)` — because a Filters zone that shows only field names gives no clue that anything is being restricted.

The picker also carries the filter's **mode**. A checkbox always means "shown", in both modes; what the mode picks is which side of the list gets stored, and therefore what happens to a value the source gains later — under `Include` a new value is hidden, under `Exclude` it is shown. That is why the control is labelled by its outcome (*Sonradan eklenen değerler: Gizlensin / Gösterilsin*) rather than by the storage. Switching modes never changes what is currently checked, because both descriptions cover the same rows. An excluding chip counts what it drops — `Çeyrek (2 hariç)` — and with every value checked the filter is stored as an empty list in both modes, which means no restriction at all.

Removing the last field from the data area is refused by `PivotLayoutState.remove`, and the designer reflects this in the UI: that chip's remove (`×`) button is rendered `disabled`, with a `title` explaining why.

#### Limitations

- **A measure can only go to Values; a dimension can go anywhere else.** The
  rule comes from the field's `role`, which is inferred from its declared area
  (`data` implies `measure`, `row`/`column`/`filter` imply `dimension`) and must
  be stated explicitly for a field declared `area="Available"`. Dragging a field
  where its role forbids marks the zone as refused; the drop is rejected.
- **A placed field can be dragged back to the Fields list to remove it**, which does the same thing as its × button and obeys the same rule: the last remaining Values field cannot be removed either way.
- **Mouse, touch, pen and keyboard all work.** Drag runs on pointer events
  rather than the HTML5 drag-and-drop API, which never fires on a touch device.
  A mouse drags from anywhere on a chip. A finger or a pen drags from the
  chip's grip (`⠿`) only — the grip is the sole element carrying
  `touch-action: none`, so a touch anywhere else still scrolls the panel, which
  a long available-field list needs. A press becomes a drag only after it has
  travelled 5px, so a tap or a click on a chip control still reaches that
  control.

  The keyboard path is a **pick up / drop** gesture rather than a set of
  shortcuts, so it has the drag's cancel: nothing is written to the state until
  the field is dropped, and Escape simply forgets the move. Chips use a roving
  `tabindex` — one tab stop per zone, on the chip focus last visited there — and
  the chip's own controls (`×`, `⋯`, `▼`) are taken out of the tab sequence, so
  a ten-field panel costs five tab stops rather than forty.

  | Key | On a focused chip | While a chip is picked up |
  |---|---|---|
  | `Space` | pick the field up | drop it where the marker is |
  | `Enter` | open the settings modal | drop it |
  | `↑` / `↓` | move focus within the zone | move the landing slot |
  | `←` / `→` | — | move to the previous / next zone |
  | `Escape` | — | cancel; nothing changes |
  | `Delete` | remove the field | — |

  Zones step in screen order: **Alanlar → Filtreler → Sütunlar → Satırlar →
  Değerler**. Dropping onto Alanlar unplaces the field, exactly as dragging it
  back there does; a zone the field's role forbids is marked refused and the
  drop does nothing. Focus follows the field through the re-render its own move
  triggers, so a second move needs no reach for the mouse. Because `▼` is out
  of the tab sequence, the settings modal carries a **Filtre değerleri** button
  that opens the same picker.
- **No sort panel from the designer.** The settings modal covers naming, position, aggregation, show-as, number format and removal; sorting is still driven through the widget's `sortBy`, outside the designer.
- **Named saved views are not wired up automatically.** `state-storing` persists one current state per key, automatically. Letting a user keep *several* named views and switch between them is a different feature, built on `PivotViewStore` — see the MVC demo for one approach.
- **`visible: false` fields never activate through the designer.** `visible` is a catalog-level attribute, fixed at construction, not something the designer's drag-and-drop mutates. A field declared `visible="false"` starts out in the available list rather than its declared area, can still be dragged into a zone and will render as a placed chip, but `toFields()` always reports its catalog `visible` value — so it stays excluded from the pivot request regardless of where the designer places it. To let a user actually turn a field on, do not declare it `visible="false"`; use `area="Available"` instead, which keeps it out of the initial layout while leaving it eligible to be dragged in and included normally.

#### `PivotForge.PivotFilterPicker`

`new PivotFilterPicker({ widget, host, labels })` — a modal that lists a field's
distinct values as checkboxes, with a search box, **Tümünü seç** / **Temizle**,
and Uygula/İptal. `PivotFieldDesigner` builds one on first use, so a declarative
page needs only the script tag; a consumer can also drive it directly.

`open({ field, caption, selected, onApply })` fetches the values through
`widget.fieldValues(field)` and resolves once the list has rendered. `onApply`
receives the chosen values when the user applies, and is not called at all when
they cancel, press Escape, or click the backdrop.

Three rules are worth knowing, because they are what make a checkbox list behave
like a filter rather than a frozen snapshot:

- **An empty incoming `selected` opens with everything checked.** No restriction
  and "nothing selected" are the same stored state, but they must not look the
  same: a freshly placed filter field would otherwise appear to exclude
  everything.
- **Applying with everything checked emits `[]`, not the full value list.**
  Freezing the set would silently exclude values that appear in the source
  later.
- **Selections the response could not list are preserved.** When a field has
  more distinct values than `FieldValueLimit`, the picker says so and carries
  the unlisted selections through `onApply` untouched, rather than dropping the
  part of the filter it could not display.

**Tümünü seç** and **Temizle** act on what the search is currently showing, the
way a spreadsheet filter does — searching and then selecting all is how a subset
gets picked out of a long list.

### Header filter

Every row and column field's header cell in the table itself carries the same `▼`. It opens the same `PivotFilterPicker` over the same filter entry the Filters zone would — the funnel and the chip are two ways into one filter, not two filters — and the field stays where it is: filtering `Bölge` from its header leaves it a row field and adds no chip to the Filters zone. A funnel whose field is currently restricted is marked (`is-active`).

The control is rendered only where there is something behind it: the renderer draws it when `onFilterRequested` is a function, and the widget supplies that callback only when `allowFiltering` is on and `pivot-filter-picker.js` was loaded. A host that renders through its own `PivotTableRenderer` options gets the same bargain — no callback, no funnel.

#### Where a column field's funnel lives

The row axis had somewhere obvious to put a funnel: its corner cell already names
the field. The column axis did not — a column header reads `2024`, never `Yıl`, and
a funnel on a value cell would read as filtering that one column.

So the column fields get named cells of their own, one per column level, in the
corner block beside the values they head. That pushes the row field names onto a
header row of their own, directly above the body — the layout a spreadsheet uses,
and the reason the header block gained a row:

```
Yıl ▼        | 2024 | 2025 | Genel Toplam
Bölge ▼ | Kategori ▼ |
```

Those cells are drawn only when there is a column field to name **and** a filter
callback to give it — the same bargain the funnel itself makes. A grid with no
column fields, or with filtering off, keeps exactly the header it always had. The
export model is read off the rendered table, so the field names travel into the
`.xlsx` as header rows too.

Nothing else moved: a filter belongs to a field rather than to an area, so the
picker, the engine, the saved view and the request are unchanged — the column
axis simply gained a way in.

One limit remains: in `compact` layout mode the row fields share one header cell,
so only the first of them is reachable from the table.

Because a filter belongs to the field, `PivotLayoutState.move` carries it along: dragging a header-filtered row field into the Filters zone shows the selection it already had, and dragging it back out keeps it. Only `remove` drops a filter.

### Detail modal

Double-clicking a data cell (or choosing **Detayı aç** from its context menu)
opens the source records behind that cell. `PivotWidget` wires this up on its
own: load `pivot-drill-down.js` and `pivot-drill-down-modal.js`, leave
`AllowDrillDown` at its default, and a declarative page gets a working detail
view without writing any JavaScript.

The modal is built on first use, reused afterwards, and disposed with the
widget. It provides a global search box, a per-column value filter, a CSV
export of whatever is currently visible, and a notice when the server truncated
the result at `DrillDownRecordLimit`.

**Columns come from the declared fields.** Every field in the grid's catalog
becomes a detail column, in declaration order, using its `caption` as the header
and its [value format](#value-formats) to render numbers — so the detail table
matches the pivot above it. Field names are matched against the record keys
case-insensitively, because the field is declared `Amount` while ASP.NET Core's
default JSON policy serializes the property as `amount`. A column is
right-aligned when its declared format is numeric or its values are numbers.

Two escape hatches:

- If the detail records share no key with the catalog, every record key becomes
  a column, labelled with the raw key.
- `drillDownModalOptions.columns` replaces the derived list entirely, taking
  `{ key, label, format?, numeric? }` entries where `format` is a function.

```javascript
PivotForge.create("#pivotGrid", {
  fields,
  drillDownModalOptions: {
    columns: [
      { key: "salesPerson", label: "Temsilci" },
      { key: "amount", label: "Tutar", numeric: true,
        format: value => value.toLocaleString("tr-TR") }
    ],
    labels: { title: "Source Records", close: "Close" }
  }
});
```

A consumer that supplies its own `rendererOptions.onCellDoubleClick` keeps it:
the widget declares its handler before merging `rendererOptions`, so bringing
your own detail UI overrides the packaged one rather than fighting it. Setting
`drillDownModal: false` does the same without needing a handler.

Labels default to English, come from the `drillDown` section of a locale pack,
and are overridable per key through `drillDownModalOptions.labels`. `{0}`/`{1}` placeholders in `truncated`,
`summary`, and `columnFilter` are substituted positionally.

### Filter operators

A filter compares its values with an operator. The default, `Equals`, reads them as
the list of values to keep — which is what a filter was before operators existed —
and every other operator reads them as its arguments:

```html
<pivot-filter field="Category" operator="Contains"    values="çim" />
<pivot-filter field="Amount"   operator="Between"     values="100, 5000" />
<pivot-filter field="Note"     operator="Blank" type="Exclude" />
```

| Operator | Arguments | Keeps |
|---|---|---|
| `Equals` | any | values on the list |
| `Contains` | 1 | values holding the argument anywhere |
| `StartsWith` | 1 | values opening with the argument |
| `EndsWith` | 1 | values closing with the argument |
| `Between` | 2 | values between the two, both ends included |
| `GreaterThan` | 1 | values above the argument |
| `LessThan` | 1 | values below the argument |
| `Blank` | 0 | values that are blank |

There is no "does not contain" or "is not blank", because `type="Exclude"` negates
whichever operator is used: every operator arrives with its opposite attached.

Text comparisons ignore case and collate in the resolved culture — a filter is
typed by a person. A range compares as numbers when both sides read as numbers and
as dates when both read as dates, so `Between 100 and 5000` does not put 100 after
2000; anything else collates as text. Everything is compared against the value's
display text, which is what the header shows and the picker lists — so on a grouped
level a condition applies to the month name rather than to the timestamp behind it.

A condition with fewer arguments than its operator reads **restricts nothing**, the
way an empty value list already did: that is what a range looks like while it is
being typed into. A *declaration* is checked instead — `<pivot-filter
operator="Between" values="100" />` throws — because a typo in markup is a bug
rather than an unfinished input box.

In the browser, `PivotFilterPicker` shows a condition row above its value list.
Choosing anything but "is one of" replaces the list with the operator's argument
boxes, since the two are answers to the same question; Apply stays disabled until
the condition has what it reads. `widget.setFilter(field, values, mode, operator)`
and `layoutState.setFilterOperator(field, operator)` are the programmatic paths,
and a filter chip in the designer's Filters zone names its condition instead of
counting values.

#### Ranges over dates

`Between`, `GreaterThan` and `LessThan` are the operators that put a value in
order rather than matching its text, and they are the only ones for which the kind
of value matters. When a field holds dates, the picker hands the reader a calendar
(`<input type="date">`) instead of a text box.

That is not a convenience. A calendar returns `2026-06-05`, and an invariant ISO
date is the one spelling both sides of the comparison read as a date — a Turkish
reader typing `05.06.2026` into a text box gets a *text* comparison and a range
that silently means nothing like what they asked for.

Which fields get one is read off the values themselves rather than declared,
because the engine decides the same way and the two have to agree:

| The values read as | Engine compares as | Control |
|---|---|---|
| `06/05/2026 00:00:00` | dates | calendar |
| `2024` | numbers | text box |
| `Haziran` | collated text | text box |

A number is tried before a date, which is what keeps a `Year` level a number
rather than a year — and it settles the grouped levels for free: a `Month` level
reads `Haziran` and a `DayOfWeek` level reads `Pazartesi`, neither of which is a
date to either side. So the calendar appears exactly where a date comparison will
actually happen.

Two details worth knowing:

- **An argument a calendar cannot hold is kept.** A range typed before this
  existed, or written by hand into a stored view, keeps its text box rather than
  being erased by a control that cannot display it.
- **Both ends are compared as instants.** A source value carrying a time of day
  sits after that day's midnight, so `Between 2026-06-01 and 2026-06-05` leaves
  out the afternoon of the fifth. Naming the next day is the way to include it.

A comparison costs one `/field-values` request when the picker opens straight
into it — the list is not shown, only consulted. A text condition asks for
nothing.

### Date grouping

`group-interval` collapses a date column into header groups, so a year over
month hierarchy needs no second source column:

```html
<pivot-field field="OrderDate" caption="Yıl"    area="Row"    group-interval="Year" />
<pivot-field field="OrderDate" caption="Ay"     area="Row"    group-interval="Month" />
<pivot-field field="OrderDate" caption="Çeyrek" area="Column" group-interval="Quarter" />
```

The same column is declared three times, which is the point: a level is
identified by its field **and** its interval, not by the field alone. That
identity is spelled `OrderDate:month` and is what a sort, a filter, a header
funnel and a saved layout all name. `PivotFieldBuilder.GroupInterval(...)` is
the fluent equivalent; `PivotRequest.Rows`/`Columns` carry `PivotFieldRef`
values, and a plain field name still converts to one on its own.

| Interval | Header reads | Ordered by |
|---|---|---|
| `Year` | `2026` | the year |
| `Quarter` | `Q1` … `Q4` | the quarter |
| `Month` | the month name in the resolved culture | the month number |
| `Day` | the day of the month, as a number | the number |
| `DayOfWeek` | the weekday name in the resolved culture | the culture's first weekday |

Labelling and ordering are one subject: a month reads as a name and sorts as a
number, or a pivot lists April before August. This is also the one case where
the column axis does **not** keep the order the data arrived in — the engine
produced those labels itself, so there is no query intent left to preserve.

Grouping happens where the header value is read, which is why a filter, a
drill-down and the value picker all collapse the same way: a filter set from a
month header holds month names, and comparing those against raw timestamps
would match nothing. `PivotEngine.DistinctValues(records, field, interval)`
lists the groups rather than the dates behind them.

A value that does not convert to a date keeps its own text and sorts after
every group, so a column that is not a date under a date interval is visible as
a mistake rather than silently blank. Text dates are parsed in the resolved
culture first and invariant second, so a column loaded from CSV or JSON groups
like one loaded as `DateTime`. `group-interval` is not valid on a `Data` field:
a measure is aggregated rather than grouped.

### Localization

Culture is resolved separately on each side, because the two answer different
questions.

**Server-side collation** follows `CultureInfo.CurrentCulture`, resolved per
call rather than cached — so an ASP.NET application with request localization
configured sorts each request in that request's culture without wiring anything
up. For a direct `PivotForge.Core` consumer, `new PivotEngine(culture)` pins it.
This is not cosmetic: in Turkish `Ç` is a letter of its own that sorts after
every word starting with `C`, while elsewhere it is a variant of `C` and the
following letters decide — so `Corum` and `Çanakkale` swap places between the
two. The same collation orders the filter picker's value list, which is shown
to a person and therefore sorted the way that person reads.

Deliberately **not** taken from the request payload: a browser claiming a
culture must not be able to change how the server sorts.

**Browser-side number formatting** follows the reader's own locale unless
`culture` is declared. Pin it only when the page must show the same separators
to everyone:

```html
<pivot-grid id="pivotGrid" culture="tr-TR" ...>
```

The detail modal inherits the grid's culture, so it cannot contradict the cell
it was opened from; `drillDownModalOptions.culture` overrides that on purpose.

**On-screen text** is English by default, in all four components that show any:
the rendered grid, the field designer, the filter value picker and the detail
modal. A **locale pack** replaces the lot in one move. Reference the pack on the
page and the grid finds it by name:

```html
<script src="~/_content/PivotForge.AspNetCore/js/pivot-locale-tr.js"></script>
```

The name is not usually declared. `<pivot-grid>` derives it from
`CultureInfo.CurrentUICulture` — a two-letter code, so `tr-TR` asks for `tr` —
which means an application with request localization configured is localized
without any grid saying so. Declare `locale` to pin one regardless of the
request, and `locale="en"` to pin the built-in English:

```html
<pivot-grid id="pivotGrid" locale="tr" ...>
```

`en` names the built-in defaults rather than a pack, so it loads nothing. A name
whose pack is not on the page leaves the text English and warns in the browser
console: a missing translation file is not a reason to fail a page.

The shipped packs live in `_content/PivotForge.AspNetCore/js/`:

| Pack | Language |
|---|---|
| `pivot-locale-tr.js` | Turkish |

A pack is an ordinary object, so a page can supply its own — `locale` accepts
one directly — with four optional sections:

| Section | Reaches |
|---|---|
| `table` | A partial `rendererOptions`: `texts`, and presentation strings that live outside it such as `totalText` and `ariaLabel` |
| `designer` | `PivotFieldDesigner` labels |
| `filterPicker` | `PivotFilterPicker` labels |
| `drillDown` | `PivotDrillDownModal` labels |

Anything the page declares wins over the pack, key by key: overriding one string
costs none of the others. `rendererOptions.texts` overrides the grid's,
`designerLabels` the designer's, and `designerLabels.filterPicker` the value
picker's. `{0}` placeholders are substituted positionally.

```js
PivotForge.create("#pivotGrid", {
  locale: "tr",
  designerLabels: { row: "Satır Alanları" },
  rendererOptions: { texts: { noData: "Kayıt bulunamadı" } }
});
```

Still open: `IStringLocalizer` integration on the .NET side, so a pack can be
generated from resource files rather than shipped as a script.

### Accessibility

The rendered table declares **`role="grid"`**, which is a claim about behaviour
as much as about markup: a grid promises arrow-key navigation, `Enter` to
activate, and a single tab stop, and the renderer has shipped all of that since
before the role was declared (`pivot-table.js`). Declaring it is what makes the
behaviour discoverable — and what makes the `aria-selected` written on rows and
cells mean anything. On a plain table `aria-selected` is an unsupported
attribute that screen readers drop, so selection used to be visible and nothing
more.

Because the role **replaces** native table semantics rather than adding to them,
every row and cell carries its own role: `rowgroup` on `thead`/`tbody`, `row` on
`tr`, `columnheader` on head cells, `rowheader` on row labels, and `gridcell` on
values. A cell left without one is a hole in the accessibility tree, not a
fallback — which is why they are all built through one factory (`createCell`).

- **Name the grid.** `aria-label` defaults to `Pivot tablosu`; a page with two
  pivots needs two different names.
- **`aria-rowcount` / `aria-rowindex` state the real size.** A screen reader
  otherwise counts the rows in the DOM, which under virtual scrolling is a page:
  "row 3 of 12" for a five-thousand-row pivot. Spacer rows claim no position,
  and the grand total is indexed against the whole table rather than the page it
  trails.
- **`aria-sort`** on a sortable header, because the `▲`/`▼` glyph is
  `aria-hidden`.
- **Collapse toggles carry `aria-expanded` and a name.** Their entire content is
  a `▸`/`▾` glyph, so without a name a screen reader announces "button" and
  stops there.
- **Designer zones are named groups.** Each zone body is a `role="group"`
  labelled by its heading, so a chip is announced as "Satırlar, Bölge, düğme"
  rather than "Bölge, düğme" — the zone is the only part that says where the
  field currently is. Heading ids are namespaced per designer, so two panels on
  one page do not collide.

Still open: an **adaptive mobile layout**. The packaged `@media (max-width:
720px)` rules cover the demo's page layout, not the designer zones or the filter
picker.

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
| `POST /pivotforge/field-values` | Return the distinct values a filter on one field can accept |
| `POST /pivotforge/excel` | Convert a renderer export model into an `.xlsx` response |

A missing or expired large-data session returns HTTP `410 Gone`. Invalid pivot, paging, drill-down, field-values, and Excel requests return HTTP `400 Bad Request`. Request cancellation propagates through the provider and Core calculation.

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
| `AllowedFields` | empty (every field readable) |
| `CacheSlidingExpiration` | 5 minutes |
| `MinimumLargeDataSourceRowCount` | 1,000 |
| `MaximumSourceRowCount` | 500,000 |
| `MinimumPageSize` | 10 |
| `MaximumPageSize` | 200 |
| `DrillDownRecordLimit` | 1,000 |
| `FieldValueLimit` | 1,000 |
| `MaximumExcelRows` | 20,000 |
| `MaximumExcelCells` | 200,000 |

Options are validated when resolved. Values must be positive and minimums cannot exceed their corresponding maximums.

### Restricting which fields the endpoints may read

By default the endpoints read whatever field the browser names. That is convenient
while a report is being built and wrong once the record type carries anything the
report does not: a request naming `PasswordHash` as a row field gets it as a header,
and a drill-down returns the whole source record whether the grid showed it or not.

`AllowedFields` turns that around:

```csharp
builder.Services.AddPivotForge<Sale>(
    LoadSalesAsync,
    options => options.AllowedFields.UnionWith(
        ["Region", "Category", "OrderDate", "Amount", "Quantity"]));
```

With a list declared:

- `/pivot`, `/large/start`, `/drill-down`, and `/field-values` refuse a request that
  names anything else, in rows, columns, values, or filters. The refusal is a `400`
  that does not name the field, so it cannot be used to ask what the record type holds.
- `/drill-down` returns only the listed fields rather than whole records.

Names are compared without regard to case, matching how the record readers resolve
them. An empty list — the default — keeps the previous behaviour, so nothing changes
for an application that does not declare one.

Sorts are not checked: a sort names a header level, which has to be among the rows or
columns to mean anything, and those are checked.

## Production Notes

- Scope the data provider to the authenticated tenant and user.
- Apply authorization to the endpoint group.
- Add rate limits for large calculations and exports.
- Keep `MaximumSourceRowCount` and export limits appropriate for host memory.
- Use a distributed implementation of `IPivotForgeResultCache` when sessions must survive multiple application instances. The included implementation is process-local.
