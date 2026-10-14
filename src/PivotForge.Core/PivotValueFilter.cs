namespace PivotForge.Core;

/// <summary>Keeps the row groups of one level whose summary value meets a condition.</summary>
/// <remarks>
/// Like <see cref="PivotTopN"/>, and unlike <see cref="PivotFilter"/>, this runs after aggregation:
/// "regions whose sales exceed 10,000" asks about a total that does not exist until the records
/// have been summed. The groups it drops leave the result entirely, totals included, so every
/// total still adds up to the rows on screen.
/// <para>
/// A group with no value meets no condition and is dropped. When a level also carries a
/// <see cref="PivotTopN"/>, the ranking is taken among the groups this filter keeps.
/// </para>
/// </remarks>
/// <param name="Field">The row field, or <c>field:interval</c> level key, being filtered.</param>
/// <param name="Operator">How each group's value is compared.</param>
/// <param name="Value">The value compared against; the lower bound for a range.</param>
/// <param name="Value2">The upper bound for <see cref="PivotValueFilterOperator.Between"/> and
/// <see cref="PivotValueFilterOperator.NotBetween"/>; unused otherwise.</param>
/// <param name="ValueKey">
/// The <see cref="PivotValueDefinition.Key"/> whose value is compared. When null the first
/// declared value is used.
/// </param>
public sealed record PivotValueFilter(
    string Field,
    PivotValueFilterOperator Operator,
    decimal Value,
    decimal? Value2 = null,
    string? ValueKey = null)
{
    /// <summary>Returns whether a group's value meets this filter's condition.</summary>
    /// <param name="value">The group's summary value, or null when it has none.</param>
    /// <returns>True when the group is kept.</returns>
    public bool Keeps(decimal? value)
    {
        if (value is not { } actual)
        {
            return false;
        }

        var low = Math.Min(Value, Value2 ?? Value);
        var high = Math.Max(Value, Value2 ?? Value);

        return Operator switch
        {
            PivotValueFilterOperator.GreaterThan => actual > Value,
            PivotValueFilterOperator.GreaterThanOrEqual => actual >= Value,
            PivotValueFilterOperator.LessThan => actual < Value,
            PivotValueFilterOperator.LessThanOrEqual => actual <= Value,
            PivotValueFilterOperator.Equal => actual == Value,
            PivotValueFilterOperator.NotEqual => actual != Value,
            PivotValueFilterOperator.Between => actual >= low && actual <= high,
            PivotValueFilterOperator.NotBetween => actual < low || actual > high,
            _ => throw new InvalidOperationException($"Unsupported value filter operator '{Operator}'.")
        };
    }
}

/// <summary>How a <see cref="PivotValueFilter"/> compares a group's value.</summary>
public enum PivotValueFilterOperator
{
    /// <summary>Keeps values greater than <see cref="PivotValueFilter.Value"/>.</summary>
    GreaterThan,

    /// <summary>Keeps values greater than or equal to <see cref="PivotValueFilter.Value"/>.</summary>
    GreaterThanOrEqual,

    /// <summary>Keeps values less than <see cref="PivotValueFilter.Value"/>.</summary>
    LessThan,

    /// <summary>Keeps values less than or equal to <see cref="PivotValueFilter.Value"/>.</summary>
    LessThanOrEqual,

    /// <summary>Keeps values equal to <see cref="PivotValueFilter.Value"/>.</summary>
    Equal,

    /// <summary>Keeps values other than <see cref="PivotValueFilter.Value"/>.</summary>
    NotEqual,

    /// <summary>Keeps values from <see cref="PivotValueFilter.Value"/> to <see cref="PivotValueFilter.Value2"/>, both included.</summary>
    Between,

    /// <summary>Keeps values outside the range from <see cref="PivotValueFilter.Value"/> to <see cref="PivotValueFilter.Value2"/>.</summary>
    NotBetween
}
