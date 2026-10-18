using System.Data;
using PivotForge.Core;

namespace PivotForge.Core.Tests;

// DevExtreme's retrieveFields: the fields a source offers, each once, a date as its
// year, quarter and month.
public sealed class PivotFieldDiscoveryTests
{
    private enum Channel { Online, Store }

    private sealed class Address
    {
        public string City { get; init; } = "";
    }

#pragma warning disable CS0649 // Read by reflection only.
    private sealed class Sale
    {
        public string Region { get; init; } = "";
        public DateTime OrderDate { get; init; }
        public decimal Amount { get; init; }
        public int? Quantity { get; init; }
        public Channel Channel { get; init; }
        public bool Returned { get; init; }
        public Address Customer { get; init; } = new();
        public List<string> Tags { get; init; } = [];
        public string __RowVersion { get; init; } = "";
        public DateOnly? ShippedOn { get; init; }
        public double Discount;
    }
#pragma warning restore CS0649

    private static string[] Names(IEnumerable<PivotDiscoveredField> fields) =>
        fields.Select(field => field.GroupInterval == PivotGroupInterval.None
            ? field.DataField
            : $"{field.DataField}:{field.GroupInterval}").ToArray();

    [Fact]
    public void ATypeOffersItsReadableMembersInDeclarationOrder()
    {
        var fields = PivotFieldDiscovery.Discover<Sale>();

        // A nested object, a collection and a double-underscore name are left out.
        Assert.Equal(
            [
                "Region", "OrderDate:Year", "OrderDate:Quarter", "OrderDate:Month", "Amount", "Quantity",
                "Channel", "Returned", "ShippedOn:Year", "ShippedOn:Quarter", "ShippedOn:Month", "Discount"
            ],
            Names(fields));
    }

    [Fact]
    public void EachMemberIsReadAsTheEnginesDataTypeAndADateAsThreeLevelsOfOneGroup()
    {
        var fields = PivotFieldDiscovery.Discover<Sale>().ToDictionary(field => Names([field])[0]);

        Assert.Equal(PivotDataType.String, fields["Region"].DataType);
        Assert.Equal(PivotDataType.Number, fields["Amount"].DataType);
        Assert.Equal(PivotDataType.Number, fields["Quantity"].DataType);
        Assert.Equal(PivotDataType.String, fields["Channel"].DataType);
        Assert.Equal(PivotDataType.String, fields["Returned"].DataType);
        Assert.Equal(PivotDataType.Number, fields["Discount"].DataType);
        Assert.Null(fields["Region"].GroupName);

        var month = fields["OrderDate:Month"];
        Assert.Equal(new PivotDiscoveredField("OrderDate", PivotDataType.Date, PivotGroupInterval.Month, "OrderDate", 2), month);
        Assert.Equal(0, fields["ShippedOn:Year"].GroupIndex);
    }

    [Fact]
    public void ATableOffersItsColumns()
    {
        var table = new DataTable();
        table.Columns.Add("Region", typeof(string));
        table.Columns.Add("Amount", typeof(decimal));
        table.Columns.Add("OrderDate", typeof(DateTime));

        Assert.Equal(
            ["Region", "Amount", "OrderDate:Year", "OrderDate:Quarter", "OrderDate:Month"],
            Names(PivotFieldDiscovery.Discover(table)));
    }

    [Fact]
    public void DictionariesOfferTheFirstRecordsKeys_TypedByTheFirstValueHeld()
    {
        var records = new IReadOnlyDictionary<string, object?>[]
        {
            new Dictionary<string, object?> { ["Region"] = "Ege", ["Amount"] = null, ["When"] = null },
            new Dictionary<string, object?> { ["Region"] = "Marmara", ["Amount"] = 5m, ["When"] = new DateTime(2025, 1, 1) }
        };

        var fields = PivotFieldDiscovery.Discover(records);

        Assert.Equal(["Region", "Amount", "When:Year", "When:Quarter", "When:Month"], Names(fields));
        Assert.Equal(PivotDataType.Number, fields[1].DataType);
        Assert.Empty(PivotFieldDiscovery.Discover(Array.Empty<IReadOnlyDictionary<string, object?>>()));
    }
}
