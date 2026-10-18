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
    RunningTotal,
    /// <summary>Returns the value as a percentage of its parent row group's value in the same column.</summary>
    /// <remarks>
    /// Excel's "% of Parent Row Total", DevExtreme's <c>percentOfColumnTotal</c>: a city's share of
    /// its region. A top-level row's parent is the column's grand total, so a single row level
    /// reads like <see cref="PercentOfColumnTotal"/>.
    /// </remarks>
    PercentOfParentRowTotal,
    /// <summary>Returns the value as a percentage of its parent column group's value in the same row.</summary>
    /// <remarks>
    /// Excel's "% of Parent Column Total", DevExtreme's <c>percentOfRowTotal</c>: a quarter's share
    /// of its year. A top-level column's parent is the row's grand total.
    /// </remarks>
    PercentOfParentColumnTotal
}
