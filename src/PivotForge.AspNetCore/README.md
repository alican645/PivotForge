# PivotForge for ASP.NET Core

PivotForge.AspNetCore adds reusable browser assets and minimal API endpoints to the PivotForge Core engine.

## Installation

```bash
dotnet add package PivotForge.AspNetCore --version 0.1.0-preview.1
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

The provider is called for pivot and drill-down requests. `SourceRowCount` is `null` for a normal pivot and contains the bounded requested size for large-data and drill-down requests.

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
<script src="/_content/PivotForge.AspNetCore/js/pivot-view-storage.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-drill-down.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-virtual-data-source.js"></script>
```

The scripts expose their browser APIs under `window.PivotForge`.

## Endpoint routes

- `POST /pivotforge/pivot`
- `POST /pivotforge/large/start`
- `POST /pivotforge/large/page`
- `POST /pivotforge/drill-down`
- `POST /pivotforge/excel`

Pass a different prefix to `MapPivotForgeEndpoints("/reports/pivot")` when required.

PivotForge.AspNetCore is licensed under the MIT License.
