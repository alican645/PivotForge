namespace PivotForge.Core;

/// <summary>Specifies the direction a value's running total accumulates in, DevExtreme's <c>runningTotal</c>.</summary>
/// <remarks>
/// Applied after <see cref="PivotValueDefinition.ShowAs"/> and after sorting, in the order the
/// result is drawn, so a percentage accumulates into a cumulative percentage. A subtotal row or
/// column accumulates among the subtotals of its own level. The totals it runs towards -- the
/// right-hand total for <see cref="Row"/>, the bottom row for <see cref="Column"/> -- and the grand
/// total are left as they are. <see cref="PivotValueDefinition.AllowCrossGroupCalculation"/>
/// <see langword="false"/> starts it again in every parent group.
/// </remarks>
public enum PivotRunningTotal
{
    /// <summary>No running total.</summary>
    None,

    /// <summary>Along each row, across the columns from first to last.</summary>
    Row,

    /// <summary>Down each column, across the rows from first to last.</summary>
    Column
}
