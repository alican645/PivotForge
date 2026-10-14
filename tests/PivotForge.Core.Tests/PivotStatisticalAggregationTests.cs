using System.Globalization;
using PivotForge.Core;

namespace PivotForge.Core.Tests;

public sealed class PivotStatisticalAggregationTests
{
    private sealed record Sale(string Region, string? Customer, decimal? Amount);

    private static readonly Sale[] Sales =
    [
        new("Marmara", "A", 10m),
        new("Marmara", "A", 20m),
        new("Marmara", "B", 30m),
        new("Marmara", "C", 40m),
        new("Ege", "D", 5m),
        new("Ege", "E", 15m),
        new("Ege", null, null),
        new("Karadeniz", "F", 7m)
    ];

    private static readonly PivotEngine Engine = new(CultureInfo.InvariantCulture);

    private static PivotResult Run(params PivotValueDefinition[] values) =>
        Engine.Execute(Sales, new PivotRequest { Rows = ["Region"], Values = values });

    private static decimal? Row(PivotResult result, string region, string key)
    {
        var row = result.RowHeaders.ToList().FindIndex(header => header[0] == region);
        return result.RowTotals.Single(total => total.Index == row).Values[key];
    }

    [Fact]
    public void CountDistinctCountsEachNonEmptyValueOnce()
    {
        var result = Run(PivotValueDefinition.CountDistinct("Customer"));

        Assert.Equal(3m, Row(result, "Marmara", "Customer_countdistinct"));
        // The empty customer is not a customer.
        Assert.Equal(2m, Row(result, "Ege", "Customer_countdistinct"));
        // Counted again from the records, not summed from the rows: A..F is six.
        Assert.Equal(6m, result.GrandTotals["Customer_countdistinct"]);
    }

    [Fact]
    public void MedianIsTheMiddleValueOrTheMeanOfTheTwoMiddleOnes()
    {
        var result = Run(PivotValueDefinition.Median("Amount"));

        Assert.Equal(25m, Row(result, "Marmara", "Amount_median"));
        Assert.Equal(10m, Row(result, "Ege", "Amount_median"));
        Assert.Equal(7m, Row(result, "Karadeniz", "Amount_median"));
        // 5, 7, 10, 15, 20, 30, 40: the grand total's own median, not a median of medians.
        Assert.Equal(15m, result.GrandTotals["Amount_median"]);
    }

    [Fact]
    public void VarianceAndStandardDeviationAreTheSampleStatistics()
    {
        var result = Run(PivotValueDefinition.Variance("Amount"), PivotValueDefinition.StandardDeviation("Amount"));

        // Deviations from 25 are ±5 and ±15: (25 + 25 + 225 + 225) / (4 - 1).
        Assert.Equal(166.6666666667m, Math.Round(Row(result, "Marmara", "Amount_variance")!.Value, 10));
        Assert.Equal(12.9099444874m, Math.Round(Row(result, "Marmara", "Amount_standarddeviation")!.Value, 10));
        Assert.Equal(50m, Row(result, "Ege", "Amount_variance"));
        Assert.Equal(7.0710678119m, Math.Round(Row(result, "Ege", "Amount_standarddeviation")!.Value, 10));
    }

    [Fact]
    public void ASingleValueHasNoSampleVariance()
    {
        var result = Run(PivotValueDefinition.Variance("Amount"), PivotValueDefinition.StandardDeviation("Amount"));

        Assert.Null(Row(result, "Karadeniz", "Amount_variance"));
        Assert.Null(Row(result, "Karadeniz", "Amount_standarddeviation"));
    }

    [Fact]
    public void AFormulaCanCallTheStatisticalSummaries()
    {
        var result = Run(PivotValueDefinition.Calculated("PerCustomer", "[Amount] / CountDistinct([Customer])"),
            PivotValueDefinition.Calculated("Spread", "StDev([Amount]) / Median([Amount])"));

        Assert.Equal(100m / 3m, Row(result, "Marmara", "PerCustomer_calculated"));
        Assert.Equal(
            Math.Round(Row(result, "Ege", "Spread_calculated")!.Value, 10),
            Math.Round(7.0710678118654752440084436210m / 10m, 10));
    }

    [Fact]
    public void MedianRejectsAValueThatIsNotANumber()
    {
        Assert.Throws<PivotFieldTypeException>(() => Run(PivotValueDefinition.Median("Customer")));
    }

    [Fact]
    public void KeysNameTheAggregationInLowerCase()
    {
        Assert.Equal("Amount_countdistinct", PivotValueDefinition.CountDistinct("Amount").Key);
        Assert.Equal("Amount_median", PivotValueDefinition.Median("Amount").Key);
        Assert.Equal("Amount_variance", PivotValueDefinition.Variance("Amount").Key);
        Assert.Equal("Amount_standarddeviation", PivotValueDefinition.StandardDeviation("Amount").Key);
    }
}
