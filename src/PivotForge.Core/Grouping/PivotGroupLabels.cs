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
    /// <param name="culture">The culture naming months and weekdays, and writing range bounds.</param>
    /// <param name="binSize">The width of a <see cref="PivotGroupInterval.Range"/>.</param>
    /// <returns>The header text, or the value's own text when it is not a date, or not a number
    /// for a range.</returns>
    public static string? Label(object? value, PivotGroupInterval interval, CultureInfo culture, decimal? binSize = null)
    {
        var text = Convert.ToString(value, CultureInfo.InvariantCulture);

        if (interval == PivotGroupInterval.None || string.IsNullOrEmpty(text))
        {
            return text;
        }

        if (interval == PivotGroupInterval.Range)
        {
            return binSize is > 0m && TryConvertToDecimal(value, out var number)
                ? RangeLabel(number, binSize.Value, culture)
                : text;
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
            // By where each range starts, which is the number before the dash.
            PivotGroupInterval.Range => new NumberComparer(label => RangeStart(label, culture)),
            _ => null
        };
    }

    /// <summary>Returns the order the labels of a typed field belong in.</summary>
    /// <param name="type">The field's declared type.</param>
    /// <param name="culture">The culture a date label is read in.</param>
    /// <returns>A comparer, or null when the type orders as text.</returns>
    /// <remarks>A number is labelled with its invariant text and a date with its invariant date
    /// text, so the label reads back as the value it came from. A blank or unreadable label goes
    /// last.</remarks>
    public static IComparer<string?>? Order(PivotDataType type, CultureInfo culture) => type switch
    {
        PivotDataType.Number => new NumberComparer(label =>
            decimal.TryParse(label, NumberStyles.Number | NumberStyles.AllowExponent, CultureInfo.InvariantCulture, out var number)
                ? number
                : null),
        // Invariant first: a date label is the value's invariant text, which the reader's
        // culture can misread -- "03/04/2026" is the 4th of March, not the 3rd of April.
        PivotDataType.Date => new NumberComparer(label =>
            !string.IsNullOrEmpty(label) &&
            (DateTime.TryParse(label, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) ||
             TryConvertToDate(label, culture, out date))
                ? date.Ticks
                : null),
        _ => null
    };

    // The separator between a range's bounds: an en dash with a space either side,
    // which a minus sign on either bound can never be mistaken for.
    private const string RangeSeparator = " – ";

    private static string RangeLabel(decimal value, decimal binSize, CultureInfo culture)
    {
        var start = Math.Floor(value / binSize) * binSize;
        return $"{FormatBound(start, culture)}{RangeSeparator}{FormatBound(start + binSize, culture)}";
    }

    private static string FormatBound(decimal bound, CultureInfo culture) =>
        bound.ToString("#,0.############", culture);

    private static decimal? RangeStart(string? label, CultureInfo culture)
    {
        var separator = label?.IndexOf(RangeSeparator, StringComparison.Ordinal) ?? -1;

        return separator > 0 &&
            decimal.TryParse(label![..separator], NumberStyles.Number, culture, out var start)
                ? start
                : null;
    }

    private static bool TryConvertToDecimal(object? value, out decimal number)
    {
        switch (value)
        {
            case decimal typed:
                number = typed;
                return true;
            // Past decimal's range a double has no decimal to be; it is left as its text.
            case double typed when double.IsFinite(typed) && Math.Abs(typed) < 7.9e28:
                number = (decimal)typed;
                return true;
            case float typed when float.IsFinite(typed) && Math.Abs(typed) < 7.9e28f:
                number = (decimal)typed;
                return true;
            case double or float:
                number = default;
                return false;
            case byte or sbyte or short or ushort or int or uint or long or ulong:
                number = Convert.ToDecimal(value, CultureInfo.InvariantCulture);
                return true;
        }

        return decimal.TryParse(
            Convert.ToString(value, CultureInfo.InvariantCulture),
            NumberStyles.Number,
            CultureInfo.InvariantCulture,
            out number);
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

    internal static bool TryConvertToDate(object? value, CultureInfo culture, out DateTime date)
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

    /// <summary>Orders labels by a decimal derived from each, leaving unknown labels last.</summary>
    private sealed class NumberComparer(Func<string?, decimal?> numberOf) : IComparer<string?>
    {
        public int Compare(string? left, string? right)
        {
            var leftNumber = numberOf(left);
            var rightNumber = numberOf(right);

            if (leftNumber is { } first && rightNumber is { } second)
            {
                return first.CompareTo(second);
            }

            if (leftNumber is null && rightNumber is null)
            {
                return string.CompareOrdinal(left, right);
            }

            return leftNumber is null ? 1 : -1;
        }
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
