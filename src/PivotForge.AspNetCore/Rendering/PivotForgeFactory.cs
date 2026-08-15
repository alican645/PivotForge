namespace PivotForge.AspNetCore.Rendering;

/// <summary>Creates PivotForge view components.</summary>
public sealed class PivotForgeFactory
{
    /// <summary>Creates a pivot grid builder.</summary>
    /// <returns>A new grid builder.</returns>
    public PivotGridBuilder PivotGrid() => new();
}
