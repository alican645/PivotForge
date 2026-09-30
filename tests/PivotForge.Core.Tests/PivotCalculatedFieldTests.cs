using System.Globalization;
using PivotForge.Core;

namespace PivotForge.Core.Tests;

public sealed class PivotCalculatedFieldTests
{
    private sealed record Sale(string Region, string City, decimal? Revenue, decimal? Cost);

    private static readonly Sale[] Sales =
    [
        new("Marmara", "İstanbul", 100m, 60m),
        new("Marmara", "İstanbul", 50m, 20m),
        new("Marmara", "Bursa", 40m, 30m),
        new("Ege", "İzmir", 200m, 150m),
        new("Ege", "Manisa", 10m, null)
    ];

    private static readonly PivotEngine Engine = new(CultureInfo.GetCultureInfo("tr-TR"));

    private static PivotResult Run(params PivotValueDefinition[] values) =>
        Engine.Execute(Sales, new PivotRequest { Rows = ["Region", "City"], Values = values });

    private static decimal? RowTotal(PivotResult result, string city, string key)
    {
        var row = result.RowHeaders.ToList().FindIndex(header => header[1] == city);
        return result.RowTotals.Single(total => total.Index == row).Values[key];
    }

    [Fact]
    public void AFormulaIsEvaluatedPerRow()
    {
        var result = Run(PivotValueDefinition.Calculated("Profit", "[Revenue] - [Cost]"));

        Assert.Equal(70m, RowTotal(result, "İstanbul", "Profit_calculated"));
        Assert.Equal(10m, RowTotal(result, "Bursa", "Profit_calculated"));
    }

    [Fact]
    public void TheKeyNamesTheFieldAndTheCalculatedAggregation()
    {
        Assert.Equal(
            "Profit_calculated",
            PivotValueDefinition.Calculated("Profit", "[Revenue] - [Cost]").Key);
    }

    [Fact]
    public void ARatioIsTheRatioOfTheSumsAtEveryLevel()
    {
        // The reason formulas run on summaries rather than on records: a margin summed
        // over rows would be meaningless, and one averaged over rows would weigh a small
        // sale like a large one.
        var result = Run(PivotValueDefinition.Calculated("Margin", "([Revenue] - [Cost]) / [Revenue]"));

        var marmara = result.Subtotals.Single(subtotal => subtotal.RowHeader[0] == "Marmara");
        Assert.Equal((190m - 110m) / 190m, marmara.Totals["Margin_calculated"]);

        // Manisa has no cost, so Ege's cost sum is İzmir's alone.
        Assert.Equal((210m - 150m) / 210m,
            result.Subtotals.Single(subtotal => subtotal.RowHeader[0] == "Ege").Totals["Margin_calculated"]);
        Assert.Equal((400m - 260m) / 400m, result.GrandTotals["Margin_calculated"]);
    }

    [Fact]
    public void FunctionsSummarizeTheirFieldAndBareReferencesSum()
    {
        var result = Run(
            PivotValueDefinition.Calculated("PerSale", "Sum([Revenue]) / Count([Revenue])"),
            PivotValueDefinition.Calculated("Spread", "max([Revenue]) - MIN([Revenue])"),
            PivotValueDefinition.Calculated("Avg", "Avg([Revenue]) + Average([Revenue]) * 0"));

        Assert.Equal(75m, RowTotal(result, "İstanbul", "PerSale_calculated"));
        Assert.Equal(50m, RowTotal(result, "İstanbul", "Spread_calculated"));
        Assert.Equal(75m, RowTotal(result, "İstanbul", "Avg_calculated"));
    }

    [Fact]
    public void PrecedenceParenthesesAndUnaryMinusReadAsArithmetic()
    {
        var result = Run(PivotValueDefinition.Calculated("X", "-2 + 3 * (1.5 - [Cost] / 10) - -1"));

        // İstanbul: cost 80 -> -2 + 3 * (1.5 - 8) + 1
        Assert.Equal(-2m + 3m * (1.5m - 8m) + 1m, RowTotal(result, "İstanbul", "X_calculated"));
    }

    [Fact]
    public void AnEmptySummaryOrADivisionByZeroLeavesTheCellEmpty()
    {
        var result = Run(
            PivotValueDefinition.Calculated("Profit", "[Revenue] - [Cost]"),
            PivotValueDefinition.Calculated("Zero", "[Revenue] / ([Cost] - [Cost])"));

        Assert.Null(RowTotal(result, "Manisa", "Profit_calculated"));
        Assert.Null(RowTotal(result, "İstanbul", "Zero_calculated"));
    }

    [Fact]
    public void AFormulaSitsBesideThePlainValuesItShares()
    {
        var result = Run(
            PivotValueDefinition.Sum("Revenue"),
            PivotValueDefinition.Calculated("Double", "[Revenue] * 2"));

        Assert.Equal(150m, RowTotal(result, "İstanbul", "Revenue_sum"));
        Assert.Equal(300m, RowTotal(result, "İstanbul", "Double_calculated"));
    }

    [Fact]
    public void ShowAsAppliesToTheCalculatedValue()
    {
        var result = Run(
            PivotValueDefinition.Calculated("Profit", "[Revenue] - [Cost]").As(PivotShowAs.PercentOfGrandTotal));

        Assert.Equal(70m / 140m, RowTotal(result, "İstanbul", "Profit_calculated"));
    }

    [Fact]
    public void RowsCanBeSortedAndRankedByACalculatedValue()
    {
        var request = new PivotRequest
        {
            Rows = ["City"],
            Values = [PivotValueDefinition.Calculated("Profit", "[Revenue] - [Cost]")],
            TopN = [new PivotTopN("City", 2, ValueKey: "Profit_calculated")]
        };

        var result = Engine.Execute(Sales, request);

        Assert.Equal(["İstanbul", "İzmir"], result.RowHeaders.Select(header => header[0]!).Order().ToArray());
    }

    [Fact]
    public void ACustomAggregateIsCalledByName()
    {
        var engine = new PivotEngine(CultureInfo.InvariantCulture)
        {
            CustomAggregates = new Dictionary<string, PivotCustomAggregate>(StringComparer.OrdinalIgnoreCase)
            {
                ["Median"] = values =>
                {
                    var sorted = values.Order().ToArray();
                    return sorted.Length % 2 == 1
                        ? sorted[sorted.Length / 2]
                        : (sorted[sorted.Length / 2 - 1] + sorted[sorted.Length / 2]) / 2;
                }
            }
        };

        var result = engine.Execute(Sales, new PivotRequest
        {
            Values = [PivotValueDefinition.Calculated("MedianRevenue", "median([Revenue])")]
        });

        Assert.Equal(50m, result.GrandTotals["MedianRevenue_calculated"]);
    }

    [Fact]
    public void ACustomAggregateIsNotCalledForAnEmptyCell()
    {
        var calls = 0;
        var engine = new PivotEngine(CultureInfo.InvariantCulture)
        {
            CustomAggregates = new Dictionary<string, PivotCustomAggregate>
            {
                ["Probe"] = values =>
                {
                    calls++;
                    return values.Count;
                }
            }
        };

        var result = engine.Execute(Sales, new PivotRequest
        {
            Rows = ["City"],
            Values = [PivotValueDefinition.Calculated("C", "Probe([Cost])")]
        });

        var manisa = result.RowHeaders.ToList().FindIndex(header => header[0] == "Manisa");
        Assert.Null(result.RowTotals.Single(total => total.Index == manisa).Values["C_calculated"]);
        Assert.DoesNotContain(result.RowTotals, total => total.Values["C_calculated"] == 0m);
        Assert.True(calls > 0);
    }

    [Fact]
    public void ABuiltInNameCannotBeReplaced()
    {
        var engine = new PivotEngine(CultureInfo.InvariantCulture)
        {
            CustomAggregates = new Dictionary<string, PivotCustomAggregate> { ["Sum"] = _ => -1m }
        };

        var result = engine.Execute(Sales, new PivotRequest
        {
            Values = [PivotValueDefinition.Calculated("S", "Sum([Revenue])")]
        });

        Assert.Equal(400m, result.GrandTotals["S_calculated"]);
    }

    [Theory]
    [InlineData("")]
    [InlineData("[Revenue] -")]
    [InlineData("([Revenue]")]
    [InlineData("[Revenue")]
    [InlineData("Revenue")]
    [InlineData("Sum(Revenue)")]
    [InlineData("[Revenue] $ 2")]
    [InlineData("[]")]
    [InlineData("1..2")]
    public void AFormulaThatCannotBeReadIsRefused(string formula)
    {
        Assert.Throws<PivotExpressionException>(() => Run(PivotValueDefinition.Calculated("X", formula)));
    }

    [Fact]
    public void AnUnknownFunctionIsRefusedByName()
    {
        var error = Assert.Throws<PivotExpressionException>(
            () => Run(PivotValueDefinition.Calculated("X", "[Cost] + Medain([Revenue])")));

        Assert.Contains("Medain", error.Message);
        Assert.Equal(9, error.Position);
    }

    [Fact]
    public void ABareWordIsExplainedAsAMissingBracket()
    {
        var error = Assert.Throws<PivotExpressionException>(() => PivotExpression.Parse("Revenue - 1"));

        Assert.Contains("[Revenue]", error.Message);
        Assert.Equal(0, error.Position);
    }

    [Fact]
    public void AFormulaReadingAMissingFieldIsRefused()
    {
        var error = Assert.Throws<PivotFieldNotFoundException>(
            () => Run(PivotValueDefinition.Calculated("X", "[Revenue] - [Tax]")));

        Assert.Equal("Tax", error.Field);
    }

    [Fact]
    public void CalculatedWithoutAFormulaAndAFormulaWithoutCalculatedAreRefused()
    {
        Assert.ThrowsAny<ArgumentException>(
            () => Run(new PivotValueDefinition("X", PivotAggregation.Calculated)));
        Assert.ThrowsAny<ArgumentException>(
            () => Run(PivotValueDefinition.Sum("Revenue") with { Expression = "[Cost]" }));
    }

    [Fact]
    public void ParseListsTheFieldsAFormulaReadsOnce()
    {
        var expression = PivotExpression.Parse("Sum([Revenue]) - [Cost] + Max([revenue]) / 2");

        Assert.Equal(["Revenue", "Cost"], expression.Fields);
    }

    [Fact]
    public void NumbersAreReadInvariantly()
    {
        var previous = CultureInfo.CurrentCulture;

        try
        {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("tr-TR");
            var result = new PivotEngine().Execute(Sales, new PivotRequest
            {
                Values = [PivotValueDefinition.Calculated("X", "[Revenue] * 0.5")]
            });

            Assert.Equal(200m, result.GrandTotals["X_calculated"]);
        }
        finally
        {
            CultureInfo.CurrentCulture = previous;
        }
    }

    [Fact]
    public void DrillDownAcceptsARequestWithACalculatedValue()
    {
        var request = new PivotRequest
        {
            Rows = ["Region"],
            Values = [PivotValueDefinition.Calculated("Profit", "[Revenue] - [Cost]")]
        };

        Assert.Equal(3, Engine.DrillDown(Sales, request, ["Marmara"], []).Count);
    }
}
