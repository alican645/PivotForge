namespace PivotForge.AspNetCore.Rendering;

/// <summary>How a data field's values are formatted in the browser.</summary>
public enum PivotValueFormatType
{
    /// <summary>A plain number.</summary>
    Number,

    /// <summary>A currency amount, rendered with the configured currency code.</summary>
    Currency,

    /// <summary>A percentage.</summary>
    Percent
}
