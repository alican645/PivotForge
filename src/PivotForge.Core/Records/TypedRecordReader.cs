using System.Globalization;
using PivotForge.Core.Grouping;

namespace PivotForge.Core.Records;

/// <summary>Converts the values of the fields a request typed, and passes every other value through.</summary>
/// <remarks>
/// The one place a declared <see cref="PivotDataType"/> takes effect: every engine path reads
/// source values through a reader, so wrapping it here is what keeps a converted value the same
/// everywhere. A converted number is a <see cref="decimal"/> and a converted date a
/// <see cref="DateTime"/>, so either behaves exactly as a typed source field would.
/// </remarks>
internal sealed class TypedRecordReader(
    IRecordReader inner,
    IReadOnlyDictionary<string, PivotDataType> dataTypes,
    CultureInfo culture) : IRecordReader
{
    private readonly Dictionary<string, PivotDataType> _types =
        new(dataTypes.Where(pair => pair.Value != PivotDataType.Auto), StringComparer.OrdinalIgnoreCase);

    /// <summary>Wraps <paramref name="reader"/> when <paramref name="dataTypes"/> types anything.</summary>
    public static IRecordReader Wrap(
        IRecordReader reader,
        IReadOnlyDictionary<string, PivotDataType>? dataTypes,
        CultureInfo culture) =>
        dataTypes is null || dataTypes.Values.All(type => type == PivotDataType.Auto)
            ? reader
            : new TypedRecordReader(reader, dataTypes, culture);

    public bool HasField(string field) => inner.HasField(field);

    public object? GetValue(object record, string field)
    {
        var value = inner.GetValue(record, field);

        return value is null || !_types.TryGetValue(field, out var type)
            ? value
            : type switch
            {
                PivotDataType.String => Convert.ToString(value, CultureInfo.InvariantCulture),
                PivotDataType.Number => ToNumber(value),
                PivotDataType.Date => PivotGroupLabels.TryConvertToDate(value, culture, out var date) ? date : null,
                _ => value
            };
    }

    private object? ToNumber(object value)
    {
        switch (value)
        {
            case decimal:
                return value;
            case byte or sbyte or short or ushort or int or uint or long or ulong:
                return Convert.ToDecimal(value, CultureInfo.InvariantCulture);
            case double or float:
                // Past decimal's range there is no decimal to be.
                try
                {
                    return Convert.ToDecimal(value, CultureInfo.InvariantCulture);
                }
                catch (OverflowException)
                {
                    return null;
                }
            case string text:
                // Invariant first: that is how a serializer or a database writes one,
                // and "1.5" read in a culture whose separator is a comma is 15.
                return decimal.TryParse(text, NumberStyles.Number | NumberStyles.AllowExponent, CultureInfo.InvariantCulture, out var invariant)
                    ? invariant
                    : decimal.TryParse(text, NumberStyles.Number, culture, out var local)
                        ? local
                        : null;
            default:
                return null;
        }
    }
}
