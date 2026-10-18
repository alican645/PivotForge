using System.Globalization;
using System.Text.Json;
using PivotForge.Core.Records;

namespace PivotForge.Core.Tests;

public sealed class DevExtremeCalculationTests
{
    public static IEnumerable<object[]> Cases() => ReadCases();

    private static IEnumerable<object[]> ReadCases()
    {
        using var document = JsonDocument.Parse(File.ReadAllText(
            Path.Combine(AppContext.BaseDirectory, "compatibility", "calculations.json")));
        return document.RootElement.GetProperty("cases").EnumerateArray()
            .Select(entry => new object[] { entry.GetProperty("id").GetString()!, entry.GetRawText() }).ToArray();
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void MatchesObservedDevExtremeResult(string id, string json)
    {
        using var document = JsonDocument.Parse(json);
        var input = document.RootElement;
        var rows = Strings(input.GetProperty("rows"));
        var columns = Strings(input.GetProperty("columns"));
        var definition = new PivotValueDefinition("V", Enum.Parse<PivotAggregation>(input.GetProperty("aggregation").GetString()!))
        {
            ShowAs = Enum.Parse<PivotShowAs>(input.GetProperty("showAs").GetString()!),
            RunningTotal = Enum.Parse<PivotRunningTotal>(input.GetProperty("runningTotal").GetString()!),
            AllowCrossGroupCalculation = input.GetProperty("crossGroup").GetBoolean()
        };
        var direction = input.GetProperty("descending").GetBoolean() ? PivotSortDirection.Descending : PivotSortDirection.Ascending;
        var result = new PivotEngine(CultureInfo.GetCultureInfo("en-US")).ExecuteRecords(
            JsonRecordParser.Parse(input.GetProperty("records").GetRawText()),
            new PivotRequest
            {
                Rows = rows.Select(field => new PivotFieldRef(field)).ToArray(),
                Columns = columns.Select(field => new PivotFieldRef(field)).ToArray(),
                Values = [definition],
                DataTypes = new Dictionary<string, PivotDataType> { ["V"] = PivotDataType.Number },
                FieldSorts = rows.Concat(columns).Select(field => new PivotFieldSort(field, direction,
                    input.GetProperty("summarySort").GetBoolean() &&
                    (!input.TryGetProperty("summaryAxis", out var axis) ||
                     (axis.GetString() == "row" ? rows : columns).Contains(field)) ? definition.Key : null,
                    input.TryGetProperty("summaryPath", out var summaryPath) ? Strings(summaryPath) : null)).ToArray()
            });
        var expected = input.GetProperty("expected");
        Assert.Equal(expected.GetProperty("rowHeaders").EnumerateArray().Select(e => PathKey(Strings(e))), result.RowHeaders.Select(PathKey));
        Assert.Equal(expected.GetProperty("columnHeaders").EnumerateArray().Select(e => PathKey(Strings(e))), result.ColumnHeaders.Select(PathKey));
        foreach (var cell in expected.GetProperty("cells").EnumerateArray())
        {
            var row = Strings(cell.GetProperty("row"));
            var column = Strings(cell.GetProperty("column"));
            var expectedValue = cell.GetProperty("value").ValueKind == JsonValueKind.Null ? (decimal?)null : cell.GetProperty("value").GetDecimal();
            var actual = Value(result, row, column, definition.Key);
            // JS uses IEEE doubles; the engine uses decimal. No tolerance for null vs zero.
            var equal = expectedValue is null ? actual is null
                : actual is not null && Math.Abs(actual.Value - expectedValue.Value) <= Math.Max(1m, Math.Abs(expectedValue.Value)) * 0.000000000001m;
            Assert.True(equal, $"{id}: row={PathKey(row)} column={PathKey(column)} expected={expectedValue?.ToString(CultureInfo.InvariantCulture) ?? "null"}, actual={actual?.ToString(CultureInfo.InvariantCulture) ?? "null"}");
        }
    }

    private static string[] Strings(JsonElement array) => array.EnumerateArray().Select(item => item.GetString()!).ToArray();
    private static string PathKey(IEnumerable<string?> path) => JsonSerializer.Serialize(path);

    private static decimal? Value(PivotResult result, string[] row, string[] column, string key)
    {
        var r = result.RowHeaders.ToList().FindIndex(path => path.SequenceEqual(row));
        var c = result.ColumnHeaders.ToList().FindIndex(path => path.SequenceEqual(column));
        var rs = result.Subtotals.FirstOrDefault(total => total.RowHeader.SequenceEqual(row));
        var cs = result.ColumnSubtotals.FirstOrDefault(total => total.ColumnHeader.SequenceEqual(column));
        IReadOnlyDictionary<string, decimal?>? values;
        if (row.Length == 0)
            values = column.Length == 0 ? result.GrandTotals : c >= 0 ? result.ColumnTotals.FirstOrDefault(t => t.Index == c)?.Values : cs?.Totals;
        else if (column.Length == 0)
            values = r >= 0 ? result.RowTotals.FirstOrDefault(t => t.Index == r)?.Values : rs?.Totals;
        else if (r >= 0)
            values = c >= 0 ? result.Cells.FirstOrDefault(t => t.Row == r && t.Column == c)?.Values : cs?.Cells.FirstOrDefault(t => t.Index == r)?.Values;
        else
            values = c >= 0 ? rs?.Cells.FirstOrDefault(t => t.Column == c)?.Values : rs?.ColumnSubtotals.FirstOrDefault(t => t.ColumnHeader.SequenceEqual(column))?.Values;
        return values?.GetValueOrDefault(key);
    }
}
