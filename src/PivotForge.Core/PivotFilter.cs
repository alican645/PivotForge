namespace PivotForge.Core;

/// <summary>Restricts a source field to a set of accepted values.</summary>
/// <param name="Field">The source field name.</param>
/// <param name="Values">The accepted display values, including an optional null value.</param>
public sealed record PivotFilter(string Field, IReadOnlyList<string?> Values);
