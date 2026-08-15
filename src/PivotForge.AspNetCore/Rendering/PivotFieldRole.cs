namespace PivotForge.AspNetCore.Rendering;

/// <summary>Specifies which pivot areas a field may occupy.</summary>
public enum PivotFieldRole
{
    /// <summary>Groups records; valid in the row, column, and filter areas.</summary>
    Dimension,
    /// <summary>Is aggregated; valid in the data area.</summary>
    Measure
}
