using PivotForge.Core;

namespace PivotForge.Core.Tests;

// DevExtreme's runningTotal: "row" accumulates along a row (across the
// columns), "column" down a column (across the rows), after the display mode
// and in the order the result is drawn. A subtotal row accumulates among the
// subtotal rows of its own level; the totals are left as they are.
public sealed class PivotRunningTotalTests
{
    private sealed record Sale(string Region, string City, string Year, decimal Amount);

    //                 2024  2025  2026
    // Ege    Aydın      1     2     -
    // Ege    İzmir      3     4     5
    // Marmara Bursa     6     -     7
    private static readonly Sale[] Sales =
    [
        new("Ege", "Aydın", "2024", 1m),
        new("Ege", "Aydın", "2025", 2m),
        new("Ege", "İzmir", "2024", 3m),
        new("Ege", "İzmir", "2025", 4m),
        new("Ege", "İzmir", "2026", 5m),
        new("Marmara", "Bursa", "2024", 6m),
        new("Marmara", "Bursa", "2026", 7m)
    ];

    private static PivotResult Execute(PivotRunningTotal runningTotal, bool crossGroups = true, PivotShowAs showAs = PivotShowAs.Normal) =>
        new PivotEngine().Execute(Sales, new PivotRequest
        {
            Rows = ["Region", "City"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Sum("Amount").As(showAs) with
            {
                RunningTotal = runningTotal,
                AllowCrossGroupCalculation = crossGroups
            }]
        });

    private static decimal? Cell(PivotResult result, string city, string year)
    {
        var row = result.RowHeaders.Select((header, index) => (header, index)).Single(entry => entry.header[1] == city).index;
        var column = result.ColumnHeaders.Select((header, index) => (header, index)).Single(entry => entry.header[0] == year).index;
        return result.Cells.SingleOrDefault(cell => cell.Row == row && cell.Column == column)?.Values["Amount_sum"];
    }

    private static decimal? RowTotal(PivotResult result, string city)
    {
        var row = result.RowHeaders.Select((header, index) => (header, index)).Single(entry => entry.header[1] == city).index;
        return result.RowTotals.Single(total => total.Index == row).Values["Amount_sum"];
    }

    private static decimal? Subtotal(PivotResult result, string region, string year)
    {
        var column = result.ColumnHeaders.Select((header, index) => (header, index)).Single(entry => entry.header[0] == year).index;
        return result.Subtotals.Single(subtotal => subtotal.RowHeader.SequenceEqual([region]))
            .Cells.SingleOrDefault(cell => cell.Column == column)?.Values["Amount_sum"];
    }

    [Fact]
    public void DownTheColumns_AccumulatesEachColumnInDrawnRowOrder()
    {
        var result = Execute(PivotRunningTotal.Column);

        // 2024: Aydın 1, İzmir 1+3, Bursa 1+3+6.
        Assert.Equal(1m, Cell(result, "Aydın", "2024"));
        Assert.Equal(4m, Cell(result, "İzmir", "2024"));
        Assert.Equal(10m, Cell(result, "Bursa", "2024"));
        // 2025: Bursa has nothing of its own, so it carries the total so far.
        Assert.Equal(6m, Cell(result, "Bursa", "2025"));
        // The right-hand total column accumulates the same way: 3, 3+12, 15+13.
        Assert.Equal(28m, RowTotal(result, "Bursa"));

        // Region rows accumulate among themselves: Ege 4, Marmara 4+6 in 2024.
        Assert.Equal(4m, Subtotal(result, "Ege", "2024"));
        Assert.Equal(10m, Subtotal(result, "Marmara", "2024"));

        // The bottom total and the grand total are left as they are.
        Assert.Equal(28m, result.GrandTotals["Amount_sum"]);
    }

    [Fact]
    public void DownTheColumns_StartsAgainInEachRegionWhenGroupsAreNotCrossed()
    {
        var result = Execute(PivotRunningTotal.Column, crossGroups: false);

        Assert.Equal(4m, Cell(result, "İzmir", "2024"));
        // Bursa is the first city of Marmara.
        Assert.Equal(6m, Cell(result, "Bursa", "2024"));
        Assert.Null(Cell(result, "Bursa", "2025"));
    }

    [Fact]
    public void AlongTheRows_AccumulatesEachRowLeftToRight()
    {
        var result = Execute(PivotRunningTotal.Row);

        Assert.Equal(3m, Cell(result, "İzmir", "2024"));
        Assert.Equal(7m, Cell(result, "İzmir", "2025"));
        Assert.Equal(12m, Cell(result, "İzmir", "2026"));
        // Aydın's 2026 is empty: it carries the row's total so far.
        Assert.Equal(3m, Cell(result, "Aydın", "2026"));
        // The row total is left as it is.
        Assert.Equal(12m, RowTotal(result, "İzmir"));
    }

    [Fact]
    public void AfterTheDisplayMode_ItGivesACumulativeShare()
    {
        // Each city's share of its region, accumulated down the column: the
        // region's last city reaches 100%.
        var result = Execute(PivotRunningTotal.Column, crossGroups: false, showAs: PivotShowAs.PercentOfParentRowTotal);

        Assert.Equal(0.25m, Cell(result, "Aydın", "2024"));
        Assert.Equal(1m, Cell(result, "İzmir", "2024"));
        Assert.Equal(1m, Cell(result, "Bursa", "2024"));
    }

    [Fact]
    public void ItFollowsTheRowsAsTheyAreSorted()
    {
        var result = new PivotEngine().Execute(Sales, new PivotRequest
        {
            Rows = ["Region", "City"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Sum("Amount") with { RunningTotal = PivotRunningTotal.Column }],
            FieldSorts = [new PivotFieldSort("City", PivotSortDirection.Descending), new PivotFieldSort("Region", PivotSortDirection.Descending)]
        });

        // Marmara first, then Ege with İzmir before Aydın: 6, 6+3, 9+1.
        Assert.Equal(6m, Cell(result, "Bursa", "2024"));
        Assert.Equal(9m, Cell(result, "İzmir", "2024"));
        Assert.Equal(10m, Cell(result, "Aydın", "2024"));
    }
}
