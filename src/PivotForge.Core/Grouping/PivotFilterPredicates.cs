using System.Globalization;

namespace PivotForge.Core.Grouping;

/// <summary>Decides whether one field value satisfies a filter's operator.</summary>
/// <remarks>
/// Everything is compared against the value's display text — the same string the header shows
/// and the value picker lists — so what a person selected is what the engine matches. Text
/// comparisons ignore case and collate in the resolved culture, because a filter is read by a
/// person rather than by a parser.
/// </remarks>
internal static class PivotFilterPredicates
{
    /// <summary>The number of arguments an operator needs before it restricts anything.</summary>
    /// <param name="op">The operator.</param>
    /// <returns>The minimum argument count.</returns>
    public static int ArgumentCount(PivotFilterOperator op) => op switch
    {
        PivotFilterOperator.Blank => 0,
        PivotFilterOperator.Between => 2,
        PivotFilterOperator.Equals => 1,
        _ => 1
    };

    /// <summary>Whether a value satisfies the operator, before the filter's mode is applied.</summary>
    /// <param name="value">The value's display text.</param>
    /// <param name="op">The operator.</param>
    /// <param name="arguments">The filter's values, read as the operator's arguments.</param>
    /// <param name="culture">The culture text is compared in.</param>
    /// <returns>True when the value satisfies the operator.</returns>
    public static bool Matches(
        string? value,
        PivotFilterOperator op,
        IReadOnlyList<string?> arguments,
        CultureInfo culture)
    {
        var text = value ?? "";

        return op switch
        {
            PivotFilterOperator.Equals => arguments.Contains(value, StringComparer.Ordinal),
            PivotFilterOperator.Contains => IndexOf(text, arguments[0], culture) >= 0,
            PivotFilterOperator.StartsWith =>
                culture.CompareInfo.IsPrefix(text, arguments[0] ?? "", CompareOptions.IgnoreCase),
            PivotFilterOperator.EndsWith =>
                culture.CompareInfo.IsSuffix(text, arguments[0] ?? "", CompareOptions.IgnoreCase),
            PivotFilterOperator.Between =>
                Compare(text, arguments[0], culture) >= 0 && Compare(text, arguments[1], culture) <= 0,
            PivotFilterOperator.GreaterThan => Compare(text, arguments[0], culture) > 0,
            PivotFilterOperator.LessThan => Compare(text, arguments[0], culture) < 0,
            PivotFilterOperator.Blank => text.Length == 0,
            _ => true
        };
    }

    private static int IndexOf(string text, string? argument, CultureInfo culture) =>
        culture.CompareInfo.IndexOf(text, argument ?? "", CompareOptions.IgnoreCase);

    /// <summary>Orders two display strings the way their underlying type would order.</summary>
    /// <remarks>
    /// A range over a number column has to compare as numbers — text order puts 100 above 20 —
    /// and a range over dates has to compare as dates. Both are read back from the display text
    /// in the invariant culture, which is what wrote it. Anything else collates as text, so a
    /// range over region names still means something.
    /// </remarks>
    private static int Compare(string text, string? argument, CultureInfo culture)
    {
        var other = argument ?? "";

        if (decimal.TryParse(text, NumberStyles.Any, CultureInfo.InvariantCulture, out var left) &&
            decimal.TryParse(other, NumberStyles.Any, CultureInfo.InvariantCulture, out var right))
        {
            return left.CompareTo(right);
        }

        if (DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.None, out var leftDate) &&
            DateTime.TryParse(other, CultureInfo.InvariantCulture, DateTimeStyles.None, out var rightDate))
        {
            return leftDate.CompareTo(rightDate);
        }

        return string.Compare(text, other, culture, CompareOptions.IgnoreCase);
    }
}
