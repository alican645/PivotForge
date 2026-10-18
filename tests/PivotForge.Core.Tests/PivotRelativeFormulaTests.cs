using PivotForge.Core;

namespace PivotForge.Core.Tests;

// Formulas that read another cell -- DevExtreme's cell API (prev, next,
// parent, grandTotal, slice) written into the formula language.
public sealed class PivotRelativeFormulaTests
{
    private sealed record Sale(string Region, string City, string Year, string Quarter, decimal Amount);

    //                  2024/Q3 2024/Q4 2025/Q1 2025/Q2
    // Ege     Aydın        10      20      30       -
    // Ege     İzmir        40      50      60      70
    // Marmara Bursa         -      80      90     100
    private static readonly Sale[] Sales =
    [
        new("Ege", "Aydın", "2024", "Q3", 10m),
        new("Ege", "Aydın", "2024", "Q4", 20m),
        new("Ege", "Aydın", "2025", "Q1", 30m),
        new("Ege", "İzmir", "2024", "Q3", 40m),
        new("Ege", "İzmir", "2024", "Q4", 50m),
        new("Ege", "İzmir", "2025", "Q1", 60m),
        new("Ege", "İzmir", "2025", "Q2", 70m),
        new("Marmara", "Bursa", "2024", "Q4", 80m),
        new("Marmara", "Bursa", "2025", "Q1", 90m),
        new("Marmara", "Bursa", "2025", "Q2", 100m)
    ];

    private const string Key = "F_calculated";

    private static PivotResult Execute(string formula, bool crossGroups = true, PivotShowAs showAs = PivotShowAs.Normal) =>
        new PivotEngine().Execute(Sales, new PivotRequest
        {
            Rows = ["Region", "City"],
            Columns = ["Year", "Quarter"],
            Values = [PivotValueDefinition.Calculated("F", formula).As(showAs) with { AllowCrossGroupCalculation = crossGroups }]
        });

    private static int Row(PivotResult result, string city) =>
        result.RowHeaders.Select((header, index) => (header, index)).Single(entry => entry.header[1] == city).index;

    private static int Column(PivotResult result, string year, string quarter) =>
        result.ColumnHeaders.Select((header, index) => (header, index))
            .Single(entry => entry.header[0] == year && entry.header[1] == quarter).index;

    private static decimal? Cell(PivotResult result, string city, string year, string quarter) =>
        result.Cells.SingleOrDefault(cell => cell.Row == Row(result, city) && cell.Column == Column(result, year, quarter))
            ?.Values[Key];

    [Fact]
    public void Prev_ReadsThePreviousColumn_AndTheFirstColumnHasNone()
    {
        var result = Execute("Prev([Amount])");

        Assert.Equal(40m, Cell(result, "İzmir", "2024", "Q4"));
        // Across the year boundary: 2025/Q1's previous column is 2024/Q4.
        Assert.Equal(50m, Cell(result, "İzmir", "2025", "Q1"));
        Assert.Null(Cell(result, "İzmir", "2024", "Q3"));
    }

    [Fact]
    public void GrowthOnThePreviousPeriod_IsOneFormula()
    {
        var result = Execute("([Amount] - Prev([Amount])) / Prev([Amount])");

        Assert.Equal(0.25m, Cell(result, "İzmir", "2024", "Q4"));
        Assert.Equal(0.2m, Cell(result, "İzmir", "2025", "Q1"));
    }

    [Fact]
    public void WithoutCrossingGroups_PrevStopsAtTheYear()
    {
        var result = Execute("Prev([Amount])", crossGroups: false);

        Assert.Null(Cell(result, "İzmir", "2025", "Q1"));
        Assert.Equal(60m, Cell(result, "İzmir", "2025", "Q2"));
    }

    [Fact]
    public void Next_PrevRow_And_NextRow_ReadTheirNeighbours()
    {
        Assert.Equal(60m, Cell(Execute("Next([Amount])"), "İzmir", "2024", "Q4"));
        // Rows in their labels' order: Aydın, İzmir, then Bursa.
        Assert.Equal(10m, Cell(Execute("PrevRow([Amount])"), "İzmir", "2024", "Q3"));
        Assert.Equal(90m, Cell(Execute("NextRow([Amount])"), "İzmir", "2025", "Q1"));
        Assert.Null(Cell(Execute("NextRow([Amount])", crossGroups: false), "İzmir", "2025", "Q1"));
    }

    [Fact]
    public void ParentAndTotals_ReadTheGroupAndTheTotals()
    {
        // İzmir's share of Ege in 2024/Q4: 50 of 70.
        Assert.Equal(50m / 70m, Cell(Execute("[Amount] / ParentRow([Amount])"), "İzmir", "2024", "Q4"));
        // İzmir's 2024/Q4 against its 2024: 50 of 90.
        Assert.Equal(50m / 90m, Cell(Execute("[Amount] / ParentColumn([Amount])"), "İzmir", "2024", "Q4"));
        Assert.Equal(220m, Cell(Execute("RowTotal([Amount])"), "İzmir", "2024", "Q3"));
        Assert.Equal(150m, Cell(Execute("ColumnTotal([Amount])"), "İzmir", "2024", "Q4"));

        var grand = Execute("GrandTotal([Amount])");
        Assert.Equal(550m, Cell(grand, "Aydın", "2024", "Q3"));
        Assert.Equal(550m, grand.GrandTotals[Key]);
    }

    [Fact]
    public void Slice_ReadsTheSameCellLastYear()
    {
        var result = Execute("Slice([Amount], [Year], -1)");

        // 2024 is the first year: it has no last year.
        Assert.Null(Cell(result, "İzmir", "2024", "Q4"));
        // 2025/Q1 last year is 2024/Q1, which does not exist.
        Assert.Null(Cell(result, "İzmir", "2025", "Q1"));

        // On the year subtotal column the slice is the previous year's subtotal: İzmir 2024 is 90.
        var year2025 = result.ColumnSubtotals.Single(subtotal => subtotal.ColumnHeader.SequenceEqual(["2025"]));
        Assert.Equal(90m, year2025.Cells.Single(cell => cell.Index == Row(result, "İzmir")).Values[Key]);

        // Moving along the rows: the next region.
        var regions = Execute("Slice([Amount], [Region], 1)");
        var ege = regions.Subtotals.Single(subtotal => subtotal.RowHeader.SequenceEqual(["Ege"]));
        Assert.Equal(80m, ege.Cells.Single(cell => cell.Column == Column(regions, "2024", "Q4")).Values[Key]);
    }

    [Fact]
    public void TheDisplayModeAppliesToTheFormulasValue()
    {
        // RowTotal is defined at the root too (the grand total), so the share is İzmir's 220 of 550.
        var result = Execute("RowTotal([Amount])", showAs: PivotShowAs.PercentOfGrandTotal);

        Assert.Equal(1m, result.GrandTotals[Key]);
        Assert.Equal(220m / 550m, Cell(result, "İzmir", "2024", "Q4"));
    }

    [Fact]
    public void NoHiddenSummaryReachesTheResult()
    {
        var result = Execute("([Amount] - Prev([Amount])) / Prev([Amount])");
        var keys = result.Cells.SelectMany(cell => cell.Values.Keys)
            .Concat(result.RowTotals.SelectMany(total => total.Values.Keys))
            .Concat(result.Subtotals.SelectMany(subtotal => subtotal.Totals.Keys))
            .Concat(result.ColumnSubtotals.SelectMany(subtotal => subtotal.Totals.Keys))
            .Concat(result.GrandTotals.Keys);

        Assert.All(keys, key => Assert.Equal(Key, key));
    }

    [Theory]
    [InlineData("Prev()")]
    [InlineData("Slice([Amount], -1)")]
    [InlineData("Slice([Amount], [Year])")]
    [InlineData("Slice([Amount], [Year], 1.5)")]
    [InlineData("Prev([Amount]")]
    public void AMalformedRelativeFunctionIsRefusedWhereItWasWritten(string formula)
    {
        var error = Assert.Throws<PivotExpressionException>(() => PivotExpression.Parse(formula));
        Assert.InRange(error.Position, 0, formula.Length);
    }

    [Fact]
    public void ASlicedLevelIsAFieldTheFormulaNames()
    {
        Assert.Equal(["Amount", "Year"], PivotExpression.Parse("Slice([Amount], [Year], -1)").Fields);
    }
}
