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

    /// <summary>Gets or sets how a click on a cell selects.</summary>
    /// <remarks>
    /// Non-nullable so Razor accepts the unqualified member name (<c>selection-mode="None"</c>).
    /// Whether the author wrote it is recovered from <see cref="TagHelperContext.AllAttributes"/>,
    /// because the CLR default is indistinguishable from a written <c>Single</c>.
    /// </remarks>
    [HtmlAttributeName("selection-mode")]
    public PivotSelectionMode SelectionMode { get; set; }

    /// <summary>Gets or sets how row headers are arranged.</summary>
    /// <remarks>Non-nullable for the same reason as <see cref="SelectionMode"/>.</remarks>
    [HtmlAttributeName("layout-mode")]
    public PivotGridLayoutMode LayoutMode { get; set; }

    /// <summary>Gets or sets whether the cell context menu is available.</summary>
    [HtmlAttributeName("context-menu")]
    public bool? ContextMenu { get; set; }

    /// <summary>Gets or sets whether subtotal rows are shown.</summary>
    [HtmlAttributeName("subtotals")]
    public bool? Subtotals { get; set; }

    /// <summary>Gets or sets whether the grand total is shown.</summary>
    [HtmlAttributeName("show-grand-total")]
    public bool? ShowGrandTotal { get; set; }

    /// <summary>Gets or sets whether a row label repeats on every row it spans.</summary>
    [HtmlAttributeName("repeat-row-labels")]
    public bool? RepeatRowLabels { get; set; }

    /// <summary>Gets or sets the narrowest a column may be, in pixels.</summary>
    [HtmlAttributeName("min-column-width")]
    public int? MinColumnWidth { get; set; }

    /// <summary>Gets or sets the widest a column may be, in pixels.</summary>
    [HtmlAttributeName("max-column-width")]
    public int? MaxColumnWidth { get; set; }

    /// <summary>Gets or sets the text shown in a cell that has no value.</summary>
    [HtmlAttributeName("empty-text")]
    public string? EmptyText { get; set; }

    /// <summary>Gets or sets the caption used for total rows and columns.</summary>
    [HtmlAttributeName("total-text")]
    public string? TotalText { get; set; }

    /// <summary>Gets or sets the page function called before each data request.</summary>
    /// <remarks>
    /// Every event attribute names a function on the page, optionally as a dotted path
    /// such as <c>app.handlers.onLoaded</c>. The name is resolved when the grid is
    /// created, so a misspelling fails immediately rather than never firing. The same
    /// events are also dispatched on the container as <c>pivotforge:*</c> CustomEvents,
    /// whether or not an attribute names a handler.
    /// </remarks>
    [HtmlAttributeName("on-data-loading")]
    public string? OnDataLoading { get; set; }

    /// <summary>Gets or sets the page function called after each successful data request.</summary>
    [HtmlAttributeName("on-data-loaded")]
    public string? OnDataLoaded { get; set; }

    /// <summary>Gets or sets the page function called when a request fails.</summary>
    [HtmlAttributeName("on-error")]
    public string? OnError { get; set; }

    /// <summary>Gets or sets the page function called when the selected cell changes.</summary>
    [HtmlAttributeName("on-selection-changed")]
    public string? OnSelectionChanged { get; set; }

    /// <summary>Gets or sets the page function called when a cell is activated.</summary>
    [HtmlAttributeName("on-cell-double-click")]
    public string? OnCellDoubleClick { get; set; }

    /// <summary>Gets or sets the page function called after a cell is copied.</summary>
    [HtmlAttributeName("on-cell-copied")]
    public string? OnCellCopied { get; set; }

    /// <summary>Gets or sets the page function called when a cell asks to filter by its value.</summary>
    [HtmlAttributeName("on-cell-filter-requested")]
    public string? OnCellFilterRequested { get; set; }

    /// <summary>Gets or sets the page function called when the view state changes.</summary>
    [HtmlAttributeName("on-view-state-changed")]
    public string? OnViewStateChanged { get; set; }

    /// <summary>Collects the declared fields and writes the grid markup.</summary>
    /// <param name="context">The tag helper context.</param>
    /// <param name="output">The output that receives the grid markup.</param>
    /// <returns>A task that completes when the grid has been written.</returns>
    /// <exception cref="InvalidOperationException">Required configuration is missing or invalid.</exception>
    public override async Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(output);

        var written = new HashSet<string>(
            context.AllAttributes.Select(attribute => attribute.Name),
            StringComparer.OrdinalIgnoreCase);

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

        if (written.Contains("selection-mode"))
        {
            builder.SelectionMode(SelectionMode);
        }

        if (written.Contains("layout-mode"))
        {
            builder.LayoutMode(LayoutMode);
        }

        if (ContextMenu is { } contextMenu)
        {
            builder.ContextMenu(contextMenu);
        }

        if (Subtotals is { } subtotals)
        {
            builder.Subtotals(subtotals);
        }

        if (ShowGrandTotal is { } showGrandTotal)
        {
            builder.ShowGrandTotal(showGrandTotal);
        }

        if (RepeatRowLabels is { } repeatRowLabels)
        {
            builder.RepeatRowLabels(repeatRowLabels);
        }

        if (MinColumnWidth is { } minColumnWidth)
        {
            builder.MinColumnWidth(minColumnWidth);
        }

        if (MaxColumnWidth is { } maxColumnWidth)
        {
            builder.MaxColumnWidth(maxColumnWidth);
        }

        if (EmptyText is { } emptyText)
        {
            builder.EmptyText(emptyText);
        }

        if (TotalText is { } totalText)
        {
            builder.TotalText(totalText);
        }

        if (OnDataLoading is { } onDataLoading)
        {
            builder.OnDataLoading(onDataLoading);
        }

        if (OnDataLoaded is { } onDataLoaded)
        {
            builder.OnDataLoaded(onDataLoaded);
        }

        if (OnError is { } onError)
        {
            builder.OnError(onError);
        }

        if (OnSelectionChanged is { } onSelectionChanged)
        {
            builder.OnSelectionChanged(onSelectionChanged);
        }

        if (OnCellDoubleClick is { } onCellDoubleClick)
        {
            builder.OnCellDoubleClick(onCellDoubleClick);
        }

        if (OnCellCopied is { } onCellCopied)
        {
            builder.OnCellCopied(onCellCopied);
        }

        if (OnCellFilterRequested is { } onCellFilterRequested)
        {
            builder.OnCellFilterRequested(onCellFilterRequested);
        }

        if (OnViewStateChanged is { } onViewStateChanged)
        {
            builder.OnViewStateChanged(onViewStateChanged);
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
