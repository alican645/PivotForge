using PivotForge.Core;

namespace PivotForge.AspNetCore.Models;

/// <summary>Describes a pivot operation received by an ASP.NET Core endpoint.</summary>
public class PivotForgeRequest
{
    /// <summary>Gets the source fields that form row headers.</summary>
    public IReadOnlyList<string> Rows { get; init; } = [];

    /// <summary>Gets the source fields that form column headers.</summary>
    public IReadOnlyList<string> Columns { get; init; } = [];

    /// <summary>Gets the values to aggregate.</summary>
    public IReadOnlyList<PivotValueDefinition> Values { get; init; } = [];

    /// <summary>Gets source filters applied before aggregation.</summary>
    public IReadOnlyList<PivotFilter> Filters { get; init; } = [];

    /// <summary>Gets the optional row ordering definition.</summary>
    public PivotSort? RowSort { get; init; }

    internal PivotRequest ToPivotRequest() => new()
    {
        Rows = Rows,
        Columns = Columns,
        Values = Values,
        Filters = Filters,
        RowSort = RowSort
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
/// list by the filters already applied would make previously excluded values unreachable.</remarks>
public sealed class PivotForgeFieldValuesRequest
{
    /// <summary>Gets the source field whose values are listed.</summary>
    public string Field { get; init; } = "";

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
