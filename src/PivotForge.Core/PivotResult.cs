namespace PivotForge.Core;

/// <summary>Contains the headers, cells, totals, and metadata produced by a pivot operation.</summary>
public sealed class PivotResult
{
    /// <summary>Gets the ordered row-header paths.</summary>
    public IReadOnlyList<IReadOnlyList<string?>> RowHeaders { get; init; } = [];

    /// <summary>Gets the ordered column-header paths.</summary>
    public IReadOnlyList<IReadOnlyList<string?>> ColumnHeaders { get; init; } = [];

    /// <summary>Gets the data cells addressed by row and column indexes.</summary>
    public IReadOnlyList<PivotCell> Cells { get; init; } = [];

    /// <summary>Gets the totals for each row.</summary>
    public IReadOnlyList<PivotTotal> RowTotals { get; init; } = [];

    /// <summary>Gets the totals for each column.</summary>
    public IReadOnlyList<PivotTotal> ColumnTotals { get; init; } = [];

    /// <summary>Gets the subtotal rows for grouped row headers.</summary>
    public IReadOnlyList<PivotSubtotal> Subtotals { get; init; } = [];

    /// <summary>Gets the grand total for each value definition key.</summary>
    public IReadOnlyDictionary<string, decimal?> GrandTotals { get; init; } = new Dictionary<string, decimal?>();

    /// <summary>Gets counts describing the generated result.</summary>
    public PivotMetadata Metadata { get; init; } = new();
}

/// <summary>Represents an aggregated pivot cell.</summary>
public sealed class PivotCell
{
    /// <summary>Gets the zero-based row-header index.</summary>
    public int Row { get; init; }

    /// <summary>Gets the zero-based column-header index.</summary>
    public int Column { get; init; }

    /// <summary>Gets aggregated values keyed by value definition.</summary>
    public IReadOnlyDictionary<string, decimal?> Values { get; init; } = new Dictionary<string, decimal?>();
}

/// <summary>Represents aggregated values for one row or column index.</summary>
public sealed class PivotTotal
{
    /// <summary>Gets the zero-based row or column index.</summary>
    public int Index { get; init; }

    /// <summary>Gets totals keyed by value definition.</summary>
    public IReadOnlyDictionary<string, decimal?> Values { get; init; } = new Dictionary<string, decimal?>();
}

/// <summary>Represents a subtotal for a grouped row-header path.</summary>
public sealed class PivotSubtotal
{
    /// <summary>Gets the row-header prefix represented by the subtotal.</summary>
    public IReadOnlyList<string?> RowHeader { get; init; } = [];

    /// <summary>Gets subtotal cells for each column.</summary>
    public IReadOnlyList<PivotCell> Cells { get; init; } = [];

    /// <summary>Gets subtotal values across all columns.</summary>
    public IReadOnlyDictionary<string, decimal?> Totals { get; init; } = new Dictionary<string, decimal?>();
}

/// <summary>Describes the size of a generated pivot result.</summary>
public sealed class PivotMetadata
{
    /// <summary>Gets the number of source records processed.</summary>
    public int SourceRowCount { get; init; }

    /// <summary>Gets the number of distinct row-header paths.</summary>
    public int RowHeaderCount { get; init; }

    /// <summary>Gets the number of distinct column-header paths.</summary>
    public int ColumnHeaderCount { get; init; }

    /// <summary>Gets the number of populated data cells.</summary>
    public int CellCount { get; init; }
}
