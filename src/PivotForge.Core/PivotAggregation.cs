namespace PivotForge.Core;

/// <summary>Specifies how source values are aggregated.</summary>
public enum PivotAggregation
{
    /// <summary>Adds numeric values.</summary>
    Sum,
    /// <summary>Counts source records.</summary>
    Count,
    /// <summary>Calculates the arithmetic mean of numeric values.</summary>
    Average,
    /// <summary>Returns the smallest numeric value.</summary>
    Min,
    /// <summary>Returns the largest numeric value.</summary>
    Max
}
