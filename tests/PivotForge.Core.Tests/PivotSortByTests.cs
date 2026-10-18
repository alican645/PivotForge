using System.Globalization;
using PivotForge.Core;

namespace PivotForge.Core.Tests;

// DevExtreme's sortBy ("value", "displayText", "none") and sortingMethod, the
// latter as a comparer registered on the engine by name.
public sealed class PivotSortByTests
{
    private sealed record Sale(string Priority, int Code, DateTime OrderDate, decimal Amount);

    // Arrival order: Low, High, Medium; codes 10, 9, 100; dates out of order.
    private static readonly Sale[] Sales =
    [
        new("Low", 10, new DateTime(2026, 4, 3), 1m),
        new("High", 9, new DateTime(2026, 3, 4), 2m),
        new("Medium", 100, new DateTime(2026, 1, 20), 3m),
        new("Low", 9, new DateTime(2026, 8, 1), 4m)
    ];

    private static readonly IComparer<string?> ByPriority = Comparer<string?>.Create((left, right) =>
        Rank(left).CompareTo(Rank(right)));

    private static int Rank(string? priority) => priority switch
    {
        "High" => 0,
        "Medium" => 1,
        "Low" => 2,
        _ => 3
    };

    private static readonly PivotEngine Engine = new(CultureInfo.GetCultureInfo("tr-TR"))
    {
        CustomSorts = new Dictionary<string, IComparer<string?>>(StringComparer.OrdinalIgnoreCase)
        {
            ["priority"] = ByPriority
        }
    };

    private static PivotResult Execute(PivotFieldRef field, PivotFieldSort? sort, bool onColumns = false) =>
        Engine.Execute(Sales, new PivotRequest
        {
            Rows = onColumns ? [] : [field],
            Columns = onColumns ? [field] : [],
            Values = [PivotValueDefinition.Sum("Amount")],
            FieldSorts = sort is null ? [] : [sort]
        });

    private static string[] Labels(PivotResult result, bool onColumns = false) =>
        (onColumns ? result.ColumnHeaders : result.RowHeaders).Select(header => header[0] ?? "").ToArray();

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void ANumericLevelRunsInNumberOrder(bool onColumns)
    {
        var result = Execute("Code", new PivotFieldSort("Code", PivotSortDirection.Ascending), onColumns);

        Assert.Equal(["9", "10", "100"], Labels(result, onColumns));
    }

    [Fact]
    public void AnUndeclaredNumericRowLevelRunsInNumberOrderToo()
    {
        Assert.Equal(["9", "10", "100"], Labels(Execute("Code", sort: null)));
    }

    [Fact]
    public void ADateLevelRunsInDateOrderWhateverTheCulture()
    {
        var result = Execute("OrderDate", new PivotFieldSort("OrderDate", PivotSortDirection.Ascending));

        // Labels are invariant text; tr-TR would misread 04/03 as the 4th of March.
        Assert.Equal(
            [new DateTime(2026, 1, 20), new DateTime(2026, 3, 4), new DateTime(2026, 4, 3), new DateTime(2026, 8, 1)],
            Labels(result).Select(label => DateTime.Parse(label, CultureInfo.InvariantCulture)).ToArray());
    }

    [Fact]
    public void DisplayTextOrdersAsText()
    {
        Assert.Equal(["10", "100", "9"], Labels(Execute(
            "Code", new PivotFieldSort("Code", PivotSortDirection.Ascending, SortBy: PivotSortBy.DisplayText))));

        // Month names alphabetically rather than through the year (tr-TR: Ağustos, Mart, Nisan, Ocak).
        var months = Execute(
            new PivotFieldRef("OrderDate", PivotGroupInterval.Month),
            new PivotFieldSort("OrderDate", PivotSortDirection.Ascending, SortBy: PivotSortBy.DisplayText));
        Assert.Equal(["Ağustos", "Mart", "Nisan", "Ocak"], Labels(months));
        Assert.Equal(
            ["Ocak", "Mart", "Nisan", "Ağustos"],
            Labels(Execute(new PivotFieldRef("OrderDate", PivotGroupInterval.Month), sort: null)));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void NoneKeepsTheOrderTheGroupsArrivedIn(bool onColumns)
    {
        Assert.Equal(["Low", "High", "Medium"], Labels(Execute(
            "Priority", new PivotFieldSort("Priority", PivotSortDirection.Ascending, SortBy: PivotSortBy.None), onColumns), onColumns));
        Assert.Equal(["Medium", "High", "Low"], Labels(Execute(
            "Priority", new PivotFieldSort("Priority", PivotSortDirection.Descending, SortBy: PivotSortBy.None), onColumns), onColumns));
    }

    [Fact]
    public void NoneOnAnInnerRowLevelKeepsArrivalInsideEachGroup()
    {
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Rows = ["Priority", "Code"],
            Values = [PivotValueDefinition.Sum("Amount")],
            FieldSorts = [new PivotFieldSort("Code", PivotSortDirection.Ascending, SortBy: PivotSortBy.None)]
        });

        // Low's codes arrived 10 then 9; the regions themselves stay in value order.
        Assert.Equal(
            ["High/9", "Low/10", "Low/9", "Medium/100"],
            result.RowHeaders.Select(header => string.Join("/", header)).ToArray());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void ARegisteredSortingMethodReplacesTheCriterion(bool onColumns)
    {
        Assert.Equal(["High", "Medium", "Low"], Labels(Execute(
            "Priority", new PivotFieldSort("Priority", PivotSortDirection.Ascending, SortingMethod: "Priority"), onColumns), onColumns));
        // The direction still applies, and sortBy gives way to the method.
        Assert.Equal(["Low", "Medium", "High"], Labels(Execute(
            "Priority",
            new PivotFieldSort("Priority", PivotSortDirection.Descending, SortBy: PivotSortBy.None, SortingMethod: "priority"),
            onColumns), onColumns));
    }

    [Fact]
    public void AnUnregisteredSortingMethodIsRefused()
    {
        var error = Assert.Throws<ArgumentException>(() => Execute(
            "Priority", new PivotFieldSort("Priority", PivotSortDirection.Ascending, SortingMethod: "Missing")));

        Assert.Contains("Missing", error.Message);
    }

    [Fact]
    public void ASummaryTieBreaksOnTheLevelsCriterion()
    {
        Sale[] tied =
        [
            new("Low", 1, DateTime.Today, 5m),
            new("High", 2, DateTime.Today, 5m),
            new("Medium", 3, DateTime.Today, 5m)
        ];

        var result = Engine.Execute(tied, new PivotRequest
        {
            Rows = ["Priority"],
            Values = [PivotValueDefinition.Sum("Amount")],
            FieldSorts = [new PivotFieldSort("Priority", PivotSortDirection.Ascending, "Amount_sum", SortingMethod: "priority")]
        });

        Assert.Equal(["High", "Medium", "Low"], Labels(result));
    }

    [Fact]
    public void AVariationIsCalculatedInValueOrderWhateverTheSortBy()
    {
        var result = Engine.Execute(Sales, new PivotRequest
        {
            Columns = ["Code"],
            Values = [PivotValueDefinition.Sum("Amount").As(PivotShowAs.DifferenceFromPrevious)],
            FieldSorts = [new PivotFieldSort("Code", PivotSortDirection.Ascending, SortBy: PivotSortBy.DisplayText)]
        });

        // Drawn as text (10, 100, 9), calculated along 9, 10, 100: 9 has no previous column,
        // 10 is 1 - 6, 100 is 3 - 1.
        Assert.Equal(["10", "100", "9"], Labels(result, onColumns: true));
        decimal? Column(string code) => result.ColumnTotals
            .Single(total => result.ColumnHeaders[total.Index][0] == code).Values["Amount_sum"];
        Assert.Null(Column("9"));
        Assert.Equal(-5m, Column("10"));
        Assert.Equal(2m, Column("100"));
    }
}
