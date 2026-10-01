using System.Globalization;
using PivotForge.Core;

namespace PivotForge.Core.Tests;

public sealed class PivotColumnSubtotalTests
{
    private sealed record Sale(string Region, string City, string Year, string Quarter, decimal? Amount, decimal? Cost);

    private static readonly Sale[] Sales =
    [
        new("Marmara", "İstanbul", "2025", "Q1", 100m, 60m),
        new("Marmara", "İstanbul", "2025", "Q2", 50m, 20m),
        new("Marmara", "Bursa", "2026", "Q1", 40m, 30m),
        new("Ege", "İzmir", "2025", "Q1", 200m, 150m),
        new("Ege", "İzmir", "2026", "Q2", 10m, 5m)
    ];

    private static readonly PivotEngine Engine = new(CultureInfo.GetCultureInfo("tr-TR"));

    private static PivotRequest Request(params PivotValueDefinition[] values) => Request(values, null);

    private static PivotRequest Request(
        PivotValueDefinition[] values,
        PivotFieldRef[]? columns,
        PivotFieldRef[]? rows = null,
        PivotSort? rowSort = null,
        bool hideEmpty = false) => new()
    {
        Rows = rows ?? ["Region", "City"],
        Columns = columns ?? ["Year", "Quarter"],
        Values = values.Length > 0 ? values : [PivotValueDefinition.Sum("Amount")],
        RowSort = rowSort,
        HideEmptySummaryCells = hideEmpty
    };

    private static int Row(PivotResult result, string city) =>
        result.RowHeaders.ToList().FindIndex(header => header[1] == city);

    private static PivotColumnSubtotal Column(PivotResult result, string year) =>
        result.ColumnSubtotals.Single(subtotal => subtotal.ColumnHeader.SequenceEqual([year]));

    private static decimal? Cell(PivotResult result, string year, string city, string key = "Amount_sum") =>
        Column(result, year).Cells.SingleOrDefault(cell => cell.Index == Row(result, city))?.Values[key];

    [Fact]
    public void EachOuterColumnGroupGetsASubtotal()
    {
        var result = Engine.Execute(Sales, Request());

        Assert.Equal(
            [["2025"], ["2026"]],
            result.ColumnSubtotals.Select(subtotal => subtotal.ColumnHeader.ToArray()));
    }

    [Fact]
    public void ASubtotalSumsItsGroupForEachRow()
    {
        var result = Engine.Execute(Sales, Request());

        Assert.Equal(150m, Cell(result, "2025", "İstanbul"));
        Assert.Equal(200m, Cell(result, "2025", "İzmir"));
        Assert.Equal(10m, Cell(result, "2026", "İzmir"));
        // Bursa sold nothing in 2025, so it has no cell there rather than a zero.
        Assert.Null(Cell(result, "2025", "Bursa"));
    }

    [Fact]
    public void ASubtotalCarriesItsOwnTotalAcrossEveryRow()
    {
        var result = Engine.Execute(Sales, Request());

        Assert.Equal(350m, Column(result, "2025").Totals["Amount_sum"]);
        Assert.Equal(50m, Column(result, "2026").Totals["Amount_sum"]);
    }

    [Fact]
    public void ASubtotalRowCarriesItsValueInEachSubtotalColumn()
    {
        var result = Engine.Execute(Sales, Request());

        var marmara = result.Subtotals.Single(subtotal => subtotal.RowHeader[0] == "Marmara");
        Assert.Equal(
            150m,
            marmara.ColumnSubtotals.Single(cell => cell.ColumnHeader[0] == "2025").Values["Amount_sum"]);
        Assert.Equal(
            40m,
            marmara.ColumnSubtotals.Single(cell => cell.ColumnHeader[0] == "2026").Values["Amount_sum"]);
    }

    [Fact]
    public void ASingleColumnLevelHasNoSubtotals()
    {
        var result = Engine.Execute(Sales, Request([], ["Year"]));

        Assert.Empty(result.ColumnSubtotals);
        Assert.All(result.Subtotals, subtotal => Assert.Empty(subtotal.ColumnSubtotals));
    }

    [Fact]
    public void ThreeLevelsGiveSubtotalsAtBothOuterLevels()
    {
        var result = Engine.Execute(Sales, Request([], ["Region", "Year", "Quarter"], ["City"]));

        Assert.Contains(result.ColumnSubtotals, subtotal => subtotal.ColumnHeader.SequenceEqual(["Marmara"]));
        Assert.Contains(result.ColumnSubtotals, subtotal => subtotal.ColumnHeader.SequenceEqual(["Marmara", "2025"]));
        // Drawn order: an inner group closes before the group around it.
        var order = result.ColumnSubtotals.Select(subtotal => string.Join("/", subtotal.ColumnHeader)).ToList();
        Assert.True(order.IndexOf("Marmara/2026") < order.IndexOf("Marmara"));
    }

    [Fact]
    public void ARatioIsTheRatioOfTheGroupsSums()
    {
        var result = Engine.Execute(Sales, Request(
            PivotValueDefinition.Calculated("Margin", "([Amount] - [Cost]) / [Amount]")));

        Assert.Equal((150m - 80m) / 150m, Cell(result, "2025", "İstanbul", "Margin_calculated"));
        Assert.Equal((350m - 230m) / 350m, Column(result, "2025").Totals["Margin_calculated"]);
    }

    [Fact]
    public void PercentagesDivideByTheSubtotalsOwnRowColumnAndGrandTotal()
    {
        var rowShare = Engine.Execute(Sales, Request(PivotValueDefinition.Sum("Amount").As(PivotShowAs.PercentOfRowTotal)));
        var columnShare = Engine.Execute(Sales, Request(PivotValueDefinition.Sum("Amount").As(PivotShowAs.PercentOfColumnTotal)));
        var grandShare = Engine.Execute(Sales, Request(PivotValueDefinition.Sum("Amount").As(PivotShowAs.PercentOfGrandTotal)));

        // İzmir: 200 in 2025 of 210 in its row; 2025 is 350 across rows; 400 overall.
        Assert.Equal(200m / 210m, Cell(rowShare, "2025", "İzmir"));
        Assert.Equal(200m / 350m, Cell(columnShare, "2025", "İzmir"));
        Assert.Equal(200m / 400m, Cell(grandShare, "2025", "İzmir"));
        Assert.Equal(1m, Column(columnShare, "2025").Totals["Amount_sum"]);
        Assert.Equal(350m / 400m, Column(grandShare, "2025").Totals["Amount_sum"]);
    }

    [Fact]
    public void ComparisonsWithThePreviousColumnLeaveTheSubtotalEmpty()
    {
        var result = Engine.Execute(Sales, Request(PivotValueDefinition.Sum("Amount").As(PivotShowAs.DifferenceFromPrevious)));

        Assert.Null(Cell(result, "2025", "İzmir"));
    }

    [Fact]
    public void RowIndexesFollowTheSortedRows()
    {
        var result = Engine.Execute(Sales, Request([], null, rowSort: PivotSort.RowLabel("City", PivotSortDirection.Descending)));

        Assert.Equal(150m, Cell(result, "2025", "İstanbul"));
        Assert.Equal(200m, Cell(result, "2025", "İzmir"));
    }

    [Fact]
    public void ASubtotalWhoseColumnsWereAllEmptyGoesWithThem()
    {
        var records = Sales.Append(new Sale("Ege", "İzmir", "2027", "Q1", null, null)).ToArray();

        var shown = Engine.Execute(records, Request());
        var hidden = Engine.Execute(records, Request([], null, hideEmpty: true));

        Assert.Contains(shown.ColumnSubtotals, subtotal => subtotal.ColumnHeader[0] == "2027");
        Assert.DoesNotContain(hidden.ColumnSubtotals, subtotal => subtotal.ColumnHeader[0] == "2027");
        Assert.All(
            hidden.Subtotals.SelectMany(subtotal => subtotal.ColumnSubtotals),
            cell => Assert.NotEqual("2027", cell.ColumnHeader[0]));
    }

    [Fact]
    public void APageRenumbersItsSubtotalCellsWithItsRows()
    {
        var result = Engine.Execute(Sales, Request());
        var izmir = Row(result, "İzmir");

        var page = PivotResultPaginator.CreatePage(result, izmir, 1).Result;

        var cell = Assert.Single(Column(page, "2025").Cells);
        Assert.Equal(0, cell.Index);
        Assert.Equal(200m, cell.Values["Amount_sum"]);
        Assert.Equal(350m, Column(page, "2025").Totals["Amount_sum"]);
    }
}
