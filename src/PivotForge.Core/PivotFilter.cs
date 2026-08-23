namespace PivotForge.Core;

/// <summary>Restricts a source field to, or away from, a set of values.</summary>
/// <param name="Field">The source field name.</param>
/// <param name="Values">The listed display values. A null source value is compared as the
/// empty string, so <c>""</c> — not <c>null</c> — is the entry that matches blanks. An empty
/// list restricts nothing, in either mode.</param>
/// <param name="Mode">Whether the listed values are the ones kept or the ones dropped.</param>
/// <param name="Interval">The date interval the listed values are groups of. A filter set from a
/// grouped header lists group labels — month names rather than dates — so it has to collapse the
/// source value the same way the header did before comparing.</param>
public sealed record PivotFilter(
    string Field,
    IReadOnlyList<string?> Values,
    PivotFilterMode Mode = PivotFilterMode.Include,
    PivotGroupInterval Interval = PivotGroupInterval.None);

/// <summary>Specifies how a filter's listed values are applied.</summary>
/// <remarks>
/// The two differ only in what happens to a value the list does not mention — which is every
/// value the source gains after the filter was set. Include keeps a fixed set, so a new value
/// arrives hidden; Exclude drops a fixed set, so a new value arrives visible.
/// </remarks>
public enum PivotFilterMode
{
    /// <summary>Keeps only the listed values.</summary>
    Include,
    /// <summary>Keeps everything except the listed values.</summary>
    Exclude
}
