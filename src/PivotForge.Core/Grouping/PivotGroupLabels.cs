using System.Globalization;

namespace PivotForge.Core.Grouping;

/// <summary>Turns a source value into a group header, and orders those headers.</summary>
/// <remarks>
/// Labelling and ordering are one subject rather than two: a month reads as a name and sorts as a
/// number, and separating the two is how a pivot ends up listing April before August. Everything
/// here resolves against a supplied culture, which the engine takes from the request.
/// </remarks>
internal static class PivotGroupLabels
{
    /// <summary>Converts a raw source value into the header text for an interval.</summary>
    /// <param name="value">The raw source value.</param>
    /// <param name="interval">The interval to collapse it to.</param>
    /// <param name="culture">The culture naming months and weekdays.</param>
    /// <returns>The header text, or the value's own text when it is not a date.</returns>
    public static string? Label(object? value, PivotGroupInterval interval, CultureInfo culture)
    {
        var text = Convert.ToString(value, CultureInfo.InvariantCulture);

        if (interval == PivotGroupInterval.None || string.IsNullOrEmpty(text))
        {
            return text;
        }

        if (!TryConvertToDate(value, culture, out var date))
        {
            // Left as it stands rather than folded into the blank group: a column
            // that is not a date under a date interval is a configuration mistake,
            // and it is one the reader can see only if the value survives.
            return text;
        }

        return interval switch
        {
            PivotGroupInterval.Year => date.Year.ToString(CultureInfo.InvariantCulture),
            PivotGroupInterval.Quarter => $"Q{(date.Month - 1) / 3 + 1}",
            PivotGroupInterval.Month => culture.DateTimeFormat.GetMonthName(date.Month),
            PivotGroupInterval.Day => date.Day.ToString(CultureInfo.InvariantCulture),
            PivotGroupInterval.DayOfWeek => culture.DateTimeFormat.GetDayName(date.DayOfWeek),
            _ => text
        };
    }

    /// <summary>Returns the order the headers of an interval belong in.</summary>
    /// <param name="interval">The interval whose headers are being ordered.</param>
    /// <param name="culture">The culture naming months and weekdays, and its first weekday.</param>
    /// <returns>A comparer, or null when the interval carries no order of its own.</returns>
    public static IComparer<string?>? Order(PivotGroupInterval interval, CultureInfo culture)
    {
        return interval switch
        {
            PivotGroupInterval.None => null,
            // Numeric text, so its own value orders it -- "10" after "9", which is
            // the one thing text ordering gets wrong here.
            PivotGroupInterval.Year or PivotGroupInterval.Day => new OrdinalComparer(
                label => int.TryParse(label, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number)
                    ? number
                    : null),
            PivotGroupInterval.Quarter => new OrdinalComparer(
                label => label is { Length: 2 } && label[0] == 'Q' && char.IsDigit(label[1])
                    ? label[1] - '0'
                    : null),
            PivotGroupInterval.Month => FromNames(
                Enumerable.Range(1, 12).Select(culture.DateTimeFormat.GetMonthName), culture),
            PivotGroupInterval.DayOfWeek => FromNames(WeekdayNames(culture), culture),
            _ => null
        };
    }

    /// <summary>The weekday names in the order the culture's week runs.</summary>
    private static IEnumerable<string> WeekdayNames(CultureInfo culture)
    {
        var first = (int)culture.DateTimeFormat.FirstDayOfWeek;

        return Enumerable.Range(0, 7)
            .Select(offset => culture.DateTimeFormat.GetDayName((DayOfWeek)((first + offset) % 7)));
    }

    private static IComparer<string?> FromNames(IEnumerable<string> names, CultureInfo culture)
    {
        var order = new Dictionary<string, int>(StringComparer.Create(culture, ignoreCase: true));

        foreach (var (name, index) in names.Select((name, index) => (name, index)))
        {
            order.TryAdd(name, index);
        }

        return new OrdinalComparer(label =>
            label is not null && order.TryGetValue(label, out var index) ? index : null);
    }

    private static bool TryConvertToDate(object? value, CultureInfo culture, out DateTime date)
    {
        switch (value)
        {
            case DateTime typed:
                date = typed;
                return true;
            case DateTimeOffset typed:
                date = typed.DateTime;
                return true;
            case DateOnly typed:
                date = typed.ToDateTime(TimeOnly.MinValue);
                return true;
        }

        var text = Convert.ToString(value, CultureInfo.InvariantCulture);
        if (string.IsNullOrEmpty(text))
        {
            date = default;
            return false;
        }

        // The reader's culture first, because that is how a text column written by
        // this application reads; invariant second, because that is how one written
        // by a serializer reads.
        return DateTime.TryParse(text, culture, DateTimeStyles.None, out date) ||
            DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.None, out date);
    }

    /// <summary>Orders labels by a number derived from each, leaving unknown labels last.</summary>
    /// <remarks>
    /// A label with no number behind it is a value that was not a date. It sorts after every
    /// group rather than among them, so a stray value is visible at the end instead of splitting
    /// the sequence it does not belong to.
    /// </remarks>
    private sealed class OrdinalComparer(Func<string?, int?> ordinalOf) : IComparer<string?>
    {
        public int Compare(string? left, string? right)
        {
            var leftOrdinal = ordinalOf(left);
            var rightOrdinal = ordinalOf(right);

            if (leftOrdinal is { } first && rightOrdinal is { } second)
            {
                return first.CompareTo(second);
            }

            if (leftOrdinal is null && rightOrdinal is null)
            {
                return string.CompareOrdinal(left, right);
            }

            return leftOrdinal is null ? 1 : -1;
        }
    }
}
