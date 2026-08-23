using System.Globalization;
using PivotForge.Core;

namespace PivotForge.Core.Tests;

public sealed class PivotGroupIntervalTests
{
    private sealed record Sale(DateTime OrderDate, string Region, decimal Amount);

    // Deliberately out of chronological order and spanning two years: arrival
    // order must not be what puts the headers right.
    private static readonly Sale[] Sales =
    [
        new(new DateTime(2026, 8, 3), "Ege", 100m),
        new(new DateTime(2026, 4, 17), "Ege", 200m),
        new(new DateTime(2026, 11, 2), "Marmara", 300m),
        new(new DateTime(2025, 4, 9), "Marmara", 400m),
        new(new DateTime(2026, 4, 24), "Ege", 50m)
    ];

    private static readonly PivotEngine Turkish = new(CultureInfo.GetCultureInfo("tr-TR"));
    private static readonly PivotEngine English = new(CultureInfo.GetCultureInfo("en-US"));

    private static string[] RowLabels(PivotResult result, int level = 0)
        => result.RowHeaders.Select(header => header[level]!).ToArray();

    private static PivotRequest Rows(params PivotFieldRef[] rows) => new()
    {
        Rows = rows,
        Values = [PivotValueDefinition.Sum("Amount")]
    };

    [Fact]
    public void AFieldNameIsStillALevelOfItsOwn()
    {
        // The whole axis model changed shape; a plain field must not have.
        PivotFieldRef plain = "Region";

        Assert.Equal("Region", plain.Field);
        Assert.Equal(PivotGroupInterval.None, plain.Interval);
        Assert.Equal("Region", plain.Key);
    }

    [Fact]
    public void AGroupedLevelIsIdentifiedByFieldAndInterval()
    {
        // The identity the sort, the filter and the drill-down all name.
        Assert.Equal(
            "OrderDate:month",
            new PivotFieldRef("OrderDate", PivotGroupInterval.Month).Key);
    }

    [Fact]
    public void YearCollapsesDatesToTheirYear()
    {
        var result = Turkish.Execute(Sales, Rows(new PivotFieldRef("OrderDate", PivotGroupInterval.Year)));

        Assert.Equal(["2025", "2026"], RowLabels(result));
        Assert.Equal(400m, result.RowTotals[0].Values["Amount_sum"]);
        Assert.Equal(650m, result.RowTotals[1].Values["Amount_sum"]);
    }

    [Fact]
    public void MonthReadsAsANameInTheResolvedCulture()
    {
        Assert.Equal(
            ["Nisan", "Ağustos", "Kasım"],
            RowLabels(Turkish.Execute(
                Sales.Where(sale => sale.OrderDate.Year == 2026),
                Rows(new PivotFieldRef("OrderDate", PivotGroupInterval.Month)))));

        Assert.Equal(
            ["April", "August", "November"],
            RowLabels(English.Execute(
                Sales.Where(sale => sale.OrderDate.Year == 2026),
                Rows(new PivotFieldRef("OrderDate", PivotGroupInterval.Month)))));
    }

    [Fact]
    public void MonthsRunInCalendarOrderRatherThanAlphabetical()
    {
        // The point of the whole exercise: alphabetically Ağustos precedes Kasım
        // precedes Nisan, which is not a year anyone recognizes.
        var result = Turkish.Execute(
            Sales.Where(sale => sale.OrderDate.Year == 2026),
            Rows(new PivotFieldRef("OrderDate", PivotGroupInterval.Month)));

        Assert.Equal(["Nisan", "Ağustos", "Kasım"], RowLabels(result));
    }

    [Fact]
    public void OneDateColumnCarriesSeveralLevelsAtOnce()
    {
        // What a field name alone could not express: the same column twice.
        var result = Turkish.Execute(
            Sales,
            Rows(
                new PivotFieldRef("OrderDate", PivotGroupInterval.Year),
                new PivotFieldRef("OrderDate", PivotGroupInterval.Month)));

        Assert.Equal(
            [["2025", "Nisan"], ["2026", "Nisan"], ["2026", "Ağustos"], ["2026", "Kasım"]],
            result.RowHeaders.Select(header => header.ToArray()).ToArray());
    }

    [Fact]
    public void QuartersAreNumberedRatherThanNamed()
    {
        var result = Turkish.Execute(Sales, Rows(new PivotFieldRef("OrderDate", PivotGroupInterval.Quarter)));

        Assert.Equal(["Q2", "Q3", "Q4"], RowLabels(result));
    }

    [Fact]
    public void DaysOfTheMonthOrderAsNumbersNotAsText()
    {
        // Text order would list 17 and 24 before 3.
        var result = Turkish.Execute(
            Sales.Where(sale => sale.OrderDate is { Year: 2026, Month: 4 } or { Year: 2026, Month: 8 }),
            Rows(new PivotFieldRef("OrderDate", PivotGroupInterval.Day)));

        Assert.Equal(["3", "17", "24"], RowLabels(result));
    }

    [Fact]
    public void WeekdaysRunFromTheCulturesFirstDay()
    {
        var result = English.Execute(Sales, Rows(new PivotFieldRef("OrderDate", PivotGroupInterval.DayOfWeek)));

        // 2025-04-09 Wed, 2026-04-17 Fri, 2026-04-24 Fri, 2026-08-03 Mon, 2026-11-02 Mon.
        // en-US starts its week on Sunday, so Monday leads.
        Assert.Equal(["Monday", "Wednesday", "Friday"], RowLabels(result));
    }

    [Fact]
    public void GroupedColumnsRunInIntervalOrderWithoutBeingAsked()
    {
        // The column axis otherwise keeps arrival order, because the engine cannot
        // see the intent behind it. Labels it produced itself are the exception:
        // there is no query intent to preserve.
        var result = Turkish.Execute(
            Sales.Where(sale => sale.OrderDate.Year == 2026),
            new PivotRequest
            {
                Rows = ["Region"],
                Columns = [new PivotFieldRef("OrderDate", PivotGroupInterval.Month)],
                Values = [PivotValueDefinition.Sum("Amount")]
            });

        Assert.Equal(
            ["Nisan", "Ağustos", "Kasım"],
            result.ColumnHeaders.Select(header => header[0]!).ToArray());
    }

    [Fact]
    public void ADeclaredDescendingSortReversesTheIntervalRatherThanTheAlphabet()
    {
        var result = Turkish.Execute(
            Sales.Where(sale => sale.OrderDate.Year == 2026),
            new PivotRequest
            {
                Rows = [new PivotFieldRef("OrderDate", PivotGroupInterval.Month)],
                Values = [PivotValueDefinition.Sum("Amount")],
                FieldSorts = [new PivotFieldSort("OrderDate:month", PivotSortDirection.Descending)]
            });

        Assert.Equal(["Kasım", "Ağustos", "Nisan"], RowLabels(result));
    }

    [Fact]
    public void AFilterOnAGroupedFieldListsGroupsRatherThanDates()
    {
        // A filter set from a grouped header holds month names; comparing those
        // against raw timestamps would match nothing at all.
        var result = Turkish.Execute(
            Sales,
            new PivotRequest
            {
                Rows = [new PivotFieldRef("OrderDate", PivotGroupInterval.Month)],
                Values = [PivotValueDefinition.Sum("Amount")],
                Filters = [new PivotFilter("OrderDate", ["Nisan"], PivotFilterMode.Include, PivotGroupInterval.Month)]
            });

        Assert.Equal(["Nisan"], RowLabels(result));
        Assert.Equal(650m, result.GrandTotals["Amount_sum"]);
    }

    [Fact]
    public void DistinctValuesListsTheGroupsAHeaderShows()
    {
        Assert.Equal(
            ["Nisan", "Ağustos", "Kasım"],
            Turkish.DistinctValues(Sales, "OrderDate", PivotGroupInterval.Month));
    }

    [Fact]
    public void DrillingIntoAGroupFindsTheRecordsBehindIt()
    {
        var request = new PivotRequest
        {
            Rows = [new PivotFieldRef("OrderDate", PivotGroupInterval.Month)],
            Values = [PivotValueDefinition.Sum("Amount")]
        };

        var records = Turkish.DrillDown(Sales, request, ["Nisan"], []);

        Assert.Equal(3, records.Count);
        Assert.All(records, record => Assert.Equal(4, record.OrderDate.Month));
    }

    [Fact]
    public void AValueThatIsNotADateKeepsItsOwnText()
    {
        // Folding it into the blank group would hide a configuration mistake; at
        // the end of the list it is visible without splitting the months.
        var mixed = new[]
        {
            new Dictionary<string, object?> { ["When"] = new DateTime(2026, 4, 1), ["Amount"] = 1m },
            new Dictionary<string, object?> { ["When"] = "bilinmiyor", ["Amount"] = 2m }
        };

        var result = Turkish.ExecuteRecords(
            mixed,
            new PivotRequest
            {
                Rows = [new PivotFieldRef("When", PivotGroupInterval.Month)],
                Values = [PivotValueDefinition.Sum("Amount")]
            });

        Assert.Equal(["Nisan", "bilinmiyor"], RowLabels(result));
    }

    [Fact]
    public void ATextDateIsGroupedLikeADate()
    {
        // A column read from CSV or JSON arrives as text; refusing to group it
        // would make the feature depend on how the source was loaded.
        var text = new[]
        {
            new Dictionary<string, object?> { ["When"] = "2026-04-01", ["Amount"] = 1m },
            new Dictionary<string, object?> { ["When"] = "2026-08-01", ["Amount"] = 2m }
        };

        var result = Turkish.ExecuteRecords(
            text,
            new PivotRequest
            {
                Rows = [new PivotFieldRef("When", PivotGroupInterval.Month)],
                Values = [PivotValueDefinition.Sum("Amount")]
            });

        Assert.Equal(["Nisan", "Ağustos"], RowLabels(result));
    }
}
