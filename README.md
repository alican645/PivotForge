# PivotForge

[![CI](https://github.com/alican645/PivotForge/actions/workflows/ci.yml/badge.svg)](https://github.com/alican645/PivotForge/actions/workflows/ci.yml)
[![PivotForge.Core](https://img.shields.io/nuget/vpre/PivotForge.Core.svg?label=PivotForge.Core)](https://www.nuget.org/packages/PivotForge.Core)
[![PivotForge.AspNetCore](https://img.shields.io/nuget/vpre/PivotForge.AspNetCore.svg?label=PivotForge.AspNetCore)](https://www.nuget.org/packages/PivotForge.AspNetCore)

![PivotForge icon](assets/brand/pivotforge-icon.png)

Interactive pivot tables forged for .NET.

PivotForge is a dependency-light pivot engine and ASP.NET Core integration for operational reporting applications. It supports grouping, filtering, sorting, multiple aggregations, show-as calculations, drill-down, paging, cancellation, Excel export, saved views, selection, conditional formatting, and large-data workflows.

> The current preview is `0.1.0-preview.2`.

## Packages

| Package | Purpose | Target |
| --- | --- | --- |
| `PivotForge.Core` | Pivot calculation, record readers, drill-down, paging, cancellation, and Excel export | `net8.0` |
| `PivotForge.AspNetCore` | Razor Class Library assets, DI registration, endpoints, and large-result caching | `net8.0` |

Both packages can be consumed by .NET 8, .NET 9, and .NET 10 applications.

## Installation

After the preview is published to NuGet:

```bash
dotnet add package PivotForge.Core --version 0.1.0-preview.2
dotnet add package PivotForge.AspNetCore --version 0.1.0-preview.2
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

Reference the Razor Class Library assets:

```html
<link rel="stylesheet" href="/_content/PivotForge.AspNetCore/css/pivotforge.css">
<script src="/_content/PivotForge.AspNetCore/js/pivot-table.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-view-storage.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-drill-down.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-virtual-data-source.js"></script>
```

Browser APIs are exposed under `window.PivotForge`. The default server route prefix is `/pivotforge`.

See the [ASP.NET Core integration guide](docs/aspnetcore-integration.md) for endpoint contracts, options, security considerations, and custom route prefixes.

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
