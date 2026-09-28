# Per-Field Sort By Value Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A row field can order its own header level by a summary value, inside its parent group, declared as `sort-by-value-key="Amount_sum"` next to the existing `sort-order`.

**Architecture:** `PivotFieldSort` gains an optional `ValueKey`. The engine's default row ordering (used when no `RowSort` is set) becomes a row-index comparer that, at a value-sorted level, compares precomputed group values (subtotal totals for inner levels, row totals for the deepest level, both after `show-as`) and otherwise compares labels as today. The tag helper, builder, JS request builder and layout state carry the key to the wire.

**Tech Stack:** .NET 8/10 (xUnit), vanilla JS (`node --test`).

**Spec:** `docs/superpowers/specs/2026-09-28-pivotforge-field-sort-by-value-design.md`

## Global Constraints

- Row axis only. `sort-by-value-key` on a column, data, filter or available field is rejected (C# `InvalidOperationException`, JS `Error`), never ignored.
- `RowSort` keeps precedence over every per-field sort on the row axis.
- Null group values sort last in both directions; equal values break on the level's label, always ascending.
- A value key that is not among `request.Values` makes that level behave as if `ValueKey` were null (label order, declared direction). No exception.
- A page that declares no `sort-by-value-key` sends a byte-identical request and renders a byte-identical payload.
- Code comments and XML docs in English; commit messages in Turkish, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do **not** stage `samples/PivotForge.MvcDemo/Models/SampleSalesData.cs` (the user's uncommitted change).
- Local .NET runs: `net8.0` ASP.NET tests need `DOTNET_ROLL_FORWARD=LatestMajor`.

## Review Focus

1. **Value sort on an inner level whose subtotal is missing** (e.g. every child dropped by `hide-empty-summary-cells`) — the group must sort as null (last), not throw on a dictionary lookup. Pinned by the null-group test in Task 1 through `ResolveGroupValues` using `TryGetValue` everywhere.
2. **Value sort combined with Top-N on the same level** — the surviving groups must still be ordered by value. Task 1 adds `TopNSurvivorsAreOrderedByValue`.
3. **Grouped (`field:interval`) level ordered by value** — must use the level key and not fall back to interval order. Task 1 adds `AGroupedLevelOrdersByValue`.
4. **Designer drag of a value-sorted row field to the column zone** — must not turn a legal drag into a `normalizeField` exception. Task 3 pins it.
5. **Undeclared direction** — `sort-by-value-key` alone must sort ascending on the server as well as in the JS request (the C# payload omits `sortOrder`; the JS default fills it). Task 3 pins the JS default; Task 2 pins that the payload omits `sortOrder`.

---

### Task 1: Core — `PivotFieldSort.ValueKey` and engine ordering

**Files:**
- Modify: `src/PivotForge.Core/PivotSort.cs` (the `PivotFieldSort` record, ~line 42-52)
- Modify: `src/PivotForge.Core/PivotEngine.cs` (`Execute` call to `SortRows` ~line 500; `SortRows` ~1289; `CompareRowHeaders` ~1349; `ResolveLevelDirections` ~1381)
- Modify: `src/PivotForge.Core/PivotRequest.cs:37-41` (XML remark on `FieldSorts`)
- Create: `tests/PivotForge.Core.Tests/PivotFieldSortByValueTests.cs`

**Interfaces:**
- Produces: `public sealed record PivotFieldSort(string Field, PivotSortDirection Direction, string? ValueKey = null);` — Task 2's endpoint test sends `valueKey` in JSON and relies on this binding.

- [ ] **Step 1: Write the failing tests**

Create `tests/PivotForge.Core.Tests/PivotFieldSortByValueTests.cs`:

```csharp
using System.Globalization;
using PivotForge.Core;

namespace PivotForge.Core.Tests;

public sealed class PivotFieldSortByValueTests
{
    private sealed record Sale(string Region, string Category, decimal? Amount);

    private sealed record DatedSale(DateTime OrderDate, decimal Amount);

    // East totals 60, West totals 55, so ordering the regions by value
    // ascending (West first) is distinguishable from ordering them by label.
    private static readonly Sale[] Sales =
    [
        new("East", "Alpha", 10m),
        new("East", "Beta", 30m),
        new("East", "Gamma", 20m),
        new("West", "Alpha", 50m),
        new("West", "Beta", 5m),
        new("West", "Delta", null)
    ];

    private static readonly PivotEngine Engine = new(CultureInfo.InvariantCulture);

    private static PivotRequest Nested(params PivotFieldSort[] fieldSorts) => new()
    {
        Rows = ["Region", "Category"],
        Values = [PivotValueDefinition.Sum("Amount")],
        FieldSorts = fieldSorts
    };

    private static string[] RowPaths(PivotResult result) =>
        result.RowHeaders.Select(header => string.Join("/", header)).ToArray();

    [Fact]
    public void AnInnerLevelIsOrderedByValueInsideEachParent()
    {
        var result = Engine.Execute(Sales, Nested(
            new PivotFieldSort("Category", PivotSortDirection.Descending, "Amount_sum")));

        // Delta aggregated to nothing, so it has no rank and goes last.
        Assert.Equal(
            ["East/Beta", "East/Gamma", "East/Alpha", "West/Alpha", "West/Beta", "West/Delta"],
            RowPaths(result));
    }

    [Fact]
    public void ANullGroupIsLastWhenAscendingToo()
    {
        var result = Engine.Execute(Sales, Nested(
            new PivotFieldSort("Category", PivotSortDirection.Ascending, "Amount_sum")));

        Assert.Equal(
            ["East/Alpha", "East/Gamma", "East/Beta", "West/Beta", "West/Alpha", "West/Delta"],
            RowPaths(result));
    }

    [Fact]
    public void AnOuterLevelIsOrderedByItsSubtotal()
    {
        var result = Engine.Execute(Sales, Nested(
            new PivotFieldSort("Region", PivotSortDirection.Ascending, "Amount_sum")));

        Assert.Equal(
            ["West/Alpha", "West/Beta", "West/Delta", "East/Alpha", "East/Beta", "East/Gamma"],
            RowPaths(result));
    }

    [Fact]
    public void EqualValuesBreakOnTheLabelAscending()
    {
        Sale[] tied =
        [
            new("North", "Zeta", 10m),
            new("North", "Alpha", 10m),
            new("North", "Mid", 20m)
        ];

        var result = Engine.Execute(tied, Nested(
            new PivotFieldSort("Category", PivotSortDirection.Descending, "Amount_sum")));

        // Descending by value, but the tie between Zeta and Alpha is broken
        // ascending, so the same data always yields the same order.
        Assert.Equal(["North/Mid", "North/Alpha", "North/Zeta"], RowPaths(result));
    }

    [Fact]
    public void AnExplicitRowSortWins()
    {
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Category"],
            Values = [PivotValueDefinition.Sum("Amount")],
            FieldSorts = [new PivotFieldSort("Category", PivotSortDirection.Descending, "Amount_sum")],
            RowSort = PivotSort.RowLabel("Category", PivotSortDirection.Ascending)
        });

        Assert.Equal(["Alpha", "Beta", "Delta", "Gamma"], RowPaths(result));
    }

    [Fact]
    public void AnUnknownValueKeyFallsBackToLabelOrder()
    {
        // The reader removed the measure in the designer; the declaration stays.
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Category"],
            Values = [PivotValueDefinition.Sum("Amount")],
            FieldSorts = [new PivotFieldSort("Category", PivotSortDirection.Descending, "Missing_sum")]
        });

        Assert.Equal(["Gamma", "Delta", "Beta", "Alpha"], RowPaths(result));
    }

    [Fact]
    public void TheShownValueIsWhatIsCompared()
    {
        // As a percent of the row total every row total is 1, so the rows tie and
        // fall back to their labels. Sorting the raw sums ascending would put
        // Gamma (20) first instead.
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Category"],
            Values = [PivotValueDefinition.Sum("Amount").As(PivotShowAs.PercentOfRowTotal)],
            FieldSorts = [new PivotFieldSort("Category", PivotSortDirection.Ascending, "Amount_sum")]
        });

        Assert.Equal(["Alpha", "Beta", "Gamma", "Delta"], RowPaths(result));
    }

    [Fact]
    public void AGroupedLevelOrdersByValue()
    {
        DatedSale[] sales =
        [
            new(new DateTime(2026, 4, 10), 100m),
            new(new DateTime(2026, 8, 10), 300m),
            new(new DateTime(2026, 11, 10), 200m)
        ];

        var result = new PivotEngine(CultureInfo.GetCultureInfo("tr-TR")).Execute(sales, new PivotRequest
        {
            Rows = [new PivotFieldRef("OrderDate", PivotGroupInterval.Month)],
            Values = [PivotValueDefinition.Sum("Amount")],
            FieldSorts = [new PivotFieldSort("OrderDate:month", PivotSortDirection.Descending, "Amount_sum")]
        });

        Assert.Equal(["Ağustos", "Kasım", "Nisan"], RowPaths(result));
    }

    [Fact]
    public void TopNSurvivorsAreOrderedByValue()
    {
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Category"],
            Values = [PivotValueDefinition.Sum("Amount")],
            TopN = [new PivotTopN("Category", 2)],
            FieldSorts = [new PivotFieldSort("Category", PivotSortDirection.Ascending, "Amount_sum")]
        });

        // Top two by value are Alpha (60) and Beta (35); ascending puts Beta first,
        // which label order would not.
        Assert.Equal(["Beta", "Alpha"], RowPaths(result));
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test tests/PivotForge.Core.Tests -f net10.0 --filter "FullyQualifiedName~PivotFieldSortByValueTests"`
Expected: build FAILS with `CS1739`/`CS1729` — `PivotFieldSort` has no constructor taking three arguments.

- [ ] **Step 3: Add `ValueKey` to the record**

In `src/PivotForge.Core/PivotSort.cs`, replace the `PivotFieldSort` doc block and declaration with:

```csharp
/// <summary>Defines the ordering of one row or column field's own header level.</summary>
/// <remarks>
/// Unlike <see cref="PivotSort"/>, which orders the whole row axis by one criterion, this orders a
/// single level within its parent group, so the hierarchy stays intact. Levels left undeclared keep
/// the engine's default: ascending on the row axis, discovery order on the column axis.
/// <para>
/// With a <paramref name="ValueKey"/>, a row level orders its groups by that value's summary
/// instead of their labels: an inner level by its subtotal, the deepest level by its row total,
/// both as shown after <see cref="PivotShowAs"/>. A group with no value sorts last in either
/// direction and equal values break on the label, ascending. A key that is not among the request's
/// values leaves the level in label order. Value ordering applies to the row axis only.
/// </para>
/// </remarks>
/// <param name="Field">The row or column field whose level is ordered.</param>
/// <param name="Direction">The sort direction applied to that level.</param>
/// <param name="ValueKey">
/// The <see cref="PivotValueDefinition.Key"/> whose summary orders the level, or null to order it
/// by label.
/// </param>
public sealed record PivotFieldSort(string Field, PivotSortDirection Direction, string? ValueKey = null);
```

- [ ] **Step 4: Pass subtotals into `SortRows`**

In `PivotEngine.Execute` (~line 500) change the call to:

```csharp
        var sortedRows = SortRows(
            populated.RowHeaders,
            populated.ColumnHeaders,
            populated.Values.Cells,
            populated.Values.RowTotals,
            populated.Values.Subtotals,
            request,
            culture);
```

- [ ] **Step 5: Replace the default row ordering**

In `SortRows`, add the `subtotals` parameter after `rowTotals`, and replace the block from `var directions = ResolveLevelDirections(request.Rows, request.FieldSorts);` through the `sort is null ? ... : sort.Mode switch {...};` expression with:

```csharp
        rowOrder = sort is null
            ? SortRowsByLevel(rowOrder, rowHeaders, rowTotals, subtotals, request, culture)
            : sort.Mode switch
        {
            PivotSortMode.RowLabel => SortRowsByLabel(rowOrder, rowHeaders, request.Rows, sort, culture),
            PivotSortMode.RowTotalValue =>
                SortRowsByTotal(rowOrder, rowHeaders, columnHeaders, cells, rowTotals, sort, culture),
            _ => rowOrder
        };
```

The signature becomes:

```csharp
    private static SortedRows SortRows(
        IReadOnlyList<IReadOnlyList<string?>> rowHeaders,
        IReadOnlyList<IReadOnlyList<string?>> columnHeaders,
        IReadOnlyList<PivotCell> cells,
        IReadOnlyList<PivotTotal> rowTotals,
        IReadOnlyList<PivotSubtotal> subtotals,
        PivotRequest request,
        CultureInfo culture)
```

Delete `CompareRowHeaders` (its only caller was the block just replaced) and add in its place:

```csharp
    /// <summary>Orders rows level by level, each level by its label or by a declared value.</summary>
    private static int[] SortRowsByLevel(
        int[] rowOrder,
        IReadOnlyList<IReadOnlyList<string?>> rowHeaders,
        IReadOnlyList<PivotTotal> rowTotals,
        IReadOnlyList<PivotSubtotal> subtotals,
        PivotRequest request,
        CultureInfo culture)
    {
        var levelSorts = ResolveLevelSorts(request.Rows, request.FieldSorts);
        // Resolved once rather than inside the comparer, which runs n log n times.
        var groupValues = ResolveGroupValues(rowHeaders, rowTotals, subtotals, request, levelSorts);

        return rowOrder
            .OrderBy(
                row => row,
                Comparer<int>.Create((left, right) =>
                    CompareRows(left, right, rowHeaders, request.Rows, levelSorts, groupValues, culture)))
            .ToArray();
    }

    private static int CompareRows(
        int left,
        int right,
        IReadOnlyList<IReadOnlyList<string?>> rowHeaders,
        IReadOnlyList<PivotFieldRef> fields,
        IReadOnlyList<PivotFieldSort?> levelSorts,
        IReadOnlyList<decimal?[]?> groupValues,
        CultureInfo culture)
    {
        var leftHeader = rowHeaders[left];
        var rightHeader = rowHeaders[right];
        var depth = Math.Max(leftHeader.Count, rightHeader.Count);

        for (var level = 0; level < depth; level++)
        {
            // Per level rather than once: a grouped level runs in its interval's
            // order while the plain levels around it stay collated.
            var labelComparison = LevelComparer(fields, level, culture)
                .Compare(leftHeader.ElementAtOrDefault(level), rightHeader.ElementAtOrDefault(level));

            // Same group at this level: a deeper level decides.
            if (labelComparison == 0)
            {
                continue;
            }

            var sort = levelSorts.ElementAtOrDefault(level);

            if (sort is not null && groupValues.ElementAtOrDefault(level) is { } values)
            {
                var valueComparison = CompareGroupValues(values[left], values[right], sort.Direction);

                // Equal values fall back to the label, ascending whatever the
                // direction, so the same data always yields the same order.
                return valueComparison != 0 ? valueComparison : labelComparison;
            }

            // The comparison is applied level by level, so flipping one level
            // reverses that level's groups without moving them out of their
            // parent -- the hierarchy survives the reversal.
            return sort?.Direction == PivotSortDirection.Descending ? -labelComparison : labelComparison;
        }

        return 0;
    }

    private static int CompareGroupValues(decimal? left, decimal? right, PivotSortDirection direction)
    {
        // A group that aggregated to nothing has no rank, so it sits last in both
        // directions rather than winning an ascending sort by being empty.
        if (left is null || right is null)
        {
            return (left is null).CompareTo(right is null);
        }

        var comparison = left.Value.CompareTo(right.Value);
        return direction == PivotSortDirection.Descending ? -comparison : comparison;
    }

    /// <summary>The summary value of every row's group at each value-ordered level.</summary>
    /// <remarks>Indexed by level, then by row. A level ordered by label, or by a key the request
    /// does not carry, has no entry: a measure the reader removed leaves label order behind rather
    /// than an error. An inner group reads its subtotal and the deepest one its row total, both as
    /// shown after show-as, which is what the reader is looking at.</remarks>
    private static IReadOnlyList<decimal?[]?> ResolveGroupValues(
        IReadOnlyList<IReadOnlyList<string?>> rowHeaders,
        IReadOnlyList<PivotTotal> rowTotals,
        IReadOnlyList<PivotSubtotal> subtotals,
        PivotRequest request,
        IReadOnlyList<PivotFieldSort?> levelSorts)
    {
        if (levelSorts.All(sort => sort?.ValueKey is null))
        {
            return [];
        }

        var deepest = request.Rows.Count - 1;
        var rowTotalLookup = rowTotals.ToDictionary(total => total.Index, total => total.Values);
        var subtotalLookup = new Dictionary<HeaderKey, IReadOnlyDictionary<string, decimal?>>();

        foreach (var subtotal in subtotals)
        {
            subtotalLookup.TryAdd(new HeaderKey(subtotal.RowHeader), subtotal.Totals);
        }

        decimal?[]? Resolve(PivotFieldSort? sort, int level)
        {
            if (sort?.ValueKey is not { } valueKey ||
                request.Values.All(value => value.Key != valueKey))
            {
                return null;
            }

            var values = new decimal?[rowHeaders.Count];

            for (var row = 0; row < rowHeaders.Count; row++)
            {
                IReadOnlyDictionary<string, decimal?>? totals;

                if (level == deepest)
                {
                    totals = rowTotalLookup.GetValueOrDefault(row);
                }
                else
                {
                    subtotalLookup.TryGetValue(
                        new HeaderKey(rowHeaders[row].Take(level + 1).ToArray()), out totals);
                }

                values[row] = totals is not null && totals.TryGetValue(valueKey, out var value) ? value : null;
            }

            return values;
        }

        return levelSorts.Select(Resolve).ToArray();
    }
```

Replace `ResolveLevelDirections` with the two methods below (the column axis keeps calling `ResolveLevelDirections` unchanged):

```csharp
    /// <summary>Maps the declared per-field sorts onto header levels, by position in the axis.</summary>
    private static IReadOnlyList<PivotFieldSort?> ResolveLevelSorts(
        IReadOnlyList<PivotFieldRef> fields,
        IReadOnlyList<PivotFieldSort> fieldSorts)
    {
        if (fieldSorts.Count == 0)
        {
            return [];
        }

        return fields
            .Select(field => fieldSorts.FirstOrDefault(sort => NamesLevel(sort.Field, field)))
            .ToArray();
    }

    private static IReadOnlyList<PivotSortDirection?> ResolveLevelDirections(
        IReadOnlyList<PivotFieldRef> fields,
        IReadOnlyList<PivotFieldSort> fieldSorts) =>
        ResolveLevelSorts(fields, fieldSorts).Select(sort => sort?.Direction).ToArray();
```

- [ ] **Step 6: Update the `FieldSorts` remark**

In `src/PivotForge.Core/PivotRequest.cs`, the `FieldSorts` remark becomes:

```csharp
    /// <remarks><see cref="RowSort"/> orders the row axis as a whole and takes precedence over these
    /// on that axis; the column axis is governed by these alone. A sort carrying a value key orders
    /// a row level by that value and is ignored on the column axis.</remarks>
```

- [ ] **Step 7: Run the new tests, then the whole Core suite**

Run: `dotnet test tests/PivotForge.Core.Tests -f net10.0 --filter "FullyQualifiedName~PivotFieldSortByValueTests"`
Expected: 9 passed.

Run: `dotnet test tests/PivotForge.Core.Tests -f net10.0`
Expected: all passed (the existing `Execute_OrdersADeclaredLevel...` and `PivotGroupIntervalTests` descending-month test prove label ordering is unchanged).

- [ ] **Step 8: Commit**

```bash
git add src/PivotForge.Core/PivotSort.cs src/PivotForge.Core/PivotEngine.cs src/PivotForge.Core/PivotRequest.cs tests/PivotForge.Core.Tests/PivotFieldSortByValueTests.cs
git commit -m "$(cat <<'EOF'
feat(siralama): satir seviyesi ozet degere gore siralanabiliyor

PivotFieldSort istege bagli ValueKey aldi. Deger tasiyan bir satir
seviyesi, gruplarini ust grubunun icinde o olcunun ozetine gore siraliyor:
ara seviye alt toplamina, en derin seviye satir toplamina gore, ikisi de
show-as uygulanmis haliyle. Bos grup her iki yonde sonda, esitlik etikete
gore artan. RowSort hala ustun; istekte olmayan anahtar etiket sirasina
donuyor.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: AspNetCore — `sort-by-value-key` attribute, builder method, wire test

**Files:**
- Modify: `src/PivotForge.AspNetCore/Rendering/PivotFieldBuilder.cs` (fields ~line 15-24; after `SortOrder` ~line 202; `Build()` checks ~line 272 and emission ~line 338)
- Modify: `src/PivotForge.AspNetCore/Rendering/PivotFieldTagHelper.cs` (after the `SortOrder` property ~line 88; `ApplyTo` end ~line 221)
- Test: `tests/PivotForge.AspNetCore.Tests/PivotFieldBuilderTests.cs`
- Test: `tests/PivotForge.AspNetCore.Tests/PivotTagHelperTests.cs` (`FieldSpec` ~line 20-32, `Build` ~line 118-128, new test near line 792)
- Test: `tests/PivotForge.AspNetCore.Tests/PivotForgeAspNetCoreTests.cs` (new test after `PivotEndpoint_AppliesADeclaredFieldSortToTheRowOrder`, ~line 248)

**Interfaces:**
- Consumes: `PivotFieldSort(string Field, PivotSortDirection Direction, string? ValueKey = null)` from Task 1.
- Produces: `PivotFieldBuilder.SortByValueKey(string valueKey)`; payload member `"sortByValueKey"` (string), which Task 3's `normalizeField` reads.

- [ ] **Step 1: Write the failing builder tests**

Append to `PivotFieldBuilderTests`:

```csharp
    [Fact]
    public void SortByValueKeyIsEmittedOnlyWhenDeclared()
    {
        var declared = new PivotFieldBuilder()
            .DataField("Category").Area(PivotArea.Row).SortByValueKey("Amount_sum").Build();
        var undeclared = new PivotFieldBuilder()
            .DataField("Category").Area(PivotArea.Row).Build();

        Assert.Equal("Amount_sum", declared["sortByValueKey"]);
        // No direction was declared, and none is invented: the browser applies
        // the row axis default.
        Assert.False(declared.ContainsKey("sortOrder"));
        Assert.False(undeclared.ContainsKey("sortByValueKey"));
    }

    [Theory]
    [InlineData(PivotArea.Column)]
    [InlineData(PivotArea.Data)]
    [InlineData(PivotArea.Filter)]
    public void SortByValueKeyOutsideTheRowAreaThrows(PivotArea area)
    {
        var builder = new PivotFieldBuilder()
            .DataField("Category").Area(area).SortByValueKey("Amount_sum");

        var exception = Assert.Throws<InvalidOperationException>(() => builder.Build());

        Assert.Contains("SortByValueKey is only valid on fields whose Area is Row", exception.Message);
    }
```

- [ ] **Step 2: Write the failing tag helper test**

In `PivotTagHelperTests`, add `string? SortByValueKey = null` as the last parameter of the `FieldSpec` record, and in `Build(FieldSpec spec)` after the `GroupInterval` block:

```csharp
        if (spec.SortByValueKey is not null)
        {
            helper.SortByValueKey = spec.SortByValueKey;
            attributes.Add(new TagHelperAttribute("sort-by-value-key", spec.SortByValueKey));
        }
```

Then add, after `WritesAreaIndexAndSortOrderOnlyWhenDeclared`:

```csharp
    [Fact]
    public async Task WritesSortByValueKeyOnlyWhenDeclared()
    {
        var declared = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            new FieldSpec("Region", PivotArea.Row, "Bölge"),
            new FieldSpec("Category", PivotArea.Row, "Kategori",
                SortOrder: PivotSortDirection.Descending, SortByValueKey: "Amount_sum"),
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        var fields = declared.GetProperty("fields");
        Assert.False(fields[0].TryGetProperty("sortByValueKey", out _));
        Assert.Equal("Amount_sum", fields[1].GetProperty("sortByValueKey").GetString());
        Assert.Equal("Descending", fields[1].GetProperty("sortOrder").GetString());
    }
```

- [ ] **Step 3: Write the failing wire test**

In `PivotForgeAspNetCoreTests`, copy `PivotEndpoint_AppliesADeclaredFieldSortToTheRowOrder` in full as `PivotEndpoint_OrdersARowLevelByADeclaredValue`, changing only the JSON and the expected order:

```csharp
        // Descending by label would put South first; by value North (120) leads.
        var json = """
            {
              "rows": ["Region"],
              "columns": [],
              "values": [{ "field": "Amount", "aggregation": "sum" }],
              "filters": [],
              "fieldSorts": [{ "field": "Region", "direction": "Descending", "valueKey": "Amount_sum" }]
            }
            """;
```

and the assertion's expected array becomes `["North", "South"]`.

- [ ] **Step 4: Run the tests to verify they fail**

Run: `dotnet test tests/PivotForge.AspNetCore.Tests -f net10.0 --filter "FullyQualifiedName~SortByValueKey|FullyQualifiedName~OrdersARowLevelByADeclaredValue"`
Expected: build FAILS — `PivotFieldBuilder` has no `SortByValueKey`, `PivotFieldTagHelper` has no `SortByValueKey`.

- [ ] **Step 5: Implement the builder**

In `PivotFieldBuilder`, add beside `_sortOrder`:

```csharp
    private string? _sortByValueKey;
```

After the `SortOrder` method:

```csharp
    /// <summary>Orders this row field's level by a summary value instead of its labels.</summary>
    /// <remarks>
    /// Groups are ordered inside their parent group, so every region's categories run by amount
    /// within that region. The direction comes from <see cref="SortOrder"/>, ascending when it is
    /// not set. A sort the user applies from the cell menu still wins over this. Valid on
    /// <see cref="PivotArea.Row"/> fields only.
    /// </remarks>
    /// <param name="valueKey">The value key, as <c>Field_aggregation</c>. See <see cref="PivotValueKey"/>.</param>
    /// <returns>The same builder.</returns>
    public PivotFieldBuilder SortByValueKey(string valueKey)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(valueKey);
        _sortByValueKey = valueKey;
        return this;
    }
```

In `Build()`, after the `SortOrder` area check:

```csharp
        // Ordering a level by value is implemented on the row axis only: the
        // column axis is the product of its levels and has no such order.
        if (_area != PivotArea.Row && _sortByValueKey is not null)
        {
            throw new InvalidOperationException(
                $"Field \"{_dataField}\" sets SortByValueKey, but its Area is \"{_area}\". " +
                "SortByValueKey is only valid on fields whose Area is Row.");
        }
```

After the `sortOrder` emission:

```csharp
        if (_sortByValueKey is { } sortByValueKey)
        {
            field["sortByValueKey"] = sortByValueKey;
        }
```

Add `, or <see cref="SortByValueKey"/> was set outside <see cref="PivotArea.Row"/>` to the end of the `<exception>` sentence in `Build()`'s XML doc.

- [ ] **Step 6: Implement the tag helper**

In `PivotFieldTagHelper`, after the `SortOrder` property:

```csharp
    /// <summary>Gets or sets the value key whose summary orders this field's level.</summary>
    /// <remarks>
    /// As <c>Field_aggregation</c>, e.g. <c>Amount_sum</c>. Orders the level's groups by value inside
    /// their parent group, in the direction <c>sort-order</c> gives (ascending when absent). Valid on
    /// <c>Row</c> fields only.
    /// </remarks>
    [HtmlAttributeName("sort-by-value-key")]
    public string? SortByValueKey { get; set; }
```

At the end of `ApplyTo`:

```csharp
        if (!string.IsNullOrWhiteSpace(SortByValueKey))
        {
            builder.SortByValueKey(SortByValueKey);
        }
```

- [ ] **Step 7: Run the tests to verify they pass, then the whole suite**

Run: `dotnet test tests/PivotForge.AspNetCore.Tests -f net10.0 --filter "FullyQualifiedName~SortByValueKey|FullyQualifiedName~OrdersARowLevelByADeclaredValue"`
Expected: 6 passed (builder fact 1 + theory cases 3 + tag helper 1 + wire test 1).

Run: `dotnet test tests/PivotForge.AspNetCore.Tests -f net10.0`
Expected: all passed.

- [ ] **Step 8: Commit**

```bash
git add src/PivotForge.AspNetCore/Rendering/PivotFieldBuilder.cs src/PivotForge.AspNetCore/Rendering/PivotFieldTagHelper.cs tests/PivotForge.AspNetCore.Tests/PivotFieldBuilderTests.cs tests/PivotForge.AspNetCore.Tests/PivotTagHelperTests.cs tests/PivotForge.AspNetCore.Tests/PivotForgeAspNetCoreTests.cs
git commit -m "$(cat <<'EOF'
feat(siralama): sort-by-value-key niteligi ve SortByValueKey metodu

Satir alani ozet degere gore siralamayi bildirimsel olarak isteyebiliyor.
Yon mevcut sort-order'dan geliyor; satir disindaki alanda Build() hata
veriyor. Uc nokta testi valueKey'in JSON'dan motora kadar ulastigini
dogruluyor.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Browser — request builder and layout state

**Files:**
- Modify: `src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js` (`normalizeField` checks ~line 150-178 and return ~line 191; `buildRequest` `fieldSorts` ~line 336-340)
- Modify: `src/PivotForge.AspNetCore/wwwroot/js/pivot-layout-state.js` (`declaredIn` ~line 512-521)
- Test: `tests/pivot-request-builder.test.js` (after the sortOrder tests, ~line 395)
- Test: `tests/pivot-layout-state.test.js` (after `a row-only declaration is dropped...`, ~line 902)

**Interfaces:**
- Consumes: field member `sortByValueKey` from Task 2's payload.
- Produces: normalized field member `sortByValueKey: string | null`; request `fieldSorts` entries `{ field, direction, valueKey? }` matching Task 1's `PivotFieldSort`.

- [ ] **Step 1: Write the failing request builder tests**

Append after `an unknown sortOrder is refused rather than passed through`:

```js
test("a declared sortByValueKey reaches the request as a value field sort", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "Region", area: "row" },
    { dataField: "Category", area: "row", sortOrder: "Descending", sortByValueKey: "Amount_sum" },
    { dataField: "Amount", area: "data", aggregation: "sum" }
  ]);

  assert.deepEqual(request.fieldSorts, [
    { field: "Category", direction: "Descending", valueKey: "Amount_sum" }
  ]);
});

test("a sortByValueKey without a sortOrder sorts ascending", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "Category", area: "row", sortByValueKey: "Amount_sum" },
    { dataField: "Amount", area: "data", aggregation: "sum" }
  ]);

  assert.deepEqual(request.fieldSorts, [
    { field: "Category", direction: "Ascending", valueKey: "Amount_sum" }
  ]);
});

test("sortByValueKey is refused outside the row area", () => {
  ["column", "filter", "data"].forEach(area => {
    assert.throws(
      () => PivotRequestBuilder.normalizeFields([
        { dataField: "Amount", area, role: area === "data" ? "measure" : "dimension",
          sortByValueKey: "Amount_sum" }
      ]),
      /"sortByValueKey" is only valid on a "row" field/,
      area);
  });
});
```

- [ ] **Step 2: Write the failing layout state tests**

Append after `a row-only declaration is dropped when the field moves to another area`:

```js
test("a declared sortByValueKey survives a row-to-row move", () => {
  const state = new PivotForge.PivotLayoutState(
    catalog.map(field =>
      field.dataField === "Category" ? { ...field, sortByValueKey: "Amount_sum" } : field));

  state.reorder("row", 0, 1);
  const request = PivotForge.PivotRequestBuilder.buildRequest(state.toFields());

  assert.deepEqual(request.fieldSorts, [
    { field: "Category", direction: "Ascending", valueKey: "Amount_sum" }
  ]);
});

test("sortByValueKey is dropped, and sortOrder kept, when the field moves to the column area", () => {
  const state = new PivotForge.PivotLayoutState(
    catalog.map(field =>
      field.dataField === "Category"
        ? { ...field, sortOrder: "Descending", sortByValueKey: "Amount_sum" }
        : field));

  // Carrying the key along would turn a legal drag into a normalizeField exception.
  state.move("Category", "column", 0);
  const emitted = state.toFields().find(field => field.dataField === "Category");

  assert.equal(emitted.sortByValueKey, undefined);
  assert.equal(emitted.sortOrder, "Descending");
  assert.doesNotThrow(() => PivotForge.PivotRequestBuilder.buildRequest(state.toFields()));
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/pivot-request-builder.test.js tests/pivot-layout-state.test.js`
Expected: the five new tests FAIL (`fieldSorts` is `[]`, no throw, key not carried); every other test passes.

- [ ] **Step 4: Implement `normalizeField`**

In `pivot-request-builder.js`, after the `Unknown sortOrder` check:

```js
    // Ordering a level by a summary value is implemented on the row axis only;
    // the column axis is the product of its levels and has no such order.
    if (!isRow && field.sortByValueKey !== undefined) {
      throw new Error(
        `"sortByValueKey" is only valid on a "row" field, but was set on "${dataField}" in area "${area}".`
      );
    }
```

In the returned object, after `sortOrder,`:

```js
      sortByValueKey: isRow && field.sortByValueKey ? String(field.sortByValueKey) : null,
```

- [ ] **Step 5: Implement `buildRequest`**

Replace the `fieldSorts` member with:

```js
      // Named rather than positional so the list survives a field moving to
      // another area. A value sort declared without a direction takes the row
      // axis default; valueKey is sent only when declared, so a page that never
      // uses it sends the request it always did.
      fieldSorts: normalized
        .filter(field => field.sortOrder !== null || field.sortByValueKey !== null)
        .map(field => ({
          field: field.key,
          direction: field.sortOrder ?? "Ascending",
          ...(field.sortByValueKey !== null ? { valueKey: field.sortByValueKey } : {})
        }))
```

- [ ] **Step 6: Implement `declaredIn`**

In `pivot-layout-state.js`, inside the object `declaredIn` returns, after the `showTotals` line:

```js
          ...(isRow && field.sortByValueKey ? { sortByValueKey: field.sortByValueKey } : {}),
```

Extend the comment above `declaredIn` — the sentence ending "`normalizeField refuses it there.`" — with: ` The same holds for sortByValueKey.`

- [ ] **Step 7: Run the whole JS suite**

Run: `npm test`
Expected: all passed, including the five new tests.

- [ ] **Step 8: Commit**

```bash
git add src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js src/PivotForge.AspNetCore/wwwroot/js/pivot-layout-state.js tests/pivot-request-builder.test.js tests/pivot-layout-state.test.js
git commit -m "$(cat <<'EOF'
feat(siralama): tarayici sortByValueKey'i istege ve duzene tasiyor

normalizeField anahtari yalnizca satir alaninda kabul ediyor; fieldSorts
girdisi valueKey tasiyor, yon bildirilmemisse Ascending. Alan sutuna
suruklenince anahtar dusuyor, sortOrder kaliyor.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Documentation and full verification

**Files:**
- Modify: `TODO.md` (section 1 table row `sortBy` and the `- [ ] Alan başına \`sort-by\`` item)
- Modify: `CHANGELOG.md` (`## [0.6.0-preview.1]` → `### Added`)
- Modify: `docs/aspnetcore-integration.md`, `docs/public-api.md` (next to the existing `sort-order` / `PivotFieldSort` text; locate with `grep -n "sort-order\|PivotFieldSort" docs/*.md`)

- [ ] **Step 1: TODO.md**

Table row becomes:

```markdown
| `sortBy` | ✅ | ✅ | `sort-by-value-key` niteliği ve `SortByValueKey()` metodu; yalnızca satır ekseni |
```

The item becomes:

```markdown
- [x] Alan başına `sort-by` — `sort-by-value-key="Amount_sum"` satır seviyesini
      özet değere göre, **üst grubunun içinde** sıralıyor; yön `sort-order`'dan
      geliyor. Ara seviye alt toplamına, en derin seviye satır toplamına göre,
      ikisi de `show-as` uygulanmış hâliyle — okuyucunun gördüğü sayıya göre.
      Boş grup iki yönde de sonda, eşitlik etikete göre artan. Sütun ekseni ve
      tasarımcı UI'ı kapsam dışı
```

- [ ] **Step 2: CHANGELOG.md**

Under `## [0.6.0-preview.1]` → `### Added`, append:

```markdown
- **Core** — `PivotFieldSort.ValueKey`: a row level orders its groups by a
  value's summary inside their parent group — an inner level by its subtotal,
  the deepest by its row total, both as shown after `show-as`. Groups with no
  value sort last in either direction; equal values break on the label. The
  record gained a third, optional constructor parameter, so code compiled
  against an earlier preview must be rebuilt.
- **AspNetCore** — `sort-by-value-key` on `<pivot-field>` and
  `PivotFieldBuilder.SortByValueKey()`, row fields only; the direction comes
  from `sort-order`.
```

- [ ] **Step 3: Integration and API docs**

Next to the `sort-order` attribute in `docs/aspnetcore-integration.md`, add:

```markdown
`sort-by-value-key` orders a row field's level by a summary value instead of
its labels, inside each parent group. It names a value key (`Field_aggregation`)
and takes its direction from `sort-order`, ascending when absent:

    <pivot-field data-field="Category" area="Row"
                 sort-by-value-key="Amount_sum" sort-order="Descending" />

Row fields only. A sort the reader picks from the cell menu still wins.
```

In `docs/public-api.md`, where `PivotFieldSort` is listed, show the new signature `PivotFieldSort(string Field, PivotSortDirection Direction, string? ValueKey = null)` and add `PivotFieldBuilder.SortByValueKey(string valueKey)` beside `SortOrder`.

- [ ] **Step 4: Full verification**

Run: `dotnet build`
Expected: 0 errors, 0 warnings introduced (XML doc warnings count).

Run: `DOTNET_ROLL_FORWARD=LatestMajor dotnet test`
Expected: all passed on both `net8.0` and `net10.0`.

Run: `npm test`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add TODO.md CHANGELOG.md docs/aspnetcore-integration.md docs/public-api.md
git commit -m "$(cat <<'EOF'
docs(siralama): sort-by-value-key belgelendi

TODO'da Bolum 1 sort-by kalemi kapandi, CHANGELOG'a 0.6.0-preview.1
altinda ikili uyumluluk notuyla eklendi, entegrasyon ve API belgeleri
guncellendi.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```
