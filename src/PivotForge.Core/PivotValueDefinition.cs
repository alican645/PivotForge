namespace PivotForge.Core;

/// <summary>Defines an aggregated value in a pivot request.</summary>
/// <param name="Field">The source field to aggregate.</param>
/// <param name="Aggregation">The aggregation to apply.</param>
public sealed record PivotValueDefinition(string Field, PivotAggregation Aggregation)
{
    /// <summary>Gets the secondary calculation applied to the aggregated value.</summary>
    public PivotShowAs ShowAs { get; init; } = PivotShowAs.Normal;

    /// <summary>Gets the stable key used to identify this value in pivot results.</summary>
    public string Key => $"{Field}_{Aggregation.ToString().ToLowerInvariant()}";

    /// <summary>Creates a sum value definition.</summary>
    /// <param name="field">The source field name.</param>
    /// <returns>A sum definition.</returns>
    public static PivotValueDefinition Sum(string field) => new(field, PivotAggregation.Sum);

    /// <summary>Creates a count value definition.</summary>
    /// <param name="field">The source field name.</param>
    /// <returns>A count definition.</returns>
    public static PivotValueDefinition Count(string field) => new(field, PivotAggregation.Count);

    /// <summary>Creates an average value definition.</summary>
    /// <param name="field">The source field name.</param>
    /// <returns>An average definition.</returns>
    public static PivotValueDefinition Average(string field) => new(field, PivotAggregation.Average);

    /// <summary>Creates a minimum value definition.</summary>
    /// <param name="field">The source field name.</param>
    /// <returns>A minimum definition.</returns>
    public static PivotValueDefinition Min(string field) => new(field, PivotAggregation.Min);

    /// <summary>Creates a maximum value definition.</summary>
    /// <param name="field">The source field name.</param>
    /// <returns>A maximum definition.</returns>
    public static PivotValueDefinition Max(string field) => new(field, PivotAggregation.Max);

    /// <summary>Returns a copy configured with a secondary calculation.</summary>
    /// <param name="showAs">The secondary calculation.</param>
    /// <returns>The updated value definition.</returns>
    public PivotValueDefinition As(PivotShowAs showAs) => this with { ShowAs = showAs };
}
