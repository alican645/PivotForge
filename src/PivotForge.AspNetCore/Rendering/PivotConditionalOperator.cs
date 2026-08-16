namespace PivotForge.AspNetCore.Rendering;

/// <summary>How a conditional formatting rule compares a cell value.</summary>
public enum PivotConditionalOperator
{
    /// <summary>The value is greater than the threshold.</summary>
    GreaterThan,

    /// <summary>The value is greater than or equal to the threshold.</summary>
    GreaterThanOrEqual,

    /// <summary>The value is less than the threshold.</summary>
    LessThan,

    /// <summary>The value is less than or equal to the threshold.</summary>
    LessThanOrEqual,

    /// <summary>The value equals the threshold.</summary>
    Equal,

    /// <summary>The value falls between the two thresholds, inclusive.</summary>
    Between
}
