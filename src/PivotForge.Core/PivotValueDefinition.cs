namespace PivotForge.Core;

/// <summary>Defines an aggregated value in a pivot request.</summary>
/// <param name="Field">The source field to aggregate.</param>
/// <param name="Aggregation">The aggregation to apply.</param>
public sealed record PivotValueDefinition(string Field, PivotAggregation Aggregation)
{
    /// <summary>Gets the secondary calculation applied to the aggregated value.</summary>
    public PivotShowAs ShowAs { get; init; } = PivotShowAs.Normal;

    /// <summary>
    /// Gets whether <see cref="PivotShowAs.RunningTotal"/> and the comparisons with the previous
    /// column carry on across outer column groups (the default) or start afresh in each one.
    /// </summary>
    /// <remarks>
    /// With Year and Month on the columns, <see langword="true"/> runs one total from the first
    /// month to the last; <see langword="false"/> starts it again every January, and gives each
    /// January no previous month to compare with. A single column level is one group either way.
    /// </remarks>
    public bool AllowCrossGroupCalculation { get; init; } = true;

    /// <summary>Gets the direction this value's running total accumulates in, if any.</summary>
    /// <remarks>
    /// DevExtreme's <c>runningTotal</c>. Applied after <see cref="ShowAs"/> and after sorting, so
    /// <see cref="PivotShowAs.PercentOfParentRowTotal"/> with <see cref="PivotRunningTotal.Column"/>
    /// is a cumulative share. <see cref="PivotShowAs.RunningTotal"/> is the along-the-row case
    /// written as a display mode, kept for the requests that already say it that way.
    /// </remarks>
    public PivotRunningTotal RunningTotal { get; init; } = PivotRunningTotal.None;

    /// <summary>Gets the formula of a calculated value.</summary>
    /// <remarks>
    /// Set exactly when <see cref="Aggregation"/> is <see cref="PivotAggregation.Calculated"/>, and
    /// then <see cref="Field"/> is the calculated field's own name rather than a source field. See
    /// <see cref="PivotExpression"/> for what a formula may say.
    /// </remarks>
    public string? Expression { get; init; }

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

    /// <summary>Creates a distinct count value definition.</summary>
    /// <param name="field">The source field name.</param>
    /// <returns>A distinct count definition.</returns>
    public static PivotValueDefinition CountDistinct(string field) => new(field, PivotAggregation.CountDistinct);

    /// <summary>Creates a median value definition.</summary>
    /// <param name="field">The source field name.</param>
    /// <returns>A median definition.</returns>
    public static PivotValueDefinition Median(string field) => new(field, PivotAggregation.Median);

    /// <summary>Creates a sample variance value definition.</summary>
    /// <param name="field">The source field name.</param>
    /// <returns>A variance definition.</returns>
    public static PivotValueDefinition Variance(string field) => new(field, PivotAggregation.Variance);

    /// <summary>Creates a sample standard deviation value definition.</summary>
    /// <param name="field">The source field name.</param>
    /// <returns>A standard deviation definition.</returns>
    public static PivotValueDefinition StandardDeviation(string field) =>
        new(field, PivotAggregation.StandardDeviation);

    /// <summary>Creates a population variance value definition.</summary>
    /// <param name="field">The source field name.</param>
    /// <returns>A population variance definition.</returns>
    public static PivotValueDefinition VariancePopulation(string field) =>
        new(field, PivotAggregation.VariancePopulation);

    /// <summary>Creates a population standard deviation value definition.</summary>
    /// <param name="field">The source field name.</param>
    /// <returns>A population standard deviation definition.</returns>
    public static PivotValueDefinition StandardDeviationPopulation(string field) =>
        new(field, PivotAggregation.StandardDeviationPopulation);

    /// <summary>Creates a first-value definition: the first value in source order.</summary>
    /// <param name="field">The source field name.</param>
    /// <returns>A first-value definition.</returns>
    public static PivotValueDefinition First(string field) => new(field, PivotAggregation.First);

    /// <summary>Creates a last-value definition: the last value in source order.</summary>
    /// <param name="field">The source field name.</param>
    /// <returns>A last-value definition.</returns>
    public static PivotValueDefinition Last(string field) => new(field, PivotAggregation.Last);

    /// <summary>Creates a calculated value definition.</summary>
    /// <param name="name">The calculated field's name, which its key is built from.</param>
    /// <param name="expression">The formula, such as <c>[Revenue] - [Cost]</c>.</param>
    /// <returns>A calculated definition.</returns>
    public static PivotValueDefinition Calculated(string name, string expression) =>
        new(name, PivotAggregation.Calculated) { Expression = expression };

    /// <summary>Returns a copy configured with a secondary calculation.</summary>
    /// <param name="showAs">The secondary calculation.</param>
    /// <returns>The updated value definition.</returns>
    public PivotValueDefinition As(PivotShowAs showAs) => this with { ShowAs = showAs };
}
