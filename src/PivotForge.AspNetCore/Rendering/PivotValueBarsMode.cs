namespace PivotForge.AspNetCore.Rendering;

/// <summary>What the value bars behind the value cells are measured across.</summary>
/// <remarks>
/// Each data field is its own scale. Totals and subtotals get no bar.
/// </remarks>
public enum PivotValueBarsMode
{
    /// <summary>No value bars.</summary>
    None,

    /// <summary>One scale across every value cell of a data field.</summary>
    Table,

    /// <summary>One scale per row.</summary>
    Rows,

    /// <summary>One scale per column.</summary>
    Columns
}
