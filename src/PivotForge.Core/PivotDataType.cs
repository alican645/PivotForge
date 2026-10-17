namespace PivotForge.Core;

/// <summary>Specifies the type a source field's values are converted to when they are read.</summary>
/// <remarks>
/// A source that carries everything as text -- a CSV import, a loosely typed JSON feed, a
/// <c>DataTable</c> of strings -- cannot be summed, ordered by number or grouped by date as it
/// stands. Declaring the type converts each value where it is read, so aggregation, grouping,
/// filters, the value picker, drill-down and ordering all see the same converted value. A value
/// that does not convert is blank, the way DevExtreme reads <c>Number("abc")</c>.
/// </remarks>
public enum PivotDataType
{
    /// <summary>No conversion: the value is used as the source holds it.</summary>
    Auto,

    /// <summary>The value's invariant text, so a numeric code orders and groups as text.</summary>
    String,

    /// <summary>A number; text is read invariantly first, then in the engine's culture.</summary>
    Number,

    /// <summary>A date; text is read in the engine's culture first, then invariantly.</summary>
    Date
}
