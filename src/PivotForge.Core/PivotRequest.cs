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

    /// <summary>Gets the row header levels whose groups are kept only when their value meets a condition.</summary>
    /// <remarks>Like <see cref="TopN"/> these run after aggregation; a ranking on the same level is
    /// taken among the groups these keep.</remarks>
    public IReadOnlyList<PivotValueFilter> ValueFilters { get; init; } = [];

    /// <summary>Gets the per-field ordering of individual row and column header levels.</summary>
    /// <remarks><see cref="RowSort"/> orders the row axis as a whole and takes precedence over these
    /// on that axis; the column axis is governed by these alone. A sort carrying a value key orders
    /// its level by that value's summary, on either axis.</remarks>
    public IReadOnlyList<PivotFieldSort> FieldSorts { get; init; } = [];

    /// <summary>Gets the type each named source field's values are converted to when read.</summary>
    /// <remarks>Keyed by source field, not by level: a date column grouped by year and again by
    /// month is one column of one type. Names match the way field names do everywhere, ignoring
    /// case. A field left out, or typed <see cref="PivotDataType.Auto"/>, is read as it is.</remarks>
    public IReadOnlyDictionary<string, PivotDataType> DataTypes { get; init; } =
        new Dictionary<string, PivotDataType>();

    /// <summary>Gets the fields whose values a registered <see cref="PivotSelector"/> works out,
    /// keyed by field, naming the selector.</summary>
    /// <remarks>DevExtreme's <c>selector</c>, by name: each entry names an entry in
    /// <see cref="PivotEngine.CustomSelectors"/>, and an unknown name is refused. The field may be
    /// one the source has, whose values the selector replaces, or a name of its own. Names match
    /// ignoring case. A selected field takes no data type.</remarks>
    public IReadOnlyDictionary<string, string> Selectors { get; init; } =
        new Dictionary<string, string>();
}
