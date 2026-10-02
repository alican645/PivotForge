namespace PivotForge.Core;

/// <summary>Defines row ordering for a pivot request.</summary>
/// <remarks>
/// A value sort orders every row level by that value, each inside its parent group, so the
/// hierarchy survives: the largest region first, and inside it the largest product first.
/// </remarks>
/// <param name="Mode">The value used to order rows.</param>
/// <param name="Direction">The sort direction.</param>
/// <param name="Field">The row field used for label sorting.</param>
/// <param name="ValueKey">The value definition key used for value sorting.</param>
/// <param name="ColumnPath">The optional column path whose value is used for sorting.</param>
public sealed record PivotSort(
    PivotSortMode Mode,
    PivotSortDirection Direction,
    string? Field = null,
    string? ValueKey = null,
    IReadOnlyList<string?>? ColumnPath = null)
{
    /// <summary>Creates a sort by a row field label.</summary>
    /// <param name="field">The row field name.</param>
    /// <param name="direction">The sort direction.</param>
    /// <returns>A row-label sort definition.</returns>
    public static PivotSort RowLabel(string field, PivotSortDirection direction) =>
        new(PivotSortMode.RowLabel, direction, Field: field);

    /// <summary>Creates a sort by the total of a value definition.</summary>
    /// <param name="valueKey">The value definition key.</param>
    /// <param name="direction">The sort direction.</param>
    /// <returns>A row-total sort definition.</returns>
    public static PivotSort RowTotal(string valueKey, PivotSortDirection direction) =>
        new(PivotSortMode.RowTotalValue, direction, ValueKey: valueKey);

    /// <summary>Creates a sort by a value at a specific column path.</summary>
    /// <remarks>A path shorter than the column axis names that group's subtotal column.</remarks>
    /// <param name="valueKey">The value definition key.</param>
    /// <param name="columnPath">The column path to inspect.</param>
    /// <param name="direction">The sort direction.</param>
    /// <returns>A column-value sort definition.</returns>
    public static PivotSort RowColumnValue(
        string valueKey,
        IReadOnlyList<string?> columnPath,
        PivotSortDirection direction) =>
        new(PivotSortMode.RowTotalValue, direction, ValueKey: valueKey, ColumnPath: columnPath);
}

/// <summary>Defines the ordering of one row or column field's own header level.</summary>
/// <remarks>
/// Unlike <see cref="PivotSort"/>, which orders the whole row axis by one criterion, this orders a
/// single level within its parent group, so the hierarchy stays intact. Levels left undeclared keep
/// the engine's default: ascending on the row axis, discovery order on the column axis.
/// <para>
/// With a <paramref name="ValueKey"/>, a level orders its groups by that value's summary instead
/// of their labels (DevExpress <c>sortBySummaryField</c>): an inner level by its subtotal, the
/// deepest level by its total, both as shown after <see cref="PivotShowAs"/>. This works on the
/// row and the column axis alike. A group with no value sorts last in either direction; equal
/// values break on the label, ascending on the row axis and in the level's label order on the
/// column axis. A key that is not among the request's values leaves the level in
/// label order.
/// </para>
/// <para>
/// <paramref name="SummaryPath"/> picks which summary on the other axis is compared (DevExpress
/// <c>sortBySummaryPath</c>): for a row level, a column header path; for a column level, a row
/// header path. A full path names one column or row, a shorter one names its subtotal, and null
/// or empty names the grand total. A path matching nothing leaves every group without a value,
/// so the tie-break above decides.
/// </para>
/// </remarks>
/// <param name="Field">The row or column field whose level is ordered.</param>
/// <param name="Direction">The sort direction applied to that level.</param>
/// <param name="ValueKey">
/// The <see cref="PivotValueDefinition.Key"/> whose summary orders the level, or null to order it
/// by label.
/// </param>
/// <param name="SummaryPath">
/// The header path on the other axis whose summary is compared, or null for the grand total.
/// </param>
public sealed record PivotFieldSort(
    string Field,
    PivotSortDirection Direction,
    string? ValueKey = null,
    IReadOnlyList<string?>? SummaryPath = null);

/// <summary>Specifies the source used to order pivot rows.</summary>
public enum PivotSortMode
{
    /// <summary>Orders rows by a row field label.</summary>
    RowLabel,
    /// <summary>Orders rows by an aggregated value.</summary>
    RowTotalValue
}

/// <summary>Specifies the direction of a pivot sort.</summary>
public enum PivotSortDirection
{
    /// <summary>Orders values from lowest to highest.</summary>
    Ascending,
    /// <summary>Orders values from highest to lowest.</summary>
    Descending
}
