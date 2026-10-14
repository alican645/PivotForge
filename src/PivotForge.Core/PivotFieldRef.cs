using System.Text.Json.Serialization;
using PivotForge.Core.Json;

namespace PivotForge.Core;

/// <summary>Names one header level: a source field, optionally collapsed to a date interval or a numeric range.</summary>
/// <remarks>
/// A field name alone cannot identify a level once the same column appears twice — which is
/// exactly what a year/quarter/month hierarchy is — so an axis is a list of these rather than a
/// list of names. A plain field converts from its own name, so <c>Rows = ["Region"]</c> keeps
/// meaning what it always did.
/// </remarks>
/// <param name="Field">The source field name.</param>
/// <param name="Interval">How the field's values are collapsed into groups.</param>
/// <param name="BinSize">The width of each range when <paramref name="Interval"/> is
/// <see cref="PivotGroupInterval.Range"/>; required there, and unused otherwise.</param>
[JsonConverter(typeof(PivotFieldRefJsonConverter))]
public sealed record PivotFieldRef(
    string Field,
    PivotGroupInterval Interval = PivotGroupInterval.None,
    decimal? BinSize = null)
{
    /// <summary>Gets the identity of this level across the request, the wire and the browser.</summary>
    /// <remarks>
    /// A plain field is its own key, so nothing that already exists changes shape. A grouped one
    /// is <c>Field:interval</c> — the same spelling the browser sends — which is what lets a sort,
    /// a filter or a drill-down name one level of a field that occupies several. A range carries
    /// its width, <c>Amount:range100</c>, so two widths of one field are two levels.
    /// </remarks>
    public string Key => Interval switch
    {
        PivotGroupInterval.None => Field,
        PivotGroupInterval.Range => $"{Field}:range{FormatBinSize(BinSize)}",
        _ => $"{Field}:{Interval.ToString().ToLowerInvariant()}"
    };

    /// <summary>Writes a range width the way the browser does: no trailing zeros, invariant.</summary>
    internal static string FormatBinSize(decimal? binSize) =>
        binSize?.ToString("0.############################", System.Globalization.CultureInfo.InvariantCulture) ?? "";

    /// <summary>Converts a field name to an ungrouped level.</summary>
    /// <param name="field">The source field name.</param>
    public static implicit operator PivotFieldRef(string field) => new(field);

    /// <summary>Returns the level's key.</summary>
    /// <returns>The value of <see cref="Key"/>.</returns>
    public override string ToString() => Key;
}
