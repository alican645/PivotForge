using System.Globalization;
using System.Text.Json;
using PivotForge.Core;

namespace PivotForge.Core.Tests;

public sealed class PivotRangeGroupingTests
{
    private sealed record Sale(string Region, decimal? Amount, int Quantity);

    // Out of order on purpose: the ranges must come out ordered by their start.
    private static readonly Sale[] Sales =
    [
        new("Ege", 1250m, 3),
        new("Ege", 99.5m, 1),
        new("Marmara", 100m, 2),
        new("Marmara", 1100m, 4),
        new("Akdeniz", -20m, 1),
        new("Akdeniz", null, 5)
    ];

    private static readonly PivotEngine Turkish = new(CultureInfo.GetCultureInfo("tr-TR"));

    private static readonly PivotFieldRef AmountRanges = new("Amount", PivotGroupInterval.Range, 1000m);

    private static PivotRequest Request(PivotFieldRef rows, IReadOnlyList<PivotFilter>? filters = null) => new()
    {
        Rows = [rows],
        Values = [PivotValueDefinition.Sum("Quantity")],
        Filters = filters ?? []
    };

    private static string[] RowLabels(PivotResult result) =>
        result.RowHeaders.Select(header => header[0] ?? "").ToArray();

    private static decimal? Total(PivotResult result, string label)
    {
        var row = Array.IndexOf(RowLabels(result), label);
        return result.RowTotals.Single(total => total.Index == row).Values["Quantity_sum"];
    }

    [Fact]
    public void ARangeLevelCarriesItsWidthInItsKey()
    {
        Assert.Equal("Amount:range1000", AmountRanges.Key);
        Assert.Equal("Amount:range0.5", new PivotFieldRef("Amount", PivotGroupInterval.Range, 0.50m).Key);
    }

    [Fact]
    public void ValuesFallIntoRangesAlignedToZeroAndOrderedByTheirStart()
    {
        var result = Turkish.Execute(Sales, Request(AmountRanges));

        // 99.5 and 100 share 0 – 1.000; -20 is in -1.000 – 0; an empty amount stays blank.
        Assert.Equal(["-1.000 – 0", "0 – 1.000", "1.000 – 2.000", ""], RowLabels(result));
        Assert.Equal(3m, Total(result, "0 – 1.000"));
        Assert.Equal(7m, Total(result, "1.000 – 2.000"));
    }

    [Fact]
    public void ARangeStartIsIncludedAndItsEndIsNot()
    {
        var result = Turkish.Execute(Sales, Request(new PivotFieldRef("Amount", PivotGroupInterval.Range, 100m)));

        // 99.5 is below 100; 100 itself opens the next range.
        Assert.Contains("0 – 100", RowLabels(result));
        Assert.Contains("100 – 200", RowLabels(result));
    }

    [Fact]
    public void ARangeFilterComparesRangesAndTheValueListMatchesIt()
    {
        var labels = Turkish.DistinctValues(Sales, "Amount", PivotGroupInterval.Range, 1000m)
            .Select(label => label ?? "")
            .ToArray();
        Assert.Equal(["", "-1.000 – 0", "0 – 1.000", "1.000 – 2.000"], labels);

        var result = Turkish.Execute(Sales, Request(
            "Region",
            [new PivotFilter("Amount", ["1.000 – 2.000"], Interval: PivotGroupInterval.Range, BinSize: 1000m)]));

        Assert.Equal(["Ege", "Marmara"], RowLabels(result).Order(StringComparer.Ordinal).ToArray());
    }

    [Fact]
    public void ADrillDownIntoARangeReturnsTheRecordsInside()
    {
        var records = Turkish.DrillDown(Sales, Request(AmountRanges), ["0 – 1.000"], []);

        Assert.Equal([99.5m, 100m], records.Select(record => record.Amount!.Value).Order().ToArray());
    }

    [Fact]
    public void ARangeWithoutAWidthOrAWidthWithoutARangeIsRefused()
    {
        Assert.Throws<ArgumentException>(() =>
            Turkish.Execute(Sales, Request(new PivotFieldRef("Amount", PivotGroupInterval.Range))));
        Assert.Throws<ArgumentException>(() =>
            Turkish.Execute(Sales, Request(new PivotFieldRef("Amount", PivotGroupInterval.Range, 0m))));
        Assert.Throws<ArgumentException>(() =>
            Turkish.Execute(Sales, Request(new PivotFieldRef("Amount", PivotGroupInterval.Year, 10m))));
    }

    [Fact]
    public void ARangeLevelRoundTripsThroughJson()
    {
        var json = JsonSerializer.Serialize(AmountRanges);
        Assert.Contains("\"binSize\":1000", json, StringComparison.Ordinal);

        var read = JsonSerializer.Deserialize<PivotFieldRef>("{\"field\":\"Amount\",\"interval\":\"range\",\"binSize\":250}");
        Assert.Equal(new PivotFieldRef("Amount", PivotGroupInterval.Range, 250m), read);
    }

    [Fact]
    public void AValueThatIsNotANumberKeepsItsOwnText()
    {
        var mixed = new[]
        {
            new Dictionary<string, object?> { ["Amount"] = "n/a", ["Quantity"] = 1 },
            new Dictionary<string, object?> { ["Amount"] = 150, ["Quantity"] = 2 }
        };

        var result = Turkish.ExecuteRecords(mixed, Request(new PivotFieldRef("Amount", PivotGroupInterval.Range, 100m)));

        Assert.Equal(["100 – 200", "n/a"], RowLabels(result));
    }
}
