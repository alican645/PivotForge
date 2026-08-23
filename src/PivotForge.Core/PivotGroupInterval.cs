namespace PivotForge.Core;

/// <summary>Specifies how a date field's values are collapsed into header groups.</summary>
/// <remarks>
/// Grouping happens where the header value is read, so it costs one pass and no extra source
/// column: a single order-date column can carry a year level, a quarter level and a month level
/// at once. Every interval except <see cref="None"/> requires a value that converts to a date;
/// one that does not is left as its own text, so an odd value stays visible rather than
/// disappearing into a blank group.
/// </remarks>
public enum PivotGroupInterval
{
    /// <summary>No grouping: the value's own text is the header.</summary>
    None,

    /// <summary>The four-digit year.</summary>
    Year,

    /// <summary>The calendar quarter, as <c>Q1</c> through <c>Q4</c>.</summary>
    Quarter,

    /// <summary>The month name in the resolved culture.</summary>
    Month,

    /// <summary>The day of the month, as a number.</summary>
    Day,

    /// <summary>The weekday name in the resolved culture, ordered from that culture's first day.</summary>
    DayOfWeek
}
