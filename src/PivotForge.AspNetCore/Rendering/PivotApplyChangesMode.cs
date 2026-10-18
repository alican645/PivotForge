namespace PivotForge.AspNetCore.Rendering;

/// <summary>When a field chooser's edits reach the grid, DevExtreme's <c>applyChangesMode</c>.</summary>
public enum PivotApplyChangesMode
{
    /// <summary>Each edit is applied as it is made.</summary>
    Instantly,

    /// <summary>Edits wait for OK; Cancel puts the layout back as the chooser found it.</summary>
    OnDemand
}
