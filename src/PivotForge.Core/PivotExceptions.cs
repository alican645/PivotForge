namespace PivotForge.Core;

/// <summary>The exception thrown when a pivot request references a missing source field.</summary>
public sealed class PivotFieldNotFoundException : Exception
{
    /// <summary>Initializes an exception for the missing field.</summary>
    /// <param name="field">The missing source field name.</param>
    public PivotFieldNotFoundException(string field)
        : base($"Pivot field '{field}' was not found in the data source.")
    {
        Field = field;
    }

    /// <summary>Gets the missing source field name.</summary>
    public string Field { get; }
}

/// <summary>The exception thrown when an aggregation receives an incompatible source value.</summary>
public sealed class PivotFieldTypeException : Exception
{
    /// <summary>Initializes an exception for an incompatible field value.</summary>
    /// <param name="field">The source field name.</param>
    /// <param name="aggregation">The requested aggregation.</param>
    /// <param name="value">The incompatible source value.</param>
    public PivotFieldTypeException(string field, PivotAggregation aggregation, object? value)
        : base($"Pivot field '{field}' cannot be used with aggregation '{aggregation}' because value '{value}' is not numeric.")
    {
        Field = field;
        Aggregation = aggregation;
        Value = value;
    }

    /// <summary>Gets the source field name.</summary>
    public string Field { get; }

    /// <summary>Gets the requested aggregation.</summary>
    public PivotAggregation Aggregation { get; }

    /// <summary>Gets the incompatible source value.</summary>
    public object? Value { get; }
}
