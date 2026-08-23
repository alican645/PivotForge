using System.Globalization;
using PivotForge.Core;

namespace PivotForge.Core.Tests;

public sealed class PivotTopNTests
{
    private sealed record Sale(string Region, string Category, decimal? Amount);

    private static readonly Sale[] Sales =
    [
        new("Marmara", "Beton", 500m),
        new("Ege", "Beton", 400m),
        new("Akdeniz", "Beton", 300m),
        new("Karadeniz", "Beton", 200m),
        new("Doğu", "Beton", 100m)
    ];

    private static readonly PivotEngine Engine = new(CultureInfo.GetCultureInfo("tr-TR"));

    private static PivotRequest Request(params PivotTopN[] limits) => new()
    {
        Rows = ["Region"],
        Values = [PivotValueDefinition.Sum("Amount")],
        TopN = limits
    };

    private static string[] Regions(PivotResult result) =>
        result.RowHeaders.Select(header => header[0]!).ToArray();

    [Fact]
    public void TheHighestRankingGroupsSurvive()
    {
        var result = Engine.Execute(Sales, Request(new PivotTopN("Region", 2)));

        Assert.Equal(["Ege", "Marmara"], Regions(result).Order().ToArray());
    }

    [Fact]
    public void BottomKeepsTheOtherEnd()
    {
        var result = Engine.Execute(
            Sales, Request(new PivotTopN("Region", 2, Mode: PivotTopNMode.Bottom)));

        Assert.Equal(["Doğu", "Karadeniz"], Regions(result).Order().ToArray());
    }

    [Fact]
    public void AskingForMoreGroupsThanExistKeepsThemAll()
    {
        var result = Engine.Execute(Sales, Request(new PivotTopN("Region", 50)));

        Assert.Equal(5, result.RowHeaders.Count);
    }

    [Fact]
    public void TheGrandTotalCountsWhatSurvived()
    {
        // The decision this feature turns on. A grand total still holding the dropped
        // regions would not equal the rows printed above it, which is the one thing a
        // reader checks by hand.
        var result = Engine.Execute(Sales, Request(new PivotTopN("Region", 2)));

        Assert.Equal(900m, result.GrandTotals["Amount_sum"]);
    }

    [Fact]
    public void TheColumnTotalsCountWhatSurvivedToo()
    {
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Category"],
            Values = [PivotValueDefinition.Sum("Amount")],
            TopN = [new PivotTopN("Region", 2)]
        });

        Assert.Equal(900m, result.ColumnTotals.Single().Values["Amount_sum"]);
    }

    [Fact]
    public void TheSourceRowCountReportsWhatWasCounted()
    {
        var result = Engine.Execute(Sales, Request(new PivotTopN("Region", 2)));

        Assert.Equal(2, result.Metadata.SourceRowCount);
    }

    [Fact]
    public void ARankingIsAppliedInsideEachParentGroup()
    {
        // "The top category of every region" is one per region, not one overall.
        var records = new[]
        {
            new Sale("Ege", "Beton", 100m),
            new Sale("Ege", "Çimento", 900m),
            new Sale("Marmara", "Beton", 50m),
            new Sale("Marmara", "Çimento", 10m)
        };

        var result = Engine.Execute(records, new PivotRequest
        {
            Rows = ["Region", "Category"],
            Values = [PivotValueDefinition.Sum("Amount")],
            TopN = [new PivotTopN("Category", 1)]
        });

        Assert.Equal(
            [["Ege", "Çimento"], ["Marmara", "Beton"]],
            result.RowHeaders.Select(header => header.ToArray()).OrderBy(header => header[0]).ToArray());
    }

    [Fact]
    public void ARankingOnAnOuterLevelTakesItsWholeSubtreeWithIt()
    {
        var records = new[]
        {
            new Sale("Ege", "Beton", 10m),
            new Sale("Ege", "Çimento", 20m),
            new Sale("Marmara", "Beton", 500m),
            new Sale("Marmara", "Çimento", 600m)
        };

        var result = Engine.Execute(records, new PivotRequest
        {
            Rows = ["Region", "Category"],
            Values = [PivotValueDefinition.Sum("Amount")],
            TopN = [new PivotTopN("Region", 1)]
        });

        Assert.All(result.RowHeaders, header => Assert.Equal("Marmara", header[0]));
        Assert.Equal(2, result.RowHeaders.Count);
        Assert.Equal(1100m, result.GrandTotals["Amount_sum"]);
    }

    [Fact]
    public void ASubtotalOfADroppedGroupGoesWithIt()
    {
        var records = new[]
        {
            new Sale("Ege", "Beton", 10m),
            new Sale("Marmara", "Beton", 500m)
        };

        var result = Engine.Execute(records, new PivotRequest
        {
            Rows = ["Region", "Category"],
            Values = [PivotValueDefinition.Sum("Amount")],
            TopN = [new PivotTopN("Region", 1)]
        });

        Assert.Equal(["Marmara"], result.Subtotals.Select(subtotal => subtotal.RowHeader[0]!));
    }

    [Fact]
    public void AGroupThatAggregatedToNothingRanksLastInBothDirections()
    {
        // Otherwise an empty group would win every "bottom" ranking, which reads as the
        // report being sorted by absence.
        var records = new[]
        {
            new Sale("Ege", "Beton", 100m),
            new Sale("Marmara", "Beton", 200m),
            new Sale("Boş", "Beton", null)
        };

        var top = Engine.Execute(records, new PivotRequest
        {
            Rows = ["Region"],
            Values = [PivotValueDefinition.Sum("Amount")],
            TopN = [new PivotTopN("Region", 2)]
        });
        var bottom = Engine.Execute(records, new PivotRequest
        {
            Rows = ["Region"],
            Values = [PivotValueDefinition.Sum("Amount")],
            TopN = [new PivotTopN("Region", 2, Mode: PivotTopNMode.Bottom)]
        });

        Assert.DoesNotContain("Boş", top.RowHeaders.Select(header => header[0]));
        Assert.DoesNotContain("Boş", bottom.RowHeaders.Select(header => header[0]));
    }

    [Fact]
    public void ARankingUsesTheNamedValueRatherThanTheFirst()
    {
        var records = new[]
        {
            new Sale("Ege", "Beton", 1m),
            new Sale("Ege", "Beton", 1m),
            new Sale("Ege", "Beton", 1m),
            new Sale("Marmara", "Beton", 900m)
        };

        var byCount = Engine.Execute(records, new PivotRequest
        {
            Rows = ["Region"],
            Values = [PivotValueDefinition.Sum("Amount"), PivotValueDefinition.Count("Amount")],
            TopN = [new PivotTopN("Region", 1, ValueKey: "Amount_count")]
        });

        Assert.Equal(["Ege"], byCount.RowHeaders.Select(header => header[0]!));
    }

    [Fact]
    public void AnAverageIsRankedAsAnAverageRatherThanAsASum()
    {
        // The reason the second pass exists rather than a subtraction: an average of a
        // subset cannot be recovered from the averages of its parts.
        var records = new[]
        {
            new Sale("Ege", "Beton", 100m),
            new Sale("Ege", "Beton", 100m),
            new Sale("Marmara", "Beton", 150m)
        };

        var result = Engine.Execute(records, new PivotRequest
        {
            Rows = ["Region"],
            Values = [PivotValueDefinition.Average("Amount")],
            TopN = [new PivotTopN("Region", 1)]
        });

        Assert.Equal(["Marmara"], result.RowHeaders.Select(header => header[0]!));
        Assert.Equal(150m, result.GrandTotals["Amount_average"]);
    }

    [Fact]
    public void TiesBreakOnTheLabelSoTheSameDataAlwaysGivesTheSameRows()
    {
        // The large-data endpoint caches results by request, so two identical requests
        // that disagreed on which of two tied groups survived would poison the cache.
        var records = new[]
        {
            new Sale("Bravo", "Beton", 100m),
            new Sale("Alfa", "Beton", 100m),
            new Sale("Çarşı", "Beton", 100m)
        };

        var result = Engine.Execute(records, Request(new PivotTopN("Region", 2)));
        var reversed = Engine.Execute(records.Reverse().ToArray(), Request(new PivotTopN("Region", 2)));

        Assert.Equal(["Alfa", "Bravo"], Regions(result).Order().ToArray());
        Assert.Equal(Regions(result).Order(), Regions(reversed).Order());
    }

    [Fact]
    public void ARankingCombinesWithASort()
    {
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Region"],
            Values = [PivotValueDefinition.Sum("Amount")],
            TopN = [new PivotTopN("Region", 3)],
            RowSort = PivotSort.RowTotal("Amount_sum", PivotSortDirection.Ascending)
        });

        Assert.Equal(["Akdeniz", "Ege", "Marmara"], Regions(result));
    }

    [Fact]
    public void ARankingRunsAfterTheFiltersRatherThanBesideThem()
    {
        // Top two of what is left, not the survivors of the top two.
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Region"],
            Values = [PivotValueDefinition.Sum("Amount")],
            Filters = [new PivotFilter("Region", ["Marmara"], PivotFilterMode.Exclude)],
            TopN = [new PivotTopN("Region", 2)]
        });

        Assert.Equal(["Akdeniz", "Ege"], Regions(result).Order().ToArray());
    }

    [Fact]
    public void ARankingNamingNoRowLevelIsRejected()
    {
        // Silently showing every row would read as the feature being broken rather than
        // as the field name being wrong.
        Assert.Throws<ArgumentException>(() =>
            Engine.Execute(Sales, Request(new PivotTopN("Category", 2))));
    }

    [Fact]
    public void ARankingKeepingNoGroupsIsRejected()
    {
        Assert.Throws<ArgumentException>(() =>
            Engine.Execute(Sales, Request(new PivotTopN("Region", 0))));
    }

    [Fact]
    public void ARankingByAnUndeclaredValueIsRejected()
    {
        Assert.Throws<ArgumentException>(() =>
            Engine.Execute(Sales, Request(new PivotTopN("Region", 2, ValueKey: "Amount_max"))));
    }

    [Fact]
    public void NoRankingLeavesTheResultUntouched()
    {
        var plain = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Region"],
            Values = [PivotValueDefinition.Sum("Amount")]
        });

        Assert.Equal(5, plain.RowHeaders.Count);
        Assert.Equal(1500m, plain.GrandTotals["Amount_sum"]);
    }
}
