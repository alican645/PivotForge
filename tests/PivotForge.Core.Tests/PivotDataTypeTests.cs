using System.Data;
using System.Globalization;
using PivotForge.Core;

namespace PivotForge.Core.Tests;

// A declared data type converts a source value where it is read, so every path
// -- aggregation, grouping, filters, the value picker, drill-down, ordering --
// sees the same converted value. The source here holds everything as text, the
// way a CSV import or a loosely typed JSON feed does.
public sealed class PivotDataTypeTests
{
    private sealed record TextSale(string Region, string Code, string? Amount, string OrderDate);

    private static readonly TextSale[] Sales =
    [
        new("Ege", "10", "1250.5", "2026-03-14"),
        new("Ege", "9", "100", "2025-11-02"),
        new("Marmara", "10", "abc", "2026-07-01"),
        new("Marmara", "2", null, "not a date")
    ];

    private static readonly IReadOnlyDictionary<string, PivotDataType> Typed = new Dictionary<string, PivotDataType>
    {
        ["Amount"] = PivotDataType.Number,
        ["Code"] = PivotDataType.Number,
        ["OrderDate"] = PivotDataType.Date
    };

    private static readonly PivotEngine Engine = new(CultureInfo.InvariantCulture);

    private static string[] RowLabels(PivotResult result) => result.RowHeaders.Select(header => header[0] ?? "").ToArray();

    [Fact]
    public void TextNumbersAreSummedAndAnUnreadableOneIsBlank()
    {
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Region"],
            Values = [PivotValueDefinition.Sum("Amount")],
            DataTypes = Typed
        });

        Assert.Equal(1350.5m, result.RowTotals.Single(total => total.Index == 0).Values["Amount_sum"]);
        // Both values convert to blank; an observed all-blank sum is zero.
        Assert.Equal(0m, result.RowTotals.Single(total => total.Index == 1).Values["Amount_sum"]);
    }

    [Fact]
    public void WithoutADataTypeTextNumbersStillRefuseToBeSummed()
    {
        Assert.Throws<PivotFieldTypeException>(() => Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Region"],
            Values = [PivotValueDefinition.Sum("Amount")]
        }));
    }

    [Fact]
    public void NumberHeadersRunInNumberOrderOnBothAxes()
    {
        var request = new PivotRequest
        {
            Rows = ["Code"],
            Columns = ["Code"],
            Values = [PivotValueDefinition.Count("Region")],
            FieldSorts =
            [
                new PivotFieldSort("Code", PivotSortDirection.Ascending)
            ],
            DataTypes = Typed
        };

        var result = Engine.Execute(Sales, request);

        Assert.Equal(["2", "9", "10"], RowLabels(result));
        Assert.Equal(["2", "9", "10"], result.ColumnHeaders.Select(header => header[0] ?? "").ToArray());
    }

    [Fact]
    public void TextDatesGroupByIntervalAndAnUnreadableOneIsBlank()
    {
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = [new PivotFieldRef("OrderDate", PivotGroupInterval.Year)],
            Values = [PivotValueDefinition.Count("Region")],
            DataTypes = Typed
        });

        // Without the type "not a date" would survive as its own group.
        Assert.Equal(["", "2025", "2026"], RowLabels(result).Order(StringComparer.Ordinal).ToArray());
    }

    [Fact]
    public void FiltersAndTheValuePickerSeeTheConvertedValues()
    {
        var filtered = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Region"],
            Values = [PivotValueDefinition.Count("Region")],
            Filters = [new PivotFilter("Code", ["5"], Operator: PivotFilterOperator.GreaterThan)],
            DataTypes = Typed
        });

        Assert.Equal(["Ege", "Marmara"], RowLabels(filtered));
        Assert.Equal<string?>(
            ["", "100", "1250.5"],
            Engine.DistinctValues(Sales, "Amount", [], dataTypes: Typed));
        Assert.Equal<string?>(["2", "9", "10"], Engine.DistinctValues(Sales, "Code", [], dataTypes: Typed));
    }

    [Fact]
    public void StringTreatsANumericColumnAsText()
    {
        var numbers = new[] { new { Code = 10, Amount = 1m }, new { Code = 9, Amount = 1m } };

        var result = Engine.Execute(numbers, new PivotRequest
        {
            Rows = ["Code"],
            Values = [PivotValueDefinition.Sum("Amount")],
            FieldSorts = [new PivotFieldSort("Code", PivotSortDirection.Ascending)],
            DataTypes = new Dictionary<string, PivotDataType> { ["Code"] = PivotDataType.String }
        });

        Assert.Equal(["10", "9"], RowLabels(result));
    }

    [Fact]
    public void DataTablesAndDictionaryRecordsConvertTheSameWay()
    {
        var table = new DataTable();
        table.Columns.Add("Region", typeof(string));
        table.Columns.Add("Amount", typeof(string));
        table.Rows.Add("Ege", "40");
        table.Rows.Add("Ege", "2");
        var records = new[]
        {
            new Dictionary<string, object?> { ["Region"] = "Ege", ["Amount"] = "40" },
            new Dictionary<string, object?> { ["Region"] = "Ege", ["Amount"] = "2" }
        };
        var request = new PivotRequest
        {
            Rows = ["Region"],
            Values = [PivotValueDefinition.Sum("Amount")],
            DataTypes = new Dictionary<string, PivotDataType> { ["amount"] = PivotDataType.Number }
        };

        Assert.Equal(42m, Engine.Execute(table, request).GrandTotals["Amount_sum"]);
        Assert.Equal(42m, Engine.ExecuteRecords(records, request).GrandTotals["Amount_sum"]);
    }

    [Fact]
    public void TypingAFieldTheSourceDoesNotHaveIsRefusedLikeAnyOtherUnknownField()
    {
        Assert.Throws<PivotFieldNotFoundException>(() => Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Region"],
            Values = [PivotValueDefinition.Count("Region")],
            DataTypes = new Dictionary<string, PivotDataType> { ["Missing"] = PivotDataType.Number }
        }));
    }

    [Fact]
    public void DrillDownMatchesOnTheConvertedValue()
    {
        var request = new PivotRequest
        {
            Rows = [new PivotFieldRef("OrderDate", PivotGroupInterval.Year)],
            Values = [PivotValueDefinition.Count("Region")],
            DataTypes = Typed
        };

        Assert.Equal(2, Engine.DrillDown(Sales, request, ["2026"], []).Count);
    }
}
