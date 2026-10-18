namespace PivotForge.AspNetCore.Rendering;

/// <summary>How the grid's Excel and CSV exports lay out their headers, DevExtreme's
/// <c>exportPivotGrid</c> options.</summary>
/// <remarks>
/// The field header rows go above the table: the filter fields across the whole width, then the
/// data fields over the row headers and the column fields over the column headers, each field in a
/// cell of its own while there is room. They are bold, bordered and freeze with the table's head.
/// </remarks>
public sealed record PivotExcelExportOptions
{
    /// <summary>Gets whether a row naming the filter fields goes above the table.</summary>
    public bool ExportFilterFieldHeaders { get; init; }

    /// <summary>Gets whether the data fields are named above the row headers.</summary>
    public bool ExportDataFieldHeaders { get; init; }

    /// <summary>Gets whether the column fields are named above the column headers. A grid whose
    /// corner already names them -- one with sorting or filtering on its columns -- is not given a second row.</summary>
    public bool ExportColumnFieldHeaders { get; init; }

    /// <summary>Gets whether the corner names the row fields, as it does on screen. Unlike
    /// DevExtreme, whose corner is blank unless asked, true is the default here, so an export
    /// shows what the grid does.</summary>
    public bool ExportRowFieldHeaders { get; init; } = true;

    /// <summary>Gets whether a row header spanning several rows is one merged cell; false writes it into each.</summary>
    public bool MergeRowFieldValues { get; init; } = true;

    /// <summary>Gets whether a column header spanning several columns is one merged cell; false writes it into each.</summary>
    public bool MergeColumnFieldValues { get; init; } = true;
}
