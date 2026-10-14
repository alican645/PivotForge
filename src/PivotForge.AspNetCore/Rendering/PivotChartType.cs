namespace PivotForge.AspNetCore.Rendering;

/// <summary>The form a pivot chart draws the grid's numbers in.</summary>
/// <remarks>
/// The chart plots one data field at a time, so there is only ever one value axis: its
/// categories are the outermost row groups and its series the outermost column groups (or the
/// data field itself when nothing is on the columns). The reader can switch the type and the
/// data field from the chart's own header.
/// </remarks>
public enum PivotChartType
{
    /// <summary>No chart.</summary>
    None,

    /// <summary>Vertical bars, one per series, side by side in each category.</summary>
    Column,

    /// <summary>Vertical bars with each category's series stacked into one.</summary>
    StackedColumn,

    /// <summary>Horizontal bars, for long category labels or many categories.</summary>
    Bar,

    /// <summary>One line per series, for categories in a meaningful order such as months.</summary>
    Line
}
