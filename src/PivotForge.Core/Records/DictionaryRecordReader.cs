using System.Text.Json;

namespace PivotForge.Core.Records;

internal sealed class DictionaryRecordReader : IRecordReader
{
    private readonly IReadOnlyCollection<string> _fields;

    public DictionaryRecordReader(IReadOnlyCollection<string> fields)
    {
        _fields = fields;
    }

    public bool HasField(string field) => _fields.Contains(field, StringComparer.OrdinalIgnoreCase);

    public object? GetValue(object record, string field)
    {
        var values = (IReadOnlyDictionary<string, object?>)record;

        foreach (var pair in values)
        {
            if (string.Equals(pair.Key, field, StringComparison.OrdinalIgnoreCase))
            {
                return NormalizeValue(pair.Value);
            }
        }

        throw new PivotFieldNotFoundException(field);
    }

    private static object? NormalizeValue(object? value)
    {
        if (value is not JsonElement element)
        {
            return value;
        }

        return element.ValueKind switch
        {
            JsonValueKind.Null => null,
            JsonValueKind.String => element.GetString(),
            JsonValueKind.Number when element.TryGetDecimal(out var decimalValue) => decimalValue,
            JsonValueKind.Number => element.GetDouble(),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => element.ToString()
        };
    }
}
