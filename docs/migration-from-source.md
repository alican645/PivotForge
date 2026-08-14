# Migrate from Source Copies to PivotForge Packages

This guide applies to applications that copied the original pivot engine, renderer, controller actions, or cache service into their own source tree.

## 1. Replace Project References

Remove references to the old source projects and install the packages:

```bash
dotnet add package PivotForge.AspNetCore --version 0.1.0-preview.1
```

Install only `PivotForge.Core` when the application owns its HTTP and UI integration.

## 2. Update Namespaces

Replace old engine namespaces with:

```csharp
using PivotForge.Core;
using PivotForge.Core.Excel;
using PivotForge.Core.Records;
```

ASP.NET Core registration uses:

```csharp
using PivotForge.AspNetCore.DependencyInjection;
using PivotForge.AspNetCore.Endpoints;
```

## 3. Register the Data Provider

Replace application-specific pivot controller data loading with one typed provider:

```csharp
builder.Services.AddPivotForge<Sale>(
    (request, cancellationToken) =>
        ValueTask.FromResult<IReadOnlyList<Sale>>(
            LoadSales(request.SourceRowCount)));
```

Move tenant, user, and source access checks into the provider or its dependencies.

## 4. Replace Controller Actions

Remove copied actions for normal pivot, large-data start/page, drill-down, and Excel export. Map the packaged endpoints instead:

```csharp
app.MapPivotForgeEndpoints();
```

The default route changes are:

| Previous demo action | Package route |
| --- | --- |
| `/Home/Pivot` | `/pivotforge/pivot` |
| `/Home/StartLargePivot` | `/pivotforge/large/start` |
| `/Home/LargePivotPage` | `/pivotforge/large/page` |
| `/Home/DrillDown` | `/pivotforge/drill-down` |
| `/Home/ExportExcel` | `/pivotforge/excel` |

Use `MapPivotForgeEndpoints("/your-prefix")` to preserve an application-specific URL structure.

## 5. Remove the Copied Cache

Delete the application copy of the large-result cache and its DI registration. `AddPivotForge` registers `IPivotForgeResultCache` and the default process-local implementation.

Applications with distributed deployment can replace it after registration:

```csharp
builder.Services.AddSingleton<IPivotForgeResultCache, DistributedPivotResultCache>();
```

## 6. Replace Static Asset Paths

Remove copied pivot CSS and JavaScript files. Reference the RCL assets:

```html
<link rel="stylesheet" href="/_content/PivotForge.AspNetCore/css/pivotforge.css">
<script src="/_content/PivotForge.AspNetCore/js/pivot-table.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-view-storage.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-drill-down.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-virtual-data-source.js"></script>
```

Ensure `app.UseStaticFiles()` is enabled.

## 7. Update Browser Globals

Use the `window.PivotForge` namespace:

```javascript
const renderer = new PivotForge.PivotTableRenderer(element);
const views = new PivotForge.PivotViewStore(window.localStorage);
```

Direct globals such as `window.PivotTableRenderer` are no longer created.

## 8. Preserve Saved Views

The default localStorage keys remain:

- `pivot-table:last-state:v1`
- `pivot-table:saved-views:v1`

Existing saved views therefore remain available after switching to the package.

## Verification Checklist

- The application references packages instead of copied projects or files.
- `AddPivotForge<TRecord>` resolves successfully.
- The endpoint group has the required authorization policy.
- `_content/PivotForge.AspNetCore/css/pivotforge.css` returns HTTP 200.
- `window.PivotForge.PivotTableRenderer` exists and the old direct global does not.
- Normal pivot, large-data paging, drill-down, and Excel export work.
- Existing saved views still load.
