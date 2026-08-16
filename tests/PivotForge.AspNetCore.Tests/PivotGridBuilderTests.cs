using System.Text.Encodings.Web;
using System.Text.Json;
using PivotForge.AspNetCore.Rendering;
using PivotForge.Core;
using Xunit;

namespace PivotForge.AspNetCore.Tests;

public class PivotGridBuilderTests
{
    private static string Render(PivotGridBuilder builder)
    {
        using var writer = new StringWriter();
        builder.WriteTo(writer, HtmlEncoder.Default);
        return writer.ToString();
    }

    private static JsonElement ConfigOf(PivotGridBuilder builder)
    {
        var html = Render(builder);
        var start = html.IndexOf('{', html.IndexOf("application/json", StringComparison.Ordinal));
        var end = html.IndexOf("</script>", start, StringComparison.Ordinal);
        return JsonDocument.Parse(html[start..end]).RootElement;
    }

    private static PivotGridBuilder SalesGrid() =>
        new PivotGridBuilder()
            .Id("pivotGrid")
            .Fields(fields =>
            {
                fields.Add().Caption("Ürün").DataField("urun").Area(PivotArea.Row);
                fields.Add().Caption("Yıl").DataField("yil").Area(PivotArea.Column);
                fields.Add().Caption("Tutar").DataField("tutar")
                    .Aggregation(PivotAggregation.Sum).Area(PivotArea.Data);
            });

    [Fact]
    public void RendersAContainerCarryingTheSuppliedId()
    {
        var html = Render(SalesGrid());

        Assert.Contains("id=\"pivotGrid\"", html);
        Assert.Contains("class=\"pivotforge-grid\"", html);
    }

    [Fact]
    public void RendersConfigurationInAJsonScriptBlock()
    {
        var html = Render(SalesGrid());

        Assert.Contains("<script type=\"application/json\" id=\"pivotGrid-config\">", html);
    }

    [Fact]
    public void RendersAnInitializationCallReferencingBothElements()
    {
        var html = Render(SalesGrid());

        Assert.Contains("PivotForge.create(", html);
        Assert.Contains("document.getElementById(\"pivotGrid\")", html);
        Assert.Contains("document.getElementById(\"pivotGrid-config\")", html);
    }

    [Fact]
    public void ConfigurationCarriesFieldsInDeclarationOrder()
    {
        var fields = ConfigOf(SalesGrid()).GetProperty("fields");

        Assert.Equal(3, fields.GetArrayLength());
        Assert.Equal("urun", fields[0].GetProperty("dataField").GetString());
        Assert.Equal("row", fields[0].GetProperty("area").GetString());
        Assert.Equal("yil", fields[1].GetProperty("dataField").GetString());
        Assert.Equal("tutar", fields[2].GetProperty("dataField").GetString());
        Assert.Equal("sum", fields[2].GetProperty("aggregation").GetString());
    }

    [Fact]
    public void TurkishCaptionsSurviveSerializationUnescaped()
    {
        // Asserts against the raw rendered HTML rather than a parsed JsonElement:
        // GetString() would decode "Ürün" back to "Ürün" too, so a parsed
        // comparison cannot tell the escaped and unescaped forms apart. Only the raw
        // markup can prove the Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
        // configuration in PivotGridBuilder is actually in effect.
        var html = Render(SalesGrid());

        Assert.Contains("\"Ürün\"", html);
        Assert.DoesNotContain("\\u00dc", html, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void OptionFlagsReachTheConfiguration()
    {
        var config = ConfigOf(SalesGrid()
            .AllowSorting(false)
            .AllowFiltering(true)
            .AllowExcelExport(true)
            .LargeData(true)
            .AutoLoad(false)
            .PageSize(75)
            .SourceRowCount(250_000)
            .EndpointPrefix("/raporlar/pivot-api"));

        Assert.False(config.GetProperty("allowSorting").GetBoolean());
        Assert.True(config.GetProperty("allowFiltering").GetBoolean());
        Assert.True(config.GetProperty("allowExcelExport").GetBoolean());
        Assert.True(config.GetProperty("largeData").GetBoolean());
        Assert.False(config.GetProperty("autoLoad").GetBoolean());
        Assert.Equal(75, config.GetProperty("pageSize").GetInt32());
        Assert.Equal(250_000, config.GetProperty("sourceRowCount").GetInt32());
        Assert.Equal("/raporlar/pivot-api", config.GetProperty("endpointPrefix").GetString());
    }

    [Fact]
    public void UnsetOptionsAreOmittedSoBrowserDefaultsApply()
    {
        var config = ConfigOf(SalesGrid());

        Assert.False(config.TryGetProperty("pageSize", out _));
        Assert.False(config.TryGetProperty("endpointPrefix", out _));
    }

    [Fact]
    public void ACaptionContainingMarkupCannotEscapeTheScriptBlock()
    {
        var html = Render(new PivotGridBuilder()
            .Id("pivotGrid")
            .Fields(fields =>
            {
                fields.Add().DataField("urun").Area(PivotArea.Row)
                    .Caption("</script><script>alert('x')</script>");
                fields.Add().DataField("tutar").Area(PivotArea.Data)
                    .Aggregation(PivotAggregation.Sum);
            }));

        Assert.DoesNotContain("<script>alert('x')</script>", html);
    }

    [Fact]
    public void ACaptionContainingQuotesIsSerializedSafely()
    {
        var fields = ConfigOf(new PivotGridBuilder()
            .Id("pivotGrid")
            .Fields(f =>
            {
                f.Add().DataField("urun").Area(PivotArea.Row).Caption("Ürün \"A\" Grubu");
                f.Add().DataField("tutar").Area(PivotArea.Data).Aggregation(PivotAggregation.Sum);
            })).GetProperty("fields");

        Assert.Equal("Ürün \"A\" Grubu", fields[0].GetProperty("caption").GetString());
    }

    [Fact]
    public void RenderingWithoutAnIdThrows()
    {
        var builder = new PivotGridBuilder()
            .Fields(f => f.Add().DataField("tutar").Area(PivotArea.Data));

        var exception = Assert.Throws<InvalidOperationException>(() => Render(builder));

        Assert.Contains("Id", exception.Message);
    }

    [Fact]
    public void RenderingWithoutFieldsThrows()
    {
        var builder = new PivotGridBuilder().Id("pivotGrid");

        var exception = Assert.Throws<InvalidOperationException>(() => Render(builder));

        Assert.Contains("field", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void AnIdThatIsNotAValidElementIdentifierThrows()
    {
        var builder = new PivotGridBuilder()
            .Id("pivot\" onload=\"alert(1)")
            .Fields(f => f.Add().DataField("tutar").Area(PivotArea.Data));

        Assert.Throws<InvalidOperationException>(() => Render(builder));
    }

    [Fact]
    public void CssClassIsAppendedToTheDefaultClass()
    {
        var html = Render(SalesGrid().CssClass("rapor-tablosu"));

        Assert.Contains("class=\"pivotforge-grid rapor-tablosu\"", html);
    }

    [Fact]
    public void FieldDesignerSelectorReachesTheConfiguration()
    {
        var config = ConfigOf(SalesGrid().FieldDesigner("#designerHost"));

        Assert.Equal("#designerHost", config.GetProperty("fieldDesigner").GetString());
    }

    [Fact]
    public void FieldDesignerIsOmittedWhenNotRequested()
    {
        Assert.False(ConfigOf(SalesGrid()).TryGetProperty("fieldDesigner", out _));
    }

    [Fact]
    public void StateStoringNoneWritesNothing()
    {
        // None is what a caller passes to turn persistence off, so it has to be a
        // no-op rather than a third stored value the browser would have to reject.
        var config = ConfigOf(SalesGrid().StateStoring(PivotStateStorage.None));

        Assert.False(config.TryGetProperty("stateStoring", out _));
    }

    [Fact]
    public void StateStoringAndKeyReachTheConfiguration()
    {
        var config = ConfigOf(SalesGrid()
            .StateStoring(PivotStateStorage.Session)
            .StateKey("satis"));

        Assert.Equal("session", config.GetProperty("stateStoring").GetString());
        Assert.Equal("satis", config.GetProperty("stateKey").GetString());
    }
}
