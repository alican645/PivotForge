# Pivot Drill-Down Design

## Goal

Allow users to open the source records behind any pivot data cell, filter those records, and export the filtered result to CSV.

## Interaction

A single click continues to select a cell. Double-clicking a data cell selects it and opens drill-down. A toolbar `Detay` button opens the same modal and is enabled only when a data cell is selected.

Row headers do not open drill-down. Regular cells, subtotal cells, row totals, column totals, and grand totals are supported.

## Core API

Add drill-down operations to `PivotEngine` for typed objects, `DataTable`, and dictionary records. Each operation accepts the original `PivotRequest`, a row path, and a column path, and returns records that:

- Pass the request's existing filters
- Match every supplied row-path segment against the corresponding row field
- Match every supplied column-path segment against the corresponding column field

Paths are prefix paths. This makes subtotal cells match their complete group, an empty row path match all rows, and an empty column path match all columns. Unknown or overlong paths are rejected. Value selection does not change the matching record set, but `valueKey` is carried by the UI request for context and display.

## MVC Endpoint

Add a POST drill-down endpoint that accepts the current pivot layout, filters, row path, column path, and value key. It returns:

- Matching source records
- Total matching record count
- Whether the response was truncated
- A server-defined maximum record count

The demo caps returned records at 1,000 while reporting the complete count. Invalid requests return a clear client error without exposing internal exception details.

## Renderer Contract

Add `onCellDoubleClick(selection)` to renderer options. Double-click handling reuses the existing cell-selection metadata, updates selection first, and invokes the callback only for cells. Expand/collapse buttons, sort controls, and resize handles remain excluded.

The existing `onSelectionChanged` callback controls the toolbar button's enabled state.

## Detail Modal

The wide modal contains:

- A title derived from row path, column path, and selected measure
- Matching and visible record counts
- A global search input
- A scrollable source-record table
- One value filter control per column
- CSV export and close commands

The columns are Region, Category, Sales Person, Year, Quarter, Amount, Quantity, and Discount, using Turkish display labels and numeric formats consistent with the demo.

Global search matches the formatted text of every field. Column filters use distinct values from the loaded result. Global search and column filters combine with AND semantics. CSV export includes only currently visible records and uses the displayed column order.

## States And Errors

The modal has loading, populated, empty, truncated, and error states. Closing the modal clears its search and column filters but does not clear the pivot cell selection. If a drill-down request is superseded, its response is ignored using `AbortController` and a request identity check.

## Testing

- Core matching for regular, subtotal, row-total, column-total, and grand-total paths
- Existing pivot filters combined with drill-down paths
- Invalid and overlong paths
- Renderer double-click callback and selection order
- Client global search and column-filter combination
- CSV export uses filtered records
- Browser verification for toolbar enablement, double-click, modal filtering, totals, close, and error-free console

