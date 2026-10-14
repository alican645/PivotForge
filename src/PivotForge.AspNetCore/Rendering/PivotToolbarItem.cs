namespace PivotForge.AspNetCore.Rendering;

/// <summary>A button on the grid's toolbar.</summary>
public enum PivotToolbarItem
{
    /// <summary>Downloads the grid as an Excel workbook. Shown only when Excel export is allowed.</summary>
    Excel,

    /// <summary>Downloads the grid as a CSV file.</summary>
    Csv,

    /// <summary>Prints the grid alone; the browser's "Save as PDF" makes a PDF of it.</summary>
    Print,

    /// <summary>Opens every collapsed group.</summary>
    ExpandAll,

    /// <summary>Collapses every group.</summary>
    CollapseAll,

    /// <summary>
    /// Downloads the current view -- layout, filters, sorts and conditional rules -- as a JSON
    /// report file.
    /// </summary>
    SaveReport,

    /// <summary>Opens a report file saved with <see cref="SaveReport"/> and shows its view.</summary>
    OpenReport,

    /// <summary>Lets the grid and its toolbar fill the browser window; Escape or the button leaves it.</summary>
    Fullscreen,

    /// <summary>
    /// Shows or hides the grid's chart, keeping the choice with the view. Shown only when the grid
    /// has a chart; see <see cref="PivotGridBuilder.Chart"/>.
    /// </summary>
    Chart
}
