using System.Data;
using System.Globalization;
using PivotForge.Core;

namespace PivotForge.Core.Tests;

// DevExtreme's selector, registered on the engine by name: a field whose value a
// function works out from the whole record, read that way on every path.
public sealed class PivotSelectorTests
{
    private sealed record Sale(string Region, DateTime OrderDate, decimal Amount, decimal Discount);

    // The fiscal year starts in October: 2025-10-05 is fiscal 2026.
    private static readonly Sale[] Sales =
    [
        new("Ege", new DateTime(2025, 3, 1), 100m, 10m),
        new("Ege", new DateTime(2025, 10, 5), 200m, 0m),
        new("Marmara", new DateTime(2026, 1, 9), 300m, 30m),
        new("Marmara", new DateTime(2024, 12, 31), 400m, 0m)
    ];

    private static readonly PivotEngine Engine = new(CultureInfo.InvariantCulture)
    {
        CustomSelectors = new Dictionary<string, PivotSelector>(StringComparer.OrdinalIgnoreCase)
        {
            ["fiscalYear"] = record =>
            {
                var date = (DateTime)record["OrderDate"]!;
                return date.Month >= 10 ? date.Year + 1 : date.Year;
            },
            ["orderSize"] = record => ((Sale)record.Source).Amount >= 250m ? "Large" : "Small",
            ["net"] = record => (decimal)record["Amount"]! - (decimal)record["Discount"]!,
            ["firstOfMonth"] = record =>
            {
                var date = (DateTime)record["OrderDate"]!;
                return new DateTime(date.Year, date.Month, 1);
            }
        }
    };

    private static readonly Dictionary<string, string> Selected = new()
    {
        ["FiscalYear"] = "fiscalYear",
        ["Size"] = "OrderSize"
    };

    private static string[] Rows(PivotResult result) =>
        result.RowHeaders.Select(header => string.Join("/", header)).ToArray();

    private static decimal? RowTotal(PivotResult result, string label) =>
        result.RowTotals.Single(total => result.RowHeaders[total.Index][0] == label).Values.Values.Single();

    [Fact]
    public void AFieldOfTheSelectorsOwnGroupsTheRowsAndTheColumns()
    {
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["FiscalYear"],
            Columns = ["Size"],
            Values = [PivotValueDefinition.Sum("Amount")],
            Selectors = Selected
        });

        // A number, so it runs in number order.
        Assert.Equal(["2025", "2026"], Rows(result));
        Assert.Equal(500m, RowTotal(result, "2025"));
        Assert.Equal(500m, RowTotal(result, "2026"));
        Assert.Equal(["Large", "Small"], result.ColumnHeaders.Select(header => header[0] ?? "").Order().ToArray());
    }

    [Fact]
    public void FiltersTheValuePickerAndDrillDownSeeTheSelectedValue()
    {
        var request = new PivotRequest
        {
            Rows = ["Region"],
            Values = [PivotValueDefinition.Sum("Amount")],
            Filters = [new PivotFilter("Size", ["Large"])],
            Selectors = Selected
        };

        Assert.Equal(700m, Engine.Execute(Sales, request).GrandTotals["Amount_sum"]);
        Assert.Equal<string?>(
            ["2025", "2026"],
            Engine.DistinctValues(Sales, "FiscalYear", [], selectors: Selected));

        var drill = Engine.DrillDown(Sales, new PivotRequest
        {
            Rows = ["FiscalYear"],
            Values = [PivotValueDefinition.Sum("Amount")],
            Selectors = Selected
        }, ["2026"], []);
        Assert.Equal([200m, 300m], drill.Cast<Sale>().Select(sale => sale.Amount).Order().ToArray());
    }

    [Fact]
    public void AMeasureSumsTheSelectedValue()
    {
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Region"],
            Values = [PivotValueDefinition.Sum("Net")],
            Selectors = new Dictionary<string, string> { ["Net"] = "net" }
        });

        Assert.Equal(960m, result.GrandTotals["Net_sum"]);
    }

    [Fact]
    public void ASelectorReplacesTheSourceFieldOfTheSameName_AndCombinesWithAnInterval()
    {
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = [new PivotFieldRef("OrderDate", PivotGroupInterval.Day)],
            Values = [PivotValueDefinition.Count("Region")],
            Selectors = new Dictionary<string, string> { ["orderdate"] = "firstOfMonth" }
        });

        // Every date is moved to the first of its month.
        Assert.Equal(["1"], Rows(result));
    }

    [Fact]
    public void TheIndexerReadsDataTablesAndDictionariesToo()
    {
        var table = new DataTable();
        table.Columns.Add("OrderDate", typeof(DateTime));
        table.Columns.Add("Amount", typeof(decimal));
        table.Rows.Add(new DateTime(2025, 11, 1), 5m);
        var records = new[]
        {
            new Dictionary<string, object?> { ["OrderDate"] = new DateTime(2025, 11, 1), ["Amount"] = 5m }
        };
        var request = new PivotRequest
        {
            Rows = ["FiscalYear"],
            Values = [PivotValueDefinition.Sum("Amount")],
            Selectors = new Dictionary<string, string> { ["FiscalYear"] = "fiscalYear" }
        };

        Assert.Equal(["2026"], Rows(Engine.Execute(table, request)));
        Assert.Equal(["2026"], Rows(Engine.ExecuteRecords(records, request)));
    }

    [Fact]
    public void ASelectorReadsTheOtherFieldsAfterTheirDeclaredType()
    {
        var text = new[] { new { OrderDate = "2025-10-05", Amount = 1m } };

        var result = Engine.Execute(text, new PivotRequest
        {
            Rows = ["FiscalYear"],
            Values = [PivotValueDefinition.Sum("Amount")],
            DataTypes = new Dictionary<string, PivotDataType> { ["OrderDate"] = PivotDataType.Date },
            Selectors = new Dictionary<string, string> { ["FiscalYear"] = "fiscalYear" }
        });

        Assert.Equal(["2026"], Rows(result));
    }

    [Fact]
    public void AnUnregisteredSelectorIsRefused()
    {
        var error = Assert.Throws<ArgumentException>(() => Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["FiscalYear"],
            Values = [PivotValueDefinition.Sum("Amount")],
            Selectors = new Dictionary<string, string> { ["FiscalYear"] = "calendarYear" }
        }));

        Assert.Contains("calendarYear", error.Message);
        // Without a selector the name is only a field the source does not have.
        Assert.Throws<PivotFieldNotFoundException>(() => Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["FiscalYear"],
            Values = [PivotValueDefinition.Sum("Amount")]
        }));
    }
}
