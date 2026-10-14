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
    CollapseAll
}
