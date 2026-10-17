namespace PivotForge.AspNetCore.Rendering;

/// <summary>Which axis several values are drawn along.</summary>
public enum PivotValuesPosition
{
    /// <summary>A block of value columns under every column header.</summary>
    Columns,

    /// <summary>
    /// One row per value under every row header, named in a values column after the row headers.
    /// DevExtreme's <c>dataFieldArea: "row"</c>. With a single value nothing changes, since a single
    /// value has no header of its own.
    /// </summary>
    Rows
}
