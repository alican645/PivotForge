# PivotForge Core Guide

`PivotForge.Core` calculates pivot results without depending on ASP.NET Core or a browser UI. It targets `net8.0` and `net10.0`, and can be used from web APIs, workers, console applications, desktop applications, and custom reporting interfaces.

## Supported Inputs

### Objects

```csharp
var result = new PivotEngine().Execute(records, request, cancellationToken);
```

Public properties are matched case-insensitively by field name.

### DataTable

```csharp
DataTable table = LoadTable();
var result = new PivotEngine().Execute(table, request, cancellationToken);
```

### JSON and CSV

```csharp
using PivotForge.Core.Records;

var jsonRecords = JsonRecordParser.Parse(json);
var csvRecords = CsvRecordParser.Parse(csv);

var jsonResult = new PivotEngine().ExecuteRecords(jsonRecords, request, cancellationToken);
var csvResult = new PivotEngine().ExecuteRecords(csvRecords, request, cancellationToken);
```

JSON input must be an array of flat objects. CSV input uses the first row as field names and supports quoted values, escaped quotes, and invariant-culture decimal conversion.

### Data types

A source that holds numbers or dates as text — a CSV column the parser could not type, a loosely typed JSON feed, a `DataTable` of strings — declares what each column is:

```csharp
var request = new PivotRequest
{
    Rows = [new PivotFieldRef("OrderDate", PivotGroupInterval.Month)],
    Values = [PivotValueDefinition.Sum("Amount")],
    DataTypes = new Dictionary<string, PivotDataType>
    {
        ["OrderDate"] = PivotDataType.Date,
        ["Amount"] = PivotDataType.Number
    }
};
```

Each value is converted where it is read, so aggregation, grouping, filters, `DistinctValues` (which takes the same map) and drill-down all see it, and a converted value behaves exactly like a typed `decimal` or `DateTime`. `Number` reads text invariantly, then in the engine's culture; `Date` reads it in the engine's culture, then invariantly; `String` takes the invariant text, so a numeric code orders as text. A value that does not convert is blank. A `Number` or `Date` level sorts by its values when it is sorted. Typing a field the source does not have is refused like any other unknown field.

## Configure a Pivot

```csharp
var request = new PivotRequest
{
    Rows = ["Region", "Category"],
    Columns = ["Year", "Quarter"],
    Values =
    [
        PivotValueDefinition.Sum("Amount"),
        PivotValueDefinition.Average("Quantity"),
        PivotValueDefinition.Max("Discount")
    ],
    Filters =
    [
        new PivotFilter("Region", ["North", "South"])
    ],
    RowSort = PivotSort.RowTotal("Amount_sum", PivotSortDirection.Descending)
};
```

Available aggregations are `Sum`, `Count`, `Average`, `Min`, `Max`, `CountDistinct`, `Median`, `Variance`, `StandardDeviation`, `VariancePopulation`, `StandardDeviationPopulation`, `First`, and `Last`. `CountDistinct` counts distinct non-empty values of any type, as `Count` does; the rest need numbers. `Variance` and `StandardDeviation` are the sample statistics (divided by n − 1, like Excel's `VAR.S` and `STDEV.S`) and stay empty below two values; `VariancePopulation` and `StandardDeviationPopulation` divide by n, like `VAR.P` and `STDEV.P`, and are 0 for a single value. `First` and `Last` are the first and last non-empty values in the order the source yields its records. Every subtotal and grand total is computed from the records behind it, so a median or a distinct count is exact at every level rather than a combination of the cells above it. A value key is generated from the field and aggregation, such as `Amount_sum`.

Filters are applied before grouping. Multiple filters use AND semantics; the values inside one filter use OR semantics.

## Sorting

```csharp
var byLabel = PivotSort.RowLabel("Region", PivotSortDirection.Ascending);
var byTotal = PivotSort.RowTotal("Amount_sum", PivotSortDirection.Descending);
var byColumn = PivotSort.RowColumnValue(
    "Amount_sum",
    columnPath: ["2026", "Q1"],
    direction: PivotSortDirection.Descending);
```

Only row order changes. Column headers keep their calculated order.

## Numeric Ranges

A level grouped by `PivotGroupInterval.Range` splits a numeric field into ranges of `BinSize`, labelled `0 – 1.000`, `1.000 – 2.000` and so on (bounds in the engine's culture), ordered by where each starts:

```csharp
Rows = [new PivotFieldRef("Amount", PivotGroupInterval.Range, 1000m)]
```

Each range includes its start and excludes its end, and the ranges are aligned to zero. A value that is not a number keeps its own text. The level's key is `Amount:range1000`. A filter on it carries the same `Interval` and `BinSize`, and `DistinctValues(records, "Amount", PivotGroupInterval.Range, 1000m)` lists the ranges. A range without a positive `BinSize`, or a `BinSize` on any other interval, is refused.

## Value Filters

`ValueFilters` keep the groups of a row level whose summary value meets a condition. They run after aggregation, like `TopN`, and the groups they drop leave the totals too:

```csharp
var request = new PivotRequest
{
    Rows = ["Region"],
    Values = [PivotValueDefinition.Sum("Amount")],
    ValueFilters = [new PivotValueFilter("Region", PivotValueFilterOperator.GreaterThan, 10_000m)]
};
```

`Between` and `NotBetween` take `Value2` as the upper bound, both bounds included; `ValueKey` picks the value compared (the first declared one otherwise). A group with no value is dropped, and a `TopN` on the same level ranks only the groups the filter keeps. A filter naming no row level, comparing an undeclared value, or a range without its upper bound is refused.

## Show Values As

```csharp
var value = PivotValueDefinition
    .Sum("Amount")
    .As(PivotShowAs.PercentOfGrandTotal);
```

Supported modes:

- `Normal`
- `PercentOfRowTotal`
- `PercentOfColumnTotal`
- `PercentOfGrandTotal`
- `DifferenceFromPrevious`
- `PercentDifferenceFromPrevious`
- `RunningTotal`
- `PercentOfParentRowTotal`
- `PercentOfParentColumnTotal`

Percentage modes return ratios. For example, `0.25m` represents 25 percent; formatting belongs to the consuming UI.

`PercentOfRowTotal` and `PercentOfColumnTotal` divide by the grand total of the row or the column (DevExtreme's `percentOfRowGrandTotal` / `percentOfColumnGrandTotal`). The parent modes divide by the group one level up instead (Excel's "% of Parent Row / Column Total", DevExtreme's `percentOfColumnTotal` / `percentOfRowTotal`): with Region and City on the rows, `PercentOfParentRowTotal` gives each city's share of its region in every column, and each region's share of the column's grand total. Every part of the result follows the same rule -- a subtotal row, a column subtotal, where the two cross, and the totals; the root of the chosen axis (the bottom total row for the row parent, the right-hand total for the column parent) reads 100%.

### Running totals in either direction

`RunningTotal` on the value (DevExtreme's `runningTotal`) accumulates after the display mode and after sorting, in the order the result is drawn:

```csharp
PivotValueDefinition.Sum("Amount").As(PivotShowAs.PercentOfParentRowTotal) with
{
    RunningTotal = PivotRunningTotal.Column,      // down each column
    AllowCrossGroupCalculation = false            // starting again in each region
}
```

That is a cumulative share: each region's last city reaches 100%. `PivotRunningTotal.Row` runs along each row instead. A subtotal row (or column) accumulates among the subtotals of its own level; the totals it runs towards -- the bottom row for `Column`, the right-hand total for `Row` -- and the grand total are left as they are. An empty position carries the total so far.

`RunningTotal`, `DifferenceFromPrevious` and `PercentDifferenceFromPrevious` walk each row from the first column to the last. With more than one column level, `AllowCrossGroupCalculation = false` keeps them inside each outer column group instead — the running total starts again every year, and a year's first quarter has no previous column. The group is the last column level's parent, so with Year, Quarter and Month it starts again every quarter:

```csharp
PivotValueDefinition.Sum("Amount").As(PivotShowAs.RunningTotal) with { AllowCrossGroupCalculation = false }
```

## Calculated Fields

A calculated value is a formula over other summaries:

```csharp
var request = new PivotRequest
{
    Rows = ["Region"],
    Values =
    [
        PivotValueDefinition.Sum("Revenue"),
        PivotValueDefinition.Calculated("Margin", "([Revenue] - [Cost]) / [Revenue]")
    ]
};

// result.GrandTotals["Margin_calculated"]
```

The formula runs after each cell, row total, column total, subtotal and grand total has been aggregated, on that bucket's own summaries. `[Profit] / [Revenue]` is therefore the ratio of the sums at every level, never a sum or an average of per-record ratios. Show-as modes, value sorting and Top-N treat a calculated value like any other.

The grammar:

- `[Field]` is the sum of a source field; `Sum`, `Count`, `Avg` (or `Average`), `Min`, `Max`, `CountDistinct`, `Median`, `Var` (or `Variance`), `StDev` (or `StdDev`), `VarP`, `StDevP`, `First` and `Last` summarize it another way: `Count([OrderId])`, `[Revenue] / CountDistinct([CustomerId])`.
- `+ - * /`, parentheses and unary minus, with the usual precedence.
- Numbers are written with a dot as the decimal separator, whatever the culture.
- Function and field names are matched without regard to case.
- An empty summary or a division by zero leaves the cell empty.

`PivotExpression.Parse(text)` reads a formula without running it and lists the source fields it names; a formula that cannot be read throws `PivotExpressionException`, which carries the character `Position` the problem starts at.

### Custom Aggregates

A summary the engine does not have is registered by name and called from a formula:

```csharp
var engine = new PivotEngine
{
    CustomAggregates = new Dictionary<string, PivotCustomAggregate>(StringComparer.OrdinalIgnoreCase)
    {
        ["Range"] = values => values.Max() - values.Min()
    }
};

var value = PivotValueDefinition.Calculated("AmountRange", "Range([Amount])");
```

The function receives a cell's non-null values and is not called for a cell that has none. The built-in names always mean the built-in summaries.

## Result Contract

`PivotResult` contains:

- `RowHeaders` and `ColumnHeaders`
- sparse `Cells` with row and column indexes
- `RowTotals`, `ColumnTotals`, and `GrandTotals`
- hierarchical row `Subtotals`, each carrying its values in every column subtotal
- hierarchical `ColumnSubtotals`, one per outer column group, with a value per row and a total across all rows
- source, header, and cell counts in `Metadata`

Cells and totals store values in dictionaries keyed by the value definition key.

## Drill-Down

```csharp
var records = new PivotEngine().DrillDown(
    sales,
    request,
    rowPath: ["North", "Hardware"],
    columnPath: ["2026"]);
```

A full path selects a detail cell. A prefix row path selects a subtotal. An empty path selects the total for that axis. Pivot filters remain active during drill-down.

Use `DrillDown` for objects or `DataTable`, and `DrillDownRecords` for dictionary records.

## Pagination

```csharp
var page = PivotResultPaginator.CreatePage(result, offset: 0, pageSize: 100);
```

Page size must be between 1 and 1,000. Cell and row-total indexes are remapped to the page while column totals and grand totals remain authoritative for the complete result.

## Cancellation

```csharp
using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(10));
var result = new PivotEngine().Execute(records, request, cancellation.Token);
```

Cancellation is checked while materializing and scanning records and before returning the final sorted result. An interrupted calculation throws `OperationCanceledException` and does not return a partial result.

## Excel Export

```csharp
using PivotForge.Core.Excel;

var document = new PivotExcelDocument
{
    Title = "Sales Pivot",
    FilterSummary = "Region: North",
    SheetName = "Sales",
    HeaderRowCount = 2,
    FrozenColumnCount = 2,
    Rows =
    [
        new PivotExcelRow
        {
            Cells =
            [
                new PivotExcelCell { Text = "Region", Role = PivotExcelCellRole.Header },
                new PivotExcelCell
                {
                    Text = "Amount",
                    Number = 300m,
                    NumberFormat = "#,##0.00",
                    Role = PivotExcelCellRole.Value
                }
            ]
        }
    ]
};

var bytes = new PivotExcelExporter().Export(document);
File.WriteAllBytes("sales-pivot.xlsx", bytes);
```

The exporter creates an `.xlsx` file without an external spreadsheet package. It supports merged cells, row and column spans, number formats, widths, frozen headers, and highlight roles.

## Validation Errors

- `PivotFieldNotFoundException`: a configured field doesn't exist.
- `PivotFieldTypeException`: a numeric aggregation receives an incompatible value.
- `ArgumentException`: a request or drill-down path is structurally invalid.
- `OperationCanceledException`: the supplied cancellation token was cancelled.
