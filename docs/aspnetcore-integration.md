# ASP.NET Core Integration

`PivotForge.AspNetCore` is a Razor Class Library targeting `net8.0` and `net10.0` that packages browser assets, typed data-provider registration, minimal API endpoints, large-result caching, drill-down, and Excel export.

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
<script src="/_content/PivotForge.AspNetCore/js/pivot-conditional-panel.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-view-storage.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-drill-down.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-drill-down-modal.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-virtual-data-source.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-chart.js"></script>

<!-- Optional: a grid loading from a DevExtreme.AspNet.Data backend (RemoteStore). -->
<script src="/_content/PivotForge.AspNetCore/js/pivot-result-assembler.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-remote-store.js"></script>

<!-- Optional: a grid reading an OLAP cube over XMLA (XmlaStore). -->
<script src="/_content/PivotForge.AspNetCore/js/pivot-result-assembler.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-xmla-store.js"></script>

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
- `PivotConditionalPanel`
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
| `data` | Aggregated as a pivot value. At least one `data` field is required, except on a grid that [discovers its fields](#discovering-fields). |
| `filter` | Exposed for filtering without appearing in the row/column layout. |
| `available` | Declared for the [field designer](#field-designer)'s catalog without being placed in the layout. Not used outside a designer. |

Field properties and their defaults (JavaScript field object shape; `PivotFieldBuilder` exposes the same properties as fluent methods):

| Property | Default | Notes |
| --- | --- | --- |
| `dataField` | — | Required, non-empty. |
| `area` | `"data"` | One of `row`, `column`, `data`, `filter`, `available`. |
| `caption` | the `dataField` in title case | Display label. Undeclared, it is made as DevExtreme makes it: the data field split at camelCase boundaries and at `_ - .`, each word capitalised, with the interval for a grouped level and the summary type for a measure that declares one — `netAmount` summed reads `Net Amount (Sum)`, `OrderDate` by year `Order Date Year`. An acronym stays as written (`orderID` → `Order ID`). `PivotForge.PivotRequestBuilder.titleize(text)` is the same rule. |
| `role` | inferred from `area` | One of `dimension`, `measure`. **Required** when `area` is `available`, because there is no placement to infer it from. Elsewhere it is inferred (`data` → `measure`, everything else → `dimension`); an explicit `role` that contradicts its `area` — e.g., `measure` outside `data` — is a validation error. See [role rules](#field-designer). |
| `aggregation` | `"sum"` (only on `data` fields) | One of `sum`, `count`, `average`, `min`, `max`, `countDistinct`, `median`, `variance`, `standardDeviation`, `variancePopulation`, `standardDeviationPopulation`, `first`, `last`. Setting `aggregation` on a non-`data` field is a validation error. |
| `showAs` | `"normal"` (only on `data` fields) | One of `normal`, `percentOfRowTotal`, `percentOfColumnTotal`, `percentOfGrandTotal`, `differenceFromPrevious`, `percentDifferenceFromPrevious`, `runningTotal`, `percentOfParentRowTotal`, `percentOfParentColumnTotal` (a value's share of its parent group on that axis — a city's share of its region). A percent mode on a field with no declared `format` is drawn as a percentage (`18.25%`) and exported as `0.00%`, as DevExtreme gives a percent display mode a percent format. Setting `showAs` on a non-`data` field is a validation error. |
| `runningTotal` | — (only on `data` fields) | `"row"` (along each row) or `"column"` (down each column), DevExtreme's `runningTotal`; `running-total="Row\|Column"` on `<pivot-field>`. Applied after `showAs` and after sorting, so `percentOfParentRowTotal` with `"column"` is a cumulative share. A subtotal accumulates among its own level; the totals it runs towards stay as they are; `allowCrossGroupCalculation: false` starts it again in each parent group. The designer's value settings carry it as **Running total**. |
| `format` | `null` | Number formatting for a `data` field's values: `{ type, decimals, useGrouping, currency }`, where `type` is `"number"` (default), `"currency"`, or `"percent"`, `decimals` is the fraction-digit count from 0 to 6 (default `2`), `useGrouping` toggles the thousands separator (default `true`), and `currency` is an ISO code used when `type` is `"currency"` (default `"TRY"`). Values are rendered with `Intl.NumberFormat` in the reader's own locale unless the grid declares a `culture` — see [Localization](#localization). Declared from C# with `FormatType`/`FormatDecimals`/`FormatGrouping`/`FormatCurrency`, or from markup with `format-type`/`format-decimals`/`format-grouping`/`format-currency`. Setting a format on a non-`data` field is a validation error. Three more members shape the text: `compact: true` writes the culture's short form (`1,25 Mn`, `3 B`, `1.25M`), `zeroText` is shown in place of a value that is exactly zero (`"—"`), and `negative: "parentheses"` writes a negative number as `(1.250)` instead of `-1.250` (`"minus"`, the default). From C#: `FormatCompact(bool)`, `FormatZeroText(string)`, `FormatNegative(PivotNegativeFormat)`; from markup: `format-compact`, `format-zero-text`, `format-negative="Minus\|Parentheses"`. The Excel export carries the zero text and the parentheses as number-format sections, so its cells stay numbers; a short form has no culture-neutral Excel pattern, so the workbook keeps the full figure. The designer's format section offers short numbers and parentheses as switches. |
| `customizeText` | `null` | Only on `data` fields (and `available` measures). A function, or the name of one on the page (`"app.pivot.amountText"`, resolved when a cell is drawn like an event handler, so it may be defined further down the page), that has the last word on each value's text. It is called with `{ value, valueText, valueKey }`, after the format; what it returns is shown, and `null` or `undefined` keeps `valueText`. From C#: `CustomizeText(string)`; from markup: `customize-text`. The Excel export keeps the number and its format, not this text; the CSV export writes what the grid shows. |
| `allowCrossGroupCalculation` | `true` | Only on `data` fields. Whether `showAs: "runningTotal"` and the two "previous" comparisons walk the whole row (the default, as before) or start afresh at each outer column group: with Year and Quarter on the columns, `false` starts the running total again every year and gives each year's first quarter nothing to compare with. The group is the last column level's parent, so with Year, Quarter and Month it starts again every quarter. A single column level is one group either way. This follows DevExtreme's option of the same name, whose default is the opposite. From C#: `AllowCrossGroupCalculation(bool)`; from markup: `allow-cross-group-calculation`; in the engine: `PivotValueDefinition.AllowCrossGroupCalculation`. |
| `displayFolder` | `null` | Valid in every area. The folder the field is listed under in the designer's field list, such as `"Sales"`: fields without one come first, then a heading per folder, in the order the catalog first names it, that opens and closes. A search opens every folder so a match is never hidden. One level only; the name is not split. From C#: `DisplayFolder(string)`; from markup: `display-folder`. |
| `groupName` | `null` | Makes the field part of a hierarchy, DevExtreme's `groupName`. A field with `groupName` and neither `groupIndex` nor `groupInterval` is the group itself; one with `groupIndex` is a level of it. See [Field groups](#field-groups). From C#: `GroupName(string)`; from markup: `group-name`. |
| `groupIndex` | the next free level | A level's place in its group, a whole number from 0. A level with `groupName` and `groupInterval` but no index takes the next one. From C#: `GroupIndex(int)`; from markup: `group-index`. |
| `visible` | `true` | `false` configures a field without including it in the rendered request. |
| `expanded` | `true` | Only on `row` fields. `false` collapses this level's groups at the grid's **first** render; after that the state belongs to the user, and a restored `state-storing` view wins. Declaring it on the deepest row field does nothing — that level's rows are the detail rows and have no groups. |
| `showTotals` | `true` | Only on `row` and `column` fields. On a row field, `false` leaves the group header in place without its sums, which is the same shape the grid uses when `subtotals` is off entirely — so a deep hierarchy can total the levels worth totalling and nowhere else. On a column field, `false` drops the total column after each of its groups. The grid-wide `subtotals="false"` / `column-subtotals="false"` still win. |
| `showGrandTotals` | `true` | Only on `data` fields (and on `available` fields whose `role` is `measure`). `false` removes this value's column from the grand total block on the right; the other values keep theirs. The grand total row along the bottom stays, because its cells total the grid's columns, until every value has opted out — then it goes too. This follows DevExtreme's `showGrandTotals`. The engine still computes the total, so `percentOfGrandTotal` is unaffected. The grid-wide `show-row-grand-totals="false"` / `show-column-grand-totals="false"` still win. |
| `allowSorting` | `true` | Valid in every area, so the field keeps it wherever it is dragged. `false` takes away a row or column field's own sort arrow, and a data field's value-header sort (sorting rows by that measure). The grid-wide `allowSorting` still decides first: a field can only take its own controls away. |
| `allowFiltering` | `true` | Valid in every area. `false` takes away the field's header funnel and the designer's filter control on its chip. A filter declared in the markup still applies. |
| `width` | `null` | Pixels, greater than zero. A row field sizes its header column (in the compact and tree layouts, where the row fields share one column, the widest declaration sizes it); a data field sizes every column of its values, grand total column included. A column the reader resizes keeps the reader's width. |
| `wordWrap` | `null` | `true` lets the field's labels wrap onto more lines instead of ending in an ellipsis: a row field's headers, a column field's headers, a data field's value headers. The row grows to hold them. |

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
`allow-excel-export`, `load-panel`, `toolbar`, `toolbar-items`, `auto-load`, `large-data`, `page-size`,
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
| `layout-mode` | `LayoutMode(PivotGridLayoutMode)` | `Tabular` | `Tabular` gives each row field its own column; `Compact` indents them into one; `Tree` draws that column as a tree, as DevExtreme's `rowHeaderLayout: "tree"` — each group row is the parent node, named for its group (`Ege`, not `Ege Total`) and carrying its totals, the header names the levels (`Bölge / Kategori`), and guide lines run down to the children. |
| `totals-position` | `TotalsPosition(PivotTotalsPosition)` | `Before` | Where a group's subtotal row goes. `Before` draws it above the group's rows, as the group's own header with the toggle (DevExtreme's `showTotalsPrior: "rows"`). `After` draws it below them, as Excel lays a report out: a heading row with the toggle opens the group, its cells left blank, and the total row closes it. A collapsed group is its total row alone either way. Works in every layout. |
| `values-position` | `ValuesPosition(PivotValuesPosition)` | `Columns` | Which axis several values are drawn along (DevExtreme's `dataFieldArea`). `Rows` draws one row per value under every row header — totals and the grand total included — with the row headers stretched over the block and a **Values** column naming each row; the column axis then carries one value slot and no value-header row. With a single value nothing changes. Excel/CSV export, selection, heatmap and value bars follow the layout. With a field designer the reader moves it with the **Σ Values** chip (shown at the end of Rows or Columns while there are two or more values); the move is part of the layout, kept by `state-storing` and in report files when it differs from the declaration. |
| `virtual-columns` / `virtual-column-width` | `VirtualColumns(bool, int?)` | `false` / `100` | Draws only the columns around what the grid shows (DevExtreme's virtual scrolling, columns): one page of them either side of the view, with a spacer before and after keeping the table its full width; scrolling sideways redraws the window. The spacers are measured from the columns actually drawn, so `virtual-column-width` is only the first guess. Selection, the arrow keys (they walk past the window's edge), column widths and sorting work as before; Excel, CSV and printing get every column. Independent of `large-data`, which pages the rows. |
| `heatmap` | `Heatmap(PivotHeatmapMode)` | `None` | Shades the value cells on a colour scale from the smallest value to the largest. `Table` draws one scale per data field, `Rows` one per row, `Columns` one per column. Totals and subtotals are not shaded, and a conditional formatting rule's colour wins on the cells it matches. The colour is the `--pt-heat-color` CSS variable (a `#rrggbb` value, so the Excel export can reproduce it). The shades go into the Excel export too. In large-data mode each page carries the whole result's value ranges, so a value is shaded the same on every page. |
| `value-bars` | `ValueBars(PivotValueBarsMode)` | `None` | Draws a bar behind each value cell, as long as the value's share of its scale — a spreadsheet's data bars, PivotTable.js' table bar chart. `Table`, `Rows` and `Columns` group the scale as `heatmap` does, each data field on its own. The bars of a scale share an axis at zero: all-positive values grow from the left, all-negative ones from the right, and a scale holding both puts zero between them, negatives to its left in their own colour. Totals and subtotals get no bar. The colours are the `--pt-bar-color` and `--pt-bar-negative-color` CSS variables. It combines with `heatmap` and with conditional formatting, whose colour stays beneath the bar; it prints, but the Excel export leaves it out. In large-data mode the scale is the whole result's, as for the heatmap. JavaScript: `rendererOptions.valueBars: "table" \| "rows" \| "columns"`. |
| `chart` | `Chart(PivotChartType, PivotChartPosition, int?)` | `None` | Draws a chart of the pivot beside the grid: `Column`, `StackedColumn`, `Bar` or `Line`; needs `pivot-chart.js`. `chart-position` (`Top`, `Bottom`), `chart-height` (pixels, at least 120) and `chart-visible` (`false` starts it hidden) go with it. Written to the widget's `chart` option, not `rendererOptions`. See [Pivot chart](#pivot-chart). |
| `context-menu` | `ContextMenu(bool)` | `true` | The right-click cell menu, and a group header's menu: right-clicking a row header above the innermost level, or a column header that folds (or pressing the menu key / Shift+F10 on a row header), offers **Expand all {field}** / **Collapse all {field}**, which open or close every group of that level at once (DevExtreme's `allowExpandAll`). An entry with nothing to do is disabled. `false` turns both off. The renderer's `expandLevel(axis, level)` / `collapseLevel(axis, level)` do the same from code. |
| `subtotals` | `Subtotals(bool)` | `true` | Subtotal rows. |
| `column-subtotals` | `ColumnSubtotals(bool)` | `true` | Subtotal columns: a total column after each group of an outer column field. |
| `show-row-grand-totals` | `ShowRowGrandTotals(bool)` | `true` | The grand total row along the bottom. Named, as in DevExtreme, after the area its header sits in. `show-grand-total` / `ShowGrandTotal(bool)` is its earlier name and still works; setting both to different values is an error. |
| `show-column-grand-totals` | `ShowColumnGrandTotals(bool)` | `true` | The grand total column on the right. Sorting by that column goes with it. |
| `repeat-row-labels` | `RepeatRowLabels(bool)` | `false` | Repeats a row label on every row it spans instead of only the first. |
| `show-borders` | `ShowBorders(bool)` | unset | `true` closes the grid with an outer frame; `false` takes the lines between body cells away and keeps the header's. Unset keeps the default lines between cells. |
| `min-column-width` | `MinColumnWidth(int)` | `72` | Narrowest a column may be rendered or resized to, in pixels. Must be positive. |
| `max-column-width` | `MaxColumnWidth(int)` | `420` | Widest a column may be, in pixels. Must be positive. |
| `empty-text` | `EmptyText(string)` | `-` | Shown in a cell with no value. May be empty to render nothing. |
| `total-text` | `TotalText(string)` | `Toplam` | Caption for total rows and columns. Must not be blank. |
| `aria-label` | `AriaLabel(string)` | `Pivot tablosu` | Accessible name announced for the grid. Must not be blank. Give two pivots on one page two different names, or a screen reader cannot tell them apart. |
| `culture` | `Culture(string)` | the reader's own locale | BCP 47 tag used to format numbers in the browser. Must not be blank. Server-side collation is separate — see [Localization](#localization). |
| `hide-empty-summary-cells` | `HideEmptySummaryCells(bool)` | `false` | Drops rows and columns holding no values at all. The column axis is the product of its levels, so sparse data leaves whole columns that never occurred; a row is empty when its values all aggregated to nothing. Dropped in the engine, so paging, Excel export and drill-down all agree on which rows exist. |
| `show-relevant-values` | `ShowRelevantValues(bool)` | `false` | A filter picker lists only the values the **other** fields' filters leave (DevExtreme's `headerFilter.showRelevantValues`). The field's own filter never narrows its list, so a value unchecked there can still be checked again. The other filters travel as `filters` on `/field-values` and answer to `AllowedFields`. |
| `defer-layout-update` | `DeferLayoutUpdate(bool)` | undeclared | Excel's **Defer layout update** box at the foot of the field designer (DevExtreme's `applyChangesMode: "onDemand"`). While ticked, a designer edit changes only the panel; the grid refreshes once, with every held-back edit, when the reader presses **Update** or clears the box. The value is how the box starts; undeclared, there is no box and edits apply at once. A value filter set from field settings has its own Apply and is not held back. |
| `rtl-enabled` | `RtlEnabled(bool)` | undeclared | Right to left (DevExtreme's `rtlEnabled`). Undeclared, the grid **follows the page**: the stylesheet is written in logical properties, so a site whose `<html>` carries `dir="rtl"` gets a mirrored grid without saying anything. `true` / `false` pins it, writing `dir` on the grid, its toolbar and its field designer; the menus, pickers and modals they open take the grid's direction rather than the page's. The row headers freeze on the right, the horizontal arrow keys move the way they point (in the grid and for a grabbed designer chip), a column widens when its handle is dragged leftwards, dropdowns align to their anchor's right edge, and an Excel export is a right-to-left sheet (`PivotExcelDocument.RightToLeft`) with headers aligned right and numbers left. The `exporting` payload carries `rtlEnabled`. The chart does not mirror. |
| `locale` | `Locale(string)` | the request's UI culture | Name of the locale pack supplying every on-screen string. Must not be blank. `en` is the built-in English and loads nothing — see [Localization](#localization). |

`selection-mode`, `layout-mode`, `heatmap`, `value-bars`, `chart`, `chart-position` and `totals-position` are non-nullable enums so Razor accepts the
unqualified member name; whether the attribute was written is recovered from
`TagHelperContext.AllAttributes`, so an unwritten attribute is not mistaken for a
deliberate `Single`/`Tabular`/`None`/`Before`.

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
| `pivot-value-filter` | `ValueFilter(string, PivotValueFilterOperator, decimal, decimal?, string?)` | Repeatable, one per row level. Keeps the groups whose value meets a condition — see [Value filters](#value-filters). |
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
aggregations, number formats, row sort and conditional formatting rules — and
restores it on the next load. It is off by default; persistence is something a
page opts into.

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

`Custom` hands the state to the page instead, DevExtreme's `customLoad` /
`customSave` — to keep it in a user profile on the server, for instance:

```cshtml
<pivot-grid id="pivotGrid" state-storing="Custom"
            state-custom-load="app.state.load" state-custom-save="app.state.save"
            state-saving-timeout="2000">
```

`load` is called once when the grid starts and returns the state, its JSON text,
or a promise of either; with a promise the first load waits for it, and a state
the fields no longer fit is left aside as a stored one would be. `save` receives
the state object after each change and `null` when the state is cleared. No
`state-key` is needed. `state-saving-timeout` (`StateSavingTimeout(ms)`, any
storage) makes a save wait for the next change, so a burst of edits is one write;
a waiting save is written at once when the page is hidden or the grid disposed.
In JavaScript: `stateStoring: "custom"`, `customLoad`, `customSave` (functions or
their names) and `stateSavingTimeout`.

What is stored is a preference, never a contract. **A stored payload can never
break the page:** unparseable JSON, a payload from another version, a layout the
field catalog can no longer honour (a field that was removed, or one whose role
no longer allows where it sat) and a filter naming a field that no longer exists
are each discarded, and the grid falls back to what it declared. A stored layout
that was rejected takes its filters down with it, rather than leaving the grid
filtering by a layout it just refused. A stored conditional rule the renderer
could not act on — an unknown comparison or highlight, a missing threshold, a
`between` without its second bound — is dropped the same way, one rule at a
time, so one unreadable rule never costs the reader the rest of them.

A stored rule naming a measure that is not on screen right now is **kept**: it
paints nothing until the reader brings that measure back, which is the behaviour
they saved. And a stored rule list *replaces* the declared ones rather than
joining them — the list that was saved already contained whatever the markup
declared at the time, so adding to it would duplicate every declaration on every
reload, and a rule the reader cleared would reappear on every load with no way
to be rid of it. A page whose declared rules have since changed reaches them
again through `clearState()`.

Persistence works without a field designer too — there is simply no layout to
save, so only the filters, the sort and the rules are.

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
| `on-exporting` | `OnExporting(string)` | `{ format, document, fileName, cancel }` — see below |

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

##### Customizing an export

`exporting` fires before an Excel or CSV file is made — from the toolbar,
`exportToExcel()` or `exportToCsv()` — and covers what DevExtreme splits into
`onExporting` and `customizeCell`. `format` is `"excel"` or `"csv"`;
`document` is the model about to be written, changed **in place**; `fileName`
may be replaced (for Excel it otherwise comes from the server); setting
`cancel = true` makes the export method return `null` and nothing is written.
The handler is synchronous.

Each cell of `document.rows[].cells[]` carries a `source` describing it:
`area` (`"column"` for a header row, `"row"` for a row header, `"data"` for a
value), `rowType`, `rowPath`, `columnPath`, `valueKey` and `value`. `source` is
removed before the document is posted. Besides `text`, `number`,
`numberFormat`, `highlight` and `fillColor`, an Excel cell takes `fontColor`
(`#RRGGBB`) and `bold` (`true`/`false`; left out, headers and totals stay bold
and values do not).

```html
<pivot-grid id="pivotGrid" allow-excel-export="true" on-exporting="colorNegatives">
  <pivot-field field="Amount" area="Data" aggregation="Sum" />
</pivot-grid>

<script>
  function colorNegatives(event) {
    for (const row of event.document.rows) {
      for (const cell of row.cells) {
        if (cell.source.area === "data" && cell.source.value < 0) {
          cell.fontColor = "#DC2626";
        }
      }
    }
    event.fileName = "sales.xlsx";
  }
</script>
```

Anything not listed here still needs `rendererOptions` through
`PivotForge.create`, or the `pivotforge:ready` event — see
[Known limitations](#known-limitations).


`<pivot-field>` attributes are `field` (the source column, required),
`caption`, `area`, `role`, `aggregation`, `show-as`, the seven `format-*`
attributes, `visible`, `area-index`, `sort-order`, `group-interval`, `field-type`,
`allow-sorting`, `allow-filtering`, `width`, `word-wrap`, `display-folder`, and — on
`Row` and `Column` fields — `expanded`, `show-totals`, `sort-by`, `sorting-method` and `sort-by-value-key`, and — on `Data` fields only — `show-grand-totals`,
`show-values`, `show-totals`, `customize-text` and `allow-cross-group-calculation`. `area` defaults to `Data`, matching
`PivotFieldBuilder`.

`selector` names a function registered in `PivotForgeOptions.CustomSelectors` that
works the field's value out from the whole record, DevExtreme's `selector`. The
field groups, filters, lists and sums by what it returns, and `field` may be a name
of the selector's own:

```csharp
options.CustomSelectors["fiscalYear"] = record =>
    ((SalesRecord)record.Source).OrderDate is var date && date.Month >= 10 ? date.Year + 1 : date.Year;
```

```cshtml
<pivot-field field="FiscalYear" area="Column" selector="fiscalYear" />
```

DevExtreme's `selector` is a browser function; here records are read on the server,
so a page names a registered selector and nothing else, and an unknown name is
refused with 400. A selected field is worked out rather than read, so it is not
checked against `AllowedFields` -- the selector, being server code, decides what it
reads. It takes no `expression` or `field-type`. In JavaScript it is
`selector: "fiscalYear"`.

With several values, each one decides which columns it appears in, as DevExtreme's
`showValues`, `showTotals` and `showGrandTotals` on a measure do:
`show-values="false"` leaves the value out of the detail columns, `show-totals="false"`
out of the subtotal columns (and, with `show-values` left out, out of the detail columns
too), and `show-grand-totals="false"` out of the total block on the right. The value
leaves those columns outright, so a block is only as wide as the values it draws:

```cshtml
<pivot-field field="Amount" area="Data" aggregation="Sum" />
<pivot-field field="Quantity" area="Data" aggregation="Sum" show-values="false" />
```

draws Amount in every quarter and Amount and Quantity in each year's total. A kind of
column every value gives up keeps them all, so it never comes out empty. With
`values-position="Rows"` the same settings pick the value rows under detail and
subtotal rows. In JavaScript they are `showValues`, `showTotals` and `showGrandTotals`.

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

`sort-by-value-key` orders a row field's level by a summary value instead of
its labels, inside each parent group. It names a value key (`Field_aggregation`)
and takes its direction from `sort-order`, ascending when absent:

```cshtml
<pivot-field field="Category" area="Row"
             sort-by-value-key="Amount_sum" sort-order="Descending" />
```

An inner level is ordered by its subtotal and the deepest level by its row
total, both as shown after `show-as`. A group with no value sorts first
ascending and last descending, and equal values break on the label in the same
direction. Row fields only. A sort
the reader picks from the cell menu still wins.

`sort-by` (`Value`, `DisplayText`, `None`) is DevExtreme's `sortBy`: what a row
or column level's labels are compared by. `Value`, the default, orders numbers
and dates by value and a grouped month by its place in the year; `DisplayText`
orders the text, so month names run alphabetically; `None` keeps the order the
source yielded the groups in. `sorting-method` names a comparer registered on the
server and replaces `sort-by`; `sort-order` still applies to both, and with
`sort-by-value-key` they break ties between equal summaries:

```csharp
builder.Services.AddPivotForge<SalesRecord>(provider, options =>
    options.CustomSorts["coastalFirst"] = Comparer<string?>.Create(CompareRegions));
```

```cshtml
<pivot-field field="Region" area="Row" sorting-method="coastalFirst" />
<pivot-field field="OrderDate" area="Column" group-interval="Month" sort-by="DisplayText" />
```

DevExtreme's `sortingMethod` is a browser function; here the ordering runs on the
server, so a page can name a registered comparer and nothing else, and a name that
is not registered is refused with 400. In JavaScript the same options are
`sortBy: "value" | "displayText" | "none"` and `sortingMethod: "coastalFirst"`.
Display calculations (difference from previous, `Prev`…) walk the columns in
value order whatever `sort-by` says, but follow a sorting method.

`group-interval` (`Year`, `Quarter`, `Month`, `Day`, `DayOfWeek`) collapses a
date column into header groups — see [Date grouping](#date-grouping) — and
`group-interval="Range"` with `group-size` splits a numeric one into ranges — see
[Numeric ranges](#numeric-ranges).

`field-type` (`String`, `Number`, `Date`; `DataType(PivotDataType)` on the
builder, `dataType` in JavaScript — DevExtreme's `dataType`, renamed because
Razor leaves every `data-` attribute to the page) converts the source column's
values as they are read, for a source that carries everything as text: `Number`
lets `"1250"` be summed and its headers run 9, 10 rather than 10, 9; `Date` lets
`"2026-03-14"` be grouped by month and an unreadable date fall into the blank
group; `String` orders a numeric code as text. A value that does not convert is
blank. The conversion happens in the engine, so aggregation, filters, the value
picker, drill-down and ordering all see the same value; the request carries it
as `dataTypes: { "Amount": "Number" }`, which `AllowedFields` governs like any
other field name. The type belongs to the column, so two levels of one column
cannot declare different types, and a calculated field cannot declare one.

`area`, `role`, `aggregation`, `show-as`, `sort-order`, `group-interval` and `field-type`
bind to the `PivotArea`, `PivotFieldRole`, `PivotAggregation`, `PivotShowAs`,
`PivotSortDirection`, `PivotGroupInterval` and `PivotDataType` enums, so a misspelled value such as `area="Roww"` fails
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
| `allowConditionalFormatting` | `true` | Offers the cell menu's conditional-formatting entry and opens the packaged `PivotConditionalPanel` behind it. Set to `false` to remove the entry. Silently inert when `pivot-conditional-panel.js` was not loaded, in which case the entry is not offered either. |
| `conditionalPanelOptions` | `null` | Passed to the `PivotConditionalPanel` constructor: `labels`, `host`. |
| `loadPanel` | `true` | Draws a "Loading..." panel with a spinner over the grid while a request is out: the first load and every reload a sort, filter or layout change starts. The previous table stays on screen, dimmed, and the container carries `aria-busy="true"` meanwhile. Set to `false` (`load-panel="false"`, `LoadPanel(false)`) to draw your own from the `dataLoading` and `dataLoaded` events. The text is the renderer text `loading` (`rendererOptions.texts.loading`), "Yükleniyor..." in the `tr` locale. |
| `loadPanelDelay` | `300` | Milliseconds a request must run before the panel appears, so a fast answer does not flash it. |
| `toolbar` | `false` | A strip of buttons just above the grid, outside its scroll box. `true` (`toolbar="true"`, `Toolbar(true)`) shows every button the grid can offer: `excel` (only with `allowExcelExport`), `csv`, `print`, `expandAll`, `collapseAll`, `saveReport`, `openReport`, `fullscreen`, `chart` (only with `chart`). **Save report** downloads the view — layout, captions, filters, sorts and conditional rules, what `state-storing` keeps — as a JSON file (`exportReport()`); **Open report** picks such a file and shows its view (`loadReport(fileOrTextOrObject)`), in this grid or another offering the same fields. A file that is not a report, or names fields this grid does not have, is refused with the `error` event and the grid stays as it was. **Full screen** lets the grid and its toolbar fill the browser window — in the page rather than through the Fullscreen API, so the toolbar stays on screen and it works inside an iframe; the button or Escape leaves it. A list (`toolbar-items="Excel,Print"`, `Toolbar(PivotToolbarItem.Excel, PivotToolbarItem.Print)`, `["excel", "print"]`) picks the buttons and their order; an unknown name is an error, and `toolbar="false"` beside `toolbar-items` is a contradiction. Excel and Print title the file and the page with the grid's `aria-label`. A failure is raised as the `error` event. The texts are the renderer texts `toolbar` (the strip's accessible name), `toolbarExcel`, `toolbarCsv`, `toolbarPrint`, `toolbarExpandAll`, `toolbarCollapseAll`, `toolbarSaveReport`, `toolbarOpenReport`, `toolbarFullscreen` and `toolbarExitFullscreen`, translated in the `tr` locale. Printing hides the strip. |
| `chart` | `null` | A chart of the pivot beside the grid; needs `pivot-chart.js`. `true`, a type name, or `{ type, position, height, valueKey }`. See [Pivot chart](#pivot-chart). |
| `stateStoring` | `null` | `"local"`, `"session"`, `"custom"` (with `customLoad` / `customSave`), or `null`. See [State persistence](#state-persistence). Any other value throws. |
| `stateKey` | `null` | Names the storage entry. Falls back to the container's `id`; with neither, nothing is persisted. |
| `store` | `null` | `{ type: "remote", loadUrl \| load, headers, onBeforeSend, limit }` loads from a DevExtreme.AspNet.Data backend instead of the PivotForge endpoints. See [Remote data (RemoteStore)](#remote-data-remotestore). `{ type: "xmla", url, catalog, cube, headers, beforeSend, localeIdentifier, limit }` reads an OLAP cube. See [OLAP data (XmlaStore)](#olap-data-xmlastore). |

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
| `addConditionalRule(rule)` | Appends a conditional formatting rule, redraws, and persists. No request is made: a rule decides how a number is painted, never which numbers there are. Throws when the rule is one the renderer could not act on — no `valueKey`, an unknown operator or color, a non-finite threshold, or `between` without its second bound. |
| `clearConditionalRules(valueKey = null)` | Drops the rules on one measure, or every rule when called with no argument, then redraws and persists. |
| `setConditionalRules(rules)` | Replaces the whole list, redraws and persists. Unlike `addConditionalRule` it *drops* what it cannot use rather than throwing, because this is what restores a saved view. |
| `saveState()` / `clearState()` / `readState()` | Write, forget, and read the persisted state by hand. All three return `false`/`null` rather than throwing when persistence is off or storage is unavailable. |
| `fieldValues(field)` | Returns `{ field, values, totalCount, truncated, limit }`: the distinct values a filter on `field` can accept, in value order. Deliberately unaffected by the pivot layout and by the filters already applied — a list narrowed by the current filter could never offer back a value the user had excluded. Throws if `allowFiltering` is `false`. |
| `exportToCsv(options)` | Returns `{ blob, fileName }` for the visible grid. **Synchronous**, unlike `exportToExcel`: the file is built from the table already on screen, so no request is made — and for the same reason there is no `allowCsvExport`, since there is no endpoint to gate and nothing in the file the reader cannot already see. Options: `delimiter` (default `","`), `values` (`"text"`, the default, keeps the grid's formatting; `"raw"` writes the invariant numbers behind it), `fileName`, plus anything `getExcelExportModel` accepts. Throws for the same two reasons `exportToExcel` does. |
| `print(options)` | Prints this grid and nothing else on the page: every sibling of the grid and of its ancestors is hidden for the length of the print and put back on `afterprint`. The stylesheet's `@media print` prints the whole table rather than its scroll window, repeats the column headers on every sheet, drops the controls and the selection, and keeps heatmap and conditional colours. The browser's "Save as PDF" turns the same into a PDF. Options: `title` and `subtitle`, printed above the table. In large-data mode it prints the loaded page of rows. Throws when nothing has been rendered yet. `PivotForge.print(element, options)` does the same for any element. A plain Ctrl+P gets the same table layout, alongside the rest of the page. |
| `exportToExcel(options)` | Returns `{ blob, fileName }`, not a bare blob. `fileName` comes from the server's `Content-Disposition` header and is `null` when the header is absent or unparseable. Posts the *renderer's* current export model (`getExcelExportModel`), so it throws with a clear message if the widget has no renderer (`renderImpl` was used) or if nothing has been rendered yet. Throws if `allowExcelExport` is `false`. |
| `loadPage(offset)` | Loads a page from an active large-data session (see the limitation below). Throws if `largeData` is disabled or no session is active. Retries once, transparently, after an expired (`410`) session is restarted. On an XMLA grid it reads the page from the cube ([Paging](#paging-largedata)). |
| `showChart(visible)` | Shows or hides the chart, as the toolbar's chart button does, and persists the choice; with no argument it toggles. A shown chart is drawn from the latest result. Throws when the grid has no chart. |
| `setChart({ type, valueKey })` | Switches the chart's type or charted value, as the reader's own buttons do, and persists the choice. Throws when the grid has no chart or the type is unknown. |
| `getState()` | Returns a snapshot: `{ fields, request, result, error, loading, filters, rowSort, conditionalRules, sessionId, totalRowCount }`. |
| `dispose()` | Aborts any in-flight request, detaches all `on()` handlers, empties the container, and — when the widget built a designer — calls `widget.designer.dispose()` too. After disposal, any method that would issue a network request or trigger a refresh (`refresh`, `sortBy`, `setFilter`, `clearFilters`, `updateFields`, `update`, `drillDown`, `loadPage`, `exportToExcel`) throws; `getState()` remains safe to call for a final snapshot. |

### Events

Register handlers with `widget.on(eventName, handler)`, which returns an unsubscribe function.

| Event | Payload | Fires |
| --- | --- | --- |
| `dataLoading` | `{ request }` | Before each request is sent. |
| `dataLoaded` | `{ result }` | After a request succeeds and the result has been rendered. |
| `error` | the `Error` | When a request fails (network or server-side), after it is shown next to the table. |
| `cellPrepared` | `{ area, cell, rowIndex, columnIndex, cellElement }` | For every drawn cell after each draw, while someone listens through `on()`, `events` or `rendererOptions` (DevExtreme's `onCellPrepared`). A class or text put on `cellElement` stays, and an export reads that text. |
| `cellClick` | the same, with `event` and `cancel` | Before a click selects the cell or folds a group; `cancel = true` stops both. |
| `contextMenuPreparing` | the same, with `event` and `items` | Before a cell's or header's menu opens. Change `items` in place: drop an entry, or add `{ label, onClick }`; an empty list opens no menu. A header without a menu of its own gets one when the page adds an item. |
| `expandValueChanging` | `{ area, path, expanded, cancel }` | Before a group opens or folds from its toggle; `expanded` is the state it is about to take, and `cancel = true` leaves it. Expanding or collapsing a whole level does not raise it. |

The four cell events also carry `rowFields`, `columnFields` and `dataFields`. `area`
is `"row"`, `"column"` or `"data"`; `cell` holds `text`, and for a header `path`,
`type` (`"D"` value, `"T"` subtotal, `"GT"` grand total) and `expanded` when it
folds, for a data cell `value`, `rowPath`, `columnPath`, `rowType`, `columnType`
and `dataField`. Declaratively they are `on-cell-prepared`, `on-cell-click`,
`on-context-menu-preparing` and `on-expand-value-changing`.

```js
widget.on("cellPrepared", e => {
  if (e.area === "data" && e.cell.value < 0) {
    e.cellElement.classList.add("is-negative");
  }
});
```

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
| `setAggregation(name, aggregation)` | Sets the aggregation (`"sum"`, `"count"`, `"average"`, `"min"`, `"max"`, `"countDistinct"`, `"median"`, `"variance"`, `"standardDeviation"`, `"variancePopulation"`, `"standardDeviationPopulation"`, `"first"`, `"last"`) of a field already in the data area. Throws otherwise. |
| `setSort(name, { order, byValueKey })` | Orders a row or column field's level: `order` is `"Ascending"` or `"Descending"`, `byValueKey` a value on the grid (`valueKeys()` lists them) or `null` for the field's own labels. A choice equal to the declaration is forgotten rather than stored; a value picked over a declared `sortBySummaryPath` drops the path. `getState().sortBys` carries it into a saved view. The designer's sort panel — **Sort order** and **Sort by** in a row or column chip's settings — calls this, and also clears that axis' header sort, which would otherwise outrank it. The panel is left out for a field with `allowSorting: false` and on a grid with `allowSorting: false`. |
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

### Field chooser

DevExtreme's field chooser popup: the field designer in a dialog, on the grid's own
layout, opened from the cell and header menus (**Show field chooser** / "Alan
seçiciyi göster"), the `FieldChooser` toolbar button or `widget.showFieldChooser()`.
It needs no host element on the page.

```cshtml
<pivot-grid id="pivotGrid" toolbar-items="FieldChooser"
            field-chooser-layout="ListOnTop"
            field-chooser-apply-changes-mode="OnDemand">
```

| Attribute | Builder / JavaScript | Default | Meaning |
| --- | --- | --- | --- |
| `field-chooser` | `FieldChooser(true)` / `fieldChooser: true` | off | Gives the grid one. Any of the attributes below implies it. |
| `field-chooser-layout` | `FieldChooser(layout, ...)` / `layout: 0, 1, 2` | `ListBesideRowsAndColumns` (0) | DevExtreme's layouts: the list beside rows and columns with filters and values below (0), beside the four zones stacked (1), across the top with the zones in two rows (2). Narrow dialogs stack everything. |
| `field-chooser-all-fields` | `allFields` | `true` | Lists every field, placed or not, each with a checkbox: ticking a measure puts it among the values, any other field on the columns; clearing removes it; a folder's box places its first field, or removes every placed one. Enter on a listed field does the same. `false` lists only the unplaced fields. |
| `field-chooser-apply-changes-mode` | `applyChangesMode: "instantly" \| "onDemand"` | `Instantly` | `OnDemand` holds every edit until **OK**; **Cancel**, Escape or a click outside puts the layout back as the dialog found it. |

#### Field groups

A hierarchy is declared as DevExtreme declares one: a group field naming the group, then its
levels naming the group and their place in it.

```html
<pivot-field group-name="Date" field="OrderDate" area="Column" caption="Order date" />
<pivot-field group-name="Date" group-index="0" group-interval="Year" />
<pivot-field group-name="Date" group-index="1" group-interval="Quarter" />
<pivot-field group-name="Date" group-index="2" group-interval="Month" />
```

- The group field is not a field of its own. Each level takes from it what it does not declare:
  `area`, `areaIndex`, `expanded`, `dataField`, `dataType`, the sort settings, `visible` and
  `showTotals`. A group with no area is offered unplaced.
- The levels stay together in `groupIndex` order wherever the group stands. The field list
  shows the group once, under its caption (the group field's, or `groupName` titled) with a ⋮
  mark; on a zone its levels are drawn joined.
- Dragging, moving with the keyboard or removing any level does the same to the whole group,
  in the designer and the field chooser alike. A stored view that seats only part of a group, or
  splits it, comes back with the group whole where its first level stood.
- A level is a dimension: a group in the data area, or a level declared as a measure, is a
  validation error, as is a `groupIndex` used twice in one group.

Limitation: DevExtreme's tree header filter for a group, whose values are paths such as
`["2024", "1"]`, is not offered; each level filters on its own values.

#### Discovering fields

`retrieve-fields="true"` (`RetrieveFields()`, `retrieveFields: true`) is DevExtreme's
`retrieveFields`: before its first load the grid asks `POST {prefix}/fields` what the record
type holds and lists every field the page did not declare in the field chooser and designer,
unplaced. A grid that declares no fields at all discovers them unless `retrieve-fields="false"`;
it starts with nothing summed and says so until the reader places a measure.

- The fields come from the record type's public properties and fields, in declaration order, so
  no records are loaded. A nested object or a collection is left out, as is a name starting with
  `__`, and so is any field off `AllowedFields`.
- A number is offered as a measure, anything else as a dimension. A date comes as a
  [group](#field-groups) named after it, of its year, quarter and month.
- A declared field (the same data field and interval) stays as declared and takes the
  discovered data type if it names none.
- `fieldsPrepared` (`on-fields-prepared`) fires with `e.fields`, the merged list, before the first
  load; replacing or editing it changes what the grid offers.
- A stored view that seats a discovered field waits for the fields, then comes back.
- A failed discovery raises `error` and leaves the declared fields.

Outside ASP.NET Core, `PivotFieldDiscovery.Discover<T>()`, `Discover(DataTable)` and
`Discover(dictionaries)` in `PivotForge.Core` list the same fields.

The same arrangements are available to a designer the page hosts:
`field-designer-layout` (`FieldDesignerLayout`, `fieldDesignerLayout`) and
`field-designer-all-fields` (`FieldDesignerAllFields`, `fieldDesignerAllFields`).
A right click (or the menu key) on a field chip raises `contextMenuPreparing` with
`field` and `area` instead of a cell; the menu has no entries of its own and opens
only when the page adds some.

### Remote data (RemoteStore)

`remote-load-url="/api/sales/load"` (`RemoteStore("/api/sales/load")`,
`store: { type: "remote", loadUrl: "/api/sales/load" }`) is DevExtreme's `RemoteStore`: the grid
never calls the PivotForge endpoints. It sends `DataSourceLoader.Load` requests to any backend
that answers them -- DevExtreme.AspNet.Data on ASP.NET Core, or anything speaking the same
protocol -- and builds the pivot in the browser from the groups that come back. Load
`pivot-result-assembler.js` and `pivot-remote-store.js` before the grid is created.

```csharp
// The backend: any IQueryable or IEnumerable, filtered and grouped by the library.
app.MapGet("/api/sales/load", (HttpRequest request) =>
{
    var options = new SalesLoadOptions();
    DataSourceLoadOptionsParser.Parse(options, key => request.Query[key]);
    return Results.Json(DataSourceLoader.Load(db.Sales, options));
});

internal sealed class SalesLoadOptions : DataSourceLoadOptionsBase;
```

```html
<pivot-grid id="sales" remote-load-url="/api/sales/load">
    <pivot-field data-field="Region" area="Row" data-type="String" />
    <pivot-field data-field="OrderDate" group-interval="Quarter" area="Column" />
    <pivot-field data-field="Amount" area="Data" aggregation="Sum" />
</pivot-grid>
```

- **The protocol.** `loadUrl` is fetched with GET, each load option JSON-encoded in the query
  string (`group`, `groupSummary`, `totalSummary`, `filter`, `skip`, `take`, `requireTotalCount`),
  as the DevExtreme.AspNet.Data client sends them. `headers` are added to every request, and
  an `onBeforeSend(operation, settings)` function may change
  `settings.url` and `settings.headers` before it goes. `remote-load="app.sales.load"`
  (`RemoteStoreLoad`, `store: { type: "remote", load }`) hands the load options to a page
  function instead, which returns `{ data, summary, totalCount }` or a promise of it.
- **One request per depth.** Each row depth is one request grouped by the row levels down to it
  and every column level, so totals, subtotals and averages are the backend's own, and they go
  out together. A date level is grouped by its part (`year`, `quarter`, `month`, `day`,
  `dayOfWeek`), a numeric range by its size.
- **In the browser,** exactly as the engine does it: headers and their order, display modes
  (`showAs`, `allowCrossGroupCalculation`), `runningTotal`, `hideEmptySummaryCells`, ordering by
  label or by a summary (`sortByValueKey`, `sortBySummaryPath`, `rowSort`). Month and weekday
  names follow `rendererOptions.culture`, then the locale pack's, then the browser's.
- **Filters** go to the backend as a `filter` expression: a year, month, day or weekday by its
  part, a quarter as a month range, a numeric range as `>=` / `<`, `Contains`, `StartsWith` and
  `EndsWith` on text as the server's own. A filter it cannot express directly loads the field's
  values first and is sent as the values it keeps.
- **The filter picker** asks for one level grouped; **drill-down** sends the cell's filter with
  `take` (the store's `limit`, 1000 by default) and `requireTotalCount`; **`retrieveFields`**
  reads the first 20 records and offers what they hold, a date as its year, quarter and month.

Refused when the grid starts or the field changes, with a message naming what is refused,
because the protocol has no way to carry it: aggregations other than `sum`, `count`, `average`,
`min` and `max`; calculated fields (`expression`) and relative formulas; `selector`; a
`sortingMethod`; top N; value filters; `largeData`. The designer does not offer them.

#### Limitations

- **Count** is the number of records in a group, as DataSourceLoader counts, where the engine
  counts the values that are not null.
- **Text comparisons** follow the backend: DataSourceLoader compares strings ignoring case.
- **Order the grid does not set:** a column level with no `sortOrder` and `sortBy: "none"` keeps
  the order the backend returns, and rows tied under a `rowSort` keep the order they arrived in.
- **Labels of computed keys** -- a decimal's scale, a negative range's bounds -- are formatted
  from the number the backend returns, which may differ in its last digits from the engine's.
- **The whole result** is loaded at once; branches are not loaded as they are expanded.
- **Excel export** still asks `{prefix}/excel`; without the PivotForge endpoints, use CSV.

### OLAP data (XmlaStore)

`xmla-url="/olap/msmdpump.dll" xmla-catalog="Adventure Works DW" xmla-cube="Adventure Works"`
(`XmlaStore(url, catalog, cube)`, `store: { type: "xmla", url, catalog, cube }`) is DevExtreme's
`XmlaStore`: the grid reads an OLAP cube -- SQL Server Analysis Services through `msmdpump.dll`,
or any XMLA provider -- instead of the PivotForge endpoints. Load `pivot-result-assembler.js` and
`pivot-xmla-store.js` before the grid is created.

```html
<pivot-grid id="sales" xmla-url="/olap/msmdpump.dll" xmla-catalog="Adventure Works DW"
            xmla-cube="Adventure Works" retrieve-fields="true">
    <pivot-field data-field="[Customer].[Country].[Country]" area="Row" />
    <pivot-field data-field="[Date].[Calendar].[Calendar Year]" area="Column" />
    <pivot-field data-field="[Measures].[Internet Sales Amount]" area="Data" />
</pivot-grid>
```

- **Fields name the cube.** A row or column field is a level (`[Date].[Calendar].[Calendar Year]`)
  or a single-level attribute hierarchy (`[Customer].[Country]`); a data field is a measure. The
  cube sums its measures, so `aggregation` is not used and the designer offers no choice of
  summary. Levels of one hierarchy may follow each other on an axis -- year, then quarter -- but a
  hierarchy cannot be on both the rows and the columns.
- **`retrieveFields`** reads the cube's schema (`MDSCHEMA_MEASURES`, `MDSCHEMA_HIERARCHIES`,
  `MDSCHEMA_LEVELS`, `MDSCHEMA_DIMENSIONS`, `MDSCHEMA_MEASUREGROUPS`): each visible measure filed
  under its display folder or measure group, each attribute hierarchy as a field under its
  dimension, and each hierarchy of several levels as a [group](#field-groups) of them.
- **One query.** The grid sends one MDX `SELECT` crossing every row and column member down to
  each depth, so every total and subtotal is the cube's own -- a calculated member and a distinct
  count stay right. Display modes, running totals, empty-cell hiding and ordering by a summary run
  in the browser, exactly as the engine runs them.
- **Order** is the cube's member order; `sortOrder: "Descending"` turns it around and
  `sortBy: "displayText"` orders by caption.
- **Labels** are member captions in the culture's language (`LocaleIdentifier`, from
  `rendererOptions.culture` or `localeIdentifier`). Where captions repeat under what the axis
  shows -- every year's Q1 with no year beside it -- a member is named with its ancestors,
  `Q1 2024`. A quarter of every year is an attribute hierarchy of its own in a cube, and is
  declared as one.
- **Filters** are decided on the level's captions by the engine's rules (include, exclude,
  `Contains`, `StartsWith`, `EndsWith`, `Between`, `GreaterThan`, `LessThan`, `Blank`) and sent as
  the members they keep, in a subselect.
- **The filter picker** lists a level's members; **drill-down** sends `DRILLTHROUGH MAXROWS` for
  the cell, its records named by the rowset's columns (`[$Customer].[Country]` becomes `Country`).
- **Errors:** a SOAP fault is the grid's `error`; a cell the cube could not compute (`#N/A`) is
  shown empty, with one console warning.
- **The request** is a `POST` with `Content-Type: text/xml`; `headers` are added to it and
  `beforeSend(settings)` may change `settings.url`, `settings.headers` or set
  `settings.withCredentials` for a server on another origin that asks for credentials.

Refused when the grid starts, with a message naming what is refused: calculated fields
(`expression` -- declare a calculated member of the cube instead), a `groupInterval` (a cube's
dates come as hierarchy levels), `selector`, a `sortingMethod`, top N, value filters.

#### Paging (`largeData`)

With `large-data="true"` (`LargeData(true)`, `largeData: true`) the cube pages its own rows,
DevExtreme's `paginate`: no PivotForge session is kept, and each `loadPage(offset)` reads the
cube again. A page is what the engine's large-data page is -- every column, the column totals
and the grand total, and `pageSize` rows with their totals and the subtotals of the groups they
are in -- with `totalRowCount` from the cube.

- **Three queries a page.** The leaves holding a value are counted once (`WITH MEMBER … AS
  Count(NonEmpty(…))`, asked again on `refresh`); the page's leaves are read with `Subset`; then
  their cells, with every ancestor and the All member as rows so totals and columns are the
  whole cube's.
- **Order** runs in the cube, with stable `Order(…, BASC|BDESC)` calls: a level's member order
  (`Rank`), its captions (`sortBy: "displayText"`), a summary at a column path
  (`sortByValueKey` / `sortBySummaryPath`) and `rowSort` by label or by total.
- **Refused** when the grid starts or the rows are ordered: `runningTotal: "column"` (a page does
  not know the rows before it), and ordering rows by a value shown through `showAs` (the cube
  orders by the values it holds).

#### Limitations

- **Loading a branch** as it is expanded is not supported yet; the filter picker lists a level's
  values whole, not a page at a time.
- **With `largeData`,** `hideEmptySummaryCells` drops a column no row of the whole cube has a value
  in, judged by the values the cube holds rather than the ones shown; `sortBy: "displayText"`
  orders by the member's caption, not the ancestor-qualified label; and where an order by one
  level's labels (`rowSort` by label) ties, the cube's member order decides, as it does without
  `largeData` -- the engine keeps the order the records came in.
- **`metadata.sourceRowCount`** is the number of crossings holding a value; a cube has no record
  count.
- **Excel export** still asks `{prefix}/excel`; without the PivotForge endpoints, use CSV.
- The demo's `/api/xmla` is a small stand-in for `msmdpump.dll` that answers only the MDX the
  store writes; it is for trying the grid, not an OLAP server.

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

#### Value filters

`pivot-value-filter` keeps the groups of one row level whose summary value meets a
condition — "regions whose sales exceed 10,000":

```html
<pivot-value-filter field="Region" operator="GreaterThan" value="10000" />
<pivot-value-filter field="Category" operator="Between" value="100" value2="500" value-key="Amount_sum" />
```

| Attribute | Default | Meaning |
| --- | --- | --- |
| `field` | required | The row field, or `field:interval` level key, being filtered. |
| `operator` | `GreaterThan` | `GreaterThan`, `GreaterThanOrEqual`, `LessThan`, `LessThanOrEqual`, `Equal`, `NotEqual`, `Between`, `NotBetween`. |
| `value` | required | The value compared against; the lower bound of a range. |
| `value2` | — | The upper bound, required by `Between` / `NotBetween` and refused by the rest. Both bounds are included. |
| `value-key` | first declared value | The measure compared, as `Field_aggregation`. |

It works the way a ranking does: after aggregation, each group of an inner level on
its own, and the groups it drops leave the result, totals included. A group with no
value meets no condition and is dropped. A ranking on the same level is taken among
the groups the filter keeps, so a filter and a `Top 3` mean "the top three of those
over 10,000".

The reader sets one too: a row field's settings in the designer carry a **Value
filter** section — the value to compare (when the grid has more than one), the
condition, the bound or bounds, **Apply** and **Remove value filter**. A value-filtered
field lights its header funnel. In JavaScript: `valueFilters` declares them
(`{ field, operator, value, value2?, valueKey? }`), `setValueFilter(field, filter)`
sets or, with `null`, removes one, `clearValueFilters()` removes them all, and
`getState().valueFilters` lists them. They are stored with the view (`state-storing`,
report files). A filter on a field that leaves the rows, or comparing a value no longer
on the grid, is kept but not sent until the field or the value comes back.

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
and are overridable per key through `drillDownModalOptions.labels` — a declared
key wins over the pack's word for it, and the pack keeps the rest. `{0}`/`{1}` placeholders in `truncated`,
`summary`, and `columnFilter` are substituted positionally.

Declaratively, each label is one attribute, `drill-down-label-` followed by the
key in kebab-case, or one `DrillDownLabel(key, text)` call:

```cshtml
<pivot-grid id="pivotGrid"
            drill-down-label-search="Satışlarda ara"
            drill-down-label-no-records="Bu hücrede kayıt yok">
```

The keys are `title`, `close`, `search`, `csv`, `all`, `empty`, `loading`,
`noRecords`, `noMatches`, `failed`, `allRows`, `allColumns`, `truncated`,
`summary` and `columnFilter`; any other is an error naming them. `title` is
what the modal shows before its first cell — once open, the heading names the
cell. Columns stay a JavaScript option: their formatters are functions, which
an attribute cannot carry, and the default derived from the catalog is the
right one for a declared grid.

### Conditional formatting

A rule paints a cell whose value satisfies a comparison. Rules come from two
places and land in the same list: `pivot-conditional-rule` elements (or
`ConditionalRule(...)`) declare the ones a report always carries, and the
packaged `PivotConditionalPanel` lets a reader add more while reading.

Right-clicking a value cell offers **Add conditional formatting**. The entry
appears only when the panel can actually open — `allowConditionalFormatting` is
on and `pivot-conditional-panel.js` is loaded — so a page that does neither gets
no entry rather than one that does nothing when clicked. The same rule governs
the menu's **Sort by this value** and **Filter by this value**: an action whose
handler is missing is left out, while an action whose handler exists but whose
cell does not qualify is shown disabled.

The panel opens over the cell it was invoked on, seeds both bounds with that
cell's own number, and offers the six comparisons and four highlights the
renderer evaluates — no more, so a rule it produces can never colour nothing.
A threshold that is blank or not a number is refused rather than applied, for
the same reason. Applying redraws immediately without going back to the server.

**Clear rules for this measure** removes the rules on the measure the panel was
opened on, leaving other measures alone. Later rules win over earlier ones on
the same cell, so a rule added now overrides a declared one it overlaps.

```csharp
// Rules the report always carries; readers may still add their own on top.
@(Html.PivotForge().PivotGrid()
    .Id("pivotGrid")
    .ConditionalRule("Amount_sum", PivotConditionalOperator.GreaterThanOrEqual, 100000, PivotConditionalColor.Green)
    .Fields(fields => { /* ... */ }))
```

```csharp
// A read-only report: rules are declared, and readers cannot add more.
@(Html.PivotForge().PivotGrid()
    .Id("pivotGrid")
    .AllowConditionalFormatting(false)
    .Fields(fields => { /* ... */ }))
```

A page that brings its own panel keeps it: supply
`rendererOptions.onConditionalFormatRequested` and the widget hands the request
there instead of opening the packaged one, so a reader never gets two. The
widget emits `conditionalFormatRequested` either way. Rules are not part of the
part of the widget's [persisted state](#state-persistence) when `state-storing`
is on, so a rule a reader added is still there after a reload. A page that keeps
its own *named* views (through `PivotViewStore`) reads `widget.conditionalRules`
into the view and restores it with `setConditionalRules`.

Labels default to English, come from the `conditionalPanel` section of a locale
pack, and are overridable per key through `conditionalPanelOptions.labels`.

### Exporting

Two exports, both built from the same model the renderer reads off the visible
table — so they can never disagree about what the grid says, and both drop the
sort arrows, resize handles, expand chevrons and header funnels that a naive
scrape of the table would carry into the file.

```js
// CSV: built in the browser, nothing is sent anywhere.
PivotForge.download(widget.exportToCsv());

// Excel: rendered by the /excel endpoint into a real .xlsx.
PivotForge.download(await widget.exportToExcel({ sheetName: "Satışlar" }));
```

`PivotForge.download({ blob, fileName })` takes exactly what both exports return
and saves it. Both hand back a file rather than saving one, because a page may
want to upload it, preview it, or name it itself; `download` is the last step
when it does not. It returns `false` rather than throwing when there is nothing
to save.

CSV has no merged cells, so a header cell spanning several columns or rows is
written once at its top-left and the positions it covers are left empty; every
line is padded to the widest row, because a ragged file is one a spreadsheet
opens with its columns shifted.

| Option | Default | Behavior |
| --- | --- | --- |
| `delimiter` | `","` | What separates the fields, and what gets quoted. A spreadsheet whose locale reads the comma as a decimal separator wants `";"`. |
| `values` | `"text"` | `"text"` writes what the grid displays, keeping the currency, decimals and show-as percentages it computed. `"raw"` writes the invariant number behind each cell, for feeding another program. |
| `fileName` | `pivotforge-{date}.csv` | The name the browser saves it under. |

A UTF-8 byte-order mark leads the file: a spreadsheet opening a CSV without one
guesses the encoding and gets every non-ASCII caption wrong.

Both exports read the table as it currently stands, not the last result — so a
collapsed group exports collapsed, and a resized or reordered grid exports the
way it looks.


#### Field header rows and merging

DevExtreme's `exportPivotGrid` options, for every Excel and CSV export of the grid —
declared once, or passed to an export call, whose own options win:

```cshtml
<pivot-grid id="pivotGrid" allow-excel-export="true"
            excel-filter-field-headers="true"
            excel-data-field-headers="true"
            excel-column-field-headers="true"
            excel-merge-row-field-values="false">
```

| Attribute | JavaScript | Default | Meaning |
| --- | --- | --- | --- |
| `excel-filter-field-headers` | `exportFilterFieldHeaders` | `false` | A row above the table naming the filter fields. |
| `excel-data-field-headers` | `exportDataFieldHeaders` | `false` | The data fields named above the row headers. |
| `excel-column-field-headers` | `exportColumnFieldHeaders` | `false` | The column fields named above the column headers. A grid whose corner already names them (sorting or filtering on its columns) is not given a second row. |
| `excel-row-field-headers` | `exportRowFieldHeaders` | `true` | The corner names the row fields, as on screen. DevExtreme leaves it blank unless asked; `false` does the same here. |
| `excel-merge-row-field-values` | `mergeRowFieldValues` | `true` | `false` writes a row header into every row it spans instead of one merged cell, so the sheet sorts and filters row by row. |
| `excel-merge-column-field-values` | `mergeColumnFieldValues` | `true` | The same for a column header across its columns. |

Each field takes a cell of its own while there is room, the last stretching to the
edge; with more fields than columns their captions share one cell. Field header cells
are bold with a thin grey border, stay merged, freeze with the table's head, and
carry `source: { area: "fieldHeader", headerType }` in the `exporting` event. The
builder takes `ExcelExport(new PivotExcelExportOptions { ... })`; in JavaScript the
widget option is `excelExport`.

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

### Calculated fields

`expression` turns a field into a formula over other summaries; `field` then names it rather than a source column, and its value key is `Name_calculated`:

```cshtml
<pivot-field field="Margin" caption="Marj" area="Data"
             expression="([Amount] - [Cost]) / [Amount]"
             format-type="Percent" format-decimals="1" />
<pivot-field field="UnitPrice" caption="Birim Fiyat" area="Available"
             expression="[Amount] / [Quantity]" />
```

The fluent builder has the same member: `fields.Add().DataField("Margin").Expression("([Amount] - [Cost]) / [Amount]")`. A calculated field in `Available` is a measure without declaring the role. The grammar and the way totals are computed are in the [Core guide](core-guide.md#calculated-fields); the formula is evaluated on the server, after aggregation, so a ratio is right at every level.

The field designer adds a **+ ƒx** button beside its search box. It opens a builder meant for readers who should not have to learn a syntax: a field is tapped or dragged into the formula, an operation (add, subtract, multiply, divide, brackets) is a large labelled button, a number is typed into its own box (a comma works as the decimal separator), and the formula shows as a row of pieces in the readers' own words, each with a remove badge, plus Undo, Clear and a line saying what comes next. A field piece can be summarized by average, count, minimum or maximum instead of its sum. "Type the formula instead" switches to the typed syntax below, and a formula the pieces cannot show — one calling a custom aggregate — opens there. A formula naming a field the list does not have is refused in the editor, in the reader's language, before anything is sent. The builder's words are the designer's `formulaBuilder` labels. The new field lands in the data area and is carried by `state-storing`. A reader's own field can be edited or deleted from its settings; a declared one shows its formula read-only. `allow-calculated-fields="false"` (or `AllowCalculatedFields(false)`) removes the button; declared calculated fields work either way.

A formula can also read other cells — `Prev`, `Next`, `PrevRow`, `NextRow`, `ParentRow`, `ParentColumn`, `RowTotal`, `ColumnTotal`, `GrandTotal` and `Slice([Amount], [Year], -1)`, DevExtreme's cell API: `expression="([Amount] - Prev([Amount])) / Prev([Amount])"` is the growth on the previous period. See the [Core guide](core-guide.md#reading-other-cells). The editor checks a `Slice` level against every field of the list, as it is a header level rather than a measure; such a formula opens in the typed syntax, which the pieces cannot show.

A formula typed by a reader is as safe as a declared one. It is only ever read as the grammar above and evaluated on the server; `AllowedFields` is checked against the fields it names, so it can reach nothing a header could not; and a formula that cannot be read is answered with `400` and a message saying what is wrong with the text.

Custom summaries are registered on the options and called from any formula:

```csharp
builder.Services.AddPivotForge<Sale>(provider, options =>
{
    options.CustomAggregates["Median"] = values =>
    {
        var sorted = values.Order().ToArray();
        var middle = sorted.Length / 2;
        return sorted.Length % 2 == 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    };
});
```

Limitations: a formula reads source fields, not other calculated fields, and the browser cannot check a custom function's name, so a misspelled one is reported by the server when the grid loads.

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

### Numeric ranges

`group-interval="Range"` with `group-size` splits a numeric column into ranges
of that width — "orders by size", "customers by age band":

```html
<pivot-field field="Amount" caption="Tutar aralığı" area="Row" group-interval="Range" group-size="50000" />
```

| | |
|---|---|
| Header reads | `0 – 50.000`, `50.000 – 100.000`, … with the bounds written in the resolved culture |
| Ordered by | where each range starts, so `-50.000 – 0` comes before `0 – 50.000` |
| Bounds | each range includes its start and excludes its end: 50,000 is in `50.000 – 100.000` |
| Alignment | the ranges are aligned to zero |

Like a date interval, the range is part of the level's identity — `Amount:range50000`
— so a sort, a filter, a header funnel and a saved layout name it, and the same column
can sit in two levels of different widths. Filters, drill-down and the header funnel's
value list collapse values to the same ranges. A value that is not a number keeps its
own text and sorts after every range; an empty one stays blank. `group-size` is
required by `Range` and refused by every other interval.

C#: `PivotFieldBuilder.GroupInterval(PivotGroupInterval.Range).GroupSize(50000m)`;
JavaScript: `{ groupInterval: "range", groupSize: 50000 }`; Core:
`new PivotFieldRef("Amount", PivotGroupInterval.Range, 50000m)`, with
`PivotFilter.BinSize` and `PivotEngine.DistinctValues(records, field, interval, binSize)`
for filters and value lists.

The width is declared with the field, and the reader can change it in the field
designer: a range level's settings carry a **Range width** box with **Apply** and,
once changed, a way back to the declared width. The new width renames the level —
`Amount:range50000` becomes `Amount:range10000` — and its caption, sort, position and
value filter go with it; its filter values do not, since ranges of the old width match
none of the new ones. A width another level of the same column already has is refused
in the dialog. The change is kept with the view (`groupSizes` in a stored view or
report file, by the level's declared name) and comes back with it.

### Pivot chart

`chart` draws the pivot as a chart beside the grid — above it by default, below the
toolbar — from the same result the grid shows:

```html
<pivot-grid id="salesGrid" chart="Column" chart-position="Top" chart-height="320">
```

| | |
|---|---|
| Types | `Column` (bars side by side), `StackedColumn` (each category's series stacked into one bar), `Bar` (horizontal, for long labels), `Line` (for categories in an order that means something, such as months) |
| Categories | the outermost row groups — regions, not region × category — or the rows themselves when there is one row level |
| Series | the outermost column groups, or the data field itself when nothing is on the columns; at most eight, with a note naming how many were left out |
| Numbers | each group's own subtotal as the engine computed it, so an average or a distinct count is charted correctly; a tooltip shows the grid's text for it, in the field's format |
| Value | one data field at a time, so there is only ever one axis: the first, unless `valueKey` names another or the reader picks one from the chart's header |

The reader switches the type and the value from the chart's header; both are kept with
the view in `stateStoring` and in report files, and `setChart({ type, valueKey })` does
the same from code. A series keeps its colour when a filter takes others away. Hovering a
category — or focusing the chart and using the arrow keys, Home and End — shows every
series' value for it; the grid below is the chart's table view. The series colours are
the `--pt-series-1` to `--pt-series-8` CSS variables, checked together for colour-blind
separation; replace them as a set.

The toolbar's **Chart** button (`toolbar-items="Chart"`, included in `toolbar="true"`
when the grid has a chart) shows and hides it, a pressed toggle while it is on screen;
`showChart()` does the same from code. Whether it is shown is kept with the view and in
report files, like the type and the value. `chart-visible="false"` starts it hidden, for a
page where the table comes first. A hidden chart is not drawn; showing it draws the
latest result at the width it then has.

`chart-position`, `chart-height` (at least 120 pixels, 320 by default) and `chart-visible`
need `chart`.
C#: `Chart(PivotChartType.Column, PivotChartPosition.Top, height: 320, visible: true)`. JavaScript:
`chart: "column"` or `chart: { type: "line", position: "bottom", height: 280, valueKey: "Amount_sum", visible: true }`.
The chart is not printed with the grid, and in large-data mode it charts the rows of the
page on screen.

#### Binding an external chart

`bindChart(chart, options)` feeds another chart library the pivot's data, as DevExtreme's
`bindChart` does: once at the call and again after every load, filter, sort and fold.
`chart` is a dxChart instance (or anything with an `option(config)` method), a dxChart's
element or selector, or a function called with the configuration and `{ result }` — for
Chart.js, ECharts and the like. It returns the function that undoes the binding, or
`null` when `chart` is none of these; binding the chart to another grid unbinds it here,
and disposing the grid unbinds every chart.

```js
// Registered before the grid's markup, as for any pivotforge:ready listener.
document.addEventListener("pivotforge:ready", event => {
  const chart = $("#salesChart").dxChart({ commonSeriesSettings: { type: "bar" } }).dxChart("instance");
  const unbind = event.detail.widget.bindChart(chart, { dataFieldsDisplayMode: "splitPanes" });
}, true);
```

The configuration is `{ dataSource, seriesTemplate: { nameField: "series", customizeSeries }, valueAxis, panes }`.
`dataSource` holds one `{ series, arg, val }` item per row path × column path × data field,
totals included. Series names are a row path's texts joined with `" - "` and arguments a
column path's joined with `"/"`. Only the deepest level showing on each axis is charted,
so folding a group in the grid takes its rows out of the chart.

| Option | Effect |
|---|---|
| `dataFieldsDisplayMode` | `"separateAxes"` (default) gives each data field its own value axis, `"singleAxis"` one axis for all, `"splitPanes"` each field its own pane |
| `putDataFieldsInto` | `"series"`, `"args"` or `"both"`: where `" \| <field>"` is added; with several data fields it goes on the series unless the axis is single |
| `alternateDataFields` | `false` runs through every cell once per data field rather than every field per cell |
| `inverted` | the column paths become the series and the row paths the arguments |
| `processCell(e)` | called for every cell with `rowPath`, `rowPathFormatted`, `rowFields`, `maxRowLevel`, the column counterparts, `dataFields`, `dataIndex`, `dataValues`, `visible` and `chartDataItem`; what it returns is merged in, so `{ visible: true }` charts a total |
| `customizeSeries(name, options)` | changes a series' options; each series is already on its data field's axis (and pane) |
| `customizeChart(options)` | what it returns is merged into `valueAxis` and `panes` |

`getChartDataSource(options)` returns the same configuration without binding anything.
Both need `pivot-chart.js`; the packaged chart does not, and keeps drawing on its own.

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
one directly — with five optional sections:

| Section | Reaches |
|---|---|
| `table` | A partial `rendererOptions`: `texts`, and presentation strings that live outside it such as `totalText` and `ariaLabel` |
| `designer` | `PivotFieldDesigner` labels |
| `filterPicker` | `PivotFilterPicker` labels |
| `conditionalPanel` | `PivotConditionalPanel` labels |
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
- **Saved views and selection/clipboard UI** are not part of the declarative API. They remain lower-level features built on `PivotViewStore`, `PivotTableRenderer`'s `onSelectionChanged`/`onCellCopied` options, and manual request construction — see [Render a Result](#render-a-result) above. Conditional formatting is declarative in both directions: rules in markup with `pivot-conditional-rule`, and rules a reader adds through the packaged panel — see [Conditional formatting](#conditional-formatting).

## Endpoint Contract

| Method and route | Purpose |
| --- | --- |
| `POST /pivotforge/pivot` | Calculate a normal pivot result |
| `POST /pivotforge/large/start` | Calculate/cache a large result and return its first page |
| `POST /pivotforge/large/page` | Return a page from an existing cached session |
| `POST /pivotforge/drill-down` | Return source records matching row and column paths |
| `POST /pivotforge/field-values` | Return the distinct values a filter on one field can accept; optional `filters` narrow them to the records those filters keep |
| `POST /pivotforge/excel` | Convert a renderer export model into an `.xlsx` response |
| `POST /pivotforge/fields` | List the record type's fields, as far as `AllowedFields` reaches, for `retrieveFields` |

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
| `CustomAggregates` | empty (only the built-in summaries) |
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
