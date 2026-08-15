# PivotForge

[![CI](https://github.com/alican645/PivotForge/actions/workflows/ci.yml/badge.svg)](https://github.com/alican645/PivotForge/actions/workflows/ci.yml)
[![PivotForge.Core](https://img.shields.io/nuget/vpre/PivotForge.Core.svg?label=PivotForge.Core)](https://www.nuget.org/packages/PivotForge.Core)
[![PivotForge.AspNetCore](https://img.shields.io/nuget/vpre/PivotForge.AspNetCore.svg?label=PivotForge.AspNetCore)](https://www.nuget.org/packages/PivotForge.AspNetCore)

![PivotForge icon](assets/brand/pivotforge-icon.png)

Interactive pivot tables forged for .NET.

PivotForge is a dependency-light pivot engine and ASP.NET Core integration for operational reporting applications. It supports grouping, filtering, sorting, multiple aggregations, show-as calculations, drill-down, paging, cancellation, Excel export, saved views, selection, conditional formatting, and large-data workflows.

> The current preview is `0.2.0-preview.1`.

## Packages

| Package | Purpose | Target |
| --- | --- | --- |
| `PivotForge.Core` | Pivot calculation, record readers, drill-down, paging, cancellation, and Excel export | `net8.0` |
| `PivotForge.AspNetCore` | Razor Class Library assets, DI registration, endpoints, and large-result caching | `net8.0` |

Both packages can be consumed by .NET 8, .NET 9, and .NET 10 applications.

## Installation

After the preview is published to NuGet:

```bash
dotnet add package PivotForge.Core --version 0.2.0-preview.1
dotnet add package PivotForge.AspNetCore --version 0.2.0-preview.1
```

Installing `PivotForge.AspNetCore` brings `PivotForge.Core` transitively.

## Core Quick Start

```csharp
using PivotForge.Core;

var sales = new[]
{
    new { Region = "North", Year = 2025, Amount = 120m },
    new { Region = "North", Year = 2026, Amount = 180m },
    new { Region = "South", Year = 2026, Amount = 90m }
};

var request = new PivotRequest
{
    Rows = ["Region"],
    Columns = ["Year"],
    Values = [PivotValueDefinition.Sum("Amount")]
};

var result = new PivotEngine().Execute(sales, request);
```

See the [Core guide](docs/core-guide.md) for filters, sorting, show-as calculations, drill-down, pagination, cancellation, JSON/CSV input, and Excel export.

## ASP.NET Core Quick Start

Register a typed data provider:

```csharp
using PivotForge.AspNetCore.DependencyInjection;
using PivotForge.AspNetCore.Endpoints;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddPivotForge<Sale>(
    (request, cancellationToken) =>
        ValueTask.FromResult<IReadOnlyList<Sale>>(
            LoadSales(request.SourceRowCount)));

var app = builder.Build();

app.UseStaticFiles();
app.MapPivotForgeEndpoints();
app.Run();
```

Reference the Razor Class Library assets. Load them in `<head>`, not at the end of `<body>`: the Razor helper used below emits its `PivotForge.create` call inline in the page markup, so the scripts must already be loaded by the time that markup runs. `pivot-table.js` must load before `pivot-widget.js`.

```html
<link rel="stylesheet" href="/_content/PivotForge.AspNetCore/css/pivotforge.css">
<script src="/_content/PivotForge.AspNetCore/js/pivot-table.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-request-builder.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-widget.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-view-storage.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-drill-down.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-virtual-data-source.js"></script>
```

Browser APIs are exposed under `window.PivotForge`. The default server route prefix is `/pivotforge`.

See the [ASP.NET Core integration guide](docs/aspnetcore-integration.md) for endpoint contracts, options, security considerations, and custom route prefixes.

### Declarative Quick Start

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

Data always comes from the provider registered with `AddPivotForge<TRecord>`; the grid computes nothing in the browser.

To capture the created widget instance (for example, to call `sortBy`, `setFilter`, or `exportToExcel` from page code), register a capture-phase listener on `document` for the `pivotforge:ready` event *before* the helper's markup runs — a listener attached to the container element afterward can never fire, because the event is dispatched synchronously during `PivotForge.create`:

```html
<script>
  document.addEventListener(
    "pivotforge:ready",
    event => { window.pivotGridWidget = event.detail.widget; },
    true);
</script>
@(Html.PivotForge().PivotGrid().Id("pivotGrid") /* ... */)
```

The declarative API covers field configuration, sorting, filtering, drill-down, and Excel export. Saved views, conditional formatting, and selection/clipboard behavior are lower-level features and still use the manual `PivotTableRenderer` API described in the [ASP.NET Core integration guide](docs/aspnetcore-integration.md).

## Run the Demo

```bash
dotnet run --project samples/PivotForge.MvcDemo/PivotForge.MvcDemo.csproj
```

The MVC demo exercises the packaged RCL asset paths and endpoint extensions. See the [demo README](samples/PivotForge.MvcDemo/README.md) for details.

## Build and Test

```bash
dotnet build PivotForge.slnx -c Release
dotnet test tests/PivotForge.Core.Tests/PivotForge.Core.Tests.csproj -c Release
dotnet test tests/PivotForge.AspNetCore.Tests/PivotForge.AspNetCore.Tests.csproj -c Release
node --test tests/*.test.js
```

Create local packages:

```bash
dotnet pack src/PivotForge.Core/PivotForge.Core.csproj -c Release -o artifacts/packages
dotnet pack src/PivotForge.AspNetCore/PivotForge.AspNetCore.csproj -c Release -o artifacts/packages
```

## Documentation

- [Core guide](docs/core-guide.md)
- [ASP.NET Core integration](docs/aspnetcore-integration.md)
- [Migration from source copies](docs/migration-from-source.md)
- [Public API surface](docs/public-api.md)
- [Product identity and package metadata](docs/pivotforge-product-identity.md)

## License

PivotForge is available under the [MIT License](LICENSE).
