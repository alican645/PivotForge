# Pivot Show Values As Design

## Goal

Add reusable "show values as" calculations to the pivot engine and demo UI:

- Percent of row total
- Percent of column total
- Percent of grand total
- Difference from previous period
- Percent difference from previous period
- Running total

The calculations belong to the Core package so every host receives the same values. The MVC demo exposes the configuration and renders the returned result; it does not own calculation rules.

## Public Model

Add a `PivotShowAs` enum with these values:

- `Normal`
- `PercentOfRowTotal`
- `PercentOfColumnTotal`
- `PercentOfGrandTotal`
- `DifferenceFromPrevious`
- `PercentDifferenceFromPrevious`
- `RunningTotal`

Extend `PivotValueDefinition` with a `ShowAs` property that defaults to `Normal`. Existing two-argument construction and helper methods remain source-compatible. A value definition's key continues to identify its field and aggregation; changing `ShowAs` changes the displayed result, not the identity of the measure.

## Result Contract

`PivotResult` returns transformed cell values together with authoritative row totals, column totals, and grand totals. Totals are aggregated directly from source records, never reconstructed by combining finalized cell values. This is required for correct `Average`, `Min`, and `Max` behavior.

The result contains:

- Leaf row and column headers in their existing deterministic order
- Transformed leaf cell values
- Transformed row totals for each row and measure
- Transformed column totals for each column and measure
- Transformed grand totals

The engine keeps the raw aggregate matrix internally until every total and transformation has been calculated. Drill-down continues to use source records and is unaffected by transformed values.

## Calculation Rules

All transformations operate independently for each measure.

### Percent of Row Total

Each leaf cell is divided by the raw total for the same row and measure across all columns. Row-total cells display `1` when the denominator is non-zero. Column and grand totals are divided by the raw grand total.

### Percent of Column Total

Each leaf cell is divided by the raw total for the same column and measure across all rows. Column-total cells display `1` when the denominator is non-zero. Row and grand totals are divided by the raw grand total.

### Percent of Grand Total

Every leaf cell, row total, and column total is divided by the raw grand total for that measure. The grand total displays `1` when non-zero.

### Difference From Previous Period

Columns form one continuous series in their existing left-to-right order. For each row, the current raw aggregate is reduced by the previous non-empty column's raw aggregate. Empty Cartesian combinations in multi-level column layouts are skipped. The first populated column is null. The sequence does not reset when a higher-level column group changes, so `2025 Q1` follows `2024 Q4`.

Column totals use the same previous-column rule. Row totals and grand totals are null because they do not represent a period position.

### Percent Difference From Previous Period

For each row and column, calculate `(current - previous) / previous`. The first column is null. A null or zero previous value produces null. Column totals follow the same rule; row totals and grand totals are null.

### Running Total

For each row, sum raw aggregate values from the first column through the current column. Missing cells do not change the running sum. Column totals accumulate from left to right. Row totals and grand totals retain their raw aggregate because they already represent the complete series.

### Null and Zero Handling

- A missing source aggregate remains null unless a running total already has a prior numeric value.
- Division by zero returns null.
- No mode emits `NaN`, infinity, or an exception for an empty denominator.
- Calculations use `decimal` throughout.

## Sorting

Value sorting uses transformed values. Null transformed values sort after numeric values in both directions, while stable header order breaks ties. Existing label sorting is unchanged.

## Demo UI

Add a "Değerleri farklı göster" section to each value field's three-dot menu. It contains the seven modes as a single-choice menu. The active mode is visibly selected.

Changing the mode updates the value entry, reruns the pivot, and keeps the field, aggregation, alias, and number-format configuration intact.

Percent modes force percent rendering while active. `Normal`, difference, and running-total modes use the measure's configured number/currency format. Returning to `Normal` restores the prior configured format without data loss.

The display label appends a concise mode suffix when the mode is not `Normal`, allowing multiple instances of the same measure to remain understandable.

## Persistence

Saved views and last-state persistence include `showAs` for every value definition. Missing or unknown values normalize to `Normal`, preserving compatibility with existing localStorage payloads. State equality includes `showAs`, so changing a mode marks a named view as modified.

## API and Error Handling

The MVC request DTO accepts `showAs` through `PivotValueDefinition`. Unknown enum input is rejected by normal model binding or request validation. Existing field and aggregation validation remains in place.

The renderer accepts row and column totals from the server. For backward compatibility, it may fall back to its current client summary behavior only when the new total collections are absent.

## Testing

Core tests cover every mode with multiple rows and columns, including:

- Leaf cells, row totals, column totals, and grand totals
- Zero and null denominators
- First-period null behavior
- Continuous ordering across multi-level column groups
- Running totals with missing cells
- Correct totals for `Average`, `Min`, and `Max`
- Sorting by transformed values
- Existing `Normal` behavior and construction compatibility

JavaScript tests cover:

- Mode normalization and persistence
- Menu selection without losing aggregation or formatting
- Automatic percent formatting
- Renderer consumption of server-provided totals

Browser verification covers all seven menu modes, labels, saved-view restoration, sorting, totals, drill-down availability, responsive menu layout, and an error-free console.

## Out of Scope

- Choosing a custom base field or base item for previous-period calculations
- Resetting period calculations at a parent column boundary
- Running totals down rows
- Combining multiple show-as transformations on one measure
- Conditional formatting
