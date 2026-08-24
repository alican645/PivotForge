using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Razor.TagHelpers;
using PivotForge.AspNetCore.Rendering;
using PivotForge.Core;
using Xunit;

namespace PivotForge.AspNetCore.Tests;

public class PivotTagHelperTests
{
    /// <summary>
    /// Declares a pivot-field element the way a view author would write it. Enum members
    /// are nullable here to express "attribute not written", which the tag helper detects
    /// from the element's attribute list rather than from a nullable property.
    /// </summary>
    private sealed record FieldSpec(
        string? Field,
        PivotArea? Area = null,
        string? Caption = null,
        PivotAggregation? Aggregation = null,
        PivotShowAs? ShowAs = null,
        PivotValueFormatType? FormatType = null,
        int? FormatDecimals = null,
        bool? FormatGrouping = null,
        string? FormatCurrency = null,
        bool? Visible = null,
        bool? Expanded = null,
        bool? ShowTotals = null,
        int? AreaIndex = null,
        PivotSortDirection? SortOrder = null,
        PivotGroupInterval? GroupInterval = null);

    /// <summary>Builds the tag helper and the attribute list Razor would hand it.</summary>
    private static (PivotFieldTagHelper Helper, TagHelperAttributeList Attributes) Build(FieldSpec spec)
    {
        var helper = new PivotFieldTagHelper();
        var attributes = new TagHelperAttributeList();

        if (spec.Field is not null)
        {
            helper.Field = spec.Field;
            attributes.Add(new TagHelperAttribute("field", spec.Field));
        }

        if (spec.Caption is not null)
        {
            helper.Caption = spec.Caption;
            attributes.Add(new TagHelperAttribute("caption", spec.Caption));
        }

        if (spec.Area is { } area)
        {
            helper.Area = area;
            attributes.Add(new TagHelperAttribute("area", area.ToString()));
        }

        if (spec.Aggregation is { } aggregation)
        {
            helper.Aggregation = aggregation;
            attributes.Add(new TagHelperAttribute("aggregation", aggregation.ToString()));
        }

        if (spec.ShowAs is { } showAs)
        {
            helper.ShowAs = showAs;
            attributes.Add(new TagHelperAttribute("show-as", showAs.ToString()));
        }

        if (spec.FormatType is { } formatType)
        {
            helper.FormatType = formatType;
            attributes.Add(new TagHelperAttribute("format-type", formatType.ToString()));
        }

        if (spec.FormatDecimals is { } formatDecimals)
        {
            helper.FormatDecimals = formatDecimals;
            attributes.Add(new TagHelperAttribute("format-decimals", formatDecimals));
        }

        if (spec.FormatGrouping is { } formatGrouping)
        {
            helper.FormatGrouping = formatGrouping;
            attributes.Add(new TagHelperAttribute("format-grouping", formatGrouping));
        }

        if (spec.FormatCurrency is not null)
        {
            helper.FormatCurrency = spec.FormatCurrency;
            attributes.Add(new TagHelperAttribute("format-currency", spec.FormatCurrency));
        }

        if (spec.Visible is { } visible)
        {
            helper.Visible = visible;
            attributes.Add(new TagHelperAttribute("visible", visible));
        }

        if (spec.Expanded is { } expanded)
        {
            helper.Expanded = expanded;
            attributes.Add(new TagHelperAttribute("expanded", expanded));
        }

        if (spec.ShowTotals is { } showTotals)
        {
            helper.ShowTotals = showTotals;
            attributes.Add(new TagHelperAttribute("show-totals", showTotals));
        }

        if (spec.AreaIndex is { } areaIndex)
        {
            helper.AreaIndex = areaIndex;
            attributes.Add(new TagHelperAttribute("area-index", areaIndex));
        }

        if (spec.SortOrder is { } sortOrder)
        {
            helper.SortOrder = sortOrder;
            attributes.Add(new TagHelperAttribute("sort-order", sortOrder.ToString()));
        }

        if (spec.GroupInterval is { } groupInterval)
        {
            helper.GroupInterval = groupInterval;
            attributes.Add(new TagHelperAttribute("group-interval", groupInterval.ToString()));
        }

        return (helper, attributes);
    }

    /// <summary>Runs the grid tag helper with the supplied child field declarations.</summary>
    /// <summary>Non-field children the next RenderAsync call should also execute.</summary>
    private static TagHelper[] Children { get; set; } = [];

    private static Task<string> RenderAsync(PivotGridTagHelper grid, params FieldSpec[] fields) =>
        RenderAsync(grid, [], fields);

    private static async Task<string> RenderWithChildrenAsync(
        PivotGridTagHelper grid, TagHelper[] children, params FieldSpec[] fields)
    {
        Children = children;
        try
        {
            return await RenderAsync(grid, [], fields);
        }
        finally
        {
            Children = [];
        }
    }

    /// <param name="writtenAttributes">
    /// The attribute names the view author wrote on the pivot-grid element. Only these
    /// reach context.AllAttributes, which is how the grid tells a written enum member
    /// from the CLR default.
    /// </param>
    private static async Task<string> RenderAsync(
        PivotGridTagHelper grid, string[] writtenAttributes, params FieldSpec[] fields)
    {
        var gridAttributes = new TagHelperAttributeList(
            writtenAttributes.Select(name => new TagHelperAttribute(name)));
        var context = new TagHelperContext(gridAttributes, new Dictionary<object, object>(), "grid");
        var output = new TagHelperOutput(
            "pivot-grid",
            [],
            async (_, _) =>
            {
                // Razor executes child tag helpers while the parent awaits its child
                // content; each child registers itself through context.Items.
                foreach (var spec in fields)
                {
                    var (helper, attributes) = Build(spec);
                    var childContext = new TagHelperContext(attributes, context.Items, "field");
                    var childOutput = new TagHelperOutput(
                        "pivot-field",
                        attributes,
                        (_, _) => Task.FromResult<TagHelperContent>(new DefaultTagHelperContent()));

                    await helper.ProcessAsync(childContext, childOutput);
                }

                // Filters, sorts and rules register the same way fields do.
                foreach (var child in Children)
                {
                    var childContext = new TagHelperContext([], context.Items, "child");
                    var childOutput = new TagHelperOutput(
                        "pivot-child",
                        [],
                        (_, _) => Task.FromResult<TagHelperContent>(new DefaultTagHelperContent()));

                    await child.ProcessAsync(childContext, childOutput);
                }

                return new DefaultTagHelperContent();
            });

        await grid.ProcessAsync(context, output);

        using var writer = new StringWriter();
        output.WriteTo(writer, HtmlEncoder.Default);
        return writer.ToString();
    }

    private static JsonElement ConfigOf(string html)
    {
        var start = html.IndexOf('{', html.IndexOf("application/json", StringComparison.Ordinal));
        var end = html.IndexOf("</script>", start, StringComparison.Ordinal);
        return JsonDocument.Parse(html[start..end]).RootElement;
    }

    private static string RenderBuilder(PivotGridBuilder builder)
    {
        using var writer = new StringWriter();
        builder.WriteTo(writer, HtmlEncoder.Default);
        return writer.ToString();
    }

    [Fact]
    public async Task RendersTheSameMarkupAsTheEquivalentHtmlHelperConfiguration()
    {
        var fromTagHelper = await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid", AllowSorting = true },
            new FieldSpec("Region", PivotArea.Row, "Bölge"),
            new FieldSpec("Year", PivotArea.Column, "Yıl"),
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum));

        var fromBuilder = RenderBuilder(new PivotGridBuilder()
            .Id("pivotGrid")
            .AllowSorting(true)
            .Fields(fields =>
            {
                fields.Add().DataField("Region").Area(PivotArea.Row).Caption("Bölge");
                fields.Add().DataField("Year").Area(PivotArea.Column).Caption("Yıl");
                fields.Add().DataField("Amount").Area(PivotArea.Data).Caption("Tutar")
                    .Aggregation(PivotAggregation.Sum);
            }));

        Assert.Equal(fromBuilder, fromTagHelper);
    }

    [Fact]
    public async Task SuppressesItsOwnTagSoOnlyTheGridMarkupIsEmitted()
    {
        var html = await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            new FieldSpec("Amount", PivotArea.Data));

        Assert.DoesNotContain("<pivot-grid", html, StringComparison.Ordinal);
        Assert.DoesNotContain("<pivot-field", html, StringComparison.Ordinal);
        Assert.Contains("id=\"pivotGrid\"", html, StringComparison.Ordinal);
    }

    [Fact]
    public async Task FieldsReachTheConfigurationInDeclarationOrder()
    {
        var html = await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            new FieldSpec("Region", PivotArea.Row),
            new FieldSpec("Category", PivotArea.Row),
            new FieldSpec("Amount", PivotArea.Data, Aggregation: PivotAggregation.Sum));

        var fields = ConfigOf(html).GetProperty("fields");

        Assert.Equal(3, fields.GetArrayLength());
        Assert.Equal("Region", fields[0].GetProperty("dataField").GetString());
        Assert.Equal("Category", fields[1].GetProperty("dataField").GetString());
        Assert.Equal("Amount", fields[2].GetProperty("dataField").GetString());
        Assert.Equal("sum", fields[2].GetProperty("aggregation").GetString());
    }

    // The builder omits unset options so the browser applies its own defaults. A
    // non-nullable grid property would send the CLR default for an attribute the author
    // never wrote, silently disabling the feature.
    [Fact]
    public async Task UnwrittenGridAttributesAreOmittedRatherThanSentAsFalse()
    {
        var html = await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            new FieldSpec("Amount", PivotArea.Data));

        var config = ConfigOf(html);

        Assert.False(config.TryGetProperty("allowSorting", out _));
        Assert.False(config.TryGetProperty("allowFiltering", out _));
        Assert.False(config.TryGetProperty("allowDrillDown", out _));
        Assert.False(config.TryGetProperty("allowExcelExport", out _));
        Assert.False(config.TryGetProperty("allowConditionalFormatting", out _));
        Assert.False(config.TryGetProperty("autoLoad", out _));
        Assert.False(config.TryGetProperty("largeData", out _));
        Assert.False(config.TryGetProperty("pageSize", out _));
        Assert.False(config.TryGetProperty("sourceRowCount", out _));
        Assert.False(config.TryGetProperty("endpointPrefix", out _));
    }

    // Enum members are non-nullable so Razor accepts aggregation="Sum" unqualified,
    // which means an unwritten attribute still carries the CLR default. The tag helper
    // must consult the element's attributes instead, or every row field would silently
    // arrive carrying Sum.
    [Fact]
    public async Task AnUnwrittenAggregationIsOmittedEvenThoughTheEnumCannotBeNull()
    {
        var html = await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            new FieldSpec("Region", PivotArea.Row),
            new FieldSpec("Amount", PivotArea.Data, Aggregation: PivotAggregation.Sum));

        var fields = ConfigOf(html).GetProperty("fields");

        Assert.False(fields[0].TryGetProperty("aggregation", out _));
        Assert.False(fields[0].TryGetProperty("showAs", out _));
        Assert.Equal("sum", fields[1].GetProperty("aggregation").GetString());
    }

    [Fact]
    public async Task EveryWrittenGridOptionReachesTheConfiguration()
    {
        var html = await RenderAsync(
            new PivotGridTagHelper
            {
                Id = "pivotGrid",
                AllowSorting = false,
                AllowFiltering = true,
                AllowDrillDown = false,
                AllowExcelExport = true,
                AllowConditionalFormatting = false,
                AutoLoad = false,
                LargeData = true,
                PageSize = 75,
                SourceRowCount = 250_000,
                EndpointPrefix = "/raporlar/pivot-api"
            },
            new FieldSpec("Amount", PivotArea.Data));

        var config = ConfigOf(html);

        Assert.False(config.GetProperty("allowSorting").GetBoolean());
        Assert.True(config.GetProperty("allowFiltering").GetBoolean());
        Assert.False(config.GetProperty("allowDrillDown").GetBoolean());
        Assert.True(config.GetProperty("allowExcelExport").GetBoolean());
        Assert.False(config.GetProperty("allowConditionalFormatting").GetBoolean());
        Assert.False(config.GetProperty("autoLoad").GetBoolean());
        Assert.True(config.GetProperty("largeData").GetBoolean());
        Assert.Equal(75, config.GetProperty("pageSize").GetInt32());
        Assert.Equal(250_000, config.GetProperty("sourceRowCount").GetInt32());
        Assert.Equal("/raporlar/pivot-api", config.GetProperty("endpointPrefix").GetString());
    }

    [Fact]
    public async Task EveryWrittenFieldOptionReachesTheConfiguration()
    {
        var html = await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            new FieldSpec(
                "Amount",
                PivotArea.Data,
                "Tutar",
                PivotAggregation.Sum,
                PivotShowAs.PercentOfRowTotal,
                PivotValueFormatType.Number,
                2,
                Visible: false));

        var field = ConfigOf(html).GetProperty("fields")[0];

        Assert.Equal("Amount", field.GetProperty("dataField").GetString());
        Assert.Equal("Tutar", field.GetProperty("caption").GetString());
        Assert.Equal("data", field.GetProperty("area").GetString());
        Assert.Equal("sum", field.GetProperty("aggregation").GetString());
        Assert.Equal("percentOfRowTotal", field.GetProperty("showAs").GetString());
        Assert.Equal("number", field.GetProperty("format").GetProperty("type").GetString());
        Assert.Equal(2, field.GetProperty("format").GetProperty("decimals").GetInt32());
        Assert.False(field.GetProperty("visible").GetBoolean());
    }

    [Fact]
    public async Task AFieldWithoutAnAreaDefaultsToDataLikeTheBuilder()
    {
        var html = await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            new FieldSpec("Amount"));

        Assert.Equal("data", ConfigOf(html).GetProperty("fields")[0].GetProperty("area").GetString());
    }

    [Fact]
    public async Task CssClassIsAppendedToTheDefaultClass()
    {
        var html = await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid", CssClass = "rapor-tablosu" },
            new FieldSpec("Amount", PivotArea.Data));

        Assert.Contains("class=\"pivotforge-grid rapor-tablosu\"", html, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AGridWithoutAnIdThrows()
    {
        var exception = await Assert.ThrowsAsync<InvalidOperationException>(
            () => RenderAsync(new PivotGridTagHelper(), new FieldSpec("Amount", PivotArea.Data)));

        Assert.Contains("Id", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AGridWithoutFieldsThrows()
    {
        var exception = await Assert.ThrowsAsync<InvalidOperationException>(
            () => RenderAsync(new PivotGridTagHelper { Id = "pivotGrid" }));

        Assert.Contains("field", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task AFieldWithoutASourceColumnThrows()
    {
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => RenderAsync(
                new PivotGridTagHelper { Id = "pivotGrid" },
                new FieldSpec(null, PivotArea.Data)));
    }

    // The JavaScript validator rejects an aggregation outside the data area and the
    // builder rejects it server-side; the tag helper must not bypass that check.
    [Fact]
    public async Task AnAggregationOutsideTheDataAreaThrows()
    {
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => RenderAsync(
                new PivotGridTagHelper { Id = "pivotGrid" },
                new FieldSpec("Region", PivotArea.Row, Aggregation: PivotAggregation.Sum),
                new FieldSpec("Amount", PivotArea.Data)));
    }

    [Fact]
    public async Task AFieldOutsideAGridThrows()
    {
        // A pivot-field with no enclosing pivot-grid has nowhere to register itself.
        var context = new TagHelperContext([], new Dictionary<object, object>(), "orphan");
        var output = new TagHelperOutput(
            "pivot-field",
            [],
            (_, _) => Task.FromResult<TagHelperContent>(new DefaultTagHelperContent()));

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(
            () => new PivotFieldTagHelper { Field = "Amount" }.ProcessAsync(context, output));

        Assert.Contains("pivot-grid", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task FormatAttributesReachTheSerializedFieldAsAnObject()
    {
        var html = await RenderAsync(
            new PivotGridTagHelper { Id = "grid" },
            new FieldSpec(
                "tutar",
                PivotArea.Data,
                Aggregation: PivotAggregation.Sum,
                FormatType: PivotValueFormatType.Currency,
                FormatDecimals: 0,
                FormatGrouping: true,
                FormatCurrency: "TRY"));

        var format = ConfigOf(html).GetProperty("fields")[0].GetProperty("format");

        Assert.Equal("currency", format.GetProperty("type").GetString());
        Assert.Equal(0, format.GetProperty("decimals").GetInt32());
        Assert.True(format.GetProperty("useGrouping").GetBoolean());
        Assert.Equal("TRY", format.GetProperty("currency").GetString());
    }

    // format-type is non-nullable, so "not written" and "written as Number" are
    // only distinguishable through the element's attribute list.
    [Fact]
    public async Task AnUnwrittenFormatTypeEmitsNoFormatAtAll()
    {
        var html = await RenderAsync(
            new PivotGridTagHelper { Id = "grid" },
            new FieldSpec("tutar", PivotArea.Data));

        Assert.False(ConfigOf(html).GetProperty("fields")[0].TryGetProperty("format", out _));
    }

    [Fact]
    public async Task FormatTypeWrittenAsNumberIsEmitted()
    {
        var html = await RenderAsync(
            new PivotGridTagHelper { Id = "grid" },
            new FieldSpec("tutar", PivotArea.Data, FormatType: PivotValueFormatType.Number));

        var format = ConfigOf(html).GetProperty("fields")[0].GetProperty("format");

        Assert.Equal("number", format.GetProperty("type").GetString());
    }

    // --- Presentation options -------------------------------------------------
    //
    // These reach the browser renderer rather than the widget, so they travel in a
    // nested "rendererOptions" object. The widget merges that over its own defaults.

    [Fact]
    public async Task OmitsRendererOptionsEntirelyWhenNoPresentationOptionIsDeclared()
    {
        var config = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        Assert.False(config.TryGetProperty("rendererOptions", out _));
    }

    [Fact]
    public async Task WritesDeclaredPresentationOptionsUnderRendererOptions()
    {
        var config = ConfigOf(await RenderAsync(
            new PivotGridTagHelper
            {
                Id = "pivotGrid",
                Subtotals = false,
                ShowGrandTotal = false,
                ContextMenu = false,
                RepeatRowLabels = true,
                MinColumnWidth = 90,
                MaxColumnWidth = 300,
                EmptyText = "",
                TotalText = "Genel"
            },
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        var renderer = config.GetProperty("rendererOptions");
        Assert.False(renderer.GetProperty("subtotals").GetBoolean());
        Assert.False(renderer.GetProperty("showGrandTotal").GetBoolean());
        Assert.False(renderer.GetProperty("contextMenu").GetBoolean());
        Assert.True(renderer.GetProperty("repeatRowLabels").GetBoolean());
        Assert.Equal(90, renderer.GetProperty("minColumnWidth").GetInt32());
        Assert.Equal(300, renderer.GetProperty("maxColumnWidth").GetInt32());
        Assert.Equal("", renderer.GetProperty("emptyText").GetString());
        Assert.Equal("Genel", renderer.GetProperty("totalText").GetString());
    }

    [Fact]
    public async Task LeavesUndeclaredPresentationOptionsOutOfRendererOptions()
    {
        var config = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid", Subtotals = false },
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        var renderer = config.GetProperty("rendererOptions");
        Assert.False(renderer.TryGetProperty("showGrandTotal", out _));
        Assert.False(renderer.TryGetProperty("layoutMode", out _));
    }

    [Theory]
    [InlineData(PivotSelectionMode.Single, "single")]
    [InlineData(PivotSelectionMode.None, "none")]
    public async Task WritesSelectionModeWhenTheAttributeIsWritten(
        PivotSelectionMode mode, string expected)
    {
        var config = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid", SelectionMode = mode },
            ["selection-mode"],
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        Assert.Equal(expected, config.GetProperty("rendererOptions").GetProperty("selectionMode").GetString());
    }

    [Fact]
    public async Task OmitsSelectionModeWhenTheAttributeIsNotWritten()
    {
        // Single is the CLR default, so an unwritten attribute must not be mistaken
        // for a deliberate "single" -- the renderer's own default has to win.
        var config = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid", Subtotals = false },
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        Assert.False(config.GetProperty("rendererOptions").TryGetProperty("selectionMode", out _));
    }

    [Theory]
    [InlineData(PivotGridLayoutMode.Tabular, "tabular")]
    [InlineData(PivotGridLayoutMode.Compact, "compact")]
    public async Task WritesLayoutModeWhenTheAttributeIsWritten(
        PivotGridLayoutMode mode, string expected)
    {
        var config = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid", LayoutMode = mode },
            ["layout-mode"],
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        Assert.Equal(expected, config.GetProperty("rendererOptions").GetProperty("layoutMode").GetString());
    }

    [Fact]
    public async Task PresentationOptionsMatchTheEquivalentBuilderConfiguration()
    {
        var fromTagHelper = await RenderAsync(
            new PivotGridTagHelper
            {
                Id = "pivotGrid",
                SelectionMode = PivotSelectionMode.None,
                LayoutMode = PivotGridLayoutMode.Compact,
                Subtotals = false,
                MinColumnWidth = 90
            },
            ["selection-mode", "layout-mode"],
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum));

        var fromBuilder = RenderBuilder(new PivotGridBuilder()
            .Id("pivotGrid")
            .SelectionMode(PivotSelectionMode.None)
            .LayoutMode(PivotGridLayoutMode.Compact)
            .Subtotals(false)
            .MinColumnWidth(90)
            .Fields(fields => fields.Add()
                .DataField("Amount").Area(PivotArea.Data).Caption("Tutar")
                .Aggregation(PivotAggregation.Sum)));

        Assert.Equal(fromBuilder, fromTagHelper);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void RefusesAColumnWidthThatIsNotPositive(int width)
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => new PivotGridBuilder().MinColumnWidth(width));
        Assert.Throws<ArgumentOutOfRangeException>(
            () => new PivotGridBuilder().MaxColumnWidth(width));
    }

    [Fact]
    public void RefusesABlankTotalTextButAcceptsAnEmptyPlaceholder()
    {
        Assert.Throws<ArgumentException>(() => new PivotGridBuilder().TotalText("  "));
        // An empty placeholder is meaningful: it renders nothing in an empty cell.
        new PivotGridBuilder().EmptyText("");
    }

    [Fact]
    public async Task WritesTheDeclaredAccessibleNameAndOmitsItOtherwise()
    {
        var named = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid", AriaLabel = "Bölge satışları" },
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        Assert.Equal(
            "Bölge satışları",
            named.GetProperty("rendererOptions").GetProperty("ariaLabel").GetString());

        var unnamed = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        // Left out entirely rather than written as null, so the renderer keeps
        // its own default instead of naming the grid "null".
        Assert.False(unnamed.TryGetProperty("rendererOptions", out var renderer) &&
            renderer.TryGetProperty("ariaLabel", out _));
    }

    [Fact]
    public async Task WritesADeclaredGroupInterval()
    {
        var config = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            new FieldSpec("OrderDate", PivotArea.Row, GroupInterval: PivotGroupInterval.Month),
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        var field = config.GetProperty("fields")[0];
        Assert.Equal("OrderDate", field.GetProperty("dataField").GetString());
        Assert.Equal("month", field.GetProperty("groupInterval").GetString());
    }

    [Fact]
    public async Task OmitsAnUndeclaredGroupInterval()
    {
        // None is the enum's default, so an undeclared attribute would otherwise
        // be written as a grouping the author never asked for.
        var config = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            new FieldSpec("Region", PivotArea.Row),
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        Assert.False(config.GetProperty("fields")[0].TryGetProperty("groupInterval", out _));
    }

    [Fact]
    public async Task WritesTheSameColumnAtTwoIntervals()
    {
        // The hierarchy a single date column can carry, which is the whole point
        // of identifying a level by more than its field name.
        var config = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            new FieldSpec("OrderDate", PivotArea.Row, "Yıl", GroupInterval: PivotGroupInterval.Year),
            new FieldSpec("OrderDate", PivotArea.Row, "Ay", GroupInterval: PivotGroupInterval.Month),
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        var fields = config.GetProperty("fields");
        Assert.Equal("year", fields[0].GetProperty("groupInterval").GetString());
        Assert.Equal("month", fields[1].GetProperty("groupInterval").GetString());
    }

    [Fact]
    public void RefusesAGroupIntervalOnAMeasure()
    {
        // A measure is aggregated rather than grouped; collapsing it to a month
        // would leave nothing to sum.
        var builder = new PivotFieldBuilder()
            .DataField("Amount")
            .Area(PivotArea.Data)
            .GroupInterval(PivotGroupInterval.Month);

        Assert.Throws<InvalidOperationException>(() => builder.Build());
    }

    [Fact]
    public async Task WritesTheDeclaredLocaleOverTheRequestsUiCulture()
    {
        using var _ = new UiCulture("tr-TR");

        var declared = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid", Locale = "en" },
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        Assert.Equal("en", declared.GetProperty("locale").GetString());

        var derived = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        // A Turkish request gets the Turkish pack without the markup asking for
        // it -- the locale is the one option a page should not have to repeat.
        Assert.Equal("tr", derived.GetProperty("locale").GetString());
    }

    [Fact]
    public async Task WritesTheDeclaredCultureAndOmitsItOtherwise()
    {
        var pinned = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid", Culture = "de-DE" },
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        Assert.Equal(
            "de-DE",
            pinned.GetProperty("rendererOptions").GetProperty("culture").GetString());

        var ambient = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        // Omitted rather than defaulted, so the browser formats in the reader's
        // own locale instead of one the page picked for them.
        Assert.False(ambient.TryGetProperty("rendererOptions", out var renderer) &&
            renderer.TryGetProperty("culture", out _));
    }

    [Fact]
    public async Task WritesExpandedAndShowTotalsOnlyWhenDeclared()
    {
        var declared = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            new FieldSpec("Region", PivotArea.Row, "Bölge", Expanded: false, ShowTotals: false),
            new FieldSpec("Category", PivotArea.Row, "Kategori"),
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        var fields = declared.GetProperty("fields");
        Assert.False(fields[0].GetProperty("expanded").GetBoolean());
        Assert.False(fields[0].GetProperty("showTotals").GetBoolean());

        // Omitted rather than written as true, so the browser's own default
        // applies and the payload does not grow for every undeclared field.
        Assert.False(fields[1].TryGetProperty("expanded", out _));
        Assert.False(fields[1].TryGetProperty("showTotals", out _));
    }

    [Fact]
    public void RefusesExpandedAndShowTotalsOutsideTheRowArea()
    {
        // Subtotals and collapsible groups are drawn on the row axis only.
        Assert.Throws<InvalidOperationException>(() => new PivotFieldBuilder()
            .DataField("Year").Area(PivotArea.Column).Expanded(false).Build());
        Assert.Throws<InvalidOperationException>(() => new PivotFieldBuilder()
            .DataField("Amount").Area(PivotArea.Data).ShowTotals(false).Build());

        // The row area accepts both.
        new PivotFieldBuilder().DataField("Region").Area(PivotArea.Row)
            .Expanded(false).ShowTotals(false).Build();
    }

    [Fact]
    public async Task WritesAreaIndexAndSortOrderOnlyWhenDeclared()
    {
        var declared = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            new FieldSpec("Region", PivotArea.Row, "Bölge",
                AreaIndex: 1, SortOrder: PivotSortDirection.Descending),
            new FieldSpec("Category", PivotArea.Row, "Kategori"),
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        var fields = declared.GetProperty("fields");
        Assert.Equal(1, fields[0].GetProperty("areaIndex").GetInt32());
        Assert.Equal("Descending", fields[0].GetProperty("sortOrder").GetString());

        Assert.False(fields[1].TryGetProperty("areaIndex", out _));
        Assert.False(fields[1].TryGetProperty("sortOrder", out _));
    }

    [Fact]
    public async Task WritesADeclaredAscendingSortOrder()
    {
        // Ascending is the enum's default value, so an unwritten attribute and a
        // deliberate sort-order="Ascending" arrive at the tag helper identically.
        // They differ on the column axis, where undeclared means discovery order.
        var declared = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            new FieldSpec("Year", PivotArea.Column, "Yıl", SortOrder: PivotSortDirection.Ascending),
            new FieldSpec("Region", PivotArea.Row, "Bölge"),
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        Assert.Equal("Ascending", declared.GetProperty("fields")[0].GetProperty("sortOrder").GetString());
    }

    [Fact]
    public void RefusesSortOrderOutsideTheRowAndColumnAreas()
    {
        // Only those two axes draw a header level there is an order to declare.
        Assert.Throws<InvalidOperationException>(() => new PivotFieldBuilder()
            .DataField("Amount").Area(PivotArea.Data)
            .SortOrder(PivotSortDirection.Ascending).Build());
        Assert.Throws<InvalidOperationException>(() => new PivotFieldBuilder()
            .DataField("Region").Area(PivotArea.Filter)
            .SortOrder(PivotSortDirection.Ascending).Build());

        new PivotFieldBuilder().DataField("Region").Area(PivotArea.Row)
            .SortOrder(PivotSortDirection.Descending).Build();
        new PivotFieldBuilder().DataField("Year").Area(PivotArea.Column)
            .SortOrder(PivotSortDirection.Ascending).Build();
    }

    [Fact]
    public void RefusesANegativeAreaIndex()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new PivotFieldBuilder().AreaIndex(-1));
    }

    [Fact]
    public void RefusesABlankCulture()
    {
        Assert.Throws<ArgumentException>(() => new PivotGridBuilder().Culture("  "));
    }

    [Fact]
    public void RefusesABlankAccessibleName()
    {
        // A grid named " " is worse than an unnamed one: it silences the default.
        Assert.Throws<ArgumentException>(() => new PivotGridBuilder().AriaLabel("  "));
    }

    // --- Declarative events ---------------------------------------------------

    [Fact]
    public async Task OmitsEventsEntirelyWhenNoHandlerIsNamed()
    {
        var config = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        Assert.False(config.TryGetProperty("events", out _));
    }

    [Fact]
    public async Task WritesNamedHandlersUnderEvents()
    {
        var config = ConfigOf(await RenderAsync(
            new PivotGridTagHelper
            {
                Id = "pivotGrid",
                OnSelectionChanged = "handleSelection",
                OnDataLoaded = "app.handlers.loaded",
                OnError = "handleError"
            },
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        var events = config.GetProperty("events");
        Assert.Equal("handleSelection", events.GetProperty("selectionChanged").GetString());
        Assert.Equal("app.handlers.loaded", events.GetProperty("dataLoaded").GetString());
        Assert.Equal("handleError", events.GetProperty("error").GetString());
        Assert.False(events.TryGetProperty("cellCopied", out _));
    }

    [Fact]
    public async Task EventsMatchTheEquivalentBuilderConfiguration()
    {
        var fromTagHelper = await RenderAsync(
            new PivotGridTagHelper
            {
                Id = "pivotGrid",
                OnSelectionChanged = "handleSelection",
                OnCellDoubleClick = "handleDetail"
            },
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum));

        var fromBuilder = RenderBuilder(new PivotGridBuilder()
            .Id("pivotGrid")
            .OnSelectionChanged("handleSelection")
            .OnCellDoubleClick("handleDetail")
            .Fields(fields => fields.Add()
                .DataField("Amount").Area(PivotArea.Data).Caption("Tutar")
                .Aggregation(PivotAggregation.Sum)));

        Assert.Equal(fromBuilder, fromTagHelper);
    }

    [Fact]
    public void RefusesABlankHandlerName()
    {
        Assert.Throws<ArgumentException>(
            () => new PivotGridBuilder().OnSelectionChanged("  "));
        // A null name reports the more precise ArgumentNullException.
        Assert.Throws<ArgumentNullException>(
            () => new PivotGridBuilder().OnDataLoaded(null!));
    }

    // --- Initial state --------------------------------------------------------

    private static readonly FieldSpec[] MinimalFields =
        [new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)];

    [Fact]
    public async Task WritesDeclaredFilters()
    {
        var config = ConfigOf(await RenderWithChildrenAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            [new PivotFilterTagHelper { Field = "Region", Values = "Marmara, Ege" }],
            MinimalFields));

        var filter = config.GetProperty("filters")[0];
        Assert.Equal("Region", filter.GetProperty("field").GetString());
        Assert.Equal(
            new[] { "Marmara", "Ege" },
            filter.GetProperty("values").EnumerateArray().Select(v => v.GetString()).ToArray());
    }

    [Fact]
    public async Task WritesAnExcludingFilterMode()
    {
        var config = ConfigOf(await RenderWithChildrenAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            [new PivotFilterTagHelper
            {
                Field = "Region",
                Values = "Marmara, Ege",
                Type = PivotFilterMode.Exclude
            }],
            MinimalFields));

        Assert.Equal("Exclude", config.GetProperty("filters")[0].GetProperty("mode").GetString());
    }

    [Fact]
    public async Task OmitsTheFilterModeWhenItIsTheDefault()
    {
        var config = ConfigOf(await RenderWithChildrenAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            [new PivotFilterTagHelper { Field = "Region", Values = "Marmara" }],
            MinimalFields));

        // Omitted rather than written as Include, so a payload only carries the
        // mode of a filter that actually declared one.
        Assert.False(config.GetProperty("filters")[0].TryGetProperty("mode", out _));
    }

    [Fact]
    public async Task WritesADeclaredRanking()
    {
        var config = ConfigOf(await RenderWithChildrenAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            [new PivotTopNTagHelper { Field = "Region", Count = 3 }],
            MinimalFields));

        var ranking = config.GetProperty("topN")[0];
        Assert.Equal("Region", ranking.GetProperty("field").GetString());
        Assert.Equal(3, ranking.GetProperty("count").GetInt32());
    }

    [Fact]
    public async Task OmitsARankingsDefaultsRatherThanWritingThem()
    {
        // The same rule the filter mode follows: a ranking that took the defaults
        // travels as the two members it actually declared.
        var config = ConfigOf(await RenderWithChildrenAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            [new PivotTopNTagHelper { Field = "Region", Count = 3 }],
            MinimalFields));

        var ranking = config.GetProperty("topN")[0];
        Assert.False(ranking.TryGetProperty("mode", out _));
        Assert.False(ranking.TryGetProperty("valueKey", out _));
    }

    [Fact]
    public async Task WritesARankingsValueKeyAndMode()
    {
        var config = ConfigOf(await RenderWithChildrenAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            [new PivotTopNTagHelper
            {
                Field = "Region",
                Count = 2,
                ValueKey = "Amount_sum",
                Mode = PivotTopNMode.Bottom
            }],
            MinimalFields));

        var ranking = config.GetProperty("topN")[0];
        Assert.Equal("Amount_sum", ranking.GetProperty("valueKey").GetString());
        Assert.Equal("Bottom", ranking.GetProperty("mode").GetString());
    }

    [Fact]
    public async Task OmitsTheRankingListWhenNoneWasDeclared()
    {
        var config = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid" }, [], MinimalFields));

        Assert.False(config.TryGetProperty("topN", out _));
    }

    [Fact]
    public async Task ARankingWithoutAFieldIsRejected()
    {
        await Assert.ThrowsAsync<InvalidOperationException>(() => RenderWithChildrenAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            [new PivotTopNTagHelper { Count = 3 }],
            MinimalFields));
    }

    [Fact]
    public async Task ARankingKeepingNoGroupsIsRejected()
    {
        // A declaration is code, so this fails where it was written rather than
        // producing an empty table at runtime.
        await Assert.ThrowsAsync<InvalidOperationException>(() => RenderWithChildrenAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            [new PivotTopNTagHelper { Field = "Region", Count = 0 }],
            MinimalFields));
    }

    [Fact]
    public async Task ARankingOutsideAGridIsRejected()
    {
        var helper = new PivotTopNTagHelper { Field = "Region", Count = 3 };
        var context = new TagHelperContext([], new Dictionary<object, object>(), "orphan");
        var output = new TagHelperOutput(
            "pivot-top-n",
            [],
            (_, _) => Task.FromResult<TagHelperContent>(new DefaultTagHelperContent()));

        await Assert.ThrowsAsync<InvalidOperationException>(() => helper.ProcessAsync(context, output));
    }

    [Fact]
    public async Task WritesHideEmptySummaryCellsAsATopLevelOption()
    {
        // The engine drops them, so it belongs to the request rather than to
        // rendererOptions: hiding them in the browser would leave paging counting
        // rows nobody can see.
        var config = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid", HideEmptySummaryCells = true },
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        Assert.True(config.GetProperty("hideEmptySummaryCells").GetBoolean());
    }

    [Fact]
    public async Task OmitsHideEmptySummaryCellsWhenUndeclared()
    {
        var config = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        Assert.False(config.TryGetProperty("hideEmptySummaryCells", out _));
    }

    [Fact]
    public async Task WritesADeclaredFilterOperator()
    {
        var config = ConfigOf(await RenderWithChildrenAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            [new PivotFilterTagHelper
            {
                Field = "Category",
                Values = "çim",
                Operator = PivotFilterOperator.Contains
            }],
            MinimalFields));

        var filter = config.GetProperty("filters")[0];
        Assert.Equal("Contains", filter.GetProperty("operator").GetString());
        Assert.Equal(
            new[] { "çim" },
            filter.GetProperty("values").EnumerateArray().Select(v => v.GetString()).ToArray());
    }

    [Fact]
    public async Task OmitsTheFilterOperatorWhenItIsTheDefault()
    {
        // Equals is what a filter always was, so a payload from a page that never
        // touched an operator has to look exactly as it did before they existed.
        var config = ConfigOf(await RenderWithChildrenAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            [new PivotFilterTagHelper { Field = "Region", Values = "Marmara" }],
            MinimalFields));

        Assert.False(config.GetProperty("filters")[0].TryGetProperty("operator", out _));
    }

    [Fact]
    public async Task WritesARangeAsTwoArguments()
    {
        var config = ConfigOf(await RenderWithChildrenAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            [new PivotFilterTagHelper
            {
                Field = "Amount",
                Values = "100, 500",
                Operator = PivotFilterOperator.Between
            }],
            MinimalFields));

        Assert.Equal(
            new[] { "100", "500" },
            config.GetProperty("filters")[0].GetProperty("values")
                .EnumerateArray().Select(v => v.GetString()).ToArray());
    }

    [Fact]
    public void RefusesARangeMissingOneEnd()
    {
        // A declaration is code: a condition that reads two arguments and was
        // given one is a typo, and it fails where it was written. At runtime the
        // same shortfall is an unfinished input box and restricts nothing.
        Assert.Throws<InvalidOperationException>(() => new PivotGridBuilder()
            .Filter("Amount", PivotFilterMode.Include, PivotFilterOperator.Between, "100"));
    }

    [Fact]
    public void AcceptsABlankConditionWithNoArguments()
    {
        var builder = new PivotGridBuilder()
            .Filter("Note", PivotFilterMode.Exclude, PivotFilterOperator.Blank);

        Assert.NotNull(builder);
    }

    /// <summary>The builder equivalent of <see cref="MinimalFields"/>.</summary>
    private static void FillMinimalFields(PivotFieldCollectionBuilder fields) =>
        fields.Add().DataField("Amount").Area(PivotArea.Data).Caption("Tutar")
            .Aggregation(PivotAggregation.Sum);

    [Fact]
    public void TheFilterOverloadsAgreeOnTheDefaultMode()
    {
        var withoutMode = RenderBuilder(new PivotGridBuilder()
            .Id("pivotGrid").Filter("Region", "Marmara").Fields(FillMinimalFields));
        var withMode = RenderBuilder(new PivotGridBuilder()
            .Id("pivotGrid").Filter("Region", PivotFilterMode.Include, "Marmara")
            .Fields(FillMinimalFields));

        Assert.Equal(withoutMode, withMode);
    }

    [Fact]
    public void TheBuilderWritesAnExcludingFilter()
    {
        var html = RenderBuilder(new PivotGridBuilder()
            .Id("pivotGrid").Filter("Region", PivotFilterMode.Exclude, "Marmara")
            .Fields(FillMinimalFields));

        Assert.Equal(
            "Exclude",
            ConfigOf(html).GetProperty("filters")[0].GetProperty("mode").GetString());
    }

    [Fact]
    public async Task OmitsFiltersWhenNoneAreDeclared()
    {
        var config = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid" }, MinimalFields));

        Assert.False(config.TryGetProperty("filters", out _));
    }

    [Fact]
    public async Task WritesALabelSort()
    {
        var config = ConfigOf(await RenderWithChildrenAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            [new PivotSortTagHelper
            {
                Mode = PivotSortMode.RowLabel,
                Field = "Region",
                Direction = PivotSortDirection.Descending
            }],
            MinimalFields));

        var sort = config.GetProperty("rowSort");
        Assert.Equal("RowLabel", sort.GetProperty("mode").GetString());
        Assert.Equal("Region", sort.GetProperty("field").GetString());
        Assert.Equal("Descending", sort.GetProperty("direction").GetString());
    }

    [Fact]
    public async Task BuildsTheValueKeyFromTheFieldAndAggregation()
    {
        var config = ConfigOf(await RenderWithChildrenAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            [new PivotSortTagHelper
            {
                Mode = PivotSortMode.RowTotalValue,
                ValueField = "Amount",
                ValueAggregation = PivotAggregation.Sum
            }],
            MinimalFields));

        // The browser keys cells the same way, so a view author does not have to
        // spell the convention out.
        Assert.Equal("Amount_sum", config.GetProperty("rowSort").GetProperty("valueKey").GetString());
    }

    [Fact]
    public async Task AnExplicitValueKeyWinsOverTheFieldAndAggregation()
    {
        var config = ConfigOf(await RenderWithChildrenAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            [new PivotSortTagHelper
            {
                Mode = PivotSortMode.RowTotalValue,
                ValueKey = "custom_key",
                ValueField = "Amount"
            }],
            MinimalFields));

        Assert.Equal("custom_key", config.GetProperty("rowSort").GetProperty("valueKey").GetString());
    }

    [Fact]
    public async Task ALabelSortWithoutAFieldIsRefused()
    {
        await Assert.ThrowsAsync<InvalidOperationException>(() => RenderWithChildrenAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            [new PivotSortTagHelper { Mode = PivotSortMode.RowLabel }],
            MinimalFields));
    }

    [Fact]
    public async Task AValueSortNamingNoValueIsRefused()
    {
        await Assert.ThrowsAsync<InvalidOperationException>(() => RenderWithChildrenAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            [new PivotSortTagHelper { Mode = PivotSortMode.RowTotalValue }],
            MinimalFields));
    }

    [Fact]
    public async Task ASecondSortIsRefusedBecauseRowsOrderOneWay()
    {
        await Assert.ThrowsAsync<InvalidOperationException>(() => RenderWithChildrenAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            [
                new PivotSortTagHelper { Mode = PivotSortMode.RowLabel, Field = "Region" },
                new PivotSortTagHelper { Mode = PivotSortMode.RowLabel, Field = "Category" }
            ],
            MinimalFields));
    }

    [Fact]
    public async Task WritesConditionalRulesUnderRendererOptions()
    {
        var config = ConfigOf(await RenderWithChildrenAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            [new PivotConditionalRuleTagHelper
            {
                ValueField = "Amount",
                Operator = PivotConditionalOperator.GreaterThanOrEqual,
                Threshold = 50000,
                Color = PivotConditionalColor.Green,
                RuleId = "high"
            }],
            MinimalFields));

        // The renderer draws them, so they ride with the presentation options.
        var rule = config.GetProperty("rendererOptions").GetProperty("conditionalRules")[0];
        Assert.Equal("Amount_sum", rule.GetProperty("valueKey").GetString());
        Assert.Equal("greaterThanOrEqual", rule.GetProperty("operator").GetString());
        Assert.Equal(50000, rule.GetProperty("threshold").GetDouble());
        Assert.Equal("green", rule.GetProperty("color").GetString());
        Assert.Equal("high", rule.GetProperty("id").GetString());
        Assert.False(rule.TryGetProperty("threshold2", out _));
    }

    [Fact]
    public async Task ABetweenRuleCarriesBothBounds()
    {
        var config = ConfigOf(await RenderWithChildrenAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            [new PivotConditionalRuleTagHelper
            {
                ValueField = "Amount",
                Operator = PivotConditionalOperator.Between,
                Threshold = 10,
                Threshold2 = 20,
                Color = PivotConditionalColor.Amber
            }],
            MinimalFields));

        var rule = config.GetProperty("rendererOptions").GetProperty("conditionalRules")[0];
        Assert.Equal("between", rule.GetProperty("operator").GetString());
        Assert.Equal(20, rule.GetProperty("threshold2").GetDouble());
    }

    [Fact]
    public void ABetweenRuleWithoutAnUpperBoundIsRefused()
    {
        // The browser silently matches nothing, which reads as broken rather than
        // incomplete, so it is refused where the mistake was made.
        Assert.Throws<ArgumentException>(() => new PivotGridBuilder()
            .ConditionalRule("Amount_sum", PivotConditionalOperator.Between, 10, PivotConditionalColor.Red));
    }

    [Fact]
    public async Task ARuleWithoutAThresholdIsRefused()
    {
        await Assert.ThrowsAsync<InvalidOperationException>(() => RenderWithChildrenAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            [new PivotConditionalRuleTagHelper { ValueField = "Amount" }],
            MinimalFields));
    }

    [Fact]
    public async Task InitialStateMatchesTheEquivalentBuilderConfiguration()
    {
        var fromTagHelper = await RenderWithChildrenAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            [
                new PivotFilterTagHelper { Field = "Region", Values = "Marmara" },
                new PivotSortTagHelper
                {
                    Mode = PivotSortMode.RowTotalValue,
                    ValueField = "Amount",
                    Direction = PivotSortDirection.Descending
                },
                new PivotConditionalRuleTagHelper
                {
                    ValueField = "Amount",
                    Operator = PivotConditionalOperator.GreaterThan,
                    Threshold = 1000,
                    Color = PivotConditionalColor.Blue
                }
            ],
            MinimalFields);

        var fromBuilder = RenderBuilder(new PivotGridBuilder()
            .Id("pivotGrid")
            .Filter("Region", "Marmara")
            .RowSort(PivotSort.RowTotal("Amount_sum", PivotSortDirection.Descending))
            .ConditionalRule("Amount_sum", PivotConditionalOperator.GreaterThan, 1000, PivotConditionalColor.Blue)
            .Fields(fields => fields.Add()
                .DataField("Amount").Area(PivotArea.Data).Caption("Tutar")
                .Aggregation(PivotAggregation.Sum)));

        Assert.Equal(fromBuilder, fromTagHelper);
    }

    [Theory]
    [InlineData(PivotStateStorage.Local, "local")]
    [InlineData(PivotStateStorage.Session, "session")]
    public async Task WritesStateStoringWhenItIsDeclared(PivotStateStorage storage, string expected)
    {
        var config = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid", StateStoring = storage, StateKey = "satis" },
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        Assert.Equal(expected, config.GetProperty("stateStoring").GetString());
        Assert.Equal("satis", config.GetProperty("stateKey").GetString());
    }

    [Fact]
    public async Task OmitsStateStoringWhenItIsNotDeclared()
    {
        // None is the CLR default, so a grid that never mentions state-storing must
        // not carry the option at all -- persistence is opt-in.
        var config = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid" },
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        Assert.False(config.TryGetProperty("stateStoring", out _));
        Assert.False(config.TryGetProperty("stateKey", out _));
    }

    [Fact]
    public async Task WritesStateStoringWithoutAKeySoTheContainerIdCanStandIn()
    {
        var config = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid", StateStoring = PivotStateStorage.Local },
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        Assert.Equal("local", config.GetProperty("stateStoring").GetString());
        Assert.False(config.TryGetProperty("stateKey", out _));
    }

    [Fact]
    public async Task OmitsAStateKeyThatHasNowhereToStore()
    {
        var config = ConfigOf(await RenderAsync(
            new PivotGridTagHelper { Id = "pivotGrid", StateKey = "satis" },
            new FieldSpec("Amount", PivotArea.Data, "Tutar", PivotAggregation.Sum)));

        Assert.False(config.TryGetProperty("stateKey", out _));
    }

    [Fact]
    public async Task StateStoringMatchesTheEquivalentBuilderConfiguration()
    {
        var fromTagHelper = await RenderAsync(
            new PivotGridTagHelper
            {
                Id = "pivotGrid",
                StateStoring = PivotStateStorage.Session,
                StateKey = "satis"
            },
            MinimalFields);

        var fromBuilder = RenderBuilder(new PivotGridBuilder()
            .Id("pivotGrid")
            .StateStoring(PivotStateStorage.Session)
            .StateKey("satis")
            .Fields(fields => fields.Add()
                .DataField("Amount").Area(PivotArea.Data).Caption("Tutar")
                .Aggregation(PivotAggregation.Sum)));

        Assert.Equal(fromBuilder, fromTagHelper);
    }

    [Fact]
    public void PivotValueKeyMatchesTheBrowserConvention()
    {
        Assert.Equal("Amount_sum", PivotValueKey.For("Amount", PivotAggregation.Sum));
        Assert.Equal("Quantity_average", PivotValueKey.For("Quantity", PivotAggregation.Average));
        Assert.Throws<ArgumentException>(() => PivotValueKey.For("  ", PivotAggregation.Sum));
    }
}

