using System.Text.Json;
using PivotForge.AspNetCore.Models;
using PivotForge.Core;
using Xunit;

namespace PivotForge.AspNetCore.Tests;

public class PivotFieldRefJsonTests
{
    private static PivotForgeRequest Read(string json) =>
        JsonSerializer.Deserialize<PivotForgeRequest>(
            json, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

    [Fact]
    public void ReadsAnAxisOfPlainFieldNames()
    {
        // Every payload written before grouping existed looks like this one.
        var request = Read("""{"rows":["Region","Category"],"columns":["Year"]}""");

        Assert.Equal(["Region", "Category"], request.Rows.Select(level => level.Field));
        Assert.All(request.Rows, level => Assert.Equal(PivotGroupInterval.None, level.Interval));
        Assert.Equal("Year", request.Columns.Single().Field);
    }

    [Fact]
    public void AFieldNameIsNeverSplitOnItsColon()
    {
        // The key spelling is Field:interval, but reading it back out of a string
        // would rename a column genuinely called "A:B".
        var request = Read("""{"rows":["A:B"]}""");

        Assert.Equal("A:B", request.Rows.Single().Field);
        Assert.Equal(PivotGroupInterval.None, request.Rows.Single().Interval);
    }

    [Fact]
    public void ReadsAGroupedLevelAsAnObject()
    {
        var request = Read("""{"rows":[{"field":"OrderDate","interval":"month"}]}""");

        Assert.Equal(new PivotFieldRef("OrderDate", PivotGroupInterval.Month), request.Rows.Single());
        Assert.Equal("OrderDate:month", request.Rows.Single().Key);
    }

    [Fact]
    public void ReadsTheSameFieldAtSeveralIntervals()
    {
        var request = Read(
            """{"rows":[{"field":"OrderDate","interval":"Year"},{"field":"OrderDate","interval":"Month"}]}""");

        Assert.Equal(
            ["OrderDate:year", "OrderDate:month"],
            request.Rows.Select(level => level.Key));
    }

    [Fact]
    public void AnUnknownIntervalIsRefusedRatherThanIgnored()
    {
        // Silently dropping it would return an ungrouped pivot that looks like a
        // data problem rather than a spelling mistake.
        Assert.Throws<JsonException>(
            () => Read("""{"rows":[{"field":"OrderDate","interval":"fortnight"}]}"""));
    }

    [Fact]
    public void AnObjectWithoutAFieldIsRefused()
    {
        Assert.Throws<JsonException>(() => Read("""{"rows":[{"interval":"month"}]}"""));
    }

    [Fact]
    public void WritesAPlainLevelBackAsTheStringItArrivedAs()
    {
        // A round trip must not change the shape of a payload that never grouped
        // anything, or a stored view would come back looking different.
        var json = JsonSerializer.Serialize(
            new PivotFieldRef[] { "Region", new("OrderDate", PivotGroupInterval.Quarter) },
            new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.Equal("""["Region",{"field":"OrderDate","interval":"Quarter"}]""", json);
    }
}
