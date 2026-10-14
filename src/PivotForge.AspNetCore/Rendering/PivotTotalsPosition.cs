namespace PivotForge.AspNetCore.Rendering;

/// <summary>Where a group's subtotal row is drawn.</summary>
public enum PivotTotalsPosition
{
    /// <summary>Above the group's rows, as the group's own header. DevExtreme's <c>showTotalsPrior: "rows"</c>.</summary>
    Before,

    /// <summary>
    /// Below the group's rows, as Excel lays a report out by default: a header row with the toggle
    /// opens the group and the total row closes it. A collapsed group is its total row alone.
    /// </summary>
    After
}
