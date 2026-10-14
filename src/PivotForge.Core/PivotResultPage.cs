namespace PivotForge.Core;

/// <summary>Contains a contiguous page of pivot rows and paging metadata.</summary>
public sealed class PivotResultPage
{
    /// <summary>Gets the page result whose row indexes are local to the page.</summary>
    public required PivotResult Result { get; init; }

    /// <summary>Gets the zero-based source row offset.</summary>
    public int Offset { get; init; }

    /// <summary>Gets the requested maximum number of rows.</summary>
    public int PageSize { get; init; }

    /// <summary>Gets the total number of row headers in the unpaged result.</summary>
    public int TotalRowCount { get; init; }

    /// <summary>Gets a value indicating whether an earlier page exists.</summary>
    public bool HasPrevious => Offset > 0;

    /// <summary>Gets a value indicating whether a later page exists.</summary>
    public bool HasMore => Offset + Result.RowHeaders.Count < TotalRowCount;
}

/// <summary>Creates row-based pages from completed pivot results.</summary>
public static class PivotResultPaginator
{
    /// <summary>Creates a page while preserving shared column totals and grand totals.</summary>
    /// <param name="source">The completed pivot result.</param>
    /// <param name="offset">The zero-based row-header offset.</param>
    /// <param name="pageSize">The number of rows to return, from 1 through 1000.</param>
    /// <returns>A pivot result page.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="source"/> is null.</exception>
    /// <exception cref="ArgumentOutOfRangeException">The offset or page size is outside its supported range.</exception>
    public static PivotResultPage CreatePage(PivotResult source, int offset, int pageSize)
    {
        ArgumentNullException.ThrowIfNull(source);

        if (offset < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(offset));
        }

        if (pageSize is < 1 or > 1_000)
        {
            throw new ArgumentOutOfRangeException(nameof(pageSize));
        }

        var totalRows = source.RowHeaders.Count;
        var safeOffset = Math.Min(offset, totalRows);
        var rowCount = Math.Min(pageSize, totalRows - safeOffset);
        var headers = source.RowHeaders.Skip(safeOffset).Take(rowCount).ToArray();
        var cells = source.Cells
            .Where(cell => cell.Row >= safeOffset && cell.Row < safeOffset + rowCount)
            .Select(cell => new PivotCell
            {
                Row = cell.Row - safeOffset,
                Column = cell.Column,
                Values = cell.Values
            })
            .ToArray();
        var rowTotals = source.RowTotals
            .Where(total => total.Index >= safeOffset && total.Index < safeOffset + rowCount)
            .Select(total => new PivotTotal
            {
                Index = total.Index - safeOffset,
                Values = total.Values
            })
            .ToArray();
        var pagePaths = headers
            .Select(header => header.ToArray())
            .ToArray();
        var subtotals = source.Subtotals
            .Where(subtotal => pagePaths.Any(path => StartsWith(path, subtotal.RowHeader)))
            .ToArray();
        // Every row a column subtotal holds is addressed by index, so it is sliced and
        // renumbered with the rows themselves.
        var columnSubtotals = source.ColumnSubtotals
            .Select(subtotal => new PivotColumnSubtotal
            {
                ColumnHeader = subtotal.ColumnHeader,
                Cells = subtotal.Cells
                    .Where(cell => cell.Index >= safeOffset && cell.Index < safeOffset + rowCount)
                    .Select(cell => new PivotTotal { Index = cell.Index - safeOffset, Values = cell.Values })
                    .ToArray(),
                Totals = subtotal.Totals
            })
            .ToArray();

        return new PivotResultPage
        {
            Offset = safeOffset,
            PageSize = pageSize,
            TotalRowCount = totalRows,
            Result = new PivotResult
            {
                RowHeaders = headers,
                ColumnHeaders = source.ColumnHeaders,
                Cells = cells,
                RowTotals = rowTotals,
                ColumnTotals = source.ColumnTotals,
                Subtotals = subtotals,
                ColumnSubtotals = columnSubtotals,
                GrandTotals = source.GrandTotals,
                ValueRanges = CreateValueRanges(source.Cells),
                Metadata = new PivotMetadata
                {
                    SourceRowCount = source.Metadata.SourceRowCount,
                    RowHeaderCount = totalRows,
                    ColumnHeaderCount = source.Metadata.ColumnHeaderCount,
                    CellCount = cells.Length
                }
            }
        };
    }

    // Over the detail cells only: those are what a heatmap shades. One range per value key for
    // the whole result, and one per value key and column.
    private static PivotValueRange[] CreateValueRanges(IReadOnlyList<PivotCell> cells)
    {
        var ranges = new Dictionary<(string ValueKey, int? Column), (decimal Min, decimal Max)>();

        foreach (var cell in cells)
        {
            foreach (var (valueKey, value) in cell.Values)
            {
                if (value is not { } number)
                {
                    continue;
                }

                Widen(ranges, (valueKey, null), number);
                Widen(ranges, (valueKey, cell.Column), number);
            }
        }

        return ranges
            .OrderBy(entry => entry.Key.ValueKey, StringComparer.Ordinal)
            .ThenBy(entry => entry.Key.Column ?? -1)
            .Select(entry => new PivotValueRange
            {
                ValueKey = entry.Key.ValueKey,
                Column = entry.Key.Column,
                Min = entry.Value.Min,
                Max = entry.Value.Max
            })
            .ToArray();
    }

    private static void Widen(
        Dictionary<(string ValueKey, int? Column), (decimal Min, decimal Max)> ranges,
        (string ValueKey, int? Column) key,
        decimal value) =>
        ranges[key] = ranges.TryGetValue(key, out var range)
            ? (Math.Min(range.Min, value), Math.Max(range.Max, value))
            : (value, value);

    private static bool StartsWith(IReadOnlyList<string?> path, IReadOnlyList<string?> prefix)
    {
        if (prefix.Count > path.Count)
        {
            return false;
        }

        for (var index = 0; index < prefix.Count; index++)
        {
            if (!string.Equals(path[index], prefix[index], StringComparison.Ordinal))
            {
                return false;
            }
        }

        return true;
    }
}
