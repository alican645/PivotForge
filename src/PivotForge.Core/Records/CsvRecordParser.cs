using System.Globalization;
using System.Text;

namespace PivotForge.Core.Records;

/// <summary>Parses comma-separated text into dictionary-backed pivot records.</summary>
public static class CsvRecordParser
{
    /// <summary>Parses a CSV document whose first row contains field names.</summary>
    /// <param name="csv">The CSV document.</param>
    /// <returns>The parsed flat records.</returns>
    /// <exception cref="ArgumentException"><paramref name="csv"/> is empty.</exception>
    public static IReadOnlyList<IReadOnlyDictionary<string, object?>> Parse(string csv)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(csv);

        var rows = ParseRows(csv);

        if (rows.Count == 0)
        {
            return [];
        }

        var headers = rows[0];
        var records = new List<IReadOnlyDictionary<string, object?>>(Math.Max(0, rows.Count - 1));

        foreach (var row in rows.Skip(1))
        {
            var record = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);

            for (var index = 0; index < headers.Count; index++)
            {
                var value = index < row.Count ? row[index] : string.Empty;
                record[headers[index]] = ConvertValue(value);
            }

            records.Add(record);
        }

        return records;
    }

    private static List<List<string>> ParseRows(string csv)
    {
        var rows = new List<List<string>>();
        var row = new List<string>();
        var value = new StringBuilder();
        var inQuotes = false;

        for (var index = 0; index < csv.Length; index++)
        {
            var current = csv[index];

            if (current == '"')
            {
                if (inQuotes && index + 1 < csv.Length && csv[index + 1] == '"')
                {
                    value.Append('"');
                    index++;
                }
                else
                {
                    inQuotes = !inQuotes;
                }

                continue;
            }

            if (current == ',' && !inQuotes)
            {
                row.Add(value.ToString());
                value.Clear();
                continue;
            }

            if ((current == '\n' || current == '\r') && !inQuotes)
            {
                if (current == '\r' && index + 1 < csv.Length && csv[index + 1] == '\n')
                {
                    index++;
                }

                row.Add(value.ToString());
                value.Clear();
                rows.Add(row);
                row = [];
                continue;
            }

            value.Append(current);
        }

        row.Add(value.ToString());

        if (row.Count > 1 || !string.IsNullOrEmpty(row[0]))
        {
            rows.Add(row);
        }

        return rows;
    }

    private static object? ConvertValue(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        if (decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var decimalValue))
        {
            return decimalValue;
        }

        return value;
    }
}
