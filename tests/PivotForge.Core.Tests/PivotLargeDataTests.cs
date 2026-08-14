namespace PivotForge.Core.Tests;

public sealed class PivotLargeDataTests
{
    [Fact]
    public void Execute_HonorsCancellationWhileMaterializingSource()
    {
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        var records = Enumerable.Range(0, 10_000)
            .Select(index => new LargeRecord($"R{index}", index));
        var request = new PivotRequest
        {
            Rows = [nameof(LargeRecord.Region)],
            Values = [PivotValueDefinition.Sum(nameof(LargeRecord.Amount))]
        };

        Assert.Throws<OperationCanceledException>(() =>
            new PivotEngine().Execute(records, request, cancellation.Token));
    }

    [Fact]
    public void Paginator_SlicesRowsAndRemapsCellIndexes()
    {
        var source = CreateResult();

        var page = PivotResultPaginator.CreatePage(source, 2, 2);

        Assert.Equal(2, page.Offset);
        Assert.Equal(5, page.TotalRowCount);
        Assert.True(page.HasPrevious);
        Assert.True(page.HasMore);
        Assert.Equal(["R2", "R3"], page.Result.RowHeaders.Select(header => header[0]));
        Assert.Equal([0, 1], page.Result.Cells.Select(cell => cell.Row));
        Assert.Equal([0, 1], page.Result.RowTotals.Select(total => total.Index));
        Assert.Equal(5, page.Result.Metadata.RowHeaderCount);
        Assert.Equal(2, page.Result.Metadata.CellCount);
        Assert.Single(page.Result.Subtotals);
        Assert.Equal("R2", page.Result.Subtotals[0].RowHeader[0]);
    }

    [Fact]
    public void Paginator_ClampsOffsetAndValidatesPageSize()
    {
        var source = CreateResult();
        var empty = PivotResultPaginator.CreatePage(source, 99, 10);

        Assert.Equal(5, empty.Offset);
        Assert.Empty(empty.Result.RowHeaders);
        Assert.False(empty.HasMore);
        Assert.Throws<ArgumentOutOfRangeException>(() => PivotResultPaginator.CreatePage(source, -1, 10));
        Assert.Throws<ArgumentOutOfRangeException>(() => PivotResultPaginator.CreatePage(source, 0, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => PivotResultPaginator.CreatePage(source, 0, 1_001));
    }

    private static PivotResult CreateResult()
    {
        var headers = Enumerable.Range(0, 5)
            .Select(index => (IReadOnlyList<string?>)[$"R{index}", "Detail"])
            .ToArray();
        var cells = Enumerable.Range(0, 5)
            .Select(index => new PivotCell
            {
                Row = index,
                Column = 0,
                Values = new Dictionary<string, decimal?> { ["Amount_sum"] = index }
            })
            .ToArray();
        var totals = Enumerable.Range(0, 5)
            .Select(index => new PivotTotal
            {
                Index = index,
                Values = new Dictionary<string, decimal?> { ["Amount_sum"] = index }
            })
            .ToArray();

        return new PivotResult
        {
            RowHeaders = headers,
            ColumnHeaders = [["2026"]],
            Cells = cells,
            RowTotals = totals,
            Subtotals =
            [
                new PivotSubtotal { RowHeader = ["R0"] },
                new PivotSubtotal { RowHeader = ["R2"] }
            ],
            Metadata = new PivotMetadata
            {
                SourceRowCount = 100_000,
                RowHeaderCount = 5,
                ColumnHeaderCount = 1,
                CellCount = 5
            }
        };
    }

    private sealed record LargeRecord(string Region, decimal Amount);
}
