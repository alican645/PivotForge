using System.Globalization;
using PivotForge.Core;

namespace PivotForge.Core.Tests;

public sealed class PivotValueFilterTests
{
    private sealed record Sale(string Region, string City, decimal? Amount, int Quantity);

    // Region totals: Marmara 190, Ege 210, Akdeniz 30, Karadeniz none.
    private static readonly Sale[] Sales =
    [
        new("Marmara", "İstanbul", 150m, 3),
        new("Marmara", "Bursa", 40m, 1),
        new("Ege", "İzmir", 200m, 2),
        new("Ege", "Manisa", 10m, 5),
        new("Akdeniz", "Antalya", 30m, 4),
        new("Karadeniz", "Trabzon", null, 1)
    ];

    private static readonly PivotEngine Engine = new(CultureInfo.GetCultureInfo("tr-TR"));

    private static PivotResult Run(
        IReadOnlyList<PivotValueFilter> filters,
        IReadOnlyList<PivotTopN>? topN = null,
        params string[] rows) =>
        Engine.Execute(Sales, new PivotRequest
        {
            Rows = rows.Length == 0 ? ["Region"] : [.. rows.Select(row => (PivotFieldRef)row)],
            Values = [PivotValueDefinition.Sum("Amount"), PivotValueDefinition.Sum("Quantity")],
            ValueFilters = filters,
            TopN = topN ?? []
        });

    private static string?[] Regions(PivotResult result) =>
        result.RowHeaders.Select(header => header[0]).Distinct().ToArray();

    [Fact]
    public void KeepsTheGroupsWhoseValueMeetsTheConditionAndTotalsOnlyThose()
    {
        var result = Run([new PivotValueFilter("Region", PivotValueFilterOperator.GreaterThan, 100m)]);

        Assert.Equal(["Ege", "Marmara"], Regions(result).Order(StringComparer.Ordinal).ToArray());
        // The grand total counts the kept regions only.
        Assert.Equal(400m, result.GrandTotals["Amount_sum"]);
        Assert.Equal(11m, result.GrandTotals["Quantity_sum"]);
    }

    [Fact]
    public void AGroupWithNoValueMeetsNoCondition()
    {
        var result = Run([new PivotValueFilter("Region", PivotValueFilterOperator.LessThan, 1000m)]);

        Assert.DoesNotContain("Karadeniz", Regions(result));
        Assert.Equal(3, Regions(result).Length);
    }

    [Theory]
    [InlineData(PivotValueFilterOperator.GreaterThanOrEqual, 190, null, new[] { "Ege", "Marmara" })]
    [InlineData(PivotValueFilterOperator.LessThanOrEqual, 190, null, new[] { "Akdeniz", "Marmara" })]
    [InlineData(PivotValueFilterOperator.Equal, 30, null, new[] { "Akdeniz" })]
    [InlineData(PivotValueFilterOperator.NotEqual, 30, null, new[] { "Ege", "Marmara" })]
    [InlineData(PivotValueFilterOperator.Between, 200, 30, new[] { "Akdeniz", "Marmara" })]
    [InlineData(PivotValueFilterOperator.NotBetween, 30, 200, new[] { "Ege" })]
    public void EachOperatorKeepsWhatItSays(PivotValueFilterOperator op, double value, double? value2, string[] kept)
    {
        var result = Run([new PivotValueFilter("Region", op, (decimal)value, (decimal?)value2)]);

        Assert.Equal(kept, Regions(result).Order(StringComparer.Ordinal).ToArray());
    }

    [Fact]
    public void ADeclaredValueKeyChoosesWhichValueIsCompared()
    {
        var result = Run([new PivotValueFilter("Region", PivotValueFilterOperator.GreaterThanOrEqual, 4m, ValueKey: "Quantity_sum")]);

        // Quantities: Marmara 4, Ege 7, Akdeniz 4, Karadeniz 1.
        Assert.Equal(["Akdeniz", "Ege", "Marmara"], Regions(result).Order(StringComparer.Ordinal).ToArray());
    }

    [Fact]
    public void AnInnerLevelIsFilteredGroupByGroupAndItsParentTotalsFollow()
    {
        var result = Run(
            [new PivotValueFilter("City", PivotValueFilterOperator.GreaterThan, 35m)],
            null,
            "Region", "City");

        var cities = result.RowHeaders.Select(header => header[1]).ToArray();
        // Manisa (10), Antalya (30) and Trabzon (no amount) are gone.
        Assert.Equal(["Bursa", "İstanbul", "İzmir"], cities.Order(StringComparer.Ordinal).ToArray());

        var ege = result.Subtotals.Single(subtotal => subtotal.RowHeader.SequenceEqual(new[] { "Ege" }));
        Assert.Equal(200m, ege.Totals["Amount_sum"]);
    }

    [Fact]
    public void ARankingOnTheSameLevelIsTakenAmongTheGroupsTheFilterKeeps()
    {
        // Without the filter the bottom one is Akdeniz; with it, Akdeniz is gone and the
        // bottom one of what is left is Marmara.
        var result = Run(
            [new PivotValueFilter("Region", PivotValueFilterOperator.GreaterThan, 100m)],
            [new PivotTopN("Region", 1, Mode: PivotTopNMode.Bottom)]);

        Assert.Equal(["Marmara"], Regions(result));
    }

    [Fact]
    public void AFilterOnAFieldThatIsNotARowLevelIsRefused()
    {
        Assert.Throws<ArgumentException>(() =>
            Run([new PivotValueFilter("City", PivotValueFilterOperator.GreaterThan, 1m)]));
    }

    [Fact]
    public void AFilterComparingAnUndeclaredValueIsRefused()
    {
        Assert.Throws<ArgumentException>(() =>
            Run([new PivotValueFilter("Region", PivotValueFilterOperator.GreaterThan, 1m, ValueKey: "Amount_max")]));
    }

    [Fact]
    public void ARangeWithoutItsUpperBoundIsRefused()
    {
        Assert.Throws<ArgumentException>(() =>
            Run([new PivotValueFilter("Region", PivotValueFilterOperator.Between, 1m)]));
    }
}
