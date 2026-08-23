namespace PivotForge.Core;

/// <summary>Describes the fields, values, filters, and ordering used to build a pivot result.</summary>
public sealed class PivotRequest
{
    /// <summary>Gets the source fields that form row headers.</summary>
    public IReadOnlyList<string> Rows { get; init; } = [];

    /// <summary>Gets the source fields that form column headers.</summary>
    public IReadOnlyList<string> Columns { get; init; } = [];

    /// <summary>Gets the values to aggregate.</summary>
    public IReadOnlyList<PivotValueDefinition> Values { get; init; } = [];

    /// <summary>Gets the source filters applied before aggregation.</summary>
    public IReadOnlyList<PivotFilter> Filters { get; init; } = [];

    /// <summary>Gets the optional row ordering definition.</summary>
    public PivotSort? RowSort { get; init; }

    /// <summary>Gets the per-field ordering of individual row and column header levels.</summary>
    /// <remarks><see cref="RowSort"/> orders the row axis as a whole and takes precedence over these
    /// on that axis; the column axis is governed by these alone.</remarks>
    public IReadOnlyList<PivotFieldSort> FieldSorts { get; init; } = [];
}
