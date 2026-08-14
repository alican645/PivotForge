using System.Text.Json;

namespace PivotForge.Core.Records;

/// <summary>Parses JSON arrays of flat objects into dictionary-backed pivot records.</summary>
public static class JsonRecordParser
{
    /// <summary>Parses a JSON array containing objects with scalar property values.</summary>
    /// <param name="json">The JSON document.</param>
    /// <returns>The parsed flat records.</returns>
    /// <exception cref="ArgumentException">The input is empty or does not contain an array of flat objects.</exception>
    public static IReadOnlyList<IReadOnlyDictionary<string, object?>> Parse(string json)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(json);

        using var document = JsonDocument.Parse(json);

        if (document.RootElement.ValueKind != JsonValueKind.Array)
        {
            throw new ArgumentException("JSON pivot data must be an array of flat objects.", nameof(json));
        }

        return document.RootElement
            .EnumerateArray()
            .Select(ParseObject)
            .ToArray();
    }

    private static IReadOnlyDictionary<string, object?> ParseObject(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            throw new ArgumentException("JSON pivot data must contain only objects.");
        }

        return element.EnumerateObject()
            .ToDictionary(property => property.Name, property => ConvertValue(property.Value), StringComparer.OrdinalIgnoreCase);
    }

    private static object? ConvertValue(JsonElement value)
    {
        return value.ValueKind switch
        {
            JsonValueKind.Null => null,
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number when value.TryGetDecimal(out var decimalValue) => decimalValue,
            JsonValueKind.Number => value.GetDouble(),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => throw new ArgumentException("JSON pivot data supports only flat scalar values.")
        };
    }
}
