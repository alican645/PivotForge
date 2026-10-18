using PivotForge.Core;

namespace PivotForge.Core.Tests;

// Percent of the parent group (DevExtreme's percentOfColumnTotal /
// percentOfRowTotal, Excel's "% of Parent Row / Column Total"): each value
// divided by its parent group's value on one axis, the same cell on the other.
// At the top level the parent is that axis' grand total.
public sealed class PivotParentShareTests
{
    private sealed record Sale(string Region, string City, string Year, string Quarter, decimal Amount);

    // Region > City on the rows, Year > Quarter on the columns.
    //                 2025/Q1  2025/Q2  2026/Q1
    // Ege    İzmir       10       30       20
    // Ege    Aydın       30        -       20
    // Marmara Bursa      40       60        -
    private static readonly Sale[] Sales =
    [
        new("Ege", "İzmir", "2025", "Q1", 10m),
        new("Ege", "İzmir", "2025", "Q2", 30m),
        new("Ege", "İzmir", "2026", "Q1", 20m),
        new("Ege", "Aydın", "2025", "Q1", 30m),
        new("Ege", "Aydın", "2026", "Q1", 20m),
        new("Marmara", "Bursa", "2025", "Q1", 40m),
        new("Marmara", "Bursa", "2025", "Q2", 60m)
    ];

    private static PivotResult Execute(PivotShowAs showAs) => new PivotEngine().Execute(Sales, new PivotRequest
    {
        Rows = ["Region", "City"],
        Columns = ["Year", "Quarter"],
        Values = [PivotValueDefinition.Sum("Amount").As(showAs)]
    });

    private static int Row(PivotResult result, string city) =>
        result.RowHeaders.Select((header, index) => (header, index)).Single(entry => entry.header[1] == city).index;

    private static int Column(PivotResult result, string year, string quarter) =>
        result.ColumnHeaders.Select((header, index) => (header, index))
            .Single(entry => entry.header[0] == year && entry.header[1] == quarter).index;

    private static decimal? Cell(PivotResult result, string city, string year, string quarter) =>
        result.Cells.SingleOrDefault(cell => cell.Row == Row(result, city) && cell.Column == Column(result, year, quarter))
            ?.Values["Amount_sum"];

    [Fact]
    public void PercentOfParentRowTotal_DividesByTheRowGroupInTheSameColumn()
    {
        var result = Execute(PivotShowAs.PercentOfParentRowTotal);

        // İzmir's 2025/Q1 is 10 of Ege's 40 there.
        Assert.Equal(0.25m, Cell(result, "İzmir", "2025", "Q1"));
        Assert.Equal(0.75m, Cell(result, "Aydın", "2025", "Q1"));
        Assert.Equal(1m, Cell(result, "Bursa", "2025", "Q1"));

        // A city's row total is its share of its region's total: İzmir 60 of Ege 110.
        Assert.Equal(60m / 110m, result.RowTotals.Single(total => total.Index == Row(result, "İzmir")).Values["Amount_sum"]);

        // A region is the top level: its parent is the column's grand total (Ege 40 of 80 in 2025/Q1).
        var ege = result.Subtotals.Single(subtotal => subtotal.RowHeader.SequenceEqual(["Ege"]));
        Assert.Equal(0.5m, ege.Cells.Single(cell => cell.Column == Column(result, "2025", "Q1")).Values["Amount_sum"]);
        Assert.Equal(110m / 210m, ege.Totals["Amount_sum"]);
        // Where Ege crosses the 2025 column subtotal: 70 of 2025's 170.
        Assert.Equal(70m / 170m, ege.ColumnSubtotals.Single(cell => cell.ColumnHeader.SequenceEqual(["2025"])).Values["Amount_sum"]);

        // İzmir in the 2025 subtotal column: 40 of Ege's 70 there.
        var year2025 = result.ColumnSubtotals.Single(subtotal => subtotal.ColumnHeader.SequenceEqual(["2025"]));
        Assert.Equal(40m / 70m, year2025.Cells.Single(cell => cell.Index == Row(result, "İzmir")).Values["Amount_sum"]);

        // The bottom row is every row's root: 100%.
        Assert.Equal(1m, result.ColumnTotals.Single(total => total.Index == Column(result, "2025", "Q1")).Values["Amount_sum"]);
        Assert.Equal(1m, result.GrandTotals["Amount_sum"]);
    }

    [Fact]
    public void PercentOfParentColumnTotal_DividesByTheColumnGroupInTheSameRow()
    {
        var result = Execute(PivotShowAs.PercentOfParentColumnTotal);

        // İzmir's 2025/Q1 is 10 of its 2025's 40.
        Assert.Equal(0.25m, Cell(result, "İzmir", "2025", "Q1"));
        Assert.Equal(0.75m, Cell(result, "İzmir", "2025", "Q2"));
        Assert.Equal(1m, Cell(result, "İzmir", "2026", "Q1"));

        // A year is the top level: its parent is the row's grand total (İzmir's 2025 is 40 of 60).
        var year2025 = result.ColumnSubtotals.Single(subtotal => subtotal.ColumnHeader.SequenceEqual(["2025"]));
        Assert.Equal(40m / 60m, year2025.Cells.Single(cell => cell.Index == Row(result, "İzmir")).Values["Amount_sum"]);
        // The bottom row's 2025 subtotal: 170 of 210.
        Assert.Equal(170m / 210m, year2025.Totals["Amount_sum"]);

        // Ege's 2025/Q1 is 40 of Ege's 2025 (70); the bottom row's 2025/Q1 is 80 of 170.
        var ege = result.Subtotals.Single(subtotal => subtotal.RowHeader.SequenceEqual(["Ege"]));
        Assert.Equal(40m / 70m, ege.Cells.Single(cell => cell.Column == Column(result, "2025", "Q1")).Values["Amount_sum"]);
        Assert.Equal(80m / 170m, result.ColumnTotals.Single(total => total.Index == Column(result, "2025", "Q1")).Values["Amount_sum"]);

        // The right-hand total is every column's root: 100%.
        Assert.Equal(1m, result.RowTotals.Single(total => total.Index == Row(result, "İzmir")).Values["Amount_sum"]);
        Assert.Equal(1m, ege.Totals["Amount_sum"]);
        Assert.Equal(1m, result.GrandTotals["Amount_sum"]);
    }

    [Fact]
    public void AnEmptyCellStaysEmpty_AndASingleLevelAxisDividesByTheGrandTotal()
    {
        var result = Execute(PivotShowAs.PercentOfParentRowTotal);
        Assert.Null(Cell(result, "Aydın", "2025", "Q2"));

        var flat = new PivotEngine().Execute(Sales, new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Sum("Amount").As(PivotShowAs.PercentOfParentRowTotal)]
        });
        // One row level: a region's share of its column, Ege 70 of 2025's 170.
        var ege = flat.RowHeaders.Select((header, index) => (header, index)).Single(entry => entry.header[0] == "Ege").index;
        var year2025 = flat.ColumnHeaders.Select((header, index) => (header, index)).Single(entry => entry.header[0] == "2025").index;
        Assert.Equal(70m / 170m, flat.Cells.Single(cell => cell.Row == ege && cell.Column == year2025).Values["Amount_sum"]);
    }
}
