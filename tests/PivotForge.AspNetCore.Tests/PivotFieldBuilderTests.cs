using PivotForge.AspNetCore.Rendering;
using PivotForge.Core;
using Xunit;

namespace PivotForge.AspNetCore.Tests;

public class PivotFieldBuilderTests
{
    [Fact]
    public void BuildProducesCamelCaseKeysMatchingTheJavaScriptModel()
    {
        var field = new PivotFieldBuilder()
            .DataField("tutar")
            .Caption("Tutar")
            .Area(PivotArea.Data)
            .Aggregation(PivotAggregation.Sum)
            .Build();

        Assert.Equal("tutar", field["dataField"]);
        Assert.Equal("Tutar", field["caption"]);
        Assert.Equal("data", field["area"]);
        Assert.Equal("sum", field["aggregation"]);
    }

    [Fact]
    public void AreaDefaultsToData()
    {
        var field = new PivotFieldBuilder().DataField("tutar").Build();

        Assert.Equal("data", field["area"]);
    }

    [Fact]
    public void CaptionDefaultsToTheDataFieldName()
    {
        var field = new PivotFieldBuilder().DataField("tutar").Build();

        Assert.Equal("tutar", field["caption"]);
    }

    [Theory]
    [InlineData(PivotArea.Row, "row")]
    [InlineData(PivotArea.Column, "column")]
    [InlineData(PivotArea.Data, "data")]
    [InlineData(PivotArea.Filter, "filter")]
    public void EveryAreaSerializesAsLowerCamelCase(PivotArea area, string expected)
    {
        var field = new PivotFieldBuilder().DataField("alan").Area(area).Build();

        Assert.Equal(expected, field["area"]);
    }

    [Theory]
    [InlineData(PivotAggregation.Sum, "sum")]
    [InlineData(PivotAggregation.Count, "count")]
    [InlineData(PivotAggregation.Average, "average")]
    [InlineData(PivotAggregation.Min, "min")]
    [InlineData(PivotAggregation.Max, "max")]
    public void EveryAggregationSerializesAsLowerCamelCase(PivotAggregation aggregation, string expected)
    {
        var field = new PivotFieldBuilder()
            .DataField("tutar")
            .Area(PivotArea.Data)
            .Aggregation(aggregation)
            .Build();

        Assert.Equal(expected, field["aggregation"]);
    }

    [Theory]
    [InlineData(PivotShowAs.Normal, "normal")]
    [InlineData(PivotShowAs.PercentOfRowTotal, "percentOfRowTotal")]
    [InlineData(PivotShowAs.PercentOfColumnTotal, "percentOfColumnTotal")]
    [InlineData(PivotShowAs.PercentOfGrandTotal, "percentOfGrandTotal")]
    [InlineData(PivotShowAs.DifferenceFromPrevious, "differenceFromPrevious")]
    [InlineData(PivotShowAs.PercentDifferenceFromPrevious, "percentDifferenceFromPrevious")]
    [InlineData(PivotShowAs.RunningTotal, "runningTotal")]
    public void EveryShowAsSerializesAsLowerCamelCase(PivotShowAs showAs, string expected)
    {
        var field = new PivotFieldBuilder()
            .DataField("tutar")
            .Area(PivotArea.Data)
            .ShowAs(showAs)
            .Build();

        Assert.Equal(expected, field["showAs"]);
    }

    [Fact]
    public void OptionalMembersAreOmittedWhenUnset()
    {
        var field = new PivotFieldBuilder().DataField("urun").Area(PivotArea.Row).Build();

        Assert.False(field.ContainsKey("aggregation"));
        Assert.False(field.ContainsKey("showAs"));
        Assert.False(field.ContainsKey("format"));
        Assert.False(field.ContainsKey("visible"));
    }

    [Fact]
    public void VisibleIsEmittedOnlyWhenFalse()
    {
        var hidden = new PivotFieldBuilder().DataField("urun").Visible(false).Build();
        var shown = new PivotFieldBuilder().DataField("urun").Visible(true).Build();

        Assert.Equal(false, hidden["visible"]);
        Assert.False(shown.ContainsKey("visible"));
    }

    [Fact]
    public void SettingAggregationOnANonDataAreaThrows()
    {
        var builder = new PivotFieldBuilder()
            .DataField("urun")
            .Area(PivotArea.Row)
            .Aggregation(PivotAggregation.Sum);

        var exception = Assert.Throws<InvalidOperationException>(() => builder.Build());

        Assert.Contains("Aggregation", exception.Message);
    }

    [Fact]
    public void SettingShowAsOnANonDataAreaThrows()
    {
        var builder = new PivotFieldBuilder()
            .DataField("urun")
            .Area(PivotArea.Row)
            .ShowAs(PivotShowAs.PercentOfRowTotal);

        var exception = Assert.Throws<InvalidOperationException>(() => builder.Build());

        Assert.Contains("ShowAs", exception.Message);
    }

    [Fact]
    public void BuildWithoutADataFieldThrows()
    {
        var exception = Assert.Throws<InvalidOperationException>(
            () => new PivotFieldBuilder().Caption("Tutar").Build());

        Assert.Contains("DataField", exception.Message);
    }

    [Fact]
    public void CollectionBuilderPreservesDeclarationOrder()
    {
        var fields = new PivotFieldCollectionBuilder();
        fields.Add().DataField("bolge").Area(PivotArea.Row);
        fields.Add().DataField("urun").Area(PivotArea.Row);
        fields.Add().DataField("tutar").Area(PivotArea.Data).Aggregation(PivotAggregation.Sum);

        var built = fields.Build();

        Assert.Equal(3, built.Count);
        Assert.Equal("bolge", built[0]["dataField"]);
        Assert.Equal("urun", built[1]["dataField"]);
        Assert.Equal("tutar", built[2]["dataField"]);
    }

    [Fact]
    public void FluentMethodsReturnTheSameBuilderInstance()
    {
        var builder = new PivotFieldBuilder();

        Assert.Same(builder, builder.DataField("tutar"));
        Assert.Same(builder, builder.Caption("Tutar"));
        Assert.Same(builder, builder.Area(PivotArea.Data));
    }

    [Fact]
    public void AvailableAreaSerializesAsLowerCamelCase()
    {
        var field = new PivotFieldBuilder()
            .DataField("miktar")
            .Area(PivotArea.Available)
            .Role(PivotFieldRole.Measure)
            .Build();

        Assert.Equal("available", field["area"]);
        Assert.Equal("measure", field["role"]);
    }

    [Theory]
    [InlineData(PivotFieldRole.Dimension, "dimension")]
    [InlineData(PivotFieldRole.Measure, "measure")]
    public void EveryRoleSerializesAsLowerCamelCase(PivotFieldRole role, string expected)
    {
        var area = role == PivotFieldRole.Measure ? PivotArea.Data : PivotArea.Row;
        var field = new PivotFieldBuilder().DataField("alan").Area(area).Role(role).Build();

        Assert.Equal(expected, field["role"]);
    }

    [Fact]
    public void RoleIsOmittedWhenNotSetSoJavaScriptInfersIt()
    {
        var field = new PivotFieldBuilder().DataField("urun").Area(PivotArea.Row).Build();

        Assert.False(field.ContainsKey("role"));
    }

    [Fact]
    public void AnAvailableFieldWithoutARoleThrows()
    {
        var exception = Assert.Throws<InvalidOperationException>(
            () => new PivotFieldBuilder().DataField("miktar").Area(PivotArea.Available).Build());

        Assert.Contains("miktar", exception.Message, StringComparison.Ordinal);
        Assert.Contains("Role", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void AMeasureOutsideTheDataAreaThrows()
    {
        var exception = Assert.Throws<InvalidOperationException>(
            () => new PivotFieldBuilder()
                .DataField("tutar")
                .Area(PivotArea.Row)
                .Role(PivotFieldRole.Measure)
                .Build());

        Assert.Contains("tutar", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void ADimensionInTheDataAreaThrows()
    {
        Assert.Throws<InvalidOperationException>(
            () => new PivotFieldBuilder()
                .DataField("urun")
                .Area(PivotArea.Data)
                .Role(PivotFieldRole.Dimension)
                .Build());
    }

    [Fact]
    public void AnAggregationOnAnAvailableFieldThrows()
    {
        Assert.Throws<InvalidOperationException>(
            () => new PivotFieldBuilder()
                .DataField("miktar")
                .Area(PivotArea.Available)
                .Role(PivotFieldRole.Measure)
                .Aggregation(PivotAggregation.Sum)
                .Build());
    }

    // The browser renderer reads format as an object
    // ({ type, decimals, useGrouping, currency }); a string could never satisfy
    // it, which is why the old Format(string) was silently ineffective.
    [Fact]
    public void FormatIsEmittedAsAnObjectTheRendererCanRead()
    {
        var field = new PivotFieldBuilder()
            .DataField("tutar")
            .Area(PivotArea.Data)
            .Aggregation(PivotAggregation.Sum)
            .FormatType(PivotValueFormatType.Currency)
            .FormatDecimals(0)
            .FormatGrouping(true)
            .FormatCurrency("TRY")
            .Build();

        var format = Assert.IsAssignableFrom<IDictionary<string, object?>>(field["format"]);

        Assert.Equal("currency", format["type"]);
        Assert.Equal(0, format["decimals"]);
        Assert.Equal(true, format["useGrouping"]);
        Assert.Equal("TRY", format["currency"]);
    }

    [Theory]
    [InlineData(PivotValueFormatType.Number, "number")]
    [InlineData(PivotValueFormatType.Currency, "currency")]
    [InlineData(PivotValueFormatType.Percent, "percent")]
    public void EveryFormatTypeSerializesAsLowerCamelCase(PivotValueFormatType type, string expected)
    {
        var field = new PivotFieldBuilder().DataField("tutar").FormatType(type).Build();
        var format = Assert.IsAssignableFrom<IDictionary<string, object?>>(field["format"]);

        Assert.Equal(expected, format["type"]);
    }

    [Fact]
    public void OnlyTheFormatMembersThatWereSetAreEmitted()
    {
        var field = new PivotFieldBuilder().DataField("tutar").FormatDecimals(2).Build();
        var format = Assert.IsAssignableFrom<IDictionary<string, object?>>(field["format"]);

        Assert.Equal(2, format["decimals"]);
        Assert.False(format.ContainsKey("type"));
        Assert.False(format.ContainsKey("useGrouping"));
        Assert.False(format.ContainsKey("currency"));
    }

    [Fact]
    public void FormatOutsideTheDataAreaIsRejected()
    {
        var builder = new PivotFieldBuilder()
            .DataField("bolge")
            .Area(PivotArea.Row)
            .FormatDecimals(2);

        var error = Assert.Throws<InvalidOperationException>(() => builder.Build());

        Assert.Contains("Format", error.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(7)]
    public void FormatDecimalsOutsideTheSupportedRangeIsRejected(int decimals)
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => new PivotFieldBuilder().DataField("tutar").FormatDecimals(decimals));
    }

    [Fact]
    public void FormatCurrencyRequiresAValue()
    {
        Assert.Throws<ArgumentException>(
            () => new PivotFieldBuilder().DataField("tutar").FormatCurrency("  "));
    }

    [Fact]
    public void SortByValueKeyIsEmittedOnlyWhenDeclared()
    {
        var declared = new PivotFieldBuilder()
            .DataField("Category").Area(PivotArea.Row).SortByValueKey("Amount_sum").Build();
        var undeclared = new PivotFieldBuilder()
            .DataField("Category").Area(PivotArea.Row).Build();

        Assert.Equal("Amount_sum", declared["sortByValueKey"]);
        // No direction was declared, and none is invented: the browser applies
        // the row axis default.
        Assert.False(declared.ContainsKey("sortOrder"));
        Assert.False(undeclared.ContainsKey("sortByValueKey"));
    }

    [Theory]
    [InlineData(PivotArea.Data)]
    [InlineData(PivotArea.Filter)]
    public void SortByValueKeyOutsideTheRowAndColumnAreasThrows(PivotArea area)
    {
        var builder = new PivotFieldBuilder()
            .DataField("Category").Area(area).SortByValueKey("Amount_sum");

        var exception = Assert.Throws<InvalidOperationException>(() => builder.Build());

        Assert.Contains("SortByValueKey is only valid on fields whose Area is Row or Column", exception.Message);
    }

    [Fact]
    public void AColumnFieldCanSortByValueAlongARowPath()
    {
        var field = new PivotFieldBuilder()
            .DataField("Year").Area(PivotArea.Column)
            .SortOrder(PivotSortDirection.Descending)
            .SortByValueKey("Amount_sum")
            .SortBySummaryPath("East")
            .Build();

        Assert.Equal("Amount_sum", field["sortByValueKey"]);
        Assert.Equal(new string?[] { "East" }, field["sortBySummaryPath"]);
    }

    [Fact]
    public void ASummaryPathWithoutAValueKeyThrows()
    {
        var builder = new PivotFieldBuilder()
            .DataField("Category").Area(PivotArea.Row).SortBySummaryPath("2025");

        var exception = Assert.Throws<InvalidOperationException>(() => builder.Build());

        Assert.Contains("SortBySummaryPath without SortByValueKey", exception.Message);
    }

    [Fact]
    public void AnExpressionIsEmittedInPlaceOfAnAggregation()
    {
        var field = new PivotFieldBuilder()
            .DataField("Profit")
            .Expression("[Revenue] - [Cost]")
            .Build();

        Assert.Equal("[Revenue] - [Cost]", field["expression"]);
        Assert.False(field.ContainsKey("aggregation"));
    }

    [Fact]
    public void ACalculatedFieldInTheFieldListIsAMeasure()
    {
        var field = new PivotFieldBuilder()
            .DataField("Profit")
            .Area(PivotArea.Available)
            .Expression("[Revenue] - [Cost]")
            .Build();

        Assert.Equal("measure", field["role"]);
    }

    [Fact]
    public void AnExpressionOutsideTheDataAreaIsRefused()
    {
        var builder = new PivotFieldBuilder().DataField("Profit").Area(PivotArea.Row).Expression("[A]");

        Assert.Throws<InvalidOperationException>(() => builder.Build());
    }

    [Fact]
    public void AnExpressionBesideAnAggregationIsRefused()
    {
        var builder = new PivotFieldBuilder()
            .DataField("Profit")
            .Aggregation(PivotAggregation.Sum)
            .Expression("[A]");

        Assert.Throws<InvalidOperationException>(() => builder.Build());
    }

    [Fact]
    public void CalculatedWithoutAnExpressionIsRefused()
    {
        var builder = new PivotFieldBuilder().DataField("Profit").Aggregation(PivotAggregation.Calculated);

        Assert.Throws<InvalidOperationException>(() => builder.Build());
    }

    [Fact]
    public void AnUnreadableExpressionIsRefusedWhereItIsWritten()
    {
        Assert.Throws<PivotExpressionException>(() => new PivotFieldBuilder().Expression("Revenue - Cost"));
    }

    [Fact]
    public void TheValueKeyOfACalculatedField()
    {
        Assert.Equal("Profit_calculated", PivotValueKey.For("Profit", PivotAggregation.Calculated));
    }
}
