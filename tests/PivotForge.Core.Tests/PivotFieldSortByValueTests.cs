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
