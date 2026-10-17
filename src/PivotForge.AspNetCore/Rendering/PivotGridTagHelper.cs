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

    /// <summary>Gets or sets whether a reader may add conditional formatting rules from the cell menu.</summary>
    [HtmlAttributeName("allow-conditional-formatting")]
    public bool? AllowConditionalFormatting { get; set; }

    /// <summary>Gets or sets whether a reader may define calculated fields from the field designer.</summary>
    [HtmlAttributeName("allow-calculated-fields")]
    public bool? AllowCalculatedFields { get; set; }

    /// <summary>Gets or sets whether the field designer shows a "Defer layout update" box, and
    /// whether it starts ticked.</summary>
    [HtmlAttributeName("defer-layout-update")]
    public bool? DeferLayoutUpdate { get; set; }

    /// <summary>Gets or sets whether a "Loading..." panel covers the grid while data is requested.</summary>
    [HtmlAttributeName("load-panel")]
    public bool? LoadPanel { get; set; }

    /// <summary>Gets or sets whether a toolbar with every button the grid can offer is shown above it.</summary>
    [HtmlAttributeName("toolbar")]
    public bool? Toolbar { get; set; }

    /// <summary>Gets or sets the toolbar's buttons, comma-separated and in order, such as <c>Excel,Print</c>.</summary>
    /// <remarks>Implies a toolbar; see <see cref="PivotToolbarItem"/> for the names.</remarks>
    [HtmlAttributeName("toolbar-items")]
    public string? ToolbarItems { get; set; }

    /// <summary>Gets the detail modal's texts the page renames, one attribute each.</summary>
    /// <remarks>
    /// Written as <c>drill-down-label-title="Kaynak kayıtlar"</c>, the rest of the name being the
    /// text's key in kebab-case (<c>drill-down-label-no-records</c>). Texts not named keep the
    /// locale pack's words.
    /// </remarks>
    [HtmlAttributeName("drill-down-labels", DictionaryAttributePrefix = "drill-down-label-")]
    public IDictionary<string, string> DrillDownLabels { get; set; } =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

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

    /// <summary>Gets or sets where the grid persists the state a user arrives at.</summary>
    /// <remarks>
    /// Non-nullable so Razor accepts the unqualified member name (<c>state-storing="Local"</c>).
    /// No <see cref="TagHelperContext.AllAttributes"/> lookup is needed here, because the CLR
    /// default <see cref="PivotStateStorage.None"/> and an unwritten attribute mean the same
    /// thing: persistence is opt-in.
    /// </remarks>
    [HtmlAttributeName("state-storing")]
    public PivotStateStorage StateStoring { get; set; }

    /// <summary>Gets or sets the name of the storage entry.</summary>
    /// <remarks>
    /// When absent the container id stands in. With neither, nothing is persisted and the grid
    /// works from its declared configuration, rather than sharing a default key with every other
    /// grid on the page.
    /// </remarks>
    [HtmlAttributeName("state-key")]
    public string? StateKey { get; set; }

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

    /// <summary>Gets or sets the type of the chart drawn beside the grid; see <see cref="PivotGridBuilder.Chart"/>.</summary>
    /// <remarks>Non-nullable for the same reason as <see cref="SelectionMode"/>.</remarks>
    [HtmlAttributeName("chart")]
    public PivotChartType Chart { get; set; }

    /// <summary>Gets or sets whether the chart sits above the grid (the default) or below it.</summary>
    /// <remarks>Non-nullable for the same reason as <see cref="SelectionMode"/>.</remarks>
    [HtmlAttributeName("chart-position")]
    public PivotChartPosition ChartPosition { get; set; }

    /// <summary>Gets or sets the chart's height in pixels, at least 120.</summary>
    [HtmlAttributeName("chart-height")]
    public int? ChartHeight { get; set; }

    /// <summary>Gets or sets whether the chart starts on screen; false leaves it to the toolbar's Chart button.</summary>
    [HtmlAttributeName("chart-visible")]
    public bool? ChartVisible { get; set; }

    /// <summary>Gets or sets what a heatmap colour scale over the value cells is drawn across.</summary>
    /// <remarks>Non-nullable for the same reason as <see cref="SelectionMode"/>.</remarks>
    [HtmlAttributeName("heatmap")]
    public PivotHeatmapMode Heatmap { get; set; }

    /// <summary>Gets or sets what the bars behind the value cells are measured across.</summary>
    /// <remarks>Non-nullable for the same reason as <see cref="SelectionMode"/>.</remarks>
    [HtmlAttributeName("value-bars")]
    public PivotValueBarsMode ValueBars { get; set; }

    /// <summary>Gets or sets whether a group's subtotal row is drawn above or below its rows.</summary>
    /// <remarks>Non-nullable for the same reason as <see cref="SelectionMode"/>.</remarks>
    [HtmlAttributeName("totals-position")]
    public PivotTotalsPosition TotalsPosition { get; set; }

    /// <summary>Gets or sets which axis several values are drawn along.</summary>
    /// <remarks>Non-nullable for the same reason as <see cref="SelectionMode"/>.</remarks>
    [HtmlAttributeName("values-position")]
    public PivotValuesPosition ValuesPosition { get; set; }

    /// <summary>Gets or sets whether the cell context menu is available.</summary>
    [HtmlAttributeName("context-menu")]
    public bool? ContextMenu { get; set; }

    /// <summary>Gets or sets whether subtotal rows are shown.</summary>
    [HtmlAttributeName("subtotals")]
    public bool? Subtotals { get; set; }

    /// <summary>Gets or sets whether subtotal columns are shown.</summary>
    [HtmlAttributeName("column-subtotals")]
    public bool? ColumnSubtotals { get; set; }

    /// <summary>Gets or sets whether the grand total row is shown.</summary>
    /// <remarks>The earlier name of <see cref="ShowRowGrandTotals"/>; the two may not disagree.</remarks>
    [HtmlAttributeName("show-grand-total")]
    public bool? ShowGrandTotal { get; set; }

    /// <summary>Gets or sets whether the grand total row along the bottom is shown.</summary>
    [HtmlAttributeName("show-row-grand-totals")]
    public bool? ShowRowGrandTotals { get; set; }

    /// <summary>Gets or sets whether the grand total column on the right is shown.</summary>
    [HtmlAttributeName("show-column-grand-totals")]
    public bool? ShowColumnGrandTotals { get; set; }

    /// <summary>Gets or sets whether a row label repeats on every row it spans.</summary>
    [HtmlAttributeName("repeat-row-labels")]
    public bool? RepeatRowLabels { get; set; }

    /// <summary>
    /// Gets or sets the cell lines: true frames the grid, false keeps only the header's lines.
    /// Left unset, the grid keeps its default lines between cells.
    /// </summary>
    [HtmlAttributeName("show-borders")]
    public bool? ShowBorders { get; set; }

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

    /// <summary>Gets or sets the accessible name announced for the grid.</summary>
    [HtmlAttributeName("aria-label")]
    public string? AriaLabel { get; set; }

    /// <summary>Gets or sets whether rows and columns holding no values at all are dropped.</summary>
    /// <remarks>
    /// The column axis is the product of its levels, so sparse data leaves whole columns that
    /// never occurred. Dropping happens in the engine, so paging, Excel export and drill-down all
    /// agree on which rows exist.
    /// </remarks>
    [HtmlAttributeName("hide-empty-summary-cells")]
    public bool? HideEmptySummaryCells { get; set; }

    /// <summary>Gets or sets whether a filter picker lists only the values the other fields'
    /// filters leave.</summary>
    [HtmlAttributeName("show-relevant-values")]
    public bool? ShowRelevantValues { get; set; }

    /// <summary>Gets or sets the locale pack supplying the on-screen text.</summary>
    /// <remarks>
    /// Left unset it follows the request's UI culture, so a Turkish request gets
    /// <c>tr</c> without the page saying so. Reference <c>js/pivot-locale-&lt;name&gt;.js</c>
    /// for the pack to exist; without it the text stays English. Set <c>en</c> to pin the
    /// built-in English defaults regardless of the request.
    /// </remarks>
    [HtmlAttributeName("locale")]
    public string? Locale { get; set; }

    /// <summary>Gets or sets the culture used to format numbers in the browser.</summary>
    /// <remarks>
    /// Left unset, numbers are formatted in the reader's own locale. Server-side collation
    /// is separate and follows the request's culture.
    /// </remarks>
    [HtmlAttributeName("culture")]
    public string? Culture { get; set; }

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

    /// <summary>Gets or sets the page function called before an Excel or CSV file is written.</summary>
    [HtmlAttributeName("on-exporting")]
    public string? OnExporting { get; set; }

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

        var declaredFilters = new List<PivotFilterTagHelper>();
        context.Items[PivotFilterTagHelper.FiltersKey] = declaredFilters;

        var declaredRankings = new List<PivotTopNTagHelper>();
        context.Items[PivotTopNTagHelper.RankingsKey] = declaredRankings;

        var declaredValueFilters = new List<PivotValueFilterTagHelper>();
        context.Items[PivotValueFilterTagHelper.ValueFiltersKey] = declaredValueFilters;

        var declaredSort = new List<PivotSortTagHelper>();
        context.Items[PivotSortTagHelper.SortKey] = declaredSort;

        var declaredRules = new List<PivotConditionalRuleTagHelper>();
        context.Items[PivotConditionalRuleTagHelper.RulesKey] = declaredRules;

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

        if (AllowConditionalFormatting is { } allowConditionalFormatting)
        {
            builder.AllowConditionalFormatting(allowConditionalFormatting);
        }

        if (AllowCalculatedFields is { } allowCalculatedFields)
        {
            builder.AllowCalculatedFields(allowCalculatedFields);
        }

        if (DeferLayoutUpdate is { } deferLayoutUpdate)
        {
            builder.DeferLayoutUpdate(deferLayoutUpdate);
        }

        if (LoadPanel is { } loadPanel)
        {
            builder.LoadPanel(loadPanel);
        }

        if (ToolbarItems is not null)
        {
            if (Toolbar == false)
            {
                throw new InvalidOperationException(
                    "pivot-grid sets toolbar=\"false\" and lists toolbar-items. Drop one of them.");
            }

            builder.Toolbar(ParseToolbarItems(ToolbarItems));
        }
        else if (Toolbar is { } toolbar)
        {
            builder.Toolbar(toolbar);
        }

        foreach (var (name, text) in DrillDownLabels)
        {
            builder.DrillDownLabel(CamelCaseFromKebab(name), text);
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

        if (written.Contains("chart"))
        {
            builder.Chart(Chart, ChartPosition, ChartHeight, ChartVisible ?? true);
        }
        else if (written.Contains("chart-position") || ChartHeight is not null || ChartVisible is not null)
        {
            throw new InvalidOperationException(
                "pivot-grid sets chart-position, chart-height or chart-visible without chart. " +
                "Add chart=\"Column\" (or another type).");
        }

        if (written.Contains("heatmap"))
        {
            builder.Heatmap(Heatmap);
        }

        if (written.Contains("value-bars"))
        {
            builder.ValueBars(ValueBars);
        }

        if (written.Contains("totals-position"))
        {
            builder.TotalsPosition(TotalsPosition);
        }

        if (written.Contains("values-position"))
        {
            builder.ValuesPosition(ValuesPosition);
        }

        if (ContextMenu is { } contextMenu)
        {
            builder.ContextMenu(contextMenu);
        }

        if (Subtotals is { } subtotals)
        {
            builder.Subtotals(subtotals);
        }

        if (ColumnSubtotals is { } columnSubtotals)
        {
            builder.ColumnSubtotals(columnSubtotals);
        }

        // Two names for one setting: honouring whichever came last would make the
        // outcome depend on attribute order, so a contradiction is reported.
        if (ShowGrandTotal is { } legacy && ShowRowGrandTotals is { } current && legacy != current)
        {
            throw new InvalidOperationException(
                "pivot-grid sets show-grand-total and show-row-grand-totals to different values. " +
                "They are the same setting; keep show-row-grand-totals.");
        }

        if ((ShowRowGrandTotals ?? ShowGrandTotal) is { } showRowGrandTotals)
        {
            builder.ShowRowGrandTotals(showRowGrandTotals);
        }

        if (ShowColumnGrandTotals is { } showColumnGrandTotals)
        {
            builder.ShowColumnGrandTotals(showColumnGrandTotals);
        }

        if (RepeatRowLabels is { } repeatRowLabels)
        {
            builder.RepeatRowLabels(repeatRowLabels);
        }

        if (ShowBorders is { } showBorders)
        {
            builder.ShowBorders(showBorders);
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

        if (AriaLabel is { } ariaLabel)
        {
            builder.AriaLabel(ariaLabel);
        }

        if (HideEmptySummaryCells is { } hideEmptySummaryCells)
        {
            builder.HideEmptySummaryCells(hideEmptySummaryCells);
        }

        if (ShowRelevantValues is { } showRelevantValues)
        {
            builder.ShowRelevantValues(showRelevantValues);
        }

        if (Locale is { } locale)
        {
            builder.Locale(locale);
        }

        if (Culture is { } culture)
        {
            builder.Culture(culture);
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

        if (OnExporting is { } onExporting)
        {
            builder.OnExporting(onExporting);
        }

        foreach (var ranking in declaredRankings)
        {
            ranking.ApplyTo(builder);
        }

        foreach (var valueFilter in declaredValueFilters)
        {
            valueFilter.ApplyTo(builder);
        }

        foreach (var filter in declaredFilters)
        {
            filter.ApplyTo(builder);
        }

        foreach (var sort in declaredSort)
        {
            sort.ApplyTo(builder);
        }

        foreach (var rule in declaredRules)
        {
            rule.ApplyTo(builder);
        }

        if (CssClass is not null)
        {
            builder.CssClass(CssClass);
        }

        if (FieldDesigner is not null)
        {
            builder.FieldDesigner(FieldDesigner);
        }

        // A key with nowhere to store is dead weight in the payload, so the two
        // travel together or not at all.
        if (StateStoring != PivotStateStorage.None)
        {
            builder.StateStoring(StateStoring);

            if (StateKey is not null)
            {
                builder.StateKey(StateKey);
            }
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

    // "no-records" -> "noRecords": the attribute's suffix as the modal's key.
    private static string CamelCaseFromKebab(string name)
    {
        var parts = name.Split('-', StringSplitOptions.RemoveEmptyEntries);
        return string.Concat(parts.Select((part, index) => index == 0
            ? part.ToLowerInvariant()
            : char.ToUpperInvariant(part[0]) + part[1..].ToLowerInvariant()));
    }

    // Names as the enum spells them, without regard to case. A name that is not one is
    // reported with the list, rather than dropped: a misspelt button silently missing
    // from the toolbar is harder to find than an error.
    private static PivotToolbarItem[] ParseToolbarItems(string value) => value
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Select(name => Enum.TryParse<PivotToolbarItem>(name, ignoreCase: true, out var item)
                && Enum.IsDefined(item)
            ? item
            : throw new InvalidOperationException(
                $"pivot-grid toolbar-items names '{name}', which is not a toolbar item. " +
                $"Expected any of: {string.Join(", ", Enum.GetNames<PivotToolbarItem>())}."))
        .ToArray();
}
