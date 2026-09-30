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

[Unreleased]: https://github.com/alican645/PivotForge/compare/v0.6.0-preview.3...HEAD
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
