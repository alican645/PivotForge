# PivotForge for ASP.NET Core

PivotForge.AspNetCore adds reusable browser assets and minimal API endpoints to the PivotForge Core engine.

## Installation

```bash
dotnet add package PivotForge.AspNetCore --version 0.2.0-preview.1
```

## Register services

```csharp
using PivotForge.AspNetCore.DependencyInjection;

builder.Services.AddPivotForge<Sale>(
    (request, cancellationToken) =>
        ValueTask.FromResult<IReadOnlyList<Sale>>(LoadSales(request.SourceRowCount)),
    options =>
    {
        options.CacheSlidingExpiration = TimeSpan.FromMinutes(5);
        options.MaximumSourceRowCount = 500_000;
    });
```

For request-scoped dependencies such as a tenant-aware database context, implement
`IPivotForgeDataProvider<TRecord>` and register the provider type:

```csharp
builder.Services.AddPivotForge<Sale, TenantSaleProvider>();
```

The provider is called for pivot and drill-down requests. `SourceRowCount` is `null` for a normal pivot and contains the bounded requested size for large-data and drill-down requests.
Large-result cache identities include the authenticated user, endpoint path, and query string.

## Map endpoints and assets

```csharp
using PivotForge.AspNetCore.Endpoints;

app.UseStaticFiles();
app.MapPivotForgeEndpoints();
```

The default endpoint prefix is `/pivotforge`. Static assets are available at:

```html
<link rel="stylesheet" href="/_content/PivotForge.AspNetCore/css/pivotforge.css">
<script src="/_content/PivotForge.AspNetCore/js/pivot-table.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-request-builder.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-widget.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-view-storage.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-drill-down.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-virtual-data-source.js"></script>
```

Load them in `<head>`, not at the end of `<body>`: `pivot-table.js` must load before `pivot-widget.js`, and any Razor helper that calls `PivotForge.create` inline (see below) needs both already loaded when its markup runs.

The scripts expose their browser APIs under `window.PivotForge`.

## Declarative rendering

With the fields declared in the view, no manual JavaScript wiring is needed:

```cshtml
@(Html.PivotForge().PivotGrid()
    .Id("pivotGrid")
    .AllowSorting(true)
    .AllowFiltering(true)
    .Fields(fields =>
    {
        fields.Add().Caption("Bölge").DataField("Region").Area(PivotArea.Row);
        fields.Add().Caption("Kategori").DataField("Category").Area(PivotArea.Row);
        fields.Add().Caption("Yıl").DataField("Year").Area(PivotArea.Column);
        fields.Add().Caption("Tutar").DataField("Amount")
            .Aggregation(PivotAggregation.Sum).Area(PivotArea.Data);
    }))
```

The same grid is also available as tag helpers. Register them once in
`_ViewImports.cshtml` with `@addTagHelper *, PivotForge.AspNetCore`:

```cshtml
<pivot-grid id="pivotGrid" allow-sorting="true" allow-filtering="true">
    <pivot-field field="Region"   caption="Bölge"    area="Row" />
    <pivot-field field="Category" caption="Kategori" area="Row" />
    <pivot-field field="Year"     caption="Yıl"      area="Column" />
    <pivot-field field="Amount"   caption="Tutar"    area="Data" aggregation="Sum" />
</pivot-grid>
```

Both Razor forms render identical markup. `area`, `aggregation`, and `show-as`
are enum-typed, so a misspelled value is a compile error.

The same configuration is available directly from JavaScript:

```js
PivotForge.create("#pivotGrid", {
  fields: [
    { caption: "Bölge", dataField: "Region", area: "row" },
    { caption: "Kategori", dataField: "Category", area: "row" },
    { caption: "Yıl", dataField: "Year", area: "column" },
    { caption: "Tutar", dataField: "Amount", area: "data", aggregation: "sum" }
  ]
});
```

To capture the widget instance from page code, register a capture-phase `pivotforge:ready` listener on `document` before the helper's markup runs — a listener attached to the container afterward never fires:

```html
<script>
  document.addEventListener(
    "pivotforge:ready",
    event => { window.pivotGridWidget = event.detail.widget; },
    true);
</script>
```

Saved views, conditional formatting, and selection/clipboard behavior still use the lower-level `PivotTableRenderer` API. See the [ASP.NET Core integration guide](https://github.com/alican645/PivotForge/blob/main/docs/aspnetcore-integration.md) for the full declarative API reference.

## Endpoint routes

- `POST /pivotforge/pivot`
- `POST /pivotforge/large/start`
- `POST /pivotforge/large/page`
- `POST /pivotforge/drill-down`
- `POST /pivotforge/excel`

Pass a different prefix to `MapPivotForgeEndpoints("/reports/pivot")` when required.

PivotForge.AspNetCore is licensed under the MIT License.
