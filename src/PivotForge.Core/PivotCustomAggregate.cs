namespace PivotForge.Core;

/// <summary>Summarizes the values of one field in one cell.</summary>
/// <param name="values">The cell's non-null values, in source order; never empty.</param>
/// <returns>The summary, or null to leave the cell empty.</returns>
/// <remarks>
/// Registered on <see cref="PivotEngine.CustomAggregates"/> under a name, and used in a
/// calculated field's formula like a built-in summary: <c>Median([Amount])</c>. A cell with no
/// values is left empty without calling the function.
/// </remarks>
public delegate decimal? PivotCustomAggregate(IReadOnlyList<decimal> values);
