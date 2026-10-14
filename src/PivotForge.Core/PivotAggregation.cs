namespace PivotForge.Core;

/// <summary>Specifies how source values are aggregated.</summary>
public enum PivotAggregation
{
    /// <summary>Adds numeric values.</summary>
    Sum,
    /// <summary>Counts source records.</summary>
    Count,
    /// <summary>Calculates the arithmetic mean of numeric values.</summary>
    Average,
    /// <summary>Returns the smallest numeric value.</summary>
    Min,
    /// <summary>Returns the largest numeric value.</summary>
    Max,
    /// <summary>Evaluates a formula over other summaries; see <see cref="PivotValueDefinition.Expression"/>.</summary>
    Calculated,
    // The ones below come after Calculated so the numbers the earlier members already have stay put.
    /// <summary>Counts the distinct non-empty values. Works on any field, not only a numeric one.</summary>
    CountDistinct,
    /// <summary>Returns the middle numeric value, or the mean of the two middle ones.</summary>
    Median,
    /// <summary>Calculates the sample variance (n - 1), as Excel's <c>VAR.S</c>. Empty below two values.</summary>
    Variance,
    /// <summary>Calculates the sample standard deviation (n - 1), as Excel's <c>STDEV.S</c>. Empty below two values.</summary>
    StandardDeviation
}
