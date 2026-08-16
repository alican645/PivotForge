namespace PivotForge.AspNetCore.Rendering;

/// <summary>How the browser grid responds to a click on a cell.</summary>
public enum PivotSelectionMode
{
    /// <summary>A click selects the cell it lands on.</summary>
    Single,

    /// <summary>Cells cannot be selected.</summary>
    None
}
