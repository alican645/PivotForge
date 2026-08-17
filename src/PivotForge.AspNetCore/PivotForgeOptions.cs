namespace PivotForge.AspNetCore;

/// <summary>Configures PivotForge endpoint limits and cache behavior.</summary>
public sealed class PivotForgeOptions
{
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
