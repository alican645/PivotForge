using PivotForge.Core;

namespace PivotForge.AspNetCore;

/// <summary>Configures PivotForge endpoint limits and cache behavior.</summary>
public sealed class PivotForgeOptions
{
    /// <summary>Gets the source fields the endpoints are allowed to read.</summary>
    /// <remarks>
    /// An empty set means every field on the record type is readable, which is what an
    /// application that never declared a list gets. Declaring one turns the endpoints from
    /// "read whatever the browser named" into "read only these": a request naming anything
    /// else is rejected, and drill-down hands back only these fields rather than the whole
    /// record. Names are compared without regard to case, because the record readers resolve
    /// them that way too.
    /// </remarks>
    public ISet<string> AllowedFields { get; } =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    /// <summary>Gets the custom summary functions a calculated field's formula may call.</summary>
    /// <remarks>
    /// Registered by the name a formula uses, e.g. <c>options.CustomAggregates["Median"] = ...</c>
    /// for <c>Median([Amount])</c>, and matched without regard to case. The function receives a
    /// cell's non-null values and is not called for a cell that has none. It runs on the
    /// server, which is the only place a formula ever runs: a reader who types one into the
    /// designer can call what is registered here and nothing else.
    /// </remarks>
    public IDictionary<string, PivotCustomAggregate> CustomAggregates { get; } =
        new Dictionary<string, PivotCustomAggregate>(StringComparer.OrdinalIgnoreCase);

    /// <summary>Gets or sets the sliding expiration used for completed large pivot results.</summary>
    public TimeSpan CacheSlidingExpiration { get; set; } = TimeSpan.FromMinutes(5);

    /// <summary>Gets or sets the minimum source-row hint accepted by the large-data endpoint.</summary>
    public int MinimumLargeDataSourceRowCount { get; set; } = 1_000;

    /// <summary>Gets or sets the maximum source-row hint passed to the data provider.</summary>
    public int MaximumSourceRowCount { get; set; } = 500_000;

    /// <summary>Gets or sets the minimum page size.</summary>
    public int MinimumPageSize { get; set; } = 10;

    /// <summary>Gets or sets the maximum page size.</summary>
    public int MaximumPageSize { get; set; } = 200;

    /// <summary>Gets or sets the maximum number of drill-down records returned to a client.</summary>
    public int DrillDownRecordLimit { get; set; } = 1_000;

    /// <summary>Gets or sets the maximum number of distinct field values returned to a client.</summary>
    public int FieldValueLimit { get; set; } = 1_000;

    /// <summary>Gets or sets the maximum number of rows accepted by the Excel endpoint.</summary>
    public int MaximumExcelRows { get; set; } = 20_000;

    /// <summary>Gets or sets the maximum number of cells accepted by the Excel endpoint.</summary>
    public int MaximumExcelCells { get; set; } = 200_000;
}
