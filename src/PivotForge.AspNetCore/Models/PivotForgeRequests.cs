using PivotForge.Core;

namespace PivotForge.AspNetCore.Models;

/// <summary>Describes a pivot operation received by an ASP.NET Core endpoint.</summary>
public class PivotForgeRequest
{
    /// <summary>Gets the header levels that form rows.</summary>
    /// <remarks>Each entry is a field name, or an object carrying a <c>field</c> and an
    /// <c>interval</c> when the level groups dates.</remarks>
    public IReadOnlyList<PivotFieldRef> Rows { get; init; } = [];

    /// <summary>Gets the header levels that form columns.</summary>
    public IReadOnlyList<PivotFieldRef> Columns { get; init; } = [];

    /// <summary>Gets the values to aggregate.</summary>
    public IReadOnlyList<PivotValueDefinition> Values { get; init; } = [];

    /// <summary>Gets source filters applied before aggregation.</summary>
    public IReadOnlyList<PivotFilter> Filters { get; init; } = [];

    /// <summary>Gets the optional row ordering definition.</summary>
    public PivotSort? RowSort { get; init; }

    /// <summary>Gets the per-field ordering of individual row and column header levels.</summary>
    public IReadOnlyList<PivotFieldSort> FieldSorts { get; init; } = [];

    /// <summary>Gets whether rows and columns holding no values at all are dropped.</summary>
    public bool HideEmptySummaryCells { get; init; }

    /// <summary>Gets the row header levels limited to their highest or lowest ranking groups.</summary>
    public IReadOnlyList<PivotTopN> TopN { get; init; } = [];

    /// <summary>Gets the row header levels whose groups are kept only when their value meets a condition.</summary>
    public IReadOnlyList<PivotValueFilter> ValueFilters { get; init; } = [];

    /// <summary>Gets the type each named source field's values are converted to when read.</summary>
    /// <remarks>See <see cref="PivotRequest.DataTypes"/>. The names answer to
    /// <see cref="PivotForgeOptions.AllowedFields"/> like every other field the request names.</remarks>
    public IReadOnlyDictionary<string, PivotDataType> DataTypes { get; init; } =
        new Dictionary<string, PivotDataType>();

    /// <summary>Gets the fields a registered selector works out, naming the selector.</summary>
    /// <remarks>See <see cref="PivotRequest.Selectors"/>. A name must be registered in
    /// <see cref="PivotForgeOptions.CustomSelectors"/>.</remarks>
    public IReadOnlyDictionary<string, string> Selectors { get; init; } =
        new Dictionary<string, string>();

    internal PivotRequest ToPivotRequest() => new()
    {
        DataTypes = DataTypes,
        Selectors = Selectors,
        HideEmptySummaryCells = HideEmptySummaryCells,
        Rows = Rows,
        Columns = Columns,
        Values = Values,
        Filters = Filters,
        TopN = TopN,
        ValueFilters = ValueFilters,
        RowSort = RowSort,
        FieldSorts = FieldSorts
    };
}

/// <summary>Starts a cached, paged pivot operation.</summary>
public sealed class PivotForgeLargeStartRequest : PivotForgeRequest
{
    /// <summary>Gets the requested number of pivot rows in the first page.</summary>
    public int PageSize { get; init; } = 40;

    /// <summary>Gets the source-row hint passed to the configured data provider.</summary>
    public int SourceRowCount { get; init; } = 100_000;
}

/// <summary>Requests a page from a cached pivot result.</summary>
public sealed class PivotForgePageRequest
{
    /// <summary>Gets the large-pivot session identifier.</summary>
    public string SessionId { get; init; } = "";

    /// <summary>Gets the zero-based pivot row offset.</summary>
    public int Offset { get; init; }

    /// <summary>Gets the requested number of pivot rows.</summary>
    public int PageSize { get; init; } = 40;
}

/// <summary>Requests the distinct values a filter on one field can accept.</summary>
/// <remarks>This carries no pivot definition on purpose: a filter picker lists every value the
/// field holds, so unchecking one and reopening the picker still shows the rest. Narrowing the
/// list by the field's own filter would make previously excluded values unreachable; narrowing
/// it by the <em>other</em> fields' filters (<see cref="Filters"/>) does not, and is what a grid
/// asks for when it shows only relevant values.</remarks>
public sealed class PivotForgeFieldValuesRequest
{
    /// <summary>Gets the source field whose values are listed.</summary>
    public string Field { get; init; } = "";

    /// <summary>Gets the date interval the listed values are groups of.</summary>
    /// <remarks>A picker opened from a grouped header lists what that header shows — month
    /// names rather than timestamps — because that is what the filter will compare against.</remarks>
    public PivotGroupInterval Interval { get; init; } = PivotGroupInterval.None;

    /// <summary>Gets the range width when <see cref="Interval"/> is <see cref="PivotGroupInterval.Range"/>.</summary>
    public decimal? BinSize { get; init; }

    /// <summary>Gets the filters a record has to pass for its value to be listed.</summary>
    /// <remarks>Empty lists every value the field holds.</remarks>
    public IReadOnlyList<PivotFilter> Filters { get; init; } = [];

    /// <summary>Gets the type each named source field's values are converted to when read, so
    /// the list holds what the headers show.</summary>
    public IReadOnlyDictionary<string, PivotDataType> DataTypes { get; init; } =
        new Dictionary<string, PivotDataType>();

    /// <summary>Gets the fields a registered selector works out, as the pivot request sends them,
    /// so the list holds what the headers show; <see cref="Field"/> may be one of them.</summary>
    public IReadOnlyDictionary<string, string> Selectors { get; init; } =
        new Dictionary<string, string>();

    /// <summary>Gets the source-row hint passed to the configured data provider.</summary>
    public int SourceRowCount { get; init; } = 100_000;
}

/// <summary>Requests source records behind a pivot row and column path.</summary>
public sealed class PivotForgeDrillDownRequest : PivotForgeRequest
{
    /// <summary>Gets the source-row hint passed to the configured data provider.</summary>
    public int SourceRowCount { get; init; } = 100;

    /// <summary>Gets the selected row-header path.</summary>
    public IReadOnlyList<string?> RowPath { get; init; } = [];

    /// <summary>Gets the selected column-header path.</summary>
    public IReadOnlyList<string?> ColumnPath { get; init; } = [];

    /// <summary>Gets the optional selected value definition key.</summary>
    public string? ValueKey { get; init; }
}
