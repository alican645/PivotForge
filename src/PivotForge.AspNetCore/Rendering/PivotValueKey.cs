using PivotForge.Core;

namespace PivotForge.AspNetCore.Rendering;

/// <summary>Builds the key a pivot result uses for a data field's cells and totals.</summary>
/// <remarks>
/// The browser builds the same key in PivotRequestBuilder.valueKey. Anything that has
/// to name a value — a sort by total, a conditional rule — needs it, and computing it
/// here saves a view author from spelling out the convention by hand.
/// </remarks>
public static class PivotValueKey
{
    /// <summary>Builds the value key for a data field.</summary>
    /// <param name="dataField">The source field name.</param>
    /// <param name="aggregation">The aggregation applied to it.</param>
    /// <returns>The value key, such as <c>Amount_sum</c>.</returns>
    /// <exception cref="ArgumentException">The field name is null or blank.</exception>
    public static string For(string dataField, PivotAggregation aggregation)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(dataField);
        return $"{dataField}_{aggregation.ToString().ToLowerInvariant()}";
    }
}
