# PivotForge Core

PivotForge Core is a dependency-light pivot table engine for .NET 8 and newer applications.

## Features

- Group rows and columns from objects, dictionaries, `DataTable`, JSON, or CSV
- Sum, count, average, minimum, and maximum aggregations
- Filters and row sorting by labels, totals, or a selected column value
- Percentages, differences, percent differences, and running totals
- Source-record drill-down for detail cells, subtotals, and grand totals
- Result pagination and cooperative cancellation
- Dependency-free `.xlsx` export

## Installation

```bash
dotnet add package PivotForge.Core --version 0.1.0-preview.1
```

## Create a pivot

```csharp
using PivotForge.Core;

var sales = new[]
{
    new { Region = "North", Year = 2025, Amount = 120m },
    new { Region = "North", Year = 2026, Amount = 180m },
    new { Region = "South", Year = 2026, Amount = 90m }
};

var request = new PivotRequest
{
    Rows = ["Region"],
    Columns = ["Year"],
    Values = [PivotValueDefinition.Sum("Amount")]
};

var result = new PivotEngine().Execute(sales, request);
```

Pass a `CancellationToken` to the `Execute` overload for cancellable calculations.

## Drill down

```csharp
var records = new PivotEngine().DrillDown(
    sales,
    request,
    rowPath: ["North"],
    columnPath: ["2026"]);
```

Use an empty path for an axis total or a prefix path for a subtotal.

## Pagination

```csharp
var page = PivotResultPaginator.CreatePage(result, offset: 0, pageSize: 100);
```

## Excel export

```csharp
using PivotForge.Core.Excel;

var document = new PivotExcelDocument
{
    Title = "Sales Pivot",
    Rows =
    [
        new PivotExcelRow
        {
            Cells =
            [
                new PivotExcelCell { Text = "Region", Role = PivotExcelCellRole.Header },
                new PivotExcelCell { Text = "Amount", Role = PivotExcelCellRole.Header }
            ]
        }
    ]
};

var xlsx = new PivotExcelExporter().Export(document);
File.WriteAllBytes("pivot.xlsx", xlsx);
```

PivotForge Core is licensed under the MIT License.
