namespace PivotForge.AspNetCore.Rendering;

/// <summary>How a data field writes a negative number.</summary>
public enum PivotNegativeFormat
{
    /// <summary>With a minus sign, as the culture writes it: -1.250.</summary>
    Minus,

    /// <summary>In parentheses, as accounts write it: (1.250).</summary>
    Parentheses
}
