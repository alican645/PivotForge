namespace PivotForge.Core;

/// <summary>Specifies how an aggregated value is presented relative to other values.</summary>
public enum PivotShowAs
{
    /// <summary>Returns the aggregated value without a secondary calculation.</summary>
    Normal,
    /// <summary>Returns the value as a percentage of its row total.</summary>
    PercentOfRowTotal,
    /// <summary>Returns the value as a percentage of its column total.</summary>
    PercentOfColumnTotal,
    /// <summary>Returns the value as a percentage of the grand total.</summary>
    PercentOfGrandTotal,
    /// <summary>Returns the difference from the preceding column value.</summary>
    DifferenceFromPrevious,
    /// <summary>Returns the percentage difference from the preceding column value.</summary>
    PercentDifferenceFromPrevious,
    /// <summary>Returns the cumulative total across columns.</summary>
    RunningTotal
}
