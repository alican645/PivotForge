using System.Globalization;
using PivotForge.Core;

namespace PivotForge.Core.Tests;

public sealed class PivotSortBySummaryTests
{
    private sealed record Sale(string Region, string Category, string Year, string Quarter, decimal Amount);

    // Region totals: East 105, West 121. Category totals: Alpha 100, Beta 105, Gamma 20,
    // Delta 1. Year by quarter: 2024 Q1 80, Q2 31; 2025 Q1 45, Q2 70.
    private static readonly Sale[] Sales =
    [
        new("East", "Alpha", "2024", "Q1", 10m),
        new("East", "Alpha", "2025", "Q1", 40m),
        new("East", "Beta", "2024", "Q2", 30m),
        new("East", "Beta", "2025", "Q1", 5m),
        new("East", "Gamma", "2024", "Q1", 20m),
        new("West", "Alpha", "2024", "Q1", 50m),
        new("West", "Beta", "2025", "Q2", 70m),
        new("West", "Delta", "2024", "Q2", 1m)
    ];

    private static readonly PivotEngine Engine = new(CultureInfo.InvariantCulture);

    private static string[] Paths(IEnumerable<IReadOnlyList<string?>> headers) =>
        headers.Select(header => string.Join("/", header)).ToArray();

    private static decimal? Cell(PivotResult result, string row, string column) =>
        result.Cells.Single(cell =>
                string.Join("/", result.RowHeaders[cell.Row]) == row &&
                string.Join("/", result.ColumnHeaders[cell.Column]) == column)
            .Values["Amount_sum"];

    [Fact]
    public void AValueRowSortOrdersEveryLevelInsideItsParent()
    {
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Region", "Category"],
            Values = [PivotValueDefinition.Sum("Amount")],
            RowSort = PivotSort.RowTotal("Amount_sum", PivotSortDirection.Descending)
        });

        // West's 121 beats East's 105, and each region's categories stay together.
        Assert.Equal(
            ["West/Beta", "West/Alpha", "West/Delta", "East/Alpha", "East/Beta", "East/Gamma"],
            Paths(result.RowHeaders));
    }

    [Fact]
    public void ARowLevelIsOrderedByTheValueInOneColumn()
    {
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Region", "Category"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Sum("Amount")],
            FieldSorts = [new PivotFieldSort("Category", PivotSortDirection.Descending, "Amount_sum", ["2025"])]
        });

        // Groups without a 2025 value have no rank and fall back to their labels, last.
        Assert.Equal(
            ["East/Alpha", "East/Beta", "East/Gamma", "West/Beta", "West/Alpha", "West/Delta"],
            Paths(result.RowHeaders));
    }

    [Fact]
    public void ARowSortCanUseASubtotalColumn()
    {
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Category"],
            Columns = ["Year", "Quarter"],
            Values = [PivotValueDefinition.Sum("Amount")],
            RowSort = PivotSort.RowColumnValue("Amount_sum", ["2024"], PivotSortDirection.Descending)
        });

        // 2024 subtotals: Alpha 60, Beta 30, Gamma 20, Delta 1.
        Assert.Equal(["Alpha", "Beta", "Gamma", "Delta"], Paths(result.RowHeaders));
    }

    [Fact]
    public void AColumnLevelIsOrderedByItsTotal()
    {
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Category"],
            Values = [PivotValueDefinition.Sum("Amount")],
            FieldSorts = [new PivotFieldSort("Category", PivotSortDirection.Descending, "Amount_sum")]
        });

        Assert.Equal(["Beta", "Alpha", "Gamma", "Delta"], Paths(result.ColumnHeaders));
        // Everything addressed by column index moved with its header.
        Assert.Equal(35m, Cell(result, "East", "Beta"));
        Assert.Equal(70m, Cell(result, "West", "Beta"));
        Assert.Equal(
            [105m, 100m, 20m, 1m],
            result.ColumnTotals.OrderBy(total => total.Index).Select(total => total.Values["Amount_sum"]));
    }

    [Fact]
    public void AColumnLevelIsOrderedByTheValueInOneRow()
    {
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Category"],
            Values = [PivotValueDefinition.Sum("Amount")],
            FieldSorts = [new PivotFieldSort("Category", PivotSortDirection.Ascending, "Amount_sum", ["East"])]
        });

        // East holds no Delta, so Delta has no rank and goes last even ascending.
        Assert.Equal(["Gamma", "Beta", "Alpha", "Delta"], Paths(result.ColumnHeaders));
    }

    [Fact]
    public void AColumnLevelCanUseASubtotalRow()
    {
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Region", "Category"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Sum("Amount")],
            FieldSorts = [new PivotFieldSort("Year", PivotSortDirection.Ascending, "Amount_sum", ["East"])]
        });

        // East's subtotal: 2024 60, 2025 45.
        Assert.Equal(["2025", "2024"], Paths(result.ColumnHeaders));
        var east = result.Subtotals.Single(subtotal => subtotal.RowHeader.SequenceEqual(["East"]));
        Assert.Equal(45m, east.Cells.Single(cell => cell.Column == 0).Values["Amount_sum"]);
        Assert.Equal(60m, east.Cells.Single(cell => cell.Column == 1).Values["Amount_sum"]);
    }

    [Fact]
    public void AnInnerColumnLevelIsOrderedInsideItsParent()
    {
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Year", "Quarter"],
            Values = [PivotValueDefinition.Sum("Amount")],
            FieldSorts = [new PivotFieldSort("Quarter", PivotSortDirection.Ascending, "Amount_sum")]
        });

        Assert.Equal(["2024/Q2", "2024/Q1", "2025/Q1", "2025/Q2"], Paths(result.ColumnHeaders));
        Assert.Equal(["2024", "2025"], Paths(result.ColumnSubtotals.Select(subtotal => subtotal.ColumnHeader)));
        Assert.Equal(30m, Cell(result, "East", "2024/Q2"));
    }

    [Fact]
    public void AnOuterColumnLevelIsOrderedByItsSubtotal()
    {
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Category", "Year"],
            Values = [PivotValueDefinition.Sum("Amount")],
            FieldSorts = [new PivotFieldSort("Category", PivotSortDirection.Descending, "Amount_sum")]
        });

        Assert.Equal(
            ["Beta", "Alpha", "Gamma", "Delta"],
            result.ColumnHeaders.Select(header => header[0]!).Distinct().ToArray());
        Assert.Equal(
            ["Beta", "Alpha", "Gamma", "Delta"],
            Paths(result.ColumnSubtotals.Select(subtotal => subtotal.ColumnHeader)));
    }

    [Fact]
    public void ACalculatedFieldOrdersColumns()
    {
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Category"],
            Values = [PivotValueDefinition.Calculated("Negative", "0 - [Amount]")],
            FieldSorts = [new PivotFieldSort("Category", PivotSortDirection.Descending, "Negative_calculated")]
        });

        Assert.Equal(["Delta", "Gamma", "Alpha", "Beta"], Paths(result.ColumnHeaders));
    }

    [Fact]
    public void APathMatchingNothingLeavesAscendingLabelOrder()
    {
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Category"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Sum("Amount")],
            FieldSorts = [new PivotFieldSort("Category", PivotSortDirection.Descending, "Amount_sum", ["1999"])]
        });

        // No group has a value, and equal values break on the label, ascending.
        Assert.Equal(["Alpha", "Beta", "Delta", "Gamma"], Paths(result.RowHeaders));
    }

    [Fact]
    public void AColumnLabelSortIsUntouchedWithoutAValueKey()
    {
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Category"],
            Values = [PivotValueDefinition.Sum("Amount")],
            FieldSorts = [new PivotFieldSort("Category", PivotSortDirection.Descending)]
        });

        Assert.Equal(["Gamma", "Delta", "Beta", "Alpha"], Paths(result.ColumnHeaders));
    }
}
