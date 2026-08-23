namespace PivotForge.Core;

/// <summary>Defines row ordering for a pivot request.</summary>
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
/// </remarks>
/// <param name="Field">The row or column field whose level is ordered.</param>
/// <param name="Direction">The sort direction applied to that level.</param>
public sealed record PivotFieldSort(string Field, PivotSortDirection Direction);

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
