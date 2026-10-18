namespace PivotForge.AspNetCore.Rendering;

/// <summary>How a field chooser arranges its field list and the four zones, DevExtreme's <c>layout</c>.</summary>
public enum PivotFieldChooserLayout
{
    /// <summary>The field list beside the rows and columns, the filters and values below (layout 0).</summary>
    ListBesideRowsAndColumns = 0,

    /// <summary>The field list beside the four zones, stacked (layout 1).</summary>
    ListBesideAllZones = 1,

    /// <summary>The field list across the top, the zones in two rows under it (layout 2).</summary>
    ListOnTop = 2
}
