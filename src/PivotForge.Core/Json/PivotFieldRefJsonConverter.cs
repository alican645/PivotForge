using System.Text.Json;
using System.Text.Json.Serialization;
namespace PivotForge.Core.Json;

/// <summary>Reads a header level written either as a field name or as a field and an interval.</summary>
/// <remarks>
/// A bare string is taken as a field name and never split, so a column genuinely called
/// <c>A:B</c> keeps working; grouping is always spelled out as an object. That also keeps every
/// payload written before grouping existed valid, and keeps the ones that do not group it
/// unchanged — an ungrouped level is written back as the plain string it arrived as.
/// </remarks>
public sealed class PivotFieldRefJsonConverter : JsonConverter<PivotFieldRef>
{
    /// <summary>Reads a header level.</summary>
    /// <param name="reader">The JSON reader.</param>
    /// <param name="typeToConvert">The target type.</param>
    /// <param name="options">The serializer options.</param>
    /// <returns>The level that was read.</returns>
    /// <exception cref="JsonException">The level is not a string or an object with a field.</exception>
    public override PivotFieldRef Read(
        ref Utf8JsonReader reader,
        Type typeToConvert,
        JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            return new PivotFieldRef(reader.GetString() ?? "");
        }

        if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException(
                "A pivot header level must be a field name or an object carrying \"field\" and \"interval\".");
        }

        string? field = null;
        var interval = PivotGroupInterval.None;

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                continue;
            }

            var name = reader.GetString();
            reader.Read();

            if (string.Equals(name, "field", StringComparison.OrdinalIgnoreCase))
            {
                field = reader.GetString();
            }
            else if (string.Equals(name, "interval", StringComparison.OrdinalIgnoreCase))
            {
                interval = ReadInterval(ref reader);
            }
            else
            {
                reader.Skip();
            }
        }

        if (string.IsNullOrWhiteSpace(field))
        {
            throw new JsonException("A pivot header level object requires a \"field\".");
        }

        return new PivotFieldRef(field, interval);
    }

    /// <summary>Writes a header level.</summary>
    /// <param name="writer">The JSON writer.</param>
    /// <param name="value">The level to write.</param>
    /// <param name="options">The serializer options.</param>
    public override void Write(Utf8JsonWriter writer, PivotFieldRef value, JsonSerializerOptions options)
    {
        ArgumentNullException.ThrowIfNull(writer);
        ArgumentNullException.ThrowIfNull(value);

        if (value.Interval == PivotGroupInterval.None)
        {
            writer.WriteStringValue(value.Field);
            return;
        }

        writer.WriteStartObject();
        writer.WriteString("field", value.Field);
        writer.WriteString("interval", value.Interval.ToString());
        writer.WriteEndObject();
    }

    private static PivotGroupInterval ReadInterval(ref Utf8JsonReader reader)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return PivotGroupInterval.None;
        }

        var text = reader.TokenType == JsonTokenType.Number
            ? reader.GetInt32().ToString(System.Globalization.CultureInfo.InvariantCulture)
            : reader.GetString();

        if (Enum.TryParse<PivotGroupInterval>(text, ignoreCase: true, out var interval) &&
            Enum.IsDefined(interval))
        {
            return interval;
        }

        throw new JsonException($"\"{text}\" is not a known pivot group interval.");
    }
}
