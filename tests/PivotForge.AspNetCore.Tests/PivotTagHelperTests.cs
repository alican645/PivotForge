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
        bool? Visible = null);

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

        return (helper, attributes);
    }

    /// <summary>Runs the grid tag helper with the supplied child field declarations.</summary>
    private static Task<string> RenderAsync(PivotGridTagHelper grid, params FieldSpec[] fields) =>
        RenderAsync(grid, [], fields);

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
}
