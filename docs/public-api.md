# Public API Surface

This document records the supported public surface for `0.5.0-preview.1`. Public .NET members also ship with XML documentation for IntelliSense. Types under an `Internal` namespace and unlisted browser implementation details are not compatibility contracts.

## PivotForge.Core

### Pivot model and engine

- `PivotEngine`: executes object, `DataTable`, and dictionary sources; supports cancellation and drill-down. `DistinctValues` / `DistinctValuesRecords` list the values a filter on a field can accept, in reading order. The parameterless constructor collates row labels with `CultureInfo.CurrentCulture`, resolved per call; `new PivotEngine(CultureInfo)` pins it.
- `PivotRequest`, `PivotFilter`, `PivotValueDefinition`, `PivotSort`, `PivotFieldSort`: define layout, filtering, values, show-as calculations, and ordering. `PivotSort` orders the row axis as a whole; `PivotRequest.FieldSorts` orders one row or column field's own header level within its parent group, and `PivotSort` wins over it on the row axis.
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
- `PivotForgeOptions` configures cache duration, paging, source-row, drill-down, Excel, and filter value (`FieldValueLimit`) limits.

### HTTP models and cache extension point

- Request models: `PivotForgeRequest`, `PivotForgeLargeStartRequest`, `PivotForgePageRequest`, `PivotForgeDrillDownRequest`, `PivotForgeFieldValuesRequest`.
- Response models: `PivotForgeLargeStartResponse`, `PivotForgeDrillDownResponse`, `PivotForgeFieldValuesResponse`, `PivotForgeErrorResponse`.
- Cache contract: `IPivotForgeResultCache`, `PivotForgeResultCache`, `PivotForgeCacheEntry`.

### Declarative rendering

`PivotSelectionMode` and `PivotGridLayoutMode` describe the renderer presentation options the grid can declare. `PivotFilterTagHelper`, `PivotSortTagHelper` and `PivotConditionalRuleTagHelper` declare the state a grid starts in, alongside `PivotGridBuilder.Filter`, `RowSort` and `ConditionalRule`; `PivotConditionalOperator`, `PivotConditionalColor` and `PivotValueKey` support them. `PivotGridBuilder.On*` methods (and the matching `on-*` attributes) name page functions for the widget's events, which are also dispatched on the container as `pivotforge:*` CustomEvents.

- `PivotForge.AspNetCore.Rendering.PivotForgeHtmlHelperExtensions`: exposes `Html.PivotForge()` on `IHtmlHelper`.
- `PivotForge.AspNetCore.Rendering.PivotForgeFactory`: creates component builders; `PivotGrid()` returns a `PivotGridBuilder`.
- `PivotForge.AspNetCore.Rendering.PivotGridBuilder`: declares a pivot grid's container, options, and fields, and renders its markup plus the `PivotForge.create` initialization script. `FieldDesigner(string selector)` renders an interactive field designer into the matching host element.
- `PivotForge.AspNetCore.Rendering.PivotFieldCollectionBuilder`: collects fields in declaration order via `Add()`.
- `PivotForge.AspNetCore.Rendering.PivotFieldBuilder`: configures a single field's data source, area, role, aggregation, show-as, caption, visibility, number format (`FormatType`, `FormatDecimals`, `FormatGrouping`, `FormatCurrency`), its position within its area (`AreaIndex`), its own level's ordering on the `Row` and `Column` axes (`SortOrder`), and — on `Row` fields — its initial expansion (`Expanded`) and whether its groups carry a total (`ShowTotals`).
- `PivotForge.AspNetCore.Rendering.PivotArea`: `Row`, `Column`, `Data`, `Filter`, `Available`.
- `PivotForge.AspNetCore.Rendering.PivotFieldRole`: `Dimension`, `Measure`. Required on `PivotArea.Available` fields; inferred elsewhere from `Area`.
- `PivotForge.AspNetCore.Rendering.PivotValueFormatType`: `Number`, `Currency`, `Percent`. Selects how a data field's values are formatted in the browser.
- `PivotForge.AspNetCore.Rendering.PivotStateStorage`: `None`, `Local`, `Session`. Selects where the grid persists the state a user arrives at; `None` and an unwritten attribute mean the same thing, so persistence is opt-in.
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
| `POST` | `/field-values` | Return the distinct values a filter on one field can accept. |
| `POST` | `/excel` | Export a client-built pivot document as XLSX. |

## Browser API

Razor Class Library scripts expose these constructors and helpers under `window.PivotForge`:

- `PivotForge.PivotTableRenderer`
- `PivotForge.PivotRequestBuilder`
- `PivotForge.create` / `PivotForge.PivotWidget`
- `PivotForge.PivotLayoutState`
- `PivotForge.PivotFieldDesigner`
- `PivotForge.PivotFilterPicker`
- `PivotForge.PivotViewStore`
- `PivotForge.PivotDrillDownData`
- `PivotForge.PivotDrillDownModal`
- `PivotForge.PivotVirtualDataSource`

`PivotForge.create(target, options)` builds and returns a `PivotWidget` from a declarative field list; see the [ASP.NET Core integration guide](aspnetcore-integration.md#declarative-api) for its full contract. `PivotForge.PivotRequestBuilder` normalizes and validates the field model shared by the declarative Razor and JavaScript APIs. `PivotWidget.update({ fields, filters, rowSort })` applies any combination of those pieces and refreshes exactly once, alongside the existing `updateFields(fields)`. `PivotForge.PivotLayoutState` and `PivotForge.PivotFieldDesigner` implement the interactive field designer described in the [ASP.NET Core integration guide](aspnetcore-integration.md#field-designer), including positional drag-and-drop: `move(name, area, index)` places a field at a specific slot, and dropping a chip into the zone it already occupies reorders it. `setFormat(name, format)` sets or clears a data field's number format, `setShowAs(name, showAs)` sets a value's show-as calculation, and `setCaption(name, caption)` overrides a field's display caption (`declaredCaption(name)` recovers the declared one, and an empty caption clears the override). The designer edits all of them, plus position and removal, through a per-field settings modal opened with the button on a placed chip; a widget built with the `fieldDesigner` option exposes them as `widget.layoutState` and `widget.designer`. `PivotForge.PivotDrillDownModal` renders the source records behind a cell — search, per-column filters, CSV export and truncation notice — deriving its columns, captions and number formats from the declared fields; `PivotWidget` builds one on first cell activation unless `drillDownModal` is `false` or the consumer supplied its own `rendererOptions.onCellDoubleClick`. `PivotForge.PivotDrillDownData.createFormatter(format, culture)` turns a declared value format into a column formatter. `PivotForge.PivotFilterPicker` lists a filter field's distinct values as a searchable checkbox modal, fetched through `widget.fieldValues(field)`; the designer builds one on first use, so a declarative page needs only the script tag.

Static assets are served from `/_content/PivotForge.AspNetCore/`.

## Compatibility Policy

PivotForge follows Semantic Versioning. During the `0.x` preview line, breaking changes may be made when necessary and will be called out in release notes. After `1.0.0`, incompatible public API changes require a new major version. Additive members and behavior-preserving fixes may ship in minor or patch releases as appropriate.

### Behaviour changes since `0.5.0-preview.1`

- **The rendered table no longer re-sorts rows in the browser.** It drew them in
  a hard-coded `tr` collation of its own, which overrode both the culture the
  request was executed in and any order the engine had been asked for. Rows are
  now drawn in the order the engine sent. A grid whose ambient culture is not
  `tr-TR` will therefore see its rows collated in that culture, as the
  `0.5.0-preview.1` culture fix already intended.

### Behaviour changes in `0.5.0-preview.1`

- **Culture is no longer hard-coded to `tr-TR`.** Server-side collation of row
  labels and filter values now follows `CultureInfo.CurrentCulture`, resolved
  per call, so an ASP.NET application with request localization configured sorts
  each request in that request's culture. `new PivotEngine(culture)` pins it for
  a direct `PivotForge.Core` consumer. In the browser, numbers are formatted in
  the reader's own locale unless the new `culture` attribute declares one.

  This is a correctness fix rather than a preference: in Turkish `Ç` is a letter
  of its own that sorts after every word starting with `C`, while elsewhere it is
  a variant of `C` and the following letters decide. A non-Turkish consumer was
  getting Turkish letter order with no way to say otherwise. Rows and filter
  value lists will therefore reorder for anyone whose ambient culture is not
  `tr-TR`; declare `culture` and configure request localization to pin the old
  behaviour.

- **The filter picker's value list is collated, not ordinal.** It is shown to a
  person, so it is sorted the way that person reads. Numeric and date fields
  still sort by value rather than by text.

### Additions in `0.5.0-preview.1`

- `PivotEngine.DistinctValues` (object, `DataTable`) and `DistinctValuesRecords`,
  behind `POST /pivotforge/field-values` and the packaged `PivotFilterPicker`.
- `state-storing` / `state-key` (`PivotStateStorage`, `StateStoring`, `StateKey`)
  persist and restore field layout, captions, filter selections, aggregation,
  format and sorting.
- `aria-label` / `AriaLabel(string)` names the grid; `culture` / `Culture(string)`
  pins browser number formatting.
- `rendererOptions.texts` overrides any renderer string; an omitted key keeps its
  built-in default.
- The field designer works with touch, pen and keyboard, and the rendered table
  declares `role="grid"` with the roles and ARIA state that make its existing
  selection and keyboard model reach a screen reader.

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
