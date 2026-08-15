# Public API Surface

This document records the supported public surface for `0.2.0-preview.1`. Public .NET members also ship with XML documentation for IntelliSense. Types under an `Internal` namespace and unlisted browser implementation details are not compatibility contracts.

## PivotForge.Core

### Pivot model and engine

- `PivotEngine`: executes object, `DataTable`, and dictionary sources; supports cancellation and drill-down.
- `PivotRequest`, `PivotFilter`, `PivotValueDefinition`, `PivotSort`: define layout, filtering, values, show-as calculations, and row ordering.
- `PivotAggregation`, `PivotShowAs`, `PivotSortMode`, `PivotSortDirection`: configure calculations and ordering.
- `PivotResult`, `PivotCell`, `PivotTotal`, `PivotSubtotal`, `PivotMetadata`: represent completed pivot output.
- `PivotResultPaginator`, `PivotResultPage`: create row-based pages from a completed result.
- `PivotFieldNotFoundException`, `PivotFieldTypeException`: report invalid fields and incompatible aggregation values.

### Input and export

- `PivotForge.Core.Records.CsvRecordParser`
- `PivotForge.Core.Records.JsonRecordParser`
- `PivotForge.Core.Excel.PivotExcelExporter`
- `PivotForge.Core.Excel.PivotExcelDocument`, `PivotExcelRow`, `PivotExcelCell`
- `PivotForge.Core.Excel.PivotExcelCellRole`, `PivotExcelHighlight`

## PivotForge.AspNetCore

### Registration and endpoints

- `AddPivotForge<TRecord>(dataProvider, configure)` registers the provider, cache, executor, options, and JSON enum support.
- `MapPivotForgeEndpoints(pattern)` maps the route group. The default prefix is `/pivotforge`; a custom prefix may be supplied with or without a leading or trailing slash.
- `PivotForgeDataProvider<TRecord>` and `PivotForgeDataRequest` define source loading.
- `PivotForgeOptions` configures cache duration, paging, source-row, drill-down, and Excel limits.

### HTTP models and cache extension point

- Request models: `PivotForgeRequest`, `PivotForgeLargeStartRequest`, `PivotForgePageRequest`, `PivotForgeDrillDownRequest`.
- Response models: `PivotForgeLargeStartResponse`, `PivotForgeDrillDownResponse`, `PivotForgeErrorResponse`.
- Cache contract: `IPivotForgeResultCache`, `PivotForgeResultCache`, `PivotForgeCacheEntry`.

### Declarative rendering

- `PivotForge.AspNetCore.Rendering.PivotForgeHtmlHelperExtensions`: exposes `Html.PivotForge()` on `IHtmlHelper`.
- `PivotForge.AspNetCore.Rendering.PivotForgeFactory`: creates component builders; `PivotGrid()` returns a `PivotGridBuilder`.
- `PivotForge.AspNetCore.Rendering.PivotGridBuilder`: declares a pivot grid's container, options, and fields, and renders its markup plus the `PivotForge.create` initialization script.
- `PivotForge.AspNetCore.Rendering.PivotFieldCollectionBuilder`: collects fields in declaration order via `Add()`.
- `PivotForge.AspNetCore.Rendering.PivotFieldBuilder`: configures a single field's data source, area, aggregation, show-as, format, caption, and visibility.
- `PivotForge.AspNetCore.Rendering.PivotArea`: `Row`, `Column`, `Data`, `Filter`.

### Endpoint contract

All routes are relative to the configured group prefix:

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/pivot` | Execute a pivot request. |
| `POST` | `/large/start` | Execute or reuse a cached result and return its first page. |
| `POST` | `/large/page` | Return a page from a cached session. |
| `POST` | `/drill-down` | Return source records behind a pivot coordinate. |
| `POST` | `/excel` | Export a client-built pivot document as XLSX. |

## Browser API

Razor Class Library scripts expose these constructors and helpers under `window.PivotForge`:

- `PivotForge.PivotTableRenderer`
- `PivotForge.PivotRequestBuilder`
- `PivotForge.create` / `PivotForge.PivotWidget`
- `PivotForge.PivotViewStore`
- `PivotForge.PivotDrillDownData`
- `PivotForge.PivotVirtualDataSource`

`PivotForge.create(target, options)` builds and returns a `PivotWidget` from a declarative field list; see the [ASP.NET Core integration guide](aspnetcore-integration.md#declarative-api) for its full contract. `PivotForge.PivotRequestBuilder` normalizes and validates the field model shared by the declarative Razor and JavaScript APIs.

Static assets are served from `/_content/PivotForge.AspNetCore/`.

## Compatibility Policy

PivotForge follows Semantic Versioning. During the `0.x` preview line, breaking changes may be made when necessary and will be called out in release notes. After `1.0.0`, incompatible public API changes require a new major version. Additive members and behavior-preserving fixes may ship in minor or patch releases as appropriate.
