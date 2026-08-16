using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Razor.TagHelpers;

namespace PivotForge.AspNetCore.Rendering;

/// <summary>Renders an interactive pivot grid from declarative markup.</summary>
/// <remarks>
/// Every option is nullable on purpose. <see cref="PivotGridBuilder"/> omits unset options
/// from the emitted configuration so the browser applies its own defaults; a non-nullable
/// property would send the CLR default for an attribute the author never wrote, silently
/// disabling the feature.
/// </remarks>
[HtmlTargetElement("pivot-grid")]
public sealed class PivotGridTagHelper : TagHelper
{
    /// <summary>Gets or sets the element identifier of the grid container. Required.</summary>
    [HtmlAttributeName("id")]
    public string? Id { get; set; }

    /// <summary>Gets or sets the server route prefix used by the grid.</summary>
    [HtmlAttributeName("endpoint-prefix")]
    public string? EndpointPrefix { get; set; }

    /// <summary>Gets or sets whether sorting is enabled.</summary>
    [HtmlAttributeName("allow-sorting")]
    public bool? AllowSorting { get; set; }

    /// <summary>Gets or sets whether filtering is enabled.</summary>
    [HtmlAttributeName("allow-filtering")]
    public bool? AllowFiltering { get; set; }

    /// <summary>Gets or sets whether drill-down is enabled.</summary>
    [HtmlAttributeName("allow-drill-down")]
    public bool? AllowDrillDown { get; set; }

    /// <summary>Gets or sets whether Excel export is enabled.</summary>
    [HtmlAttributeName("allow-excel-export")]
    public bool? AllowExcelExport { get; set; }

    /// <summary>Gets or sets whether the grid loads data as soon as it is created.</summary>
    [HtmlAttributeName("auto-load")]
    public bool? AutoLoad { get; set; }

    /// <summary>Gets or sets whether cached, paged loading is used for large results.</summary>
    [HtmlAttributeName("large-data")]
    public bool? LargeData { get; set; }

    /// <summary>Gets or sets the number of pivot rows requested per page.</summary>
    [HtmlAttributeName("page-size")]
    public int? PageSize { get; set; }

    /// <summary>Gets or sets the source-row hint passed to the data provider.</summary>
    [HtmlAttributeName("source-row-count")]
    public int? SourceRowCount { get; set; }

    /// <summary>Gets or sets an additional CSS class for the grid container.</summary>
    [HtmlAttributeName("css-class")]
    public string? CssClass { get; set; }

    /// <summary>Gets or sets a CSS selector for the field designer's host element.</summary>
    [HtmlAttributeName("field-designer")]
    public string? FieldDesigner { get; set; }

    /// <summary>Collects the declared fields and writes the grid markup.</summary>
    /// <param name="context">The tag helper context.</param>
    /// <param name="output">The output that receives the grid markup.</param>
    /// <returns>A task that completes when the grid has been written.</returns>
    /// <exception cref="InvalidOperationException">Required configuration is missing or invalid.</exception>
    public override async Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(output);

        var declaredFields = new List<PivotFieldTagHelper>();
        context.Items[PivotFieldTagHelper.FieldsKey] = declaredFields;

        // Child pivot-field elements register themselves while their content executes.
        await output.GetChildContentAsync();

        var builder = new PivotGridBuilder();

        if (Id is not null)
        {
            builder.Id(Id);
        }

        if (EndpointPrefix is not null)
        {
            builder.EndpointPrefix(EndpointPrefix);
        }

        if (AllowSorting is { } allowSorting)
        {
            builder.AllowSorting(allowSorting);
        }

        if (AllowFiltering is { } allowFiltering)
        {
            builder.AllowFiltering(allowFiltering);
        }

        if (AllowDrillDown is { } allowDrillDown)
        {
            builder.AllowDrillDown(allowDrillDown);
        }

        if (AllowExcelExport is { } allowExcelExport)
        {
            builder.AllowExcelExport(allowExcelExport);
        }

        if (AutoLoad is { } autoLoad)
        {
            builder.AutoLoad(autoLoad);
        }

        if (LargeData is { } largeData)
        {
            builder.LargeData(largeData);
        }

        if (PageSize is { } pageSize)
        {
            builder.PageSize(pageSize);
        }

        if (SourceRowCount is { } sourceRowCount)
        {
            builder.SourceRowCount(sourceRowCount);
        }

        if (CssClass is not null)
        {
            builder.CssClass(CssClass);
        }

        if (FieldDesigner is not null)
        {
            builder.FieldDesigner(FieldDesigner);
        }

        if (declaredFields.Count > 0)
        {
            builder.Fields(fields =>
            {
                foreach (var declared in declaredFields)
                {
                    declared.ApplyTo(fields.Add());
                }
            });
        }

        using var writer = new StringWriter();
        builder.WriteTo(writer, HtmlEncoder.Default);

        output.TagName = null;
        output.Content.SetHtmlContent(writer.ToString());
    }
}
