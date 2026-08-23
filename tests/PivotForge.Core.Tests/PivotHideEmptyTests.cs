using System.Globalization;
using PivotForge.Core;

namespace PivotForge.Core.Tests;

public sealed class PivotHideEmptyTests
{
    private sealed record Sale(string Region, string Category, string Year, decimal? Amount);

    // Sparse on purpose: the column axis is the product of its levels, so a pair
    // that never occurred still produces a column.
    private static readonly Sale[] Sparse =
    [
        new("Ege", "Beton", "2025", 100m),
        new("Ege", "Çimento", "2026", 200m),
        new("Marmara", "Beton", "2025", 300m)
    ];

    private static readonly PivotEngine Engine = new(CultureInfo.GetCultureInfo("tr-TR"));

    private static PivotRequest Request(bool hide) => new()
    {
        Rows = ["Region"],
        Columns = ["Category", "Year"],
        Values = [PivotValueDefinition.Sum("Amount")],
        HideEmptySummaryCells = hide
    };

    private static string[] Columns(PivotResult result) =>
        result.ColumnHeaders.Select(header => string.Join("/", header)).ToArray();

    [Fact]
    public void TheColumnProductLeavesEmptyColumnsBehind()
    {
        // What the option is for: two categories times two years is four columns,
        // and only three of them ever happened.
        var result = Engine.Execute(Sparse, Request(hide: false));

        Assert.Equal(
            ["Beton/2025", "Beton/2026", "Çimento/2025", "Çimento/2026"],
            Columns(result));
    }

    [Fact]
    public void HidingDropsTheColumnsNothingLandedIn()
    {
        var result = Engine.Execute(Sparse, Request(hide: true));

        Assert.Equal(["Beton/2025", "Çimento/2026"], Columns(result));
    }

    [Fact]
    public void TheCellsThatSurviveStillPointAtTheirOwnColumns()
    {
        // The renumbering is the whole risk here: an index that survives a drop
        // but points at the old position is worse than the empty column was.
        var result = Engine.Execute(Sparse, Request(hide: true));

        var ege = result.RowHeaders.Select((header, index) => (header, index))
            .First(entry => entry.header[0] == "Ege").index;

        var beton2025 = result.Cells.Single(cell => cell.Row == ege && cell.Column == 0);
        var cimento2026 = result.Cells.Single(cell => cell.Row == ege && cell.Column == 1);

        Assert.Equal(100m, beton2025.Values["Amount_sum"]);
        Assert.Equal(200m, cimento2026.Values["Amount_sum"]);
    }

    [Fact]
    public void ColumnTotalsFollowTheColumnsTheyBelongTo()
    {
        var result = Engine.Execute(Sparse, Request(hide: true));

        Assert.Equal([0, 1], result.ColumnTotals.Select(total => total.Index));
        Assert.Equal(400m, result.ColumnTotals[0].Values["Amount_sum"]);
        Assert.Equal(200m, result.ColumnTotals[1].Values["Amount_sum"]);
    }

    [Fact]
    public void ARowWhoseValuesAllAggregateToNothingGoes()
    {
        // The row axis only observes what the data held, so an empty row is one
        // whose values were all null rather than one that never occurred.
        var withNulls = new[]
        {
            new Sale("Ege", "Beton", "2025", 100m),
            new Sale("Karadeniz", "Beton", "2025", null)
        };

        var kept = Engine.Execute(withNulls, Request(hide: false));
        var dropped = Engine.Execute(withNulls, Request(hide: true));

        Assert.Equal(["Ege", "Karadeniz"], kept.RowHeaders.Select(header => header[0]!));
        Assert.Equal(["Ege"], dropped.RowHeaders.Select(header => header[0]!));
    }

    [Fact]
    public void RowTotalsFollowTheRowsTheyBelongTo()
    {
        // The mirror of the column case, and the easier one to get wrong: the row
        // axis is renumbered again by sorting afterwards, so a total left pointing
        // at the old row comes back attached to the wrong region -- or to nothing.
        var withNulls = new[]
        {
            new Sale("Ege", "Beton", "2025", null),
            new Sale("Karadeniz", "Beton", "2025", 700m)
        };

        var result = Engine.Execute(withNulls, Request(hide: true));

        Assert.Equal(["Karadeniz"], result.RowHeaders.Select(header => header[0]!));
        Assert.Equal([0], result.RowTotals.Select(total => total.Index));
        Assert.Equal(700m, result.RowTotals[0].Values["Amount_sum"]);
    }

    [Fact]
    public void GrandTotalsAreUntouched()
    {
        // A row that aggregated to nothing contributed nothing to them either.
        var hidden = Engine.Execute(Sparse, Request(hide: true));
        var shown = Engine.Execute(Sparse, Request(hide: false));

        Assert.Equal(shown.GrandTotals["Amount_sum"], hidden.GrandTotals["Amount_sum"]);
        Assert.Equal(600m, hidden.GrandTotals["Amount_sum"]);
    }

    [Fact]
    public void ASubtotalWhoseGroupWentWithTheRowsGoesToo()
    {
        var records = new[]
        {
            new Sale("Ege", "Beton", "2025", 100m),
            new Sale("Ege", "Çimento", "2026", 50m),
            new Sale("Karadeniz", "Beton", "2025", null)
        };

        var result = Engine.Execute(records, new PivotRequest
        {
            Rows = ["Region", "Category"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Sum("Amount")],
            HideEmptySummaryCells = true
        });

        // Karadeniz headed a group that no longer has any rows under it.
        Assert.Equal(
            ["Ege"],
            result.Subtotals.Select(subtotal => subtotal.RowHeader[0]!).Distinct());
    }

    [Fact]
    public void ASubtotalsOwnCellsAreRenumberedWithTheColumns()
    {
        var result = Engine.Execute(Sparse, new PivotRequest
        {
            Rows = ["Region", "Category"],
            Columns = ["Category", "Year"],
            Values = [PivotValueDefinition.Sum("Amount")],
            HideEmptySummaryCells = true
        });

        Assert.All(
            result.Subtotals.SelectMany(subtotal => subtotal.Cells),
            cell => Assert.InRange(cell.Column, 0, result.ColumnHeaders.Count - 1));
    }

    [Fact]
    public void NothingIsDroppedWhenNothingIsEmpty()
    {
        var dense = new[]
        {
            new Sale("Ege", "Beton", "2025", 100m),
            new Sale("Marmara", "Beton", "2025", 300m)
        };

        var hidden = Engine.Execute(dense, Request(hide: true));
        var shown = Engine.Execute(dense, Request(hide: false));

        Assert.Equal(Columns(shown), Columns(hidden));
        Assert.Equal(shown.RowHeaders.Count, hidden.RowHeaders.Count);
        Assert.Equal(shown.Cells.Count, hidden.Cells.Count);
    }

    [Fact]
    public void TheMetadataCountsWhatSurvived()
    {
        // A count that still reported the dropped columns would mislead paging
        // and the virtual scroller that reads it.
        var result = Engine.Execute(Sparse, Request(hide: true));

        Assert.Equal(result.ColumnHeaders.Count, result.Metadata.ColumnHeaderCount);
        Assert.Equal(result.RowHeaders.Count, result.Metadata.RowHeaderCount);
    }

    [Fact]
    public void SortingOrdersWhatSurvivedRatherThanWhatWasDropped()
    {
        var result = Engine.Execute(Sparse, new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Category", "Year"],
            Values = [PivotValueDefinition.Sum("Amount")],
            HideEmptySummaryCells = true,
            RowSort = new PivotSort(PivotSortMode.RowTotalValue, PivotSortDirection.Descending)
        });

        Assert.Equal(["Ege", "Marmara"], result.RowHeaders.Select(header => header[0]!));
        Assert.Equal(300m, result.RowTotals[0].Values["Amount_sum"]);
        Assert.Equal(300m, result.RowTotals[1].Values["Amount_sum"]);
    }
}
