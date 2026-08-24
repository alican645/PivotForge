# Public API Surface

This document records the supported public surface for `0.6.0-preview.1`. Public .NET members also ship with XML documentation for IntelliSense. Types under an `Internal` namespace and unlisted browser implementation details are not compatibility contracts.

## PivotForge.Core

### Pivot model and engine

- `PivotEngine`: executes object, `DataTable`, and dictionary sources; supports cancellation and drill-down. `DistinctValues` / `DistinctValuesRecords` list the values a filter on a field can accept, in reading order. The parameterless constructor collates row labels with `CultureInfo.CurrentCulture`, resolved per call; `new PivotEngine(CultureInfo)` pins it. `PivotEngine.Project` reduces records to a chosen set of fields, which is how the ASP.NET drill-down endpoint honours an allow-list.
- `PivotRequest`, `PivotFilter`, `PivotValueDefinition`, `PivotSort`, `PivotFieldSort`: define layout, filtering, values, show-as calculations, and ordering. `PivotSort` orders the row axis as a whole; `PivotRequest.FieldSorts` orders one row or column field's own header level within its parent group, and `PivotSort` wins over it on the row axis.
- `PivotAggregation`, `PivotShowAs`, `PivotSortMode`, `PivotSortDirection`: configure calculations and ordering.
- `PivotFilterMode`: whether a `PivotFilter`'s values are the ones to keep (`Include`, the default) or the ones to drop (`Exclude`). An empty value list restricts nothing in either mode.
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
- `PivotTopN` / `PivotTopNMode` limit a row header level to its highest or lowest ranking groups, ranked after aggregation and counted inside each parent group. On `PivotRequest.TopN`; declared as `<pivot-top-n>` or `PivotGridBuilder.TopN`.
- `PivotForgeOptions` configures cache duration, paging, source-row, drill-down, Excel, and filter value (`FieldValueLimit`) limits, plus `AllowedFields`, the set of source fields the endpoints may read.

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
- `PivotForge.PivotConditionalPanel`
- `PivotForge.PivotViewStore`
- `PivotForge.PivotDrillDownData`
- `PivotForge.PivotDrillDownModal`
- `PivotForge.PivotVirtualDataSource`

`PivotForge.create(target, options)` builds and returns a `PivotWidget` from a declarative field list; see the [ASP.NET Core integration guide](aspnetcore-integration.md#declarative-api) for its full contract. `PivotForge.PivotRequestBuilder` normalizes and validates the field model shared by the declarative Razor and JavaScript APIs. `PivotWidget.update({ fields, filters, rowSort })` applies any combination of those pieces and refreshes exactly once, alongside the existing `updateFields(fields)`. `PivotForge.PivotLayoutState` and `PivotForge.PivotFieldDesigner` implement the interactive field designer described in the [ASP.NET Core integration guide](aspnetcore-integration.md#field-designer), including positional drag-and-drop: `move(name, area, index)` places a field at a specific slot, and dropping a chip into the zone it already occupies reorders it. `setFormat(name, format)` sets or clears a data field's number format, `setShowAs(name, showAs)` sets a value's show-as calculation, and `setCaption(name, caption)` overrides a field's display caption (`declaredCaption(name)` recovers the declared one, and an empty caption clears the override). The designer edits all of them, plus position and removal, through a per-field settings modal opened with the button on a placed chip; a widget built with the `fieldDesigner` option exposes them as `widget.layoutState` and `widget.designer`. `PivotForge.PivotDrillDownModal` renders the source records behind a cell — search, per-column filters, CSV export and truncation notice — deriving its columns, captions and number formats from the declared fields; `PivotWidget` builds one on first cell activation unless `drillDownModal` is `false` or the consumer supplied its own `rendererOptions.onCellDoubleClick`. `PivotForge.PivotDrillDownData.createFormatter(format, culture)` turns a declared value format into a column formatter. `PivotForge.PivotFilterPicker` lists a filter field's distinct values as a searchable checkbox modal, fetched through `widget.fieldValues(field)`; the designer builds one on first use, so a declarative page needs only the script tag. It also carries the filter's mode: `open({ ..., mode })` is the mode to open on, and `onApply(values, mode)` reports back both. `PivotLayoutState.setFilterMode(name, mode)` sets it, `widget.setFilter(field, values, mode)` applies it, and a stored view carries it — one saved before modes existed restores as `Include`. `PivotForge.PivotConditionalPanel` authors a conditional formatting rule over the cell it was opened on, offering exactly the six comparisons and four highlights `PivotTableRenderer` evaluates; `PivotWidget` builds one on first use unless `allowConditionalFormatting` is `false` or the consumer supplied its own `rendererOptions.onConditionalFormatRequested`, and `addConditionalRule(rule)`, `clearConditionalRules(valueKey)` and `setConditionalRules(rules)` change the list, redraw without issuing a request, and persist when `stateStoring` is on. `PivotForge.isConditionalRule(rule)` is the shared check they all apply — whether anything could act on a rule at all, as against `matchesConditionalRule`, which asks about one value; a stored rule that fails it is dropped rather than thrown on. The renderer's cell menu now leaves out an action whose handler the host did not supply, so `onSortRequested`, `onCellFilterRequested` and `onConditionalFormatRequested` each decide whether their entry appears at all.

Static assets are served from `/_content/PivotForge.AspNetCore/`.

## Compatibility Policy

PivotForge follows Semantic Versioning. During the `0.x` preview line, breaking changes may be made when necessary and will be called out in release notes. After `1.0.0`, incompatible public API changes require a new major version. Additive members and behavior-preserving fixes may ship in minor or patch releases as appropriate.

### Behaviour changes in `0.6.0-preview.1`

- **`hide-empty-summary-cells` / `HideEmptySummaryCells(bool)`** drops rows and
  columns that hold no values at all. `PivotRequest` gained
  `HideEmptySummaryCells`; the engine renumbers cells, row and column totals and
  each subtotal's own cells together, so nothing survives pointing at an index
  that moved. Grand totals are unchanged, because a row that aggregated to
  nothing contributed nothing to them. Off by default, and omitted from the wire
  when undeclared.

- **A filter carries an operator.** `PivotFilter` gained an
  `Operator` (`PivotFilterOperator`, defaulting to `Equals`), so `Values` doubles
  as the operator's arguments: the list of values to keep for `Equals`, the
  argument for `Contains`/`StartsWith`/`EndsWith`/`GreaterThan`/`LessThan`, two
  for `Between`, none for `Blank`. `PivotFilterMode.Exclude` negates whichever
  operator is used, which is where "does not contain" comes from. A condition
  with fewer arguments than its operator reads restricts nothing, exactly as an
  empty list already did; a *declaration* with too few throws.

  New with it: `operator` on `<pivot-filter>`,
  `PivotGridBuilder.Filter(string, PivotFilterMode, PivotFilterOperator, params string[])`,
  `widget.setFilter(field, values, mode, operator)`,
  `layoutState.setFilterOperator(field, operator)`, a condition row in
  `PivotFilterPicker`, and `PivotRequestBuilder.restricts(filter)` — the one rule
  the funnel, the chip and the request all consult. On the wire the default
  operator is omitted, so a payload from a page that never used one is unchanged.

- **A header axis is a list of levels, not a list of field names.**
  `PivotRequest.Rows` and `PivotRequest.Columns` are now
  `IReadOnlyList<PivotFieldRef>`, where a `PivotFieldRef` is a source field plus
  an optional `PivotGroupInterval`. A field name converts to one implicitly, so
  `Rows = ["Region"]` still compiles and means what it did; code that *reads*
  `request.Rows` as strings does not. The change buys what a name alone could
  not express: the same date column at two intervals, which is what a year over
  month hierarchy is.

  With it, `PivotFilter` gained an `Interval`, `PivotEngine.DistinctValues`
  gained an optional one, and both collapse the source value the same way the
  header did before comparing. On the wire a plain level is still the bare
  string it always was; a grouped one is `{"field","interval"}`, and a string is
  never split on its colon, so a column called `A:B` is unaffected.

- **On-screen text defaults to English.** Every string the grid, the field
  designer, the filter value picker and the detail modal put on screen was
  Turkish and is now English. Turkish moves into a locale pack — reference
  `js/pivot-locale-tr.js` and the text comes back, without any grid naming it:
  `<pivot-grid>` derives the pack name from `CultureInfo.CurrentUICulture`, so
  an application with request localization configured keeps its language. A
  page that hard-codes no culture but expects Turkish must add the script tag.
  A pack name nothing answers to warns in the console and leaves the text
  English rather than failing the grid; `en` names the built-in defaults and
  loads nothing.

  New with it: `locale` / `Locale(string)` on the grid, `designerLabels` on the
  widget — the field designer's labels had no declarative path at all before,
  and `designerLabels.filterPicker` reaches the value picker the designer opens.

- **`group-interval` / `GroupInterval(PivotGroupInterval)`** collapses a date
  field into year, quarter, month, day or weekday header groups. Labels come
  from the resolved culture and order by the interval rather than the alphabet;
  a grouped column axis therefore orders itself instead of keeping arrival
  order. In the browser a level is identified by `field:interval`, which is what
  `rowFields`, `fieldSorts`, a filter entry and the header funnel all name.

- **A filter belongs to the field, not to the Filters zone.** Every row field's
  header cell in the rendered table carries a `▼` that opens the same
  `PivotFilterPicker` over the same entry, so a row or column field can be
  filtered where it stands. `PivotLayoutState.setFilterValues`/`setFilterMode`
  therefore no longer require the field to be in the filter area (they refuse a
  measure instead), `getState().filters` can hold an entry for a field seated
  elsewhere — the designer's Filters zone shows only the ones seated there —
  `move` carries a filter across areas, and `widget.setFilter` writes through
  `widget.layoutState` when a designer is attached. The renderer gained
  `onFilterRequested(field)` and `filteredFields`, wired like `onSortRequested`:
  no callback, no funnel. The column axis has no field-name cell and is
  unaffected.

- **A filter now carries a mode, and so does a saved view.** `PivotFilter` gained
  `Mode`, the request JSON gained `filters[].mode`, and the persisted state
  stores it. Everything defaults to `Include`, which is what the previous
  behaviour was, and a view saved before modes existed restores as `Include`.
  A consumer that reads persisted filter entries or supplies its own
  `PivotFilterPicker.onApply` will see the extra member and the extra argument.

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
