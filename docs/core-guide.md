# PivotForge Core Guide

`PivotForge.Core` calculates pivot results without depending on ASP.NET Core or a browser UI. It targets `net8.0` and can be used from web APIs, workers, console applications, desktop applications, and custom reporting interfaces.

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

Available aggregations are `Sum`, `Count`, `Average`, `Min`, and `Max`. A value key is generated from the field and aggregation, such as `Amount_sum`.

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

Percentage modes return ratios. For example, `0.25m` represents 25 percent; formatting belongs to the consuming UI.

## Result Contract

`PivotResult` contains:

- `RowHeaders` and `ColumnHeaders`
- sparse `Cells` with row and column indexes
- `RowTotals`, `ColumnTotals`, and `GrandTotals`
- hierarchical row `Subtotals`
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
