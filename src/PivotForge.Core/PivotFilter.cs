namespace PivotForge.Core;

/// <summary>Restricts a source field to a set of accepted values.</summary>
/// <param name="Field">The source field name.</param>
/// <param name="Values">The accepted display values. A null source value is compared as the
/// empty string, so <c>""</c> — not <c>null</c> — is the entry that accepts blanks.</param>
public sealed record PivotFilter(string Field, IReadOnlyList<string?> Values);
