namespace PivotForge.AspNetCore.Rendering;

/// <summary>What a heatmap colour scale is drawn across.</summary>
/// <remarks>
/// Each data field is its own scale. Totals and subtotals are never shaded.
/// </remarks>
public enum PivotHeatmapMode
{
    /// <summary>No heatmap.</summary>
    None,

    /// <summary>One scale across every value cell of a data field.</summary>
    Table,

    /// <summary>One scale per row.</summary>
    Rows,

    /// <summary>One scale per column.</summary>
    Columns
}
