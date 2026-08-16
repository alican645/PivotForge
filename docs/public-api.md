# Public API Surface

This document records the supported public surface for `0.4.0-preview.4`. Public .NET members also ship with XML documentation for IntelliSense. Types under an `Internal` namespace and unlisted browser implementation details are not compatibility contracts.

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
- `PivotForge.AspNetCore.Rendering.PivotGridBuilder`: declares a pivot grid's container, options, and fields, and renders its markup plus the `PivotForge.create` initialization script. `FieldDesigner(string selector)` renders an interactive field designer into the matching host element.
- `PivotForge.AspNetCore.Rendering.PivotFieldCollectionBuilder`: collects fields in declaration order via `Add()`.
- `PivotForge.AspNetCore.Rendering.PivotFieldBuilder`: configures a single field's data source, area, role, aggregation, show-as, caption, visibility, and number format (`FormatType`, `FormatDecimals`, `FormatGrouping`, `FormatCurrency`).
- `PivotForge.AspNetCore.Rendering.PivotArea`: `Row`, `Column`, `Data`, `Filter`, `Available`.
- `PivotForge.AspNetCore.Rendering.PivotFieldRole`: `Dimension`, `Measure`. Required on `PivotArea.Available` fields; inferred elsewhere from `Area`.
- `PivotForge.AspNetCore.Rendering.PivotValueFormatType`: `Number`, `Currency`, `Percent`. Selects how a data field's values are formatted in the browser.
- `PivotForge.AspNetCore.Rendering.PivotGridTagHelper`: targets `<pivot-grid>`; mirrors the builder's options as kebab-case attributes, including `field-designer`, and delegates to `PivotGridBuilder`.
- `PivotForge.AspNetCore.Rendering.PivotFieldTagHelper`: targets `<pivot-field>` inside a `<pivot-grid>`; declares one field, including its `role` attribute. Requires `@addTagHelper *, PivotForge.AspNetCore`.

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
- `PivotForge.PivotLayoutState`
- `PivotForge.PivotFieldDesigner`
- `PivotForge.PivotViewStore`
- `PivotForge.PivotDrillDownData`
- `PivotForge.PivotDrillDownModal`
- `PivotForge.PivotVirtualDataSource`

`PivotForge.create(target, options)` builds and returns a `PivotWidget` from a declarative field list; see the [ASP.NET Core integration guide](aspnetcore-integration.md#declarative-api) for its full contract. `PivotForge.PivotRequestBuilder` normalizes and validates the field model shared by the declarative Razor and JavaScript APIs. `PivotWidget.update({ fields, filters, rowSort })` applies any combination of those pieces and refreshes exactly once, alongside the existing `updateFields(fields)`. `PivotForge.PivotLayoutState` and `PivotForge.PivotFieldDesigner` implement the interactive field designer described in the [ASP.NET Core integration guide](aspnetcore-integration.md#field-designer), including positional drag-and-drop: `move(name, area, index)` places a field at a specific slot, and dropping a chip into the zone it already occupies reorders it. `setFormat(name, format)` sets or clears a data field's number format, which the designer edits through a per-chip panel; a widget built with the `fieldDesigner` option exposes them as `widget.layoutState` and `widget.designer`. `PivotForge.PivotDrillDownModal` renders the source records behind a cell — search, per-column filters, CSV export and truncation notice — deriving its columns, captions and number formats from the declared fields; `PivotWidget` builds one on first cell activation unless `drillDownModal` is `false` or the consumer supplied its own `rendererOptions.onCellDoubleClick`. `PivotForge.PivotDrillDownData.createFormatter(format)` turns a declared value format into a column formatter.

Static assets are served from `/_content/PivotForge.AspNetCore/`.

## Compatibility Policy

PivotForge follows Semantic Versioning. During the `0.x` preview line, breaking changes may be made when necessary and will be called out in release notes. After `1.0.0`, incompatible public API changes require a new major version. Additive members and behavior-preserving fixes may ship in minor or patch releases as appropriate.

### Breaking changes in `0.4.0-preview.1`

- **`PivotFieldBuilder.Format(string)` is removed.** It took an opaque string that
  the browser never read, so a format declared through it was silently ignored.
  Replace it with `FormatType(PivotValueFormatType)`, `FormatDecimals(int)`,
  `FormatGrouping(bool)`, and `FormatCurrency(string)`.
- **The `format` attribute on the `pivot-field` tag helper is removed**, for the
  same reason. Replace it with `format-type`, `format-decimals`,
  `format-grouping`, and `format-currency`.

Both removals are compile-time errors rather than silent behavior changes, so a
project that used them will not build until the declaration is updated.
