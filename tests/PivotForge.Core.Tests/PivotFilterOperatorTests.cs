using System.Globalization;
using PivotForge.Core;

namespace PivotForge.Core.Tests;

public sealed class PivotFilterOperatorTests
{
    private sealed record Sale(string Category, string? Note, decimal Amount, DateTime OrderDate);

    private static readonly Sale[] Sales =
    [
        new("Çimento", "acil", 100m, new DateTime(2026, 1, 5)),
        new("Çimento Katkı", null, 250m, new DateTime(2026, 6, 5)),
        new("Beton", "acil sevk", 2000m, new DateTime(2026, 9, 5)),
        new("Agrega", "", 30m, new DateTime(2025, 3, 5))
    ];

    private static readonly PivotEngine Turkish = new(CultureInfo.GetCultureInfo("tr-TR"));

    private static string[] Categories(PivotFilter filter) => Turkish
        .Execute(Sales, new PivotRequest
        {
            Rows = ["Category"],
            Values = [PivotValueDefinition.Sum("Amount")],
            Filters = [filter]
        })
        .RowHeaders.Select(header => header[0]!).ToArray();

    [Fact]
    public void EqualsIsWhatAFilterAlwaysWas()
    {
        // The default operator, so every filter written before operators existed
        // keeps meaning exactly what it meant.
        Assert.Equal(
            ["Beton"],
            Categories(new PivotFilter("Category", ["Beton"])));
    }

    [Fact]
    public void ContainsMatchesAnywhereInTheValue()
    {
        Assert.Equal(
            ["Çimento", "Çimento Katkı"],
            Categories(new PivotFilter("Category", ["ment"], Operator: PivotFilterOperator.Contains)));
    }

    [Fact]
    public void ContainsIgnoresCase()
    {
        // A filter is typed by a person, not by a parser.
        Assert.Equal(
            ["Beton"],
            Categories(new PivotFilter("Category", ["BETON"], Operator: PivotFilterOperator.Contains)));
    }

    [Fact]
    public void StartsWithAnchorsToTheStart()
    {
        Assert.Equal(
            ["Çimento", "Çimento Katkı"],
            Categories(new PivotFilter("Category", ["Çim"], Operator: PivotFilterOperator.StartsWith)));
    }

    [Fact]
    public void EndsWithAnchorsToTheEnd()
    {
        Assert.Equal(
            ["Çimento Katkı"],
            Categories(new PivotFilter("Category", ["Katkı"], Operator: PivotFilterOperator.EndsWith)));
    }

    [Fact]
    public void StartsWithIsAnchoredRatherThanFoundAnywhere()
    {
        // "Katkı" is inside "Çimento Katkı" but not at its start, which is the
        // only thing separating this operator from Contains.
        Assert.Empty(Categories(new PivotFilter(
            "Category", ["Katkı"], Operator: PivotFilterOperator.StartsWith)));
    }

    [Fact]
    public void EndsWithIsAnchoredRatherThanFoundAnywhere()
    {
        // "Çimento" ends one value and merely opens another.
        Assert.Equal(
            ["Çimento"],
            Categories(new PivotFilter("Category", ["Çimento"], Operator: PivotFilterOperator.EndsWith)));
    }

    [Fact]
    public void ExcludeNegatesWhateverTheOperatorDecided()
    {
        // Where "does not contain" comes from: there is no operator for it, and
        // there does not need to be one.
        Assert.Equal(
            ["Agrega", "Beton"],
            Categories(new PivotFilter(
                "Category", ["ment"], PivotFilterMode.Exclude, Operator: PivotFilterOperator.Contains)));
    }

    [Fact]
    public void BetweenComparesNumbersAsNumbers()
    {
        // Text order would put 100 after 2000 and hand back the wrong rows.
        Assert.Equal(
            ["Çimento", "Çimento Katkı"],
            Categories(new PivotFilter(
                "Amount", ["100", "250"], Operator: PivotFilterOperator.Between)));
    }

    [Fact]
    public void BetweenIncludesBothEnds()
    {
        Assert.Equal(
            ["Agrega", "Çimento"],
            Categories(new PivotFilter(
                "Amount", ["30", "100"], Operator: PivotFilterOperator.Between)));
    }

    [Fact]
    public void BetweenComparesDatesAsDates()
    {
        Assert.Equal(
            ["Beton", "Çimento Katkı"],
            Categories(new PivotFilter(
                "OrderDate",
                ["2026-06-01T00:00:00", "2026-12-31T00:00:00"],
                Operator: PivotFilterOperator.Between)));
    }

    [Fact]
    public void GreaterThanAndLessThanExcludeTheBoundary()
    {
        Assert.Equal(
            ["Beton"],
            Categories(new PivotFilter("Amount", ["250"], Operator: PivotFilterOperator.GreaterThan)));

        Assert.Equal(
            ["Agrega"],
            Categories(new PivotFilter("Amount", ["100"], Operator: PivotFilterOperator.LessThan)));
    }

    [Fact]
    public void BlankMatchesBothNullAndEmpty()
    {
        // A null source value is compared as the empty string everywhere else too,
        // so the two are one thing to the reader as well.
        var result = Turkish.Execute(Sales, new PivotRequest
        {
            Rows = ["Category"],
            Values = [PivotValueDefinition.Sum("Amount")],
            Filters = [new PivotFilter("Note", [], Operator: PivotFilterOperator.Blank)]
        });

        Assert.Equal(
            ["Agrega", "Çimento Katkı"],
            result.RowHeaders.Select(header => header[0]!).ToArray());
    }

    [Fact]
    public void BlankNegatedIsNotBlank()
    {
        var result = Turkish.Execute(Sales, new PivotRequest
        {
            Rows = ["Category"],
            Values = [PivotValueDefinition.Sum("Amount")],
            Filters = [new PivotFilter("Note", [], PivotFilterMode.Exclude, Operator: PivotFilterOperator.Blank)]
        });

        Assert.Equal(
            ["Beton", "Çimento"],
            result.RowHeaders.Select(header => header[0]!).ToArray());
    }

    [Fact]
    public void AConditionMissingItsArgumentRestrictsNothing()
    {
        // Half a range is what a picker looks like while it is being typed into;
        // dropping every row until the second box is filled would be hostile.
        Assert.Equal(
            ["Agrega", "Beton", "Çimento", "Çimento Katkı"],
            Categories(new PivotFilter("Amount", ["100"], Operator: PivotFilterOperator.Between)));
    }

    [Fact]
    public void AnOperatorAppliesToAGroupedFieldsLabels()
    {
        // The operator compares what the header shows, so on a grouped level that
        // is the month name rather than the timestamp behind it.
        var result = Turkish.Execute(Sales, new PivotRequest
        {
            Rows = [new PivotFieldRef("OrderDate", PivotGroupInterval.Month)],
            Values = [PivotValueDefinition.Sum("Amount")],
            Filters = [new PivotFilter(
                "OrderDate", ["Ha"], Interval: PivotGroupInterval.Month,
                Operator: PivotFilterOperator.StartsWith)]
        });

        Assert.Equal(["Haziran"], result.RowHeaders.Select(header => header[0]!).ToArray());
    }

    [Fact]
    public void ADrillDownHonoursTheOperatorToo()
    {
        // The detail list has to hold the rows the cell was built from, which
        // means the same filters have to survive the trip.
        var request = new PivotRequest
        {
            Rows = ["Category"],
            Values = [PivotValueDefinition.Sum("Amount")],
            Filters = [new PivotFilter("Category", ["Çim"], Operator: PivotFilterOperator.StartsWith)]
        };

        var records = Turkish.DrillDown(Sales, request, [], []);

        Assert.Equal(2, records.Count);
        Assert.All(records, record => Assert.StartsWith("Çim", record.Category, StringComparison.Ordinal));
    }
}
