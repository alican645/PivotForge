namespace PivotForge.AspNetCore.Rendering;

/// <summary>Specifies where a field is placed in a pivot grid layout.</summary>
public enum PivotArea
{
    /// <summary>Places the field on the row axis.</summary>
    Row,
    /// <summary>Places the field on the column axis.</summary>
    Column,
    /// <summary>Aggregates the field as a pivot value.</summary>
    Data,
    /// <summary>Exposes the field for filtering without placing it in the layout.</summary>
    Filter,
    /// <summary>Offers the field in the designer's catalog without placing it in the layout.</summary>
    Available
}
