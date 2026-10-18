# Changelog

All notable changes to PivotForge are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`PivotForge.Core` and `PivotForge.AspNetCore` ship together under one version
number, so a release entry covers both; each change names the package it
belongs to when that is not obvious.

During the `0.x` preview line, breaking changes may be made when necessary and
are called out under **Breaking**. After `1.0.0`, an incompatible public API
change will require a new major version.

## [Unreleased]

### Breaking

- Observed all-null sums now return zero, matching DevExtreme 26.1.3; an entirely
  empty source still has no sum. Zero sums remain visible under empty-cell hiding
  and participate in formulas, value filters and Top-N. Use Average/Min/Max when
  an all-null group must remain empty. Null summaries sort first ascending and
  last descending; equal summaries use the requested direction for label ties.
  (Core)

### Compatibility

- Added an offline corpus generated from real DevExtreme 26.1.3 / Chromium
  151.0.7922.34 runs: 275 passing calculation/sorting scenarios, including NaN
  summary ordering on both axes up to 1,024 groups.
  See `tests/compatibility/README.md` for provenance, scope and reproduction.
- Empty averages retain their NaN distinction internally for summary sorting;
  affected sibling groups use reference-compatible PowerSort traversal. Public
  numeric results remain nullable decimal and no runtime dependency is added.
- Variations now calculate in neutral ascending column order before display
  sorting, including sibling column subtotals. Sparse dictionary records treat
  an omitted known field as empty while unknown schema fields still fail. (Core)

### Changed

- A row or column level whose values are numbers or dates now orders by value
  (9 before 10, dates by date) even without a declared data type, as
  DevExtreme's default `sortBy: "value"` does; it used to order their text.
  `DataTypes = String` or `SortBy = DisplayText` keeps the text order. Date
  labels are read invariantly first when ordered, so a culture such as tr-TR no
  longer swaps day and month. (Core)

### Added

- DevExtreme's cell events: `cellPrepared` (every drawn cell, with its area,
  text, value and paths; what a handler adds stays and is exported),
  `cellClick` (cancel stops selecting and folding), `contextMenuPreparing`
  (edit `items`, add `{ label, onClick }`, empty opens no menu) and
  `expandValueChanging` (cancel keeps the group as it is), through `on()`,
  `events`, `rendererOptions` and `on-cell-prepared` / `on-cell-click` /
  `on-context-menu-preparing` / `on-expand-value-changing`. (AspNetCore)
- Custom state storage, DevExtreme's `customLoad` / `customSave`:
  `state-storing="Custom"` with `state-custom-load` / `state-custom-save` /
  `CustomStateStorage(load, save)` / `stateStoring: "custom"`; a promised load
  is waited for by the first request. `state-saving-timeout` /
  `StateSavingTimeout(ms)` / `stateSavingTimeout` delays saves, flushing on
  page hide and dispose. (AspNetCore)
- Fields worked out from the whole record, DevExtreme's `selector`, as a
  function registered by name: `PivotEngine.CustomSelectors` /
  `PivotForgeOptions.CustomSelectors` (`PivotSelector`, reading
  `record["Field"]` or the typed `record.Source`), picked by
  `PivotRequest.Selectors` / `selector` / `Selector(string)` /
  `selector: "fiscalYear"`. Headers, filters, the value list, drill-down,
  sorting, formulas and measures all read the selected value; a field the
  source has is replaced, and a name of the selector's own needs no source
  column or `AllowedFields` entry. An unregistered name is refused (400).
  `DistinctValues` takes the same map. (Core, AspNetCore)
- Which columns each value appears in, DevExtreme's `showValues` and a
  measure's `showTotals`: `show-values="false"` / `ShowValues(false)` /
  `showValues: false` leaves a value out of the detail columns, `show-totals`
  (now valid on a data field) out of the subtotal columns, and out of the
  detail columns too while `showValues` is undeclared. The value leaves those
  columns outright -- head, body, totals, virtual columns and Excel export --
  and a kind of column every value gives up keeps them all. With values on
  rows the same rules pick the value rows. (AspNetCore)
- What a level is sorted by, DevExtreme's `sortBy` and `sortingMethod`:
  `PivotFieldSort.SortBy` (`PivotSortBy.Value`, `DisplayText`, `None`) /
  `sort-by` / `SortBy(PivotSortBy)` / `sortBy: "value" | "displayText" | "none"`,
  and `SortingMethod`, the name of a comparer registered in
  `PivotEngine.CustomSorts` / `PivotForgeOptions.CustomSorts` /
  `sorting-method` / `SortingMethod(string)` / `sortingMethod`. Both axes, with
  the direction applied; `None` keeps the source's order; with a summary sort
  they break ties. An unregistered name is refused (400). Display calculations
  keep value order but follow a sorting method. (Core, AspNetCore)
- Formulas that read other cells, DevExtreme's cell API: `Prev(x)` / `Next(x)`
  (previous / next column), `PrevRow(x)` / `NextRow(x)`, `ParentRow(x)` /
  `ParentColumn(x)`, `RowTotal(x)` / `ColumnTotal(x)` / `GrandTotal(x)` and
  `Slice(x, [Field], n)` (`Slice([Amount], [Year], -1)` is last year), each
  taking any formula: `([Amount] - Prev([Amount])) / Prev([Amount])` is the
  growth on the previous period. Rows run in their labels' order, columns as
  drawn (skipping columns no record fell into); a missing cell reads as
  empty; `AllowCrossGroupCalculation = false` keeps neighbours inside the
  parent group; display modes apply to the result. The browser's parser and
  the designer's formula check accept the same grammar. (Core, AspNetCore)
- Running totals in either direction, DevExtreme's `runningTotal`:
  `PivotValueDefinition.RunningTotal` (`PivotRunningTotal.Row` along each row,
  `Column` down each column) / `running-total="Row|Column"` /
  `RunningTotal(PivotRunningTotal)` / `runningTotal: "row" | "column"`, and a
  **Running total** section in the designer's value settings ("Kümülatif
  toplam": Yok / Satır boyunca / Sütun boyunca). It runs after the display mode
  and after sorting, in the order the grid is drawn, so a percent of the
  parent accumulates into a cumulative share; a subtotal accumulates among
  its own level, the totals it runs towards stay as they are, and
  `AllowCrossGroupCalculation = false` starts it again in each parent group.
  `PivotShowAs.RunningTotal` stays as the along-the-row case. (Core,
  AspNetCore)
- Percent of the parent group: `PivotShowAs.PercentOfParentRowTotal` /
  `PercentOfParentColumnTotal` (`show-as`, `showAs: "percentOfParentRowTotal"`,
  "% of parent row / column total", "Üst satır / sütun toplamının %'si"),
  Excel's "% of Parent Row / Column Total" and DevExtreme's
  `percentOfColumnTotal` / `percentOfRowTotal`: each value divided by its
  parent group on one axis -- a city's share of its region in every column --
  with a top-level group's parent being that axis' grand total. Subtotal rows
  and columns, their crossings and the totals follow the same rule.
  (Core, AspNetCore)
- Right to left: `rtl-enabled="true|false"` / `RtlEnabled(bool)` /
  `rtlEnabled`, DevExtreme's `rtlEnabled`. Undeclared, the grid follows the
  page's own direction -- the stylesheet now uses logical properties
  throughout, so a `dir="rtl"` page mirrors it with no declaration. Row
  headers freeze on the right, the arrow keys move the way they point, column
  resizing, keeping a focused cell in view, the cell menu, the filter picker
  and the conditional panel are mirrored, and every overlay takes the grid's
  direction rather than the page's. The chart stays left to right. (AspNetCore)
- `PivotExcelDocument.RightToLeft`: a right-to-left sheet whose horizontal
  alignments trade sides, as the grid's do; a right-to-left grid exports one.
  The `exporting` payload carries `rtlEnabled`. (Core, AspNetCore)
- Collapsing and expanding column groups, the column axis' half of the row
  groups' toggle. Every column header above the innermost level carries a
  ▾ button; pressing it folds the group (a year's quarters, say) into one
  column headed by the group's name with ▸, holding the group's total in
  every row, subtotal row and the grand total row. A collapsed group keeps
  its total column even when column subtotals are switched off, so folding
  never leaves the group empty. The values are the engine's column
  subtotals, so averages and counts stay true group values. `expanded` /
  `Expanded(bool)` / `expanded: false` is now valid on `Column` fields and
  starts that level collapsed. The collapsed set is part of the renderer's
  view state (`collapsedColumnGroups`, next to `collapsedGroups`) and of
  saved views; `expandAll` / `collapseAll` take `{ axis: "column" }` or
  `{ axis: "all" }` and still reach the rows only by default; the toolbar's
  Expand all / Collapse all buttons reach both axes. The header's
  sort arrow on a collapsed column orders the rows by that group's total.
  (AspNetCore)
- Virtual columns: `virtual-columns="true"` / `VirtualColumns(bool, int?)` /
  `rendererOptions.virtualColumns`, DevExtreme's virtual scrolling on the
  column axis. Only a window of columns -- a page either side of the view --
  is drawn, with a spacer before and after keeping the table its full width;
  scrolling sideways redraws the window, and the arrow keys walk past its
  edge. The spacers are measured from the drawn columns
  (`virtual-column-width` is the first guess, 100). Excel, CSV and printing
  get every column. Independent of `large-data`'s row paging. (AspNetCore)
- A group header's menu, DevExtreme's Expand All / Collapse All: right-clicking
  a row header above the innermost level or a column header that folds (or
  the menu key / Shift+F10 on a row header) offers **Expand all {field}** /
  **Collapse all {field}** ("Tüm {0} gruplarını aç / kapat"), which open or
  close every group of that level on that axis at once; an entry with nothing
  to do is disabled. `context-menu="false"` turns it off with the cell menu.
  `expandLevel(axis, level)` / `collapseLevel(axis, level)` on the renderer.
  (AspNetCore)

### Fixed

- A percent display mode on a field with no declared format was drawn as a
  bare ratio (`0.18`). It is drawn as a percentage (`18%`) and exported with
  a `0.00%` number format, as DevExtreme gives a percent display mode a
  percent format. (AspNetCore)
- The frozen headers were not frozen: a general `th` rule outranked the
  rules making the row headers and the head rows sticky, so the row headers
  scrolled away sideways and the head scrolled up out of view. They stick
  now, and each head row sits below the ones above it instead of every row
  stacking at the top. (AspNetCore)

## [0.7.0-preview.1] — 2026-10-18

Pivot charts, numeric ranges, value filters and in-cell bars, values drawn
down the rows with a Σ Values chip, field data types, an export hook,
relevant-only filter values and a deferred layout update.

### Added

- Field data types: `PivotRequest.DataTypes` (`PivotDataType.String|Number|Date`)
  converts a source column's values where they are read, so a text source can
  be summed (`"1250"`), grouped by date (`"2026-03-14"`) and ordered by number
  (9 before 10). A value that does not convert is blank. Aggregation, filters,
  drill-down, ordering and `DistinctValues` (new `dataTypes` argument) see the
  same value. Declared with `field-type` on `<pivot-field>` /
  `PivotFieldBuilder.DataType()` / `dataType` in JavaScript (DevExtreme's
  `dataType`); the request carries `dataTypes`, which `AllowedFields`
  governs and the large-data cache keys on. (Core, AspNetCore)
- The field designer's **Σ Values** chip (`Σ Değerler` in Turkish): while
  there are two or more values it sits at the end of the Columns or Rows
  zone, and dragging it (or moving it with the keyboard) between the two
  switches `valuesPosition`. It cannot be removed and has no settings. The
  position is part of the layout -- `PivotLayoutState.valuesPosition` /
  `setValuesPosition()`, `toRequestState().valuesPosition`, `update({
  valuesPosition })` -- and is kept by `state-storing` and in report files
  when it differs from the page's declaration. (AspNetCore)
- `values-position="Rows"` / `ValuesPosition(PivotValuesPosition.Rows)` /
  `rendererOptions.valuesPosition: "rows"` draws several values down the rows
  instead of across the columns, as DevExtreme's `dataFieldArea: "row"`
  does: each pivot row (its subtotals and the grand total too) becomes one
  row per value, the row headers span the block, and a **Values** column
  (`texts.valuesHeading`, "Değerler" in Turkish) names each row. The column
  axis carries a single value slot, with no value-header row. A value giving
  up its grand total leaves a blank so the rows stay aligned. With one value
  nothing changes. Renderer only; the request and the engine are untouched.
  (AspNetCore)
- An `exporting` event (`on-exporting` / `OnExporting(string)` /
  `events: { exporting }`, DOM `pivotforge:exporting`) fires before an Excel
  or CSV file is made. The handler gets `{ format, document, fileName, cancel }`:
  it changes cells in place, each of which carries a `source` (`area`,
  `rowType`, `rowPath`, `columnPath`, `valueKey`, `value`) that is stripped
  before the document is posted; it renames the file; or it cancels, and the
  export method returns `null`. DevExtreme's `onExporting` and `customizeCell`
  in one place. (AspNetCore)
- `defer-layout-update="true|false"` / `DeferLayoutUpdate(bool)` /
  `deferLayoutUpdate`: Excel's **Defer layout update** box and **Update**
  button at the foot of the field designer (DevExtreme's
  `applyChangesMode: "onDemand"`). While ticked, designer edits change only
  the panel and reach the grid together, in one request, on Update or when
  the box is cleared. Undeclared, the panel is as before. In the Turkish
  locale: "Düzen güncellemesini ertele" / "Güncelle". (AspNetCore)
- `show-relevant-values="true"` / `ShowRelevantValues(bool)` /
  `showRelevantValues: true`: a filter picker lists only the values the other
  fields' filters leave, as DevExtreme's `headerFilter.showRelevantValues`
  does. The field's own filter never narrows its list. `/field-values` takes
  an optional `filters` list (checked against `AllowedFields`), and
  `PivotEngine.DistinctValues(records, field, filters, ...)` is the new
  overload behind it. (Core, AspNetCore)
- `PivotExcelCell.FontColor` (`#RRGGBB`) and `PivotExcelCell.Bold` — a text
  colour and a weight that overrides the role's, so a negative value can be
  written red. (Core)
- The field designer changes a numeric range's width: a range level's settings
  carry a **Range width** box (`Aralık genişliği`) with Apply and a way back
  to the declared width. The level is renamed with its width, keeping its
  caption, sort, position and value filter; its filter values start afresh.
  Kept with the view and in report files (`groupSizes`), and in
  `PivotLayoutState.setGroupSize()` / `declaredGroupSize()`. (AspNetCore)
- A **Chart** toolbar button (`toolbar-items="Chart"` / `PivotToolbarItem.Chart`
  / `"chart"`, part of `toolbar="true"` when the grid has a chart) shows and
  hides the pivot chart; `showChart()` does it from code. Whether the chart is
  shown is kept with the view and in report files, and `chart-visible="false"`
  / `Chart(..., visible: false)` / `chart: { visible: false }` starts it
  hidden. A hidden chart is not drawn until it is shown. (AspNetCore)
- Pivot charts: `chart="Column|StackedColumn|Bar|Line"` with `chart-position`
  and `chart-height` / `Chart(PivotChartType, PivotChartPosition, height)` /
  `chart` draws the pivot as an SVG chart beside the grid, from the same
  result (new `pivot-chart.js`). Categories are the outermost row groups and
  series the outermost column groups (at most eight), each number the
  group's own subtotal. One data field at a time, picked from the chart's
  header beside the type switch; both choices are kept with the view and in
  report files, and `setChart()` makes them from code. Tooltips on hover and
  with the arrow keys show the grid's own text; a series keeps its colour
  (`--pt-series-1..8`) when others are filtered away. In English and
  Turkish. (AspNetCore)
- Numeric ranges: `group-interval="Range"` with `group-size="50000"` /
  `GroupInterval(PivotGroupInterval.Range).GroupSize(50000m)` /
  `{ groupInterval: "range", groupSize }` splits a numeric field into ranges —
  `0 – 50.000`, `50.000 – 100.000` — ordered by their start, start included
  and end excluded, aligned to zero. The level is keyed `Amount:range50000`;
  filters (`PivotFilter.BinSize`), drill-down, the header funnel's value list
  (`DistinctValues(..., binSize)`) and saved layouts use the same ranges. A
  value that is not a number keeps its own text. In the engine:
  `PivotGroupInterval.Range` and `PivotFieldRef.BinSize`. (Core, AspNetCore)
- Value filters: keep the groups of a row level whose summary value meets a
  condition — "regions whose sales exceed 10,000". `PivotRequest.ValueFilters`
  / `PivotValueFilter` in the engine; `<pivot-value-filter field operator
  value value2 value-key>` / `ValueFilter(...)` / `valueFilters` on the grid;
  `setValueFilter()` / `clearValueFilters()` in JavaScript; and a **Value
  filter** section in a row field's designer settings. Eight operators
  (greater / less than, or equal, equal, not equal, between, not between).
  Like Top-N it runs after aggregation and drops the groups from the totals
  too; a ranking on the same level is taken among the groups it keeps. Stored
  with the view and in report files; a value-filtered field lights its header
  funnel. In English and Turkish. (Core, AspNetCore)
- Value bars: `value-bars="Table|Rows|Columns"` / `ValueBars(PivotValueBarsMode)`
  / `valueBars` draws a bar behind each value cell, as long as the value's
  share of its scale, grouped as the heatmap is. The bars share an axis at
  zero, so negative values grow the other way in their own colour
  (`--pt-bar-color`, `--pt-bar-negative-color`). Totals get no bar; it
  combines with the heatmap and conditional formatting and prints, but is not
  exported to Excel. Large-data pages use the whole result's ranges.
  (AspNetCore)
- Three toolbar buttons, included in `toolbar="true"`: **Save report**
  downloads the view (layout, captions, filters, sorts, conditional rules) as
  a JSON file, **Open report** shows such a file's view, and **Full screen**
  lets the grid and its toolbar fill the window (Escape leaves it). Also as
  `exportReport()` / `loadReport()` and `PivotToolbarItem.SaveReport`,
  `OpenReport`, `Fullscreen`. In English and Turkish. (AspNetCore)
- Aggregations `VariancePopulation`, `StandardDeviationPopulation` (divided by
  n, as `VAR.P` / `STDEV.P`), `First` and `Last` (in source order), and the
  formula functions `VarP`, `StDevP`, `First`, `Last`. (Core, AspNetCore)

- Value text: three format members — `compact` (the culture's short form,
  `1,25 Mn`), `zeroText` (shown in place of an exact zero, `"—"`) and
  `negative: "parentheses"` (`(1.250)`) — as `format-compact`,
  `format-zero-text`, `format-negative` / `FormatCompact()`,
  `FormatZeroText()`, `FormatNegative(PivotNegativeFormat)`; and
  `customize-text` / `CustomizeText()` / `customizeText`, a page function (or
  its name) handed `{ value, valueText, valueKey }` that has the last word on
  a value's text. The Excel export writes the zero text and parentheses as
  number-format sections and keeps the full figure for a short form; the
  detail modal formats the same way; the designer's format section offers
  short numbers and parentheses as switches; a saved view keeps them.
  (AspNetCore)
- `display-folder` / `DisplayFolder()` / `displayFolder`: the designer's field
  list groups fields under folder headings that open and close; fields
  without a folder come first, and a search opens every folder. (AspNetCore)
- `PivotValueDefinition.AllowCrossGroupCalculation` (default `true`, the
  behaviour so far) and `allow-cross-group-calculation` /
  `AllowCrossGroupCalculation()` / `allowCrossGroupCalculation`: `false`
  starts a running total, and the two "previous" comparisons, afresh in each
  outer column group — every year with Year and Quarter on the columns.
  Sent on the request only when `false`. (Core, AspNetCore)
- A sort panel in the field designer: a row or column chip's settings now
  offer **Sort order** (ascending / descending) and **Sort by** (the field's
  own labels, or any value on the grid — "regions by sales, highest first").
  A pick clears that axis' header sort, which would otherwise outrank it, and
  is stored with the view. `PivotLayoutState.setSort(name, { order,
  byValueKey })` and `valueKeys()` underneath; `getState().sortBys` carries it.
  Left out for a field or grid with `allowSorting: false`. In English and
  Turkish. (AspNetCore)
- `show-borders` on `<pivot-grid>` / `ShowBorders(bool)` / `showBorders`:
  `true` closes the grid with an outer frame, `false` takes the lines between
  body cells away and keeps the header's. The lines go transparent rather
  than away, so no cell changes size. Left unset, the grid keeps the lines it
  always had. (AspNetCore)
- A row field's header arrow now shows the field's own order — declared with
  `sort-order` / `sort-by-value-key`, or picked in the designer's sort panel —
  while no row sort is in place; the first click on it turns that order
  around. A column field's arrow also shows a value sort declared without a
  direction, which ascends. (AspNetCore)

- Per-field presentation: `allow-sorting`, `allow-filtering`, `width` and
  `word-wrap` on `<pivot-field>` / `AllowSorting()`, `AllowFiltering()`,
  `Width()`, `WordWrap()` / `allowSorting`, `allowFiltering`, `width`,
  `wordWrap`. Valid in every area, so a field keeps them wherever it is
  dragged. `allowSorting: false` takes away a row or column field's own sort
  arrow, and a data field's value-header sort; `allowFiltering: false` its
  header funnel and its designer filter control — the grid-wide settings still
  decide first. `width` sizes a row field's header column, or every column of
  a data field's values; a column the reader resizes keeps the reader's width.
  `wordWrap` lets a field's labels wrap instead of ending in an ellipsis.
  (AspNetCore)

- Detail modal labels from the markup: `drill-down-label-{key}="..."` (the key
  in kebab-case, `drill-down-label-no-records`) / `DrillDownLabel(key, text)`
  renames one of the modal's texts over the locale pack's word. An unknown key
  is an error listing the fifteen there are. (AspNetCore)

- Subtotal position: `totals-position="Before|After"` /
  `TotalsPosition(PivotTotalsPosition)` / `totalsPosition: "before" | "after"`.
  `Before`, the default and the layout so far, draws a group's subtotal row
  above its rows as the group's header. `After` draws it below them, as Excel
  lays a report out: a heading row carrying the toggle opens the group, with
  its cells left blank, and the total row closes it. A collapsed group is its
  total row alone either way. Works in the tabular, compact and tree layouts.
  (AspNetCore)

- Toolbar: `toolbar="true"` / `Toolbar(true)` / `toolbar: true` puts a strip
  of buttons above the grid — Excel (when export is allowed), CSV, Print,
  Expand all and Collapse all. `toolbar-items="Excel,Print"` /
  `Toolbar(params PivotToolbarItem[])` / `toolbar: ["excel", "print"]` picks
  the buttons and their order. Excel and Print are titled with the grid's
  `aria-label`; a failure is raised as the `error` event. The texts are
  renderer texts (`toolbarExcel`, `toolbarPrint`, ...), translated in the `tr`
  locale. (AspNetCore)

- Tree row header layout: `layout-mode="Tree"` / `LayoutMode(PivotGridLayoutMode.Tree)`
  / `layoutMode: "tree"`, DevExtreme's `rowHeaderLayout: "tree"`. It is the
  compact column drawn as a tree: each group row is the parent node, named for
  its group (`Ege` rather than `Ege Total`) and carrying its totals, the
  header names the levels (`Bölge / Kategori`), and guide lines run down from
  each parent's toggle to its children. Collapsing, sorting, export and saved
  views work as in compact. (AspNetCore)
- Printing: `widget.print({ title, subtitle })` prints the grid alone, and
  `PivotForge.print(element, options)` does the same for any element. The
  stylesheet's `@media print` lays out the whole table instead of its scroll
  window, repeats the column headers on every sheet, tightens the rows, drops
  the controls and the selection, and keeps heatmap and conditional colours —
  so a plain Ctrl+P prints a clean table too, and the browser's "Save as PDF"
  gives a PDF. (AspNetCore)

- Four aggregations: `CountDistinct`, `Median`, `Variance` and
  `StandardDeviation` (`countDistinct`, `median`, `variance`,
  `standardDeviation` in the browser), with `PivotValueDefinition` factories of
  the same names. A distinct count works on any field, as `Count` does; the
  variance and standard deviation are the sample statistics (n − 1, like
  Excel's `VAR.S` / `STDEV.S`) and are empty below two values. Every subtotal
  and grand total is computed from its own records, so a median or a distinct
  count is exact at every level. Formulas can call them as `CountDistinct`,
  `Median`, `Var` / `Variance` and `StDev` / `StdDev`. The field designer
  offers them, in English and Turkish. (Core, AspNetCore)

- Heatmap: `heatmap="Table|Rows|Columns"` / `Heatmap(PivotHeatmapMode)` /
  `heatmap: "table" | "rows" | "columns"` shades the value cells on a colour
  scale from the smallest value to the largest — across every cell of a data
  field, or within each row or column. Each data field is its own scale;
  totals and subtotals are not shaded, and a conditional formatting rule's
  colour wins on the cells it matches. The colour is the `--pt-heat-color`
  CSS variable. The shades are carried into the Excel export, and in
  large-data mode the scale spans the whole result rather than the page on
  screen. `PivotForge.heatmapLevels` exposes the scale calculation.
  (AspNetCore)
- `PivotExcelCell.FillColor`: an optional `#RRGGBB` background for an exported
  cell. A `Highlight` wins when both are set. (Core)
- `PivotResult.ValueRanges`: the smallest and largest value of each value
  definition, over the whole result and per column. `PivotResultPaginator`
  fills it on every page, so a page can be shaded on the whole result's
  scale. (Core)

### Changed

- A custom aggregate registered as `CountDistinct`, `Median`, `Var`,
  `Variance`, `StDev` or `StdDev` is no longer called: those names are built
  in now, and a built-in name always means the built-in summary. A custom
  median written as in the old documentation gives the same numbers. (Core)

### Fixed

- Searching the field list, a filter's values or the detail modal now ignores
  accents and the dotted or dotless i: "isk" finds "İskonto", "satis" finds
  "Satış". (AspNetCore)

- `drillDownModalOptions.labels` replaced the locale pack's whole label set, so
  renaming one text turned the other fourteen English. Labels now merge key by
  key, as the designer's and the conditional panel's do. (AspNetCore)

## [0.6.0-preview.6] — 2026-10-02

Subtotal columns, sorting by a summary value on both axes, and a loading
panel.

### Added

- Subtotal columns on the column axis. Each group of an outer column field
  now closes with a total column (`2024 Toplam` after 2024's quarters), drawn
  in every row: detail rows, subtotal rows and the grand total row. On by
  default, like subtotal rows; switched grid-wide with `column-subtotals` /
  `ColumnSubtotals(bool)` / `columnSubtotals`, and per level with
  `show-totals="false"`, which is now valid on `Column` fields too.
  Double-clicking a subtotal cell drills into the whole group. The engine
  computes them (`PivotResult.ColumnSubtotals`, and
  `PivotSubtotal.ColumnSubtotals` where a subtotal row crosses one), so
  averages, counts and calculated fields are true group values, not sums of
  the columns. Show-as percentages divide by the subtotal's own row, column
  and grand total; previous-value comparisons leave it empty. (Core,
  AspNetCore)
- Sorting by a summary value on both axes, the DevExpress
  `sortBySummaryField` / `sortBySummaryPath`. `sort-by-value-key` /
  `SortByValueKey()` / `sortByValueKey` is now valid on `Column` fields too:
  the columns are ordered by their totals, each level inside its parent
  group. The new `sort-by-summary-path` / `SortBySummaryPath(...)` /
  `sortBySummaryPath` picks which summary on the other axis is compared: a
  column path for a row field (`"2025"` orders the rows by their 2025
  column), a row path for a column field. A shorter path reads that group's
  subtotal, so rows can be ordered by a subtotal column and columns by a
  subtotal row. In the engine this is `PivotFieldSort.SummaryPath`. (Core,
  AspNetCore)
- Grid: the grand total row's label carries an arrow that orders the columns
  by their totals, a subtotal column's header now sorts the rows like any
  other column, and the cell menu gains "Sort columns by this row" next to
  the renamed "Sort rows by this column" (`sortColumnsByValue` /
  `sortByValue` texts). The widget keeps the column sort as `columnSort`
  (`{ valueKey, rowPath, direction }`), in `getState()`, `update()` and the
  stored state; a label sort picked on a column field clears it.
- A loading panel. While the grid waits for data (the first load, and every
  reload after a sort, filter or layout change) a spinner with
  "Loading..." ("Yükleniyor..." in the `tr` locale) sits over it and the
  previous table stays visible, dimmed. It appears only after 300 ms, so a
  fast answer does not flash it, and it stays in view on a scrolled or phone
  sized grid. On by default; switched off with `load-panel="false"` /
  `LoadPanel(false)` / `loadPanel: false`, delay set with `loadPanelDelay`,
  text with `rendererOptions.texts.loading`. (AspNetCore)

### Changed

- A row value sort (`PivotSort.RowTotal` / `RowColumnValue`, or clicking a
  value header) now orders every row level by that value inside its parent
  group, the way DevExpress does: the largest region first and, inside it,
  the largest category first. It used to order the rows as one flat list,
  which pulled a group's rows apart under several row fields. With a single
  row field nothing changes. (Core)
- **Breaking** — `PivotFieldSort` gained a fourth positional parameter,
  `SummaryPath`. Source written against it compiles unchanged; code
  compiled against the earlier constructor or `Deconstruct` must be rebuilt.
  (Core)

## [0.6.0-preview.5] — 2026-09-30

Calculated fields, custom summary functions, and a formula builder that needs
no typing.

### Added

- **Core** — calculated values: `PivotValueDefinition.Calculated("Margin",
  "([Revenue] - [Cost]) / [Revenue]")`, keyed `Margin_calculated`. The formula
  runs on each cell, total, subtotal and grand total after aggregation, so a
  ratio is the ratio of the sums at every level. `[Field]` is a field's sum;
  `Sum`, `Count`, `Avg`, `Min` and `Max` summarize it another way; `+ - * /`,
  parentheses and unary minus work as in arithmetic; an empty summary or a
  division by zero leaves the cell empty. Show-as, value sorting and Top-N
  accept a calculated value like any other. `PivotExpression.Parse` reads a
  formula without running it, and `PivotExpressionException` says what is
  wrong and where.
- **Core** — custom aggregates: `PivotEngine.CustomAggregates` registers a
  summary by name (`Median`, a distinct count, anything over a cell's values),
  which any formula can then call: `Median([Amount])`.
- **AspNetCore** — `<pivot-field expression="...">` and
  `PivotFieldBuilder.Expression()` declare a calculated field; one left in
  `Available` is a measure without declaring the role, and may now carry a
  format like any available measure. `PivotForgeOptions.CustomAggregates`
  registers custom summaries for the endpoints. A formula is checked against
  `AllowedFields` by the fields it names, and an unreadable one is answered with
  `400` and the reason.
- **AspNetCore** — the field designer's **+ ƒx** button opens a formula
  builder that needs no typing: the reader taps (or drags) a field, taps an
  operation (Add, Subtract, Multiply, Divide, brackets), adds a number if one is
  needed, and the formula grows as a row of large pieces in their own words,
  each removable, with Undo, Clear and a "what comes next" line. A field piece
  can be summarized by average, count, minimum or maximum instead of its sum.
  The typed formula stays one button away, and a formula the pieces cannot show
  (a custom function) opens there. A formula naming a field the list does not
  have is refused in the editor, in the reader's language. The new field lands in the data area and survives a reload under
  `state-storing`; the reader can edit or delete it from its settings.
  `allow-calculated-fields="false"` removes the button. `PivotLayoutState`
  gains `addCalculatedField()`, `setExpression()`, `deleteCalculatedField()`
  and `checkFormula()`, and the Turkish locale pack words every message.

### Fixed

- **AspNetCore** — a layout restored by `state-storing` put the chips back
  where they were saved, but the grid's first request still used the declared
  fields, so the table did not match the designer until the next edit.

## [0.6.0-preview.4] — 2026-09-30

The column axis sorts from its headers.

### Fixed

- **AspNetCore** — the column axis could not be sorted from its headers. Only a
  row field's header carried a sort arrow; a column field's header named the
  field just to hold its funnel, and with a single value no column header could
  sort the rows either. A column field's header now orders that level's own
  values (A to Z, then Z to A on the next click) through the field's
  `sortOrder`, next to the funnel it already had, and it is drawn whenever
  sorting or filtering is allowed. With a single value, the innermost column
  header sorts the rows by that column's value, as the value header does when
  there are several. `PivotLayoutState` gains `setSortOrder()`, and a stored
  view carries the header sorts alongside the captions.

## [0.6.0-preview.3] — 2026-09-30

A sorted column reverses on a second click again.

### Fixed

- **AspNetCore** — a grid built with the tag helpers or the HTML helper sorted a
  column on the first header click but never reversed it: the header sends no
  direction, and the widget re-sent the same ascending sort on every click. A
  second click on the sorted header now flips the direction; another header
  starts labels A to Z and values largest first.

## [0.6.0-preview.2] — 2026-09-30

Grand totals a field can leave, a layout that fits a phone, and a filter picker
that opens where it was asked for.

### Added

- **AspNetCore** — the field designer and the filter picker adapt to phones.
  The designer stacks its four zones in one column when the panel it was given
  is narrow (under 260px with a mouse, 420px with a finger); it measures its
  own width through a container query, so a desktop sidebar keeps two columns.
  On a coarse pointer every chip control is at least 24px, as the grip already
  was, and inputs use 16px text so iOS does not zoom in on focus. Under 560px
  the filter picker fills the screen, the field settings dialog takes its full
  width, and the picker's button rows wrap instead of running past the edge.
  The designer adds a `pivot-field-designer` class to its host.
- **AspNetCore** — the grand total column on the right can be switched off with
  `show-column-grand-totals` / `ShowColumnGrandTotals(bool)`. The bottom row gets
  the matching name `show-row-grand-totals` / `ShowRowGrandTotals(bool)`, after
  DevExtreme; `show-grand-total` keeps working as its earlier name.
- **AspNetCore** — a data field can leave itself out of the grand totals with
  `show-grand-totals="false"` / `ShowGrandTotals(false)`: its column in the
  right-hand block goes while the other values keep theirs, and the bottom row
  goes only once every value has opted out, as in DevExtreme.

### Changed

- **AspNetCore** — on a screen wider than 560px the filter picker drops down
  under the funnel it was opened from, on a table header or a designer chip,
  instead of opening as a modal in the middle of the page, and is laid out like
  Excel's filter dropdown: 300px wide and as tall as its content, no heading,
  smaller controls, the values in a framed list of about ten rows, and a
  **Select all** box at the head of the list (mixed while only some of the
  searched values are checked) in place of the toolbar's two buttons. It opens
  above the funnel when there is more room there, stays inside the window, and
  follows the funnel when the page or the table scrolls; a click outside closes
  it, as the backdrop did. Opened from a field's settings it drops down under that
  field's chip. On a phone, or in a window too short for a dropdown either way,
  it is still the modal. `PivotFilterPicker.open` takes the element as
  `anchor`, `PivotFieldDesigner.openFilterPicker` as its second argument, and
  the renderer's `onFilterRequested` callback now receives the pressed funnel
  after the field name.

### Fixed

- **AspNetCore** — the filter picker's Include/Exclude row had no styles, so its
  buttons ran out of the dialog and neither showed which mode was selected.
- **AspNetCore** — the Turkish locale pack left the filter picker's condition
  row in English (*Condition*, *is one of* and the other operators, *Value*,
  *From*, *To*). A declared picker operator now also keeps the pack's names for
  the others, rather than falling back to English for all of them.

## [0.6.0-preview.1] — 2026-09-29

The release that made the browser UI declarative down to filtering, and gave
the endpoints a way to say no.

### Breaking

- **Core** — `PivotRequest.Rows` and `Columns` are `IReadOnlyList<PivotFieldRef>`
  rather than `IReadOnlyList<string>`. A field name converts implicitly, so
  `Rows = ["Region"]` still compiles; code that *reads* `request.Rows` as strings
  does not.
- **AspNetCore** — every string the grid, the field designer, the value picker
  and the detail modal put on screen now defaults to **English** instead of
  Turkish. Turkish moved into a locale pack (`js/pivot-locale-tr.js`); reference
  it and the text comes back. The pack is chosen from
  `CultureInfo.CurrentUICulture`, so an application with request localization
  configured keeps its language without any grid declaring one, and the new
  `locale` attribute pins it.
- **AspNetCore** — the cell context menu no longer offers an action whose
  handler the host did not supply. **Sort by this value**, **Filter by this
  value** and **Add conditional formatting** used to appear enabled on pages
  that could not perform them, and did nothing when clicked. An action whose
  handler exists but whose cell does not qualify is still shown disabled.

### Added

- **Core** — `PivotGroupInterval`: a date column collapses into year, quarter,
  month, day or weekday header groups, and the same column may occupy several
  levels at once, so a year-over-month hierarchy needs no second source column.
  Group labels come from the resolved culture and order by the interval rather
  than the alphabet.
- **Core** — `PivotFilterOperator`: a filter compares with `Equals` (the
  default, and what a filter always was), `Contains`, `StartsWith`, `EndsWith`,
  `Between`, `GreaterThan`, `LessThan` or `Blank`, reading `PivotFilter.Values`
  as that operator's arguments. `PivotFilterMode.Exclude` negates whichever
  operator is used, so there is no separate does-not-contain.
- **Core** — `PivotRequest.HideEmptySummaryCells` drops rows and columns holding
  no values at all and renumbers cells, totals and subtotals together. Grand
  totals are unchanged, because a row that aggregated to nothing contributed
  nothing to them.
- **Core** — `PivotRequest.TopN` ranks each group and keeps the top or bottom
  *n*. Totals follow the surviving rows, as they do in Excel.
- **Core** — `PivotEngine.Project` reads a chosen set of fields off a record,
  which is what lets drill-down return less than the whole source object.
- **AspNetCore** — `PivotForgeOptions.AllowedFields`. Left empty every field on
  the record type is readable, which is what an application that never declared
  a list gets. Declaring one turns the endpoints from "read whatever the browser
  named" into "read only these": a request naming anything else is refused, and
  drill-down hands back only these fields rather than the whole record.
- **AspNetCore** — a header filter funnel on both axes, opening the packaged
  value picker over the field's own filter entry. The column axis gained a named
  corner cell per level to hang it on, because a column header renders a value
  and never the field it belongs to.
- **AspNetCore** — a calendar control for range arguments. The picker reads the
  comparison type off the field's own values in the same order the engine does,
  so a date range produces the invariant `yyyy-MM-dd` the comparison can read
  rather than whatever the reader's keyboard produced.
- **AspNetCore** — `PivotConditionalPanel`: a reader adds conditional
  formatting rules from the cell menu. It offers exactly the six comparisons and
  four highlights the renderer evaluates, so a rule it produces can never colour
  nothing. `allow-conditional-formatting` turns it off, and
  `addConditionalRule` / `clearConditionalRules` / `setConditionalRules` drive
  it from code.
- **AspNetCore** — `state-storing` now carries conditional formatting rules, so
  a rule a reader added survives a reload. A stored list replaces the declared
  rules rather than joining them: the list that was saved already contained
  whatever the markup declared at the time.
- **AspNetCore** — `widget.exportToCsv(options)` exports the visible grid, built
  in the browser from the same model the Excel endpoint is sent. Merged header
  cells are expanded and every line padded to the widest row.
  `PivotForge.download({ blob, fileName })` saves what either export returns.
- **AspNetCore** — declarative `pivot-top-n`, `hide-empty-summary-cells`, and an
  `operator` attribute on `pivot-filter`; `designerLabels` reaches the field
  designer's labels for the first time.
- **Core** — `PivotFieldSort.ValueKey`: a row level orders its groups by a
  value's summary inside their parent group — an inner level by its subtotal,
  the deepest by its row total, both as shown after `show-as`. Groups with no
  value sort last in either direction; equal values break on the label. The
  record gained a third, optional constructor parameter, so code compiled
  against an earlier preview must be rebuilt.
- **AspNetCore** — `sort-by-value-key` on `<pivot-field>` and
  `PivotFieldBuilder.SortByValueKey()`, row fields only; the direction comes
  from `sort-order`.

### Fixed

- **AspNetCore** — the large-data endpoint's cache identity now includes
  `FieldSorts`, `TopN` and `HideEmptySummaryCells`. Two requests differing
  only in one of them used to share a session, so a changed sort, ranking or
  empty-cell setting was served the earlier result until the entry expired.

- **AspNetCore** — the header filter funnel's glyph leaked into exported files.
  It had been reaching the `.xlsx` since the header filter shipped, and would
  have reached the new `.csv` too.

### Changed

- Both packages now target **`net8.0` and `net10.0`** rather than `net8.0`
  alone. `net8.0` remains the floor, so no consumer is dropped; the `net10.0`
  assembly carries the same public API and exists so an application on the
  current runtime loads a build compiled against its own framework rather than
  one resolved through compatibility.
- Package release notes now link to this file. Two packages ship together and
  their notes were kept by hand in two places, which is how they came to
  describe different subsets of the same release.

## [0.5.0-preview.1] — 2026-08-17

### Breaking

- **Core** — row labels and filter values collate with
  `CultureInfo.CurrentCulture`, resolved per call, instead of a hard-coded
  `tr-TR`. `new PivotEngine(culture)` pins it. This is a correctness fix rather
  than a cosmetic one: in Turkish, C-cedilla is a letter of its own that sorts
  after every word starting with C, so results reorder outside Turkish.
- **AspNetCore** — numbers are formatted in the reader's own locale unless the
  new `culture` attribute pins one, instead of always `tr-TR`.

### Added

- **Core** — `PivotEngine.DistinctValues` for object, `DataTable` and dictionary
  sources, which backs the packaged filter value picker.
- **AspNetCore** — a packaged filter value picker (`POST
  /pivotforge/field-values`).
- **AspNetCore** — `state-storing` and `state-key` for automatic save and
  restore of the layout a reader arrives at.
- **AspNetCore** — pointer-event dragging that works with touch and pen, and
  full keyboard operation of the field designer.
- **AspNetCore** — the rendered table declares `role="grid"` with the roles,
  `aria-sort`, `aria-expanded` and `aria-rowcount` that make its existing
  selection and keyboard model reach a screen reader; `aria-label` names it.
- **AspNetCore** — every renderer string moved behind an overridable `texts`
  map.

## [0.4.0-preview.8] — 2026-08-16

### Added

- **AspNetCore** — initial state becomes declarable: `pivot-filter`,
  `pivot-sort` and `pivot-conditional-rule` child elements, with
  `PivotGridBuilder.Filter`, `RowSort` and `ConditionalRule` behind them.
  Anything naming a value accepts `value-field` plus `value-aggregation` and
  builds the value key for you.

### Changed

- **AspNetCore** — the emitted configuration is serialized in key order, so the
  same configuration produces the same bytes whichever API declared it.

## [0.4.0-preview.7] — 2026-08-16

### Added

- **AspNetCore** — events become declarable: `on-data-loading`,
  `on-data-loaded`, `on-error`, `on-selection-changed`, `on-cell-double-click`,
  `on-cell-copied`, `on-cell-filter-requested` and `on-view-state-changed` name
  a page function, with matching `PivotGridBuilder` methods. Every event is also
  dispatched on the grid container as a bubbling `pivotforge:*` `CustomEvent`, so
  a page can listen instead of naming a handler. A `rendererOptions` callback
  supplied by the consumer still runs alongside.

## [0.4.0-preview.6] — 2026-08-16

### Added

- **AspNetCore** — ten renderer presentation options become declarable from
  Razor: `selection-mode`, `layout-mode`, `context-menu`, `subtotals`,
  `show-grand-total`, `repeat-row-labels`, `min-column-width`,
  `max-column-width`, `empty-text` and `total-text`, with matching
  `PivotGridBuilder` methods. These previously needed hand-written JavaScript.

## [0.4.0-preview.5] — 2026-08-16

### Added

- **AspNetCore** — the field designer's settings modal covers naming, position,
  aggregation, show-as, number format and removal, with the current option
  marked on each choice. `PivotLayoutState` gains `setCaption`/`declaredCaption`
  for display captions and `setShowAs` for show-as calculations.

## [0.4.0-preview.4] — 2026-08-16

### Changed

- **AspNetCore** — every placed chip leads with its remove control; a Values
  chip's aggregation and format moved out of the chip into a settings modal
  opened with a new button beside it; and a placed field can be dragged back to
  the Fields list to remove it instead of only through its remove button.

## [0.4.0-preview.3] — 2026-08-16

### Fixed

- **AspNetCore** — field designer drag-and-drop now shows where a field will
  land: an empty zone highlights itself (the insertion line is drawn on a chip's
  edge and had nothing to draw on), and a drag the role rule refuses is marked
  rather than ignored silently, so "not allowed here" no longer looks identical
  to "broken".

## [0.4.0-preview.2] — 2026-08-16

### Fixed

- **AspNetCore** — field designer drag-and-drop threw on every `dragover` and
  was completely unusable in `0.3.0-preview.2` and `0.4.0-preview.1`: the
  drop-position code called `Array` methods on `element.children`, which is an
  `HTMLCollection` and has none. Upgrade if you use the field designer.

## [0.4.0-preview.1] — 2026-08-16

### Breaking

- **AspNetCore** — `PivotFieldBuilder.Format(string)` and the `pivot-field`
  `format` attribute are removed. Declare formats with
  `FormatType`/`FormatDecimals`/`FormatGrouping`/`FormatCurrency`
  (`format-type`/`format-decimals`/`format-grouping`/`format-currency` in
  Razor).

### Added

- **AspNetCore** — a packaged drill-down detail modal opened by double-clicking
  a cell, positional drag-and-drop reordering in the field designer, and a
  per-field number-format panel.

## [0.3.0-preview.2] — 2026-08-16

### Fixed

- **AspNetCore** — column-header sorting: the widget tells its renderer the
  active sort, so a sorted result keeps the server's row order instead of being
  re-sorted alphabetically, and the active-sort indicator appears.

## [0.3.0-preview.1] — 2026-08-16

### Added

- **AspNetCore** — an interactive field designer: drag-and-drop layout building,
  a field catalog with dimension and measure roles, and batched widget updates.

## [0.2.0-preview.1] — 2026-08-15

### Added

- **AspNetCore** — a declarative field-based API: `PivotForge.create` in the
  browser, `Html.PivotForge().PivotGrid()` in Razor, and `pivot-grid` /
  `pivot-field` tag helpers.

## [0.1.0-preview.2] — 2026-08-15

### Added

- **AspNetCore** — scoped, dependency-injection-aware data providers, alongside
  the existing delegate registration API.

## [0.1.0-preview.1] — 2026-08-15

Initial preview release of the PivotForge pivot engine and its ASP.NET Core
integration.

[Unreleased]: https://github.com/alican645/PivotForge/compare/v0.7.0-preview.1...HEAD
[0.7.0-preview.1]: https://github.com/alican645/PivotForge/compare/v0.6.0-preview.6...v0.7.0-preview.1
[0.6.0-preview.6]: https://github.com/alican645/PivotForge/compare/v0.6.0-preview.5...v0.6.0-preview.6
[0.6.0-preview.5]: https://github.com/alican645/PivotForge/compare/v0.6.0-preview.4...v0.6.0-preview.5
[0.6.0-preview.4]: https://github.com/alican645/PivotForge/compare/v0.6.0-preview.3...v0.6.0-preview.4
[0.6.0-preview.3]: https://github.com/alican645/PivotForge/compare/v0.6.0-preview.2...v0.6.0-preview.3
[0.6.0-preview.2]: https://github.com/alican645/PivotForge/compare/v0.6.0-preview.1...v0.6.0-preview.2
[0.6.0-preview.1]: https://github.com/alican645/PivotForge/compare/v0.5.0-preview.1...v0.6.0-preview.1
[0.5.0-preview.1]: https://github.com/alican645/PivotForge/compare/v0.4.0-preview.8...v0.5.0-preview.1
[0.4.0-preview.8]: https://github.com/alican645/PivotForge/compare/v0.4.0-preview.7...v0.4.0-preview.8
[0.4.0-preview.7]: https://github.com/alican645/PivotForge/compare/v0.4.0-preview.6...v0.4.0-preview.7
[0.4.0-preview.6]: https://github.com/alican645/PivotForge/compare/v0.4.0-preview.5...v0.4.0-preview.6
[0.4.0-preview.5]: https://github.com/alican645/PivotForge/compare/v0.4.0-preview.4...v0.4.0-preview.5
[0.4.0-preview.4]: https://github.com/alican645/PivotForge/compare/v0.4.0-preview.3...v0.4.0-preview.4
[0.4.0-preview.3]: https://github.com/alican645/PivotForge/compare/v0.4.0-preview.2...v0.4.0-preview.3
[0.4.0-preview.2]: https://github.com/alican645/PivotForge/compare/v0.4.0-preview.1...v0.4.0-preview.2
[0.4.0-preview.1]: https://github.com/alican645/PivotForge/compare/v0.3.0-preview.2...v0.4.0-preview.1
[0.3.0-preview.2]: https://github.com/alican645/PivotForge/compare/v0.3.0-preview.1...v0.3.0-preview.2
[0.3.0-preview.1]: https://github.com/alican645/PivotForge/compare/v0.2.0-preview.1...v0.3.0-preview.1
[0.2.0-preview.1]: https://github.com/alican645/PivotForge/compare/v0.1.0-preview.2...v0.2.0-preview.1
[0.1.0-preview.2]: https://github.com/alican645/PivotForge/compare/v0.1.0-preview.1...v0.1.0-preview.2
[0.1.0-preview.1]: https://github.com/alican645/PivotForge/releases/tag/v0.1.0-preview.1
