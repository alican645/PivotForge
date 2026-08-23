namespace PivotForge.Core;

/// <summary>Describes the fields, values, filters, and ordering used to build a pivot result.</summary>
public sealed class PivotRequest
{
    /// <summary>Gets the header levels that form rows.</summary>
    /// <remarks>A plain field name converts to a level of its own, so a list of names still
    /// means what it did; a level carrying a <see cref="PivotGroupInterval"/> collapses its
    /// field's dates, and the same field may appear more than once at different intervals.</remarks>
    public IReadOnlyList<PivotFieldRef> Rows { get; init; } = [];

    /// <summary>Gets the header levels that form columns.</summary>
    public IReadOnlyList<PivotFieldRef> Columns { get; init; } = [];

    /// <summary>Gets the values to aggregate.</summary>
    public IReadOnlyList<PivotValueDefinition> Values { get; init; } = [];

    /// <summary>Gets the source filters applied before aggregation.</summary>
    public IReadOnlyList<PivotFilter> Filters { get; init; } = [];

    /// <summary>Gets the optional row ordering definition.</summary>
    public PivotSort? RowSort { get; init; }

    /// <summary>Gets whether rows and columns holding no values at all are dropped.</summary>
    /// <remarks>
    /// The column axis is the product of its levels, so sparse data leaves whole columns that
    /// never occurred; the row axis only observes what the data held, so an empty row is one whose
    /// values all aggregated to nothing. Dropping happens in the engine rather than in the browser,
    /// so paging, Excel export and drill-down all agree on which rows exist.
    /// </remarks>
    public bool HideEmptySummaryCells { get; init; }

    /// <summary>Gets the row header levels limited to their highest or lowest ranking groups.</summary>
    /// <remarks>These run after aggregation, on groups that do not exist until the records have
    /// been summed, which is what separates them from <see cref="Filters"/>.</remarks>
    public IReadOnlyList<PivotTopN> TopN { get; init; } = [];

    /// <summary>Gets the per-field ordering of individual row and column header levels.</summary>
    /// <remarks><see cref="RowSort"/> orders the row axis as a whole and takes precedence over these
    /// on that axis; the column axis is governed by these alone.</remarks>
    public IReadOnlyList<PivotFieldSort> FieldSorts { get; init; } = [];
}
