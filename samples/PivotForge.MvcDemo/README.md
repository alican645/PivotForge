# PivotForge MVC Demo

This application demonstrates the complete PivotForge ASP.NET Core integration with sample sales data.

## Run

From the repository root:

```bash
dotnet run --project samples/PivotForge.MvcDemo/PivotForge.MvcDemo.csproj
```

Use the URL printed by ASP.NET Core.

## Pages

| Route | Shows |
| --- | --- |
| `/` | The full hand-wired demo: every feature below, driven by page-owned JavaScript. |
| `/Home/HtmlHelper` | The same grid declared with the `Html.PivotForge().PivotGrid()` fluent helper. |
| `/Home/TagHelpers` | The same grid declared with `<pivot-grid>` / `<pivot-field>` tag helpers. |

The two declarative pages emit a byte-identical configuration payload — they differ only in
whether the declaration is C# or markup. Neither contains hand-written JavaScript.

## What It Demonstrates

- Typed `AddPivotForge<SalesRecord>` data-provider registration
- Packaged `/pivotforge` minimal API endpoints
- Razor Class Library assets under `_content/PivotForge.AspNetCore`
- Compact and tabular layouts
- The packaged field designer (drag-and-drop layout building from `PivotForge.AspNetCore`), plus filtering, sorting, and show-as calculations
- Single row and cell selection with keyboard navigation
- Drill-down filtering and CSV export
- Excel export
- Saved views and state persistence in localStorage
- Conditional formatting and cell context actions
- Large-data sessions, virtual pages, cancellation, and cache reuse

## Project Boundary

The demo owns only sample data, MVC views, and application-specific presentation. Pivot calculation belongs to `PivotForge.Core`; reusable endpoints, caching, CSS, and JavaScript belong to `PivotForge.AspNetCore`.

The demo uses project references during repository development. The clean package-consumer smoke project under `artifacts/smoke/PivotForge.AspNetCore.Consumer` verifies the same integration using only local NuGet packages.

This sample is intentionally not packed or published as a NuGet package.
