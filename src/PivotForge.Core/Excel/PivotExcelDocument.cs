namespace PivotForge.Core.Excel;

/// <summary>Describes the content and layout of a pivot workbook.</summary>
public sealed class PivotExcelDocument
{
    /// <summary>Gets the title written above the worksheet data.</summary>
    public string Title { get; init; } = "Pivot Table";

    /// <summary>Gets the filter summary written above the worksheet data.</summary>
    public string FilterSummary { get; init; } = "No active filters";

    /// <summary>Gets the label placed before the filter summary.</summary>
    public string FilterLabel { get; init; } = "Filters";

    /// <summary>Gets the worksheet name.</summary>
    public string SheetName { get; init; } = "Pivot Table";

    /// <summary>Gets the number of data rows to freeze as headers.</summary>
    public int HeaderRowCount { get; init; }

    /// <summary>Gets the number of leading data columns to freeze.</summary>
    public int FrozenColumnCount { get; init; }

    /// <summary>Gets the worksheet data rows.</summary>
    public IReadOnlyList<PivotExcelRow> Rows { get; init; } = [];
}

/// <summary>Represents one logical row in a pivot workbook.</summary>
public sealed class PivotExcelRow
{
    /// <summary>Gets the ordered cells in the row.</summary>
    public IReadOnlyList<PivotExcelCell> Cells { get; init; } = [];
}

/// <summary>Represents a styled text or numeric workbook cell.</summary>
public sealed class PivotExcelCell
{
    /// <summary>Gets the displayed text for a non-numeric cell.</summary>
    public string Text { get; init; } = "";

    /// <summary>Gets the numeric value, when the cell is numeric.</summary>
    public decimal? Number { get; init; }

    /// <summary>Gets the number of rows occupied by the cell.</summary>
    public int RowSpan { get; init; } = 1;

    /// <summary>Gets the number of columns occupied by the cell.</summary>
    public int ColumnSpan { get; init; } = 1;

    /// <summary>Gets the preferred column width in pixels.</summary>
    public double Width { get; init; } = 118;

    /// <summary>Gets the optional Excel number format.</summary>
    public string? NumberFormat { get; init; }

    /// <summary>Gets the semantic cell role used for styling.</summary>
    public PivotExcelCellRole Role { get; init; } = PivotExcelCellRole.Value;

    /// <summary>Gets the optional highlight color.</summary>
    public PivotExcelHighlight Highlight { get; init; } = PivotExcelHighlight.None;
}

/// <summary>Specifies the semantic role used to style an exported cell.</summary>
public enum PivotExcelCellRole
{
    /// <summary>A regular data value.</summary>
    Value,
    /// <summary>A column header.</summary>
    Header,
    /// <summary>A row header.</summary>
    RowHeader,
    /// <summary>A subtotal value.</summary>
    Subtotal,
    /// <summary>A row or column total.</summary>
    Total,
    /// <summary>A grand total.</summary>
    GrandTotal
}

/// <summary>Specifies the optional emphasis color applied to an exported cell.</summary>
public enum PivotExcelHighlight
{
    /// <summary>No highlight.</summary>
    None,
    /// <summary>Green highlight.</summary>
    Green,
    /// <summary>Amber highlight.</summary>
    Amber,
    /// <summary>Red highlight.</summary>
    Red,
    /// <summary>Blue highlight.</summary>
    Blue
}
