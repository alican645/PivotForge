# PivotForge Per-Field Sort By Value Design

## Goal

Let a row field order its own header level by a summary value, declaratively:

```html
<pivot-field data-field="Category" area="Row"
             sort-by-value-key="Amount_sum" sort-order="Descending" />
```

Every region's categories then run from largest to smallest amount **inside
that region**. This is DevExpress's `sortBySummaryField` for the row axis, and
closes the `sortBy` line in section 1 of `TODO.md`.

Today two mechanisms exist and neither does this:

- `PivotFieldSort(Field, Direction)` orders one level within its parent group,
  but only by the level's own label.
- `PivotSort.RowTotal` orders by a value, but flattens the whole row axis: with
  two row levels, one region's rows scatter between the others.

## Non-Goals

- **Column axis.** Column levels are built as the product of their values, so
  ordering them by a value is a separate piece of work. `sort-by-value-key` on a
  column field is rejected, not ignored.
- **Field designer UI.** No settings-modal control in this version; the
  attribute, the builder method and the JS field model are the whole surface.
- **Sort by a column path** (DevExpress `sortBySummaryPath`). The value compared
  is the group's total across all columns.
- **Build-time validation of the value key** against the declared measures. The
  field builder sees one field at a time, and `pivot-top-n` does not validate
  its key either.

## Model

`PivotFieldSort` gains an optional third parameter rather than a sibling type:

```csharp
public sealed record PivotFieldSort(
    string Field,
    PivotSortDirection Direction,
    string? ValueKey = null);
```

- `ValueKey` null: unchanged behavior, the level orders by its label.
- `ValueKey` set: the level orders by that value definition's summary.

Source compatible; **binary incompatible**, because the primary constructor's
signature changes. Acceptable in the `0.x` preview line and recorded in
`CHANGELOG.md` under *Added* with that note. Wire format: `fieldSorts` entries
gain an optional `valueKey` member, so existing requests deserialize unchanged.

## Engine

The change lives in `SortRows` / `CompareRowHeaders` in `PivotEngine`, on the
path taken when `request.RowSort` is null.

Comparison stays level by level. At a level whose resolved sort carries a
`ValueKey`, the two groups are compared by their summary value instead of their
label:

- **Inner level** (depth below the row field count): the `PivotSubtotal` whose
  `RowHeader` equals the group's prefix, reading `Totals[ValueKey]`.
- **Deepest level**: the row's own `RowTotals` entry.

This is the same group-value rule `GroupValue` applies for Top-N, with one
difference: it reads the **transformed** values (after `show-as`), because that
is what the reader sees and what the existing `SortRowsByTotal` already sorts
by.

Rules:

1. **Hierarchy is kept.** A level is ordered within its parent group; the outer
   levels decide first, exactly as for label sorting today.
2. **Null sorts last in both directions.** A group that aggregated to nothing
   has no rank; it does not win an ascending sort by being empty. Same rule as
   Top-N.
3. **Ties break on the label**, using the level's comparer (interval order for a
   grouped level, the culture's collation otherwise), always ascending. The same
   data then always yields the same order, which the large-result cache relies on.
4. **`RowSort` still wins.** A sort the reader applied with *Sort by this value*
   overrides every per-field sort on the row axis, as documented on
   `PivotRequest.FieldSorts` today.
5. **Unknown value key falls back to label order** for that level, without an
   error. A reader can remove the measure in the designer while the field keeps
   its declaration; a grid that throws is worse than one in label order.

`ResolveLevelDirections` becomes a resolution of the whole `PivotFieldSort` per
level (direction plus optional value key), keeping the existing
`NamesLevel` matching so a bare field name still names its grouped levels.

Value lookups are precomputed once per `SortRows` call (subtotals keyed by
`HeaderKey`) rather than searched inside the comparer.

## Declarative Surface

**`PivotFieldTagHelper`:** new `sort-by-value-key` attribute, forwarded only
when written (the existing `_writtenAttributes` pattern).

**`PivotFieldBuilder`:** new `SortByValueKey(string valueKey)` method.

- Direction comes from `SortOrder`. Left undeclared, it is **ascending**, the
  row axis default and DevExpress's `sortOrder` default.
- `Build()` throws `InvalidOperationException` when the key is set on a field
  whose area is not `Row`, mirroring the `Expanded`/`ShowTotals` check.
- Emitted as `field["sortByValueKey"]` only when declared, so an undeclared
  field's payload is unchanged.

## Browser

**`pivot-request-builder.js`**

- `normalizeField` accepts `sortByValueKey` on a `row` field only and throws
  elsewhere, with the same wording style as the `sortOrder` check. The
  normalized field carries `sortByValueKey` (string or null).
- `buildRequest` emits a `fieldSorts` entry for a field that declares
  `sortOrder` **or** `sortByValueKey`; `direction` defaults to `Ascending` when
  only the key is declared, and `valueKey` is present only when declared. A page
  declaring neither sends a byte-identical request.

**`pivot-layout-state.js`**

- `declaredIn` carries `sortByValueKey` into the `row` area only. A row field
  dragged to the column zone drops the key and keeps `sortOrder`, the same way
  `showTotals` is dropped today.
- `state-storing` saves the field layout through this path, so a declared
  value sort survives a reload with no further work.

## Testing

Test-first, in the existing suites.

**`PivotForge.Core.Tests`**

- Inner level ordered descending by value inside each outer group.
- Outer level ordered by its subtotal.
- Null-valued group last, ascending and descending.
- Equal values broken by label.
- `RowSort` overrides a per-field value sort.
- Unknown value key falls back to label order.
- `show-as` transformed values are the ones compared.
- Grouped (`field:interval`) level ordered by value.

**`PivotForge.AspNetCore.Tests`**

- Tag helper forwards `sort-by-value-key` into the field payload.
- Builder throws for the key on a column, data or filter field.
- Undeclared key leaves the payload without `sortByValueKey`.
- `FieldSorts` with `valueKey` round-trips through the request model.

**JS (`tests/*.test.js`)**

- `normalizeField` accepts the key on a row field and throws on other areas.
- `buildRequest` emits `{ field, direction, valueKey }`, defaults direction to
  `Ascending`, and omits `valueKey` when undeclared.
- Layout state drops the key when the field moves to the column area and keeps
  it on a row-to-row move.

## Documentation

- `TODO.md`: tick the section 1 `sort-by` item, mark the `sortBy` table row ✅.
- `CHANGELOG.md`: entry under `0.6.0-preview.1` *Added*, with the binary
  compatibility note.
- `docs/aspnetcore-integration.md` and `docs/public-api.md`: document the
  attribute, the builder method and the new `PivotFieldSort` parameter.
