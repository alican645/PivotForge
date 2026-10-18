using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Html;
using PivotForge.Core;

namespace PivotForge.AspNetCore.Rendering;

/// <summary>Builds the markup and configuration that initialize a browser pivot grid.</summary>
public sealed class PivotGridBuilder : IHtmlContent
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        // Non-ASCII characters stay readable; the payload is written inside a
        // JSON script block whose closing-tag sequence is escaped separately.
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    private readonly Dictionary<string, object?> _options = new(StringComparer.Ordinal);

    // Presentation settings are forwarded to the browser renderer rather than the
    // widget, so they are collected separately and emitted under "rendererOptions".
    // Kept out of _options because the widget would otherwise treat them as its own.
    private readonly Dictionary<string, object?> _rendererOptions = new(StringComparer.Ordinal);

    // Handler names, resolved on the page at construction. Kept apart from the
    // renderer options because the widget subscribes them, not the renderer.
    private readonly Dictionary<string, object?> _events = new(StringComparer.Ordinal);

    // Initial state the grid starts with, rather than settings it is configured by.
    private readonly List<Dictionary<string, object?>> _filters = [];
    private readonly List<Dictionary<string, object?>> _topN = [];
    private readonly List<Dictionary<string, object?>> _valueFilters = [];
    private readonly List<Dictionary<string, object?>> _conditionalRules = [];
    private readonly SortedDictionary<string, string> _drillDownLabels = new(StringComparer.Ordinal);

    // The detail modal's label keys, as PivotDrillDownModal.defaultLabels names them in
    // pivot-drill-down-modal.js. A browser test reads this list back from this file and
    // compares it with that object, so the two cannot drift apart unnoticed.
    private static readonly string[] DrillDownLabelKeys =
    [
        "title", "close", "search", "csv", "all", "empty", "loading", "noRecords", "noMatches",
        "failed", "allRows", "allColumns", "truncated", "summary", "columnFilter"
    ];
    private readonly PivotFieldCollectionBuilder _fields = new();
    private string? _id;
    private string? _cssClass;

    /// <summary>Sets the element identifier of the grid container.</summary>
    /// <param name="id">A stable HTML element identifier.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder Id(string id)
    {
        _id = id;
        return this;
    }

    /// <summary>Configures the grid fields.</summary>
    /// <param name="configure">A callback that adds fields.</param>
    /// <returns>The same builder.</returns>
    /// <remarks>Fields accumulate across calls: calling this method more than once adds to the
    /// existing field set rather than replacing it.</remarks>
    public PivotGridBuilder Fields(Action<PivotFieldCollectionBuilder> configure)
    {
        ArgumentNullException.ThrowIfNull(configure);
        configure(_fields);
        return this;
    }

    /// <summary>Sets the server route prefix used by the grid.</summary>
    /// <param name="prefix">The route prefix, matching the mapped endpoint group.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder EndpointPrefix(string prefix) => Set("endpointPrefix", prefix);

    /// <summary>Enables or disables sorting.</summary>
    /// <param name="allow">True to allow sorting.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder AllowSorting(bool allow) => Set("allowSorting", allow);

    /// <summary>Enables or disables filtering.</summary>
    /// <param name="allow">True to allow filtering.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder AllowFiltering(bool allow) => Set("allowFiltering", allow);

    /// <summary>Enables or disables drill-down.</summary>
    /// <param name="allow">True to allow drill-down.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder AllowDrillDown(bool allow) => Set("allowDrillDown", allow);

    /// <summary>Enables or disables Excel export.</summary>
    /// <param name="allow">True to allow Excel export.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder AllowExcelExport(bool allow) => Set("allowExcelExport", allow);

    /// <summary>Enables or disables the interactive conditional formatting panel.</summary>
    /// <remarks>
    /// On by default. The cell menu offers the entry only when the panel can open, so
    /// turning this off removes the entry rather than leaving one that does nothing.
    /// Rules declared with <see cref="ConditionalRule"/> are drawn either way.
    /// </remarks>
    /// <param name="allow">True to let a reader add rules from the cell menu.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder AllowConditionalFormatting(bool allow) =>
        Set("allowConditionalFormatting", allow);

    /// <summary>Enables or disables defining calculated fields from the field designer.</summary>
    /// <remarks>
    /// On by default, and only visible where a field designer is attached. A reader's formula is
    /// evaluated on the server like a declared one: it reaches only the fields the endpoints
    /// already allow and the functions registered in <see cref="PivotForgeOptions.CustomAggregates"/>.
    /// Calculated fields declared with <see cref="PivotFieldBuilder.Expression"/> work either way.
    /// </remarks>
    /// <param name="allow">True to offer the designer's calculated field editor.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder AllowCalculatedFields(bool allow) =>
        Set("allowCalculatedFields", allow);

    /// <summary>Shows Excel's "Defer layout update" box on the field designer.</summary>
    /// <remarks>
    /// While the box is ticked a designer edit changes only the panel; the grid is refreshed once,
    /// with every held-back edit, when the reader presses Update or clears the box. The reader can
    /// tick and clear it; <paramref name="defer"/> is how it starts. Left undeclared, the box is not
    /// shown and every edit applies at once. Only visible where a field designer is attached.
    /// </remarks>
    /// <param name="defer">Whether the box starts ticked.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder DeferLayoutUpdate(bool defer) => Set("deferLayoutUpdate", defer);

    /// <summary>Lays the grid out right to left, or pins it left to right.</summary>
    /// <remarks>
    /// Left undeclared, the grid follows the page: a site whose <c>&lt;html&gt;</c> carries
    /// <c>dir="rtl"</c> gets a mirrored grid without saying anything. Declaring it writes
    /// <c>dir</c> on the grid, its toolbar and its field designer, and the menus, pickers and
    /// modals they open follow. The row headers freeze on the right, the arrow keys move the way
    /// they point, and an Excel export is a right-to-left sheet. The chart does not mirror.
    /// DevExtreme's <c>rtlEnabled</c>.
    /// </remarks>
    /// <param name="enabled">True for right to left, false for left to right.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder RtlEnabled(bool enabled) => Set("rtlEnabled", enabled);

    /// <summary>Shows or hides the "Loading..." panel drawn over the grid while data is requested.</summary>
    /// <remarks>
    /// On by default. The panel covers the first load and every reload a sort, filter or
    /// layout change starts, with the previous table dimmed beneath it, and appears only once
    /// a request has taken longer than 300 milliseconds, so a fast answer does not flash it.
    /// Its text is the <c>loading</c> renderer text, "Yükleniyor..." in the <c>tr</c> locale.
    /// </remarks>
    /// <param name="enabled">True to show the panel while data loads.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder LoadPanel(bool enabled) => Set("loadPanel", enabled);

    /// <summary>Shows or hides a toolbar above the grid with every button it can offer.</summary>
    /// <remarks>
    /// The buttons are Excel (only when <see cref="AllowExcelExport"/> is on), CSV, Print, Expand all,
    /// Collapse all, Save report, Open report, Full screen and Chart (only when the grid has a
    /// chart). Excel and Print title the file and the page with the grid's
    /// <see cref="AriaLabel"/>. A failure is raised as the grid's <c>error</c> event.
    /// </remarks>
    /// <param name="enabled">True to show the toolbar.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder Toolbar(bool enabled) => Set("toolbar", enabled);

    /// <summary>Shows a toolbar above the grid with these buttons, in this order.</summary>
    /// <param name="items">The buttons. An empty list shows no toolbar.</param>
    /// <returns>The same builder.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="items"/> is null.</exception>
    public PivotGridBuilder Toolbar(params PivotToolbarItem[] items)
    {
        ArgumentNullException.ThrowIfNull(items);

        return items.Length == 0
            ? Set("toolbar", false)
            : Set("toolbar", items.Distinct().Select(item => CamelCase(item.ToString())).ToArray());
    }

    /// <summary>Draws a chart of the pivot beside the grid.</summary>
    /// <remarks>
    /// Needs <c>pivot-chart.js</c>. The chart plots one data field at a time -- the first, unless
    /// the reader picks another from its header, where they can switch the chart type too; both
    /// choices are kept with the rest of the view. Its categories are the outermost row groups,
    /// its series the outermost column groups (at most eight), and every number is the one the
    /// grid shows for that group, in the data field's own format.
    /// </remarks>
    /// <param name="type">The chart type; <see cref="PivotChartType.None"/> draws no chart.</param>
    /// <param name="position">Whether the chart sits above or below the grid.</param>
    /// <param name="height">The plot's height in pixels, at least 120; 320 when not given.</param>
    /// <param name="visible">
    /// False to start with the chart hidden, for the reader to show from the toolbar's
    /// <see cref="PivotToolbarItem.Chart"/> button; their choice is kept with the view.
    /// </param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentOutOfRangeException">
    /// <paramref name="height"/> is less than 120.
    /// </exception>
    public PivotGridBuilder Chart(
        PivotChartType type,
        PivotChartPosition position = PivotChartPosition.Top,
        int? height = null,
        bool visible = true)
    {
        if (height is { } requested)
        {
            ArgumentOutOfRangeException.ThrowIfLessThan(requested, 120, nameof(height));
        }

        if (type == PivotChartType.None)
        {
            _options.Remove("chart");
            return this;
        }

        var chart = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["type"] = CamelCase(type.ToString()),
            ["position"] = CamelCase(position.ToString())
        };

        if (height is { } pixels)
        {
            chart["height"] = pixels;
        }

        if (!visible)
        {
            chart["visible"] = false;
        }

        return Set("chart", chart);
    }

    /// <summary>Renames one of the detail modal's texts, over the locale pack's word for it.</summary>
    /// <remarks>
    /// The other texts keep the locale pack's words. <c>truncated</c> takes the record limit as
    /// <c>{0}</c>, <c>summary</c> the visible and total counts as <c>{0}</c> and <c>{1}</c>, and
    /// <c>columnFilter</c> the column's caption as <c>{0}</c>.
    /// </remarks>
    /// <param name="key">The text's key: <c>title</c>, <c>close</c>, <c>search</c>, <c>csv</c>,
    /// <c>all</c>, <c>empty</c>, <c>loading</c>, <c>noRecords</c>, <c>noMatches</c>, <c>failed</c>,
    /// <c>allRows</c>, <c>allColumns</c>, <c>truncated</c>, <c>summary</c> or <c>columnFilter</c>.</param>
    /// <param name="text">The text to show.</param>
    /// <returns>The same builder.</returns>
    /// <exception cref="ArgumentException">The key is not one of the modal's texts.</exception>
    /// <exception cref="ArgumentNullException"><paramref name="text"/> is null.</exception>
    public PivotGridBuilder DrillDownLabel(string key, string text)
    {
        ArgumentNullException.ThrowIfNull(text);

        if (!DrillDownLabelKeys.Contains(key, StringComparer.Ordinal))
        {
            throw new ArgumentException(
                $"'{key}' is not a detail modal text. Expected one of: {string.Join(", ", DrillDownLabelKeys)}.",
                nameof(key));
        }

        _drillDownLabels[key] = text;
        return this;
    }

    /// <summary>Enables or disables the initial load performed when the grid is created.</summary>
    /// <param name="autoLoad">True to load data as soon as the grid is created.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder AutoLoad(bool autoLoad) => Set("autoLoad", autoLoad);

    /// <summary>Enables cached, paged loading for large results.</summary>
    /// <param name="enabled">True to use the large-data endpoints.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder LargeData(bool enabled) => Set("largeData", enabled);

    /// <summary>Sets the number of pivot rows requested per page.</summary>
    /// <param name="pageSize">The page size.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder PageSize(int pageSize) => Set("pageSize", pageSize);

    /// <summary>Sets the source-row hint passed to the data provider.</summary>
    /// <param name="sourceRowCount">The source-row hint.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder SourceRowCount(int sourceRowCount) => Set("sourceRowCount", sourceRowCount);

    /// <summary>Adds a CSS class to the grid container.</summary>
    /// <param name="cssClass">The additional class name.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder CssClass(string cssClass)
    {
        _cssClass = cssClass;
        return this;
    }

    /// <summary>Renders an interactive field designer into the element matching a selector.</summary>
    /// <param name="selector">A CSS selector for the designer's host element.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder FieldDesigner(string selector) => Set("fieldDesigner", selector);

    /// <summary>Sets how the grid's Excel and CSV exports lay out their headers.</summary>
    /// <remarks>Only the options that differ from the defaults are written, so a grid that leaves
    /// them alone exports as it always has. An export call's own options still win.</remarks>
    /// <param name="options">The field header rows and merging to apply.</param>
    /// <returns>The same builder.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="options"/> is null.</exception>
    public PivotGridBuilder ExcelExport(PivotExcelExportOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var defaults = new PivotExcelExportOptions();
        var written = new Dictionary<string, object?>(StringComparer.Ordinal);
        void Write(string name, bool value, bool fallback)
        {
            if (value != fallback)
            {
                written[name] = value;
            }
        }

        Write("exportFilterFieldHeaders", options.ExportFilterFieldHeaders, defaults.ExportFilterFieldHeaders);
        Write("exportDataFieldHeaders", options.ExportDataFieldHeaders, defaults.ExportDataFieldHeaders);
        Write("exportColumnFieldHeaders", options.ExportColumnFieldHeaders, defaults.ExportColumnFieldHeaders);
        Write("exportRowFieldHeaders", options.ExportRowFieldHeaders, defaults.ExportRowFieldHeaders);
        Write("mergeRowFieldValues", options.MergeRowFieldValues, defaults.MergeRowFieldValues);
        Write("mergeColumnFieldValues", options.MergeColumnFieldValues, defaults.MergeColumnFieldValues);
        return written.Count == 0 ? this : Set("excelExport", written);
    }

    /// <summary>Arranges the page's field designer the way a field chooser layout does.</summary>
    /// <param name="layout">The arrangement.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder FieldDesignerLayout(PivotFieldChooserLayout layout) =>
        Set("fieldDesignerLayout", (int)layout);

    /// <summary>Lists every field in the page's field designer, placed or not, each with a
    /// checkbox that places or removes it -- the field chooser's "All fields".</summary>
    /// <param name="allFields">True to list every field.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder FieldDesignerAllFields(bool allFields) => Set("fieldDesignerAllFields", allFields);

    /// <summary>Gives the grid a field chooser popup, DevExtreme's <c>fieldChooser.enabled</c>.</summary>
    /// <remarks>
    /// Opened from the cell and header menus ("Show field chooser"), the
    /// <see cref="PivotToolbarItem.FieldChooser"/> button or <c>showFieldChooser()</c>: the field
    /// designer in a dialog, on the grid's own layout, listing every field (layout 0). Edits apply as
    /// they are made.
    /// </remarks>
    /// <param name="enabled">True to give the grid one.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder FieldChooser(bool enabled) => Set("fieldChooser", enabled);

    /// <summary>Gives the grid a field chooser popup arranged and applied as given.</summary>
    /// <param name="layout">How the list and the zones are arranged.</param>
    /// <param name="allFields">True to list every field with a checkbox; false to list the unplaced ones.</param>
    /// <param name="applyChangesMode"><see cref="PivotApplyChangesMode.OnDemand"/> holds edits until OK.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder FieldChooser(
        PivotFieldChooserLayout layout,
        bool allFields = true,
        PivotApplyChangesMode applyChangesMode = PivotApplyChangesMode.Instantly) =>
        Set("fieldChooser", new Dictionary<string, object?>
        {
            ["layout"] = (int)layout,
            ["allFields"] = allFields,
            ["applyChangesMode"] = applyChangesMode == PivotApplyChangesMode.OnDemand ? "onDemand" : "instantly"
        });

    /// <summary>Persists the layout, captions, filters, and sort the user arrives at.</summary>
    /// <param name="storage">Where to persist. <see cref="PivotStateStorage.None"/> writes nothing.</param>
    /// <returns>The same builder.</returns>
    /// <exception cref="ArgumentException"><paramref name="storage"/> is <see cref="PivotStateStorage.Custom"/>,
    /// which needs its functions: use <see cref="CustomStateStorage"/>.</exception>
    public PivotGridBuilder StateStoring(PivotStateStorage storage) => storage switch
    {
        PivotStateStorage.None => this,
        PivotStateStorage.Custom => throw new ArgumentException(
            "Custom state storage needs the page functions that load and save it; use CustomStateStorage.",
            nameof(storage)),
        _ => Set("stateStoring", storage == PivotStateStorage.Session ? "session" : "local")
    };

    /// <summary>Hands the state to page functions instead of browser storage, DevExtreme's <c>customLoad</c> / <c>customSave</c>.</summary>
    /// <remarks>
    /// <paramref name="load"/> is called once, when the grid starts, and returns the stored state,
    /// its JSON text, or a promise of either -- the first load then waits for it. <paramref name="save"/>
    /// receives the state object after each change, and <c>null</c> when the state is cleared. No
    /// <see cref="StateKey"/> is needed: where the state goes is the functions' business.
    /// </remarks>
    /// <param name="load">The load function's name, optionally a dotted path.</param>
    /// <param name="save">The save function's name, optionally a dotted path.</param>
    /// <returns>The same builder.</returns>
    /// <exception cref="ArgumentException">Either name is null or blank.</exception>
    public PivotGridBuilder CustomStateStorage(string load, string save)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(load);
        ArgumentException.ThrowIfNullOrWhiteSpace(save);
        return Set("stateStoring", "custom").Set("customLoad", load).Set("customSave", save);
    }

    /// <summary>Makes a save wait for the next change, DevExtreme's <c>savingTimeout</c>.</summary>
    /// <remarks>A burst of changes is then one save; a waiting save is written at once when
    /// the page is hidden or the grid disposed. Left unset, every change is saved as it happens.</remarks>
    /// <param name="milliseconds">How long a save waits; zero saves at once.</param>
    /// <returns>The same builder.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="milliseconds"/> is negative.</exception>
    public PivotGridBuilder StateSavingTimeout(int milliseconds)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(milliseconds);
        return Set("stateSavingTimeout", milliseconds);
    }

    /// <summary>Names the storage entry, so two grids on a page never share one.</summary>
    /// <param name="key">The key. When absent the grid's container id stands in; with neither,
    /// nothing is persisted and the grid works from its declared configuration.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder StateKey(string key) => Set("stateKey", key);

    /// <summary>Sets how a click on a cell selects.</summary>
    /// <param name="mode">The selection mode.</param>
    /// <returns>This builder.</returns>
    public PivotGridBuilder SelectionMode(PivotSelectionMode mode) =>
        SetRenderer("selectionMode", mode == PivotSelectionMode.None ? "none" : "single");

    /// <summary>Enables or disables the cell context menu.</summary>
    /// <param name="enabled">True to show the context menu.</param>
    /// <returns>This builder.</returns>
    public PivotGridBuilder ContextMenu(bool enabled) => SetRenderer("contextMenu", enabled);

    /// <summary>Shows or hides subtotal rows.</summary>
    /// <param name="show">True to show subtotals.</param>
    /// <returns>This builder.</returns>
    public PivotGridBuilder Subtotals(bool show) => SetRenderer("subtotals", show);

    /// <summary>Shows or hides subtotal columns.</summary>
    /// <remarks>
    /// The column axis' counterpart of <see cref="Subtotals"/>: a total column after each group of
    /// an outer column field. On by default, as subtotal rows are.
    /// </remarks>
    /// <param name="show">True to show subtotal columns.</param>
    /// <returns>This builder.</returns>
    public PivotGridBuilder ColumnSubtotals(bool show) => SetRenderer("columnSubtotals", show);

    /// <summary>Shows or hides the grand total row along the bottom of the grid.</summary>
    /// <remarks>The name this setting had before the column grand totals could be switched off; see <see cref="ShowRowGrandTotals"/>.</remarks>
    /// <param name="show">True to show the grand total row.</param>
    /// <returns>This builder.</returns>
    public PivotGridBuilder ShowGrandTotal(bool show) => ShowRowGrandTotals(show);

    /// <summary>Shows or hides the grand total row along the bottom of the grid.</summary>
    /// <remarks>
    /// Named, as in DevExtreme, after the area its header sits in: the row that totals every column.
    /// A data field can also leave itself out with <see cref="PivotFieldBuilder.ShowGrandTotals"/>.
    /// </remarks>
    /// <param name="show">True to show the grand total row.</param>
    /// <returns>This builder.</returns>
    public PivotGridBuilder ShowRowGrandTotals(bool show) => SetRenderer("showGrandTotal", show);

    /// <summary>Shows or hides the grand total column on the right of the grid.</summary>
    /// <remarks>
    /// Named, as in DevExtreme, after the area its header sits in: the column that totals every row.
    /// Sorting by that column goes with it. A data field can also leave only its own column out with
    /// <see cref="PivotFieldBuilder.ShowGrandTotals"/>.
    /// </remarks>
    /// <param name="show">True to show the grand total column.</param>
    /// <returns>This builder.</returns>
    public PivotGridBuilder ShowColumnGrandTotals(bool show) => SetRenderer("showColumnGrandTotals", show);

    /// <summary>Sets how row headers are arranged.</summary>
    /// <param name="mode">The layout mode.</param>
    /// <returns>This builder.</returns>
    public PivotGridBuilder LayoutMode(PivotGridLayoutMode mode) =>
        SetRenderer("layoutMode", mode switch
        {
            PivotGridLayoutMode.Compact => "compact",
            PivotGridLayoutMode.Tree => "tree",
            _ => "tabular"
        });

    /// <summary>Sets whether a group's subtotal row is drawn above or below its rows.</summary>
    /// <param name="position">Where the subtotal row goes.</param>
    /// <returns>This builder.</returns>
    public PivotGridBuilder TotalsPosition(PivotTotalsPosition position) =>
        SetRenderer("totalsPosition", position == PivotTotalsPosition.After ? "after" : "before");

    /// <summary>Sets which axis several values are drawn along.</summary>
    /// <param name="position">Columns (the default) or rows.</param>
    /// <returns>This builder.</returns>
    public PivotGridBuilder ValuesPosition(PivotValuesPosition position) =>
        SetRenderer("valuesPosition", position == PivotValuesPosition.Rows ? "rows" : "columns");

    /// <summary>Draws only the columns around what the grid shows, as DevExtreme's virtual scrolling does.</summary>
    /// <remarks>
    /// For a pivot with many columns -- a column per day, say: only a window of them is in the
    /// page, and a spacer on either side keeps the table its full width, so scrolling sideways
    /// redraws the window rather than the browser holding every cell. The spacers are measured from
    /// the columns actually drawn, so a long header does not throw them off; <paramref name="columnWidth"/>
    /// is only the guess the first draw starts from. Excel, CSV and printing still get every column.
    /// Independent of the row paging large-data mode does.
    /// </remarks>
    /// <param name="enabled">Whether columns are virtual.</param>
    /// <param name="columnWidth">The first guess at a value column's width, in pixels; 100 when left out.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentOutOfRangeException">The width is below 24.</exception>
    public PivotGridBuilder VirtualColumns(bool enabled, int? columnWidth = null)
    {
        if (columnWidth is < 24)
        {
            throw new ArgumentOutOfRangeException(nameof(columnWidth), columnWidth, "A virtual column is at least 24 pixels wide.");
        }

        SetRenderer("virtualColumns", enabled);
        return columnWidth is { } width ? SetRenderer("virtualColumnWidth", width) : this;
    }

    /// <summary>Shades the value cells on a colour scale, from the smallest value to the largest.</summary>
    /// <remarks>
    /// Each data field is its own scale; totals and subtotals are not shaded. A conditional
    /// formatting rule's colour wins on the cells it matches.
    /// </remarks>
    /// <param name="mode">What the scale is drawn across.</param>
    /// <returns>This builder.</returns>
    public PivotGridBuilder Heatmap(PivotHeatmapMode mode) =>
        SetRenderer("heatmap", mode switch
        {
            PivotHeatmapMode.Table => "table",
            PivotHeatmapMode.Rows => "rows",
            PivotHeatmapMode.Columns => "columns",
            _ => "none"
        });

    /// <summary>
    /// Draws a bar behind each value cell, as long as the value's share of its scale: a
    /// spreadsheet's data bars, or PivotTable.js' table bar chart.
    /// </summary>
    /// <remarks>
    /// Each data field is its own scale, and the bars share an axis at zero, so negative values
    /// grow the other way in their own colour. Totals and subtotals get no bar. They can be
    /// combined with a heatmap and with conditional formatting; the Excel export leaves them out.
    /// </remarks>
    /// <param name="mode">What the scale is measured across.</param>
    /// <returns>This builder.</returns>
    public PivotGridBuilder ValueBars(PivotValueBarsMode mode) =>
        SetRenderer("valueBars", mode switch
        {
            PivotValueBarsMode.Table => "table",
            PivotValueBarsMode.Rows => "rows",
            PivotValueBarsMode.Columns => "columns",
            _ => "none"
        });

    /// <summary>Repeats a row label on every row it spans instead of only the first.</summary>
    /// <param name="repeat">True to repeat row labels.</param>
    /// <returns>This builder.</returns>
    public PivotGridBuilder RepeatRowLabels(bool repeat) => SetRenderer("repeatRowLabels", repeat);

    /// <summary>
    /// Sets the cell lines: true closes the grid with an outer frame, false takes the lines
    /// between body cells away and keeps the header's. Left unset, the default grid lines stay.
    /// </summary>
    /// <param name="show">True for a framed grid; false for a grid without body lines.</param>
    /// <returns>This builder.</returns>
    public PivotGridBuilder ShowBorders(bool show) => SetRenderer("showBorders", show);

    /// <summary>Sets the narrowest a column may be rendered or resized to, in pixels.</summary>
    /// <param name="width">The minimum width. Must be greater than zero.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentOutOfRangeException">The width is not greater than zero.</exception>
    public PivotGridBuilder MinColumnWidth(int width)
    {
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(width, 0);
        return SetRenderer("minColumnWidth", width);
    }

    /// <summary>Sets the widest a column may be rendered or resized to, in pixels.</summary>
    /// <param name="width">The maximum width. Must be greater than zero.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentOutOfRangeException">The width is not greater than zero.</exception>
    public PivotGridBuilder MaxColumnWidth(int width)
    {
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(width, 0);
        return SetRenderer("maxColumnWidth", width);
    }

    /// <summary>Sets the text shown in a cell that has no value.</summary>
    /// <param name="text">The placeholder text. May be empty to render nothing.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentNullException">The text is null.</exception>
    public PivotGridBuilder EmptyText(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        return SetRenderer("emptyText", text);
    }

    /// <summary>Sets the caption used for total rows and columns.</summary>
    /// <param name="text">The total caption.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The text is null or blank.</exception>
    public PivotGridBuilder TotalText(string text)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(text);
        return SetRenderer("totalText", text);
    }

    /// <summary>Drops rows and columns that hold no values at all.</summary>
    /// <remarks>
    /// The column axis is the product of its levels, so sparse data leaves whole columns that
    /// never occurred; the row axis only observes what the data held, so an empty row is one whose
    /// values all aggregated to nothing. The dropping happens in the engine rather than in the
    /// browser, so paging, Excel export and drill-down all agree on which rows exist.
    /// </remarks>
    /// <param name="hide">Whether empty rows and columns are dropped.</param>
    /// <returns>This builder.</returns>
    public PivotGridBuilder HideEmptySummaryCells(bool hide) => Set("hideEmptySummaryCells", hide);

    /// <summary>Lists in a filter picker only the values the other fields' filters leave.</summary>
    /// <remarks>
    /// The field's own filter never narrows its list, so a value unchecked there stays on the list
    /// to be checked again. Off by default, as DevExtreme's <c>showRelevantValues</c> is.
    /// </remarks>
    /// <param name="show">Whether the picker lists only the relevant values.</param>
    /// <returns>This builder.</returns>
    public PivotGridBuilder ShowRelevantValues(bool show) => Set("showRelevantValues", show);

    /// <summary>Offers every field of the record type, DevExtreme's <c>retrieveFields</c>.</summary>
    /// <remarks>
    /// Before its first load the grid asks the <c>fields</c> endpoint what the record type holds
    /// and adds each field the page did not declare to the field list, unplaced; a date comes as
    /// its year, quarter and month in a folder of its own. A declared field without a data type
    /// takes the discovered one. On by default only for a grid that declares no fields.
    /// </remarks>
    /// <param name="retrieve">Whether the record type's fields are discovered.</param>
    /// <returns>This builder.</returns>
    public PivotGridBuilder RetrieveFields(bool retrieve = true) => Set("retrieveFields", retrieve);

    /// <summary>Loads the grid from a DevExtreme.AspNet.Data backend instead of the PivotForge endpoints, DevExtreme's <c>RemoteStore</c>.</summary>
    /// <remarks>
    /// The browser sends the backend <c>DataSourceLoader.Load</c> requests -- <c>group</c>,
    /// <c>groupSummary</c>, <c>totalSummary</c>, <c>filter</c> -- as a GET with JSON-encoded
    /// parameters and builds the result from the groups that come back, so display modes, running
    /// totals and ordering by a summary run in the browser. Reference
    /// <c>js/pivot-result-assembler.js</c> and <c>js/pivot-remote-store.js</c> on the page. What the
    /// protocol cannot express is refused when the grid starts: aggregations other than sum, count,
    /// average, min and max, calculated fields, top N, value filters and <c>largeData</c>.
    /// </remarks>
    /// <param name="loadUrl">The URL answering <c>DataSourceLoader.Load</c> requests.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The URL is null or blank.</exception>
    public PivotGridBuilder RemoteStore(string loadUrl)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(loadUrl);
        return Set("store", new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["type"] = "remote",
            ["loadUrl"] = loadUrl
        });
    }

    /// <summary>Reads the grid from an OLAP cube over XMLA instead of the PivotForge endpoints, DevExtreme's <c>XmlaStore</c>.</summary>
    /// <remarks>
    /// The browser posts SOAP <c>Discover</c> and <c>Execute</c> requests to <paramref name="url"/> --
    /// SQL Server Analysis Services' <c>msmdpump.dll</c>, or any XMLA provider -- and builds the result
    /// from the cells of one MDX query, so totals are the cube's own and display modes, running totals
    /// and ordering by a summary run in the browser. Fields name levels, hierarchies and measures by
    /// their unique names, such as <c>[Date].[Calendar].[Year]</c> and <c>[Measures].[Sales Amount]</c>.
    /// Reference <c>js/pivot-result-assembler.js</c> and <c>js/pivot-xmla-store.js</c> on the page.
    /// Refused when the grid starts: calculated fields, a <c>groupInterval</c>, <c>selector</c>,
    /// <c>sortingMethod</c>, top N, value filters and <c>largeData</c>.
    /// </remarks>
    /// <param name="url">The XMLA endpoint.</param>
    /// <param name="catalog">The database (catalog) the cube is in.</param>
    /// <param name="cube">The cube's name.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">Any argument is null or blank.</exception>
    public PivotGridBuilder XmlaStore(string url, string catalog, string cube)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(url);
        ArgumentException.ThrowIfNullOrWhiteSpace(catalog);
        ArgumentException.ThrowIfNullOrWhiteSpace(cube);
        return Set("store", new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["type"] = "xmla",
            ["url"] = url,
            ["catalog"] = catalog,
            ["cube"] = cube
        });
    }

    /// <summary>Loads the grid through a page function speaking the <c>DataSourceLoader.Load</c> protocol.</summary>
    /// <remarks>
    /// The function receives the load options -- <c>group</c>, <c>groupSummary</c>,
    /// <c>totalSummary</c>, <c>filter</c>, <c>skip</c>, <c>take</c> -- and returns the
    /// <c>{data, summary, totalCount}</c> answer or a promise of it. The same limits as
    /// <see cref="RemoteStore"/> apply.
    /// </remarks>
    /// <param name="load">The function's name, optionally a dotted path.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The name is null or blank.</exception>
    public PivotGridBuilder RemoteStoreLoad(string load)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(load);
        return Set("store", new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["type"] = "remote",
            ["load"] = load
        });
    }

    /// <summary>Sets the locale pack supplying the on-screen text.</summary>
    /// <remarks>
    /// Every string the grid, the field designer, the value picker and the detail modal put
    /// on screen defaults to English. A locale pack replaces them in one move: reference
    /// <c>js/pivot-locale-&lt;name&gt;.js</c> on the page and name it here. Anything declared
    /// explicitly — <c>total-text</c>, a <c>texts</c> map — still wins over the pack.
    /// <c>en</c> means the built-in defaults and loads nothing. A name whose pack is not on
    /// the page leaves the text in English and warns in the browser console, because a
    /// missing translation file is not a reason to fail the grid.
    /// </remarks>
    /// <param name="locale">A locale pack name, such as <c>tr</c>.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The locale is null or blank.</exception>
    public PivotGridBuilder Locale(string locale)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(locale);
        return Set("locale", locale);
    }

    /// <summary>Sets the culture used to format numbers in the browser.</summary>
    /// <remarks>
    /// Left unset the renderer formats in the reader's own locale, which is what a package
    /// with readers in more than one country wants. Pin it only when the page must show the
    /// same separators to everyone. Server-side collation is separate: it follows
    /// <see cref="System.Globalization.CultureInfo.CurrentCulture"/>, which ASP.NET's request
    /// localization sets per request.
    /// </remarks>
    /// <param name="culture">A BCP 47 language tag, such as <c>tr-TR</c>.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The culture is null or blank.</exception>
    public PivotGridBuilder Culture(string culture)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(culture);
        return SetRenderer("culture", culture);
    }

    /// <summary>Sets the accessible name announced for the grid.</summary>
    /// <remarks>
    /// The rendered table declares <c>role="grid"</c>, which needs a name; a page carrying
    /// two pivots needs two different ones, or a screen reader cannot tell them apart.
    /// </remarks>
    /// <param name="label">The accessible name.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The label is null or blank.</exception>
    public PivotGridBuilder AriaLabel(string label)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(label);
        return SetRenderer("ariaLabel", label);
    }

    /// <summary>Names a page function called before each data request.</summary>
    /// <param name="handler">The function name, optionally a dotted path.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The handler name is null or blank.</exception>
    public PivotGridBuilder OnDataLoading(string handler) => SetEvent("dataLoading", handler);

    /// <summary>Names a page function called after each successful data request.</summary>
    /// <param name="handler">The function name, optionally a dotted path.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The handler name is null or blank.</exception>
    public PivotGridBuilder OnDataLoaded(string handler) => SetEvent("dataLoaded", handler);

    /// <summary>Names a page function called when a request fails.</summary>
    /// <param name="handler">The function name, optionally a dotted path.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The handler name is null or blank.</exception>
    public PivotGridBuilder OnError(string handler) => SetEvent("error", handler);

    /// <summary>Names a page function called when the selected cell changes.</summary>
    /// <param name="handler">The function name, optionally a dotted path.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The handler name is null or blank.</exception>
    public PivotGridBuilder OnSelectionChanged(string handler) =>
        SetEvent("selectionChanged", handler);

    /// <summary>Names a page function called when a cell is activated.</summary>
    /// <param name="handler">The function name, optionally a dotted path.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The handler name is null or blank.</exception>
    public PivotGridBuilder OnCellDoubleClick(string handler) =>
        SetEvent("cellDoubleClick", handler);

    /// <summary>Names a page function called after a cell is copied.</summary>
    /// <param name="handler">The function name, optionally a dotted path.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The handler name is null or blank.</exception>
    public PivotGridBuilder OnCellCopied(string handler) => SetEvent("cellCopied", handler);

    /// <summary>Names a page function called when a cell asks to filter by its value.</summary>
    /// <param name="handler">The function name, optionally a dotted path.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The handler name is null or blank.</exception>
    public PivotGridBuilder OnCellFilterRequested(string handler) =>
        SetEvent("cellFilterRequested", handler);

    /// <summary>Names a page function called when the view state changes.</summary>
    /// <param name="handler">The function name, optionally a dotted path.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The handler name is null or blank.</exception>
    public PivotGridBuilder OnViewStateChanged(string handler) =>
        SetEvent("viewStateChanged", handler);

    /// <summary>Names a page function called before an Excel or CSV file is written.</summary>
    /// <remarks>
    /// The function receives <c>{ format, document, fileName, cancel }</c>: it may change any cell of
    /// <c>document</c> in place (each carries a <c>source</c> describing what it shows), rename the
    /// file, or set <c>cancel</c> to stop the export.
    /// </remarks>
    /// <param name="handler">The function name, optionally a dotted path.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The handler name is null or blank.</exception>
    public PivotGridBuilder OnExporting(string handler) => SetEvent("exporting", handler);

    /// <summary>Names a page function called for every drawn cell, DevExtreme's <c>onCellPrepared</c>.</summary>
    /// <remarks>
    /// It receives <c>{ area, cell, rowIndex, columnIndex, cellElement, rowFields, columnFields, dataFields }</c>
    /// after each draw: <c>area</c> is <c>"row"</c>, <c>"column"</c> or <c>"data"</c>, and <c>cell</c> holds the
    /// text, the value and the paths. A class or text it puts on <c>cellElement</c> is kept, and an
    /// export reads the text it leaves.
    /// </remarks>
    /// <param name="handler">The function name, optionally a dotted path.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The handler name is null or blank.</exception>
    public PivotGridBuilder OnCellPrepared(string handler) => SetEvent("cellPrepared", handler);

    /// <summary>Names a page function called when a cell is clicked, DevExtreme's <c>onCellClick</c>.</summary>
    /// <remarks>Called before the click selects the cell or folds a group; setting <c>cancel</c>
    /// on its argument stops both.</remarks>
    /// <param name="handler">The function name, optionally a dotted path.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The handler name is null or blank.</exception>
    public PivotGridBuilder OnCellClick(string handler) => SetEvent("cellClick", handler);

    /// <summary>Names a page function called once the discovered fields are merged, DevExtreme's <c>onFieldsPrepared</c>.</summary>
    /// <remarks>Raised by <see cref="RetrieveFields"/> before the first load, with <c>fields</c>, the
    /// merged list; what the handler leaves in it is what the grid offers.</remarks>
    /// <param name="handler">The function name, optionally a dotted path.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The handler name is null or blank.</exception>
    public PivotGridBuilder OnFieldsPrepared(string handler) => SetEvent("fieldsPrepared", handler);

    /// <summary>Names a page function called before a cell's or header's menu opens, DevExtreme's <c>onContextMenuPreparing</c>.</summary>
    /// <remarks>Its argument's <c>items</c> may be changed in place: an item the page adds is
    /// <c>{ label, onClick }</c>, and a list left empty opens no menu.</remarks>
    /// <param name="handler">The function name, optionally a dotted path.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The handler name is null or blank.</exception>
    public PivotGridBuilder OnContextMenuPreparing(string handler) =>
        SetEvent("contextMenuPreparing", handler);

    /// <summary>Names a page function called before a group opens or folds, DevExtreme's <c>onExpandValueChanging</c>.</summary>
    /// <remarks>It receives <c>{ area, path, expanded, cancel }</c>, <c>expanded</c> being the
    /// state the group is about to take; setting <c>cancel</c> leaves the group as it is.</remarks>
    /// <param name="handler">The function name, optionally a dotted path.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The handler name is null or blank.</exception>
    public PivotGridBuilder OnExpandValueChanging(string handler) =>
        SetEvent("expandValueChanging", handler);

    /// <summary>Restricts a field to the given values before aggregation.</summary>
    /// <param name="field">The source field to filter.</param>
    /// <param name="values">The values to keep. An empty set filters nothing.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The field name is null or blank.</exception>
    /// <exception cref="ArgumentNullException">The values are null.</exception>
    public PivotGridBuilder Filter(string field, params string[] values) =>
        Filter(field, PivotFilterMode.Include, values);

    /// <summary>Restricts a field to, or away from, the given values before aggregation.</summary>
    /// <param name="field">The source field to filter.</param>
    /// <param name="mode">Whether the values are the ones kept or the ones dropped.</param>
    /// <param name="values">The listed values. An empty set filters nothing, in either mode.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The field name is null or blank.</exception>
    /// <exception cref="ArgumentNullException">The values are null.</exception>
    public PivotGridBuilder Filter(string field, PivotFilterMode mode, params string[] values) =>
        Filter(field, mode, PivotFilterOperator.Equals, values);

    /// <summary>Restricts a field by a condition before aggregation.</summary>
    /// <remarks>
    /// The operator decides what <paramref name="values"/> means: the list of values to keep for
    /// <see cref="PivotFilterOperator.Equals"/>, the argument for the text and comparison
    /// operators, two arguments for <see cref="PivotFilterOperator.Between"/>, and nothing at all
    /// for <see cref="PivotFilterOperator.Blank"/>. There is no "does not contain" operator
    /// because <see cref="PivotFilterMode.Exclude"/> negates whichever one is used.
    /// </remarks>
    /// <param name="field">The source field to filter.</param>
    /// <param name="mode">Whether the condition names what is kept or what is dropped.</param>
    /// <param name="op">How the values are compared.</param>
    /// <param name="values">The operator's arguments.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The field name is null or blank.</exception>
    /// <exception cref="ArgumentNullException">The values are null.</exception>
    /// <exception cref="InvalidOperationException">The operator has fewer arguments than it reads.</exception>
    public PivotGridBuilder Filter(
        string field,
        PivotFilterMode mode,
        PivotFilterOperator op,
        params string[] values)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(field);
        ArgumentNullException.ThrowIfNull(values);

        // A declaration is code, so a condition that reads two arguments and was
        // given one is a typo and fails where it was written. At runtime the same
        // shortfall is an unfinished input box, which the engine treats as no
        // restriction rather than as an error.
        var needed = RequiredArguments(op);
        if (op != PivotFilterOperator.Equals && values.Length < needed)
        {
            throw new InvalidOperationException(
                $"Filter on \"{field}\" uses {op}, which reads {needed} argument(s), but {values.Length} were given.");
        }

        var filter = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["field"] = field,
            ["values"] = values
        };

        // Omitted when it is the default, so a payload only carries the mode of a
        // filter that actually declared one.
        if (mode != PivotFilterMode.Include)
        {
            filter["mode"] = mode.ToString();
        }

        if (op != PivotFilterOperator.Equals)
        {
            filter["operator"] = op.ToString();
        }

        _filters.Add(filter);
        return this;
    }

    /// <summary>Limits a row header level to its highest ranking groups.</summary>
    /// <param name="field">The row field, or <c>field:interval</c> level key, being limited.</param>
    /// <param name="count">How many groups survive in each parent group.</param>
    /// <returns>This builder.</returns>
    public PivotGridBuilder TopN(string field, int count) =>
        TopN(field, count, null, PivotTopNMode.Top);

    /// <summary>Limits a row header level to its highest or lowest ranking groups.</summary>
    /// <remarks>
    /// This runs after aggregation, on groups that do not exist until the records have been
    /// summed, which is what separates it from <see cref="Filter(string, string[])"/>. The rows
    /// it drops leave the result entirely, so every total on screen still adds up.
    /// <para>
    /// A level is ranked inside its own parent group, so the top two categories of every region
    /// are two per region rather than two in total.
    /// </para>
    /// </remarks>
    /// <param name="field">The row field, or <c>field:interval</c> level key, being limited.</param>
    /// <param name="count">How many groups survive in each parent group.</param>
    /// <param name="valueKey">
    /// The value key that ranks the groups, as <c>Field_aggregation</c>. Null uses the first
    /// declared value, which is what a grid with one measure means by "top five".
    /// </param>
    /// <param name="mode">Whether the highest or the lowest ranking groups survive.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The field name is null or blank.</exception>
    /// <exception cref="ArgumentOutOfRangeException">The count is not positive.</exception>
    public PivotGridBuilder TopN(string field, int count, string? valueKey, PivotTopNMode mode)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(field);
        ArgumentOutOfRangeException.ThrowIfLessThan(count, 1);

        var limit = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["field"] = field,
            ["count"] = count
        };

        // Spelled by their absence, so a ranking that took the defaults travels as the
        // two members it actually declared.
        if (!string.IsNullOrWhiteSpace(valueKey))
        {
            limit["valueKey"] = valueKey;
        }

        if (mode != PivotTopNMode.Top)
        {
            limit["mode"] = mode.ToString();
        }

        _topN.Add(limit);
        return this;
    }

    /// <summary>Keeps the groups of a row header level whose summary value meets a condition.</summary>
    /// <remarks>
    /// Like <see cref="TopN(string, int, string, PivotTopNMode)"/> this runs after aggregation --
    /// "regions whose sales exceed 10,000" -- and the groups it drops leave the result, totals
    /// included. A group with no value is dropped. A ranking on the same level is taken among
    /// the groups this keeps.
    /// </remarks>
    /// <param name="field">The row field, or <c>field:interval</c> level key, being filtered.</param>
    /// <param name="op">How each group's value is compared.</param>
    /// <param name="value">The value compared against; the lower bound of a range.</param>
    /// <param name="value2">The upper bound for <see cref="PivotValueFilterOperator.Between"/> and
    /// <see cref="PivotValueFilterOperator.NotBetween"/>; must be null otherwise.</param>
    /// <param name="valueKey">The value key compared, as <c>Field_aggregation</c>. Null uses the
    /// first declared value.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The field name is blank, or a range lacks its upper
    /// bound, or a single comparison carries one.</exception>
    public PivotGridBuilder ValueFilter(
        string field,
        PivotValueFilterOperator op,
        decimal value,
        decimal? value2 = null,
        string? valueKey = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(field);

        var range = op is PivotValueFilterOperator.Between or PivotValueFilterOperator.NotBetween;
        if (range != value2.HasValue)
        {
            throw new ArgumentException(
                range
                    ? $"A {op} value filter needs value2, its upper bound."
                    : $"A {op} value filter compares one value; value2 is only for Between and NotBetween.",
                nameof(value2));
        }

        var filter = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["field"] = field,
            ["operator"] = op.ToString(),
            ["value"] = value
        };

        if (value2 is { } upper)
        {
            filter["value2"] = upper;
        }

        if (!string.IsNullOrWhiteSpace(valueKey))
        {
            filter["valueKey"] = valueKey;
        }

        _valueFilters.Add(filter);
        return this;
    }

    private static int RequiredArguments(PivotFilterOperator op) => op switch
    {
        PivotFilterOperator.Blank => 0,
        PivotFilterOperator.Between => 2,
        _ => 1
    };

    /// <summary>Sets the row ordering the grid starts with.</summary>
    /// <param name="sort">The sort definition. Build one with the <see cref="PivotSort"/> factories.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentNullException">The sort is null.</exception>
    public PivotGridBuilder RowSort(PivotSort sort)
    {
        ArgumentNullException.ThrowIfNull(sort);

        var payload = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["mode"] = sort.Mode.ToString(),
            ["direction"] = sort.Direction.ToString()
        };

        if (sort.Field is not null)
        {
            payload["field"] = sort.Field;
        }

        if (sort.ValueKey is not null)
        {
            payload["valueKey"] = sort.ValueKey;
        }

        if (sort.ColumnPath is not null)
        {
            payload["columnPath"] = sort.ColumnPath;
        }

        return Set("rowSort", payload);
    }

    /// <summary>Highlights cells of one value that satisfy a comparison.</summary>
    /// <param name="valueKey">The value key the rule applies to. See <see cref="PivotValueKey"/>.</param>
    /// <param name="op">The comparison.</param>
    /// <param name="threshold">The threshold compared against.</param>
    /// <param name="color">The highlight applied to a matching cell.</param>
    /// <param name="threshold2">The upper bound, required by <see cref="PivotConditionalOperator.Between"/>.</param>
    /// <param name="id">An optional identifier carried through to the rendered cell.</param>
    /// <returns>This builder.</returns>
    /// <exception cref="ArgumentException">The value key is blank, or Between was given no second threshold.</exception>
    public PivotGridBuilder ConditionalRule(
        string valueKey,
        PivotConditionalOperator op,
        double threshold,
        PivotConditionalColor color,
        double? threshold2 = null,
        string? id = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(valueKey);

        // A Between rule with one bound silently matches nothing in the browser,
        // which reads as the rule being broken rather than incomplete.
        if (op == PivotConditionalOperator.Between && threshold2 is null)
        {
            throw new ArgumentException(
                "A Between conditional rule requires threshold2.", nameof(threshold2));
        }

        var rule = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["valueKey"] = valueKey,
            ["operator"] = CamelCase(op.ToString()),
            ["threshold"] = threshold,
            ["color"] = CamelCase(color.ToString())
        };

        if (threshold2 is { } upper)
        {
            rule["threshold2"] = upper;
        }

        if (id is not null)
        {
            rule["id"] = id;
        }

        _conditionalRules.Add(rule);
        return this;
    }

    private static string CamelCase(string name) =>
        char.ToLowerInvariant(name[0]) + name[1..];

    private PivotGridBuilder Set(string key, object? value)
    {
        _options[key] = value;
        return this;
    }

    private PivotGridBuilder SetRenderer(string key, object? value)
    {
        _rendererOptions[key] = value;
        return this;
    }

    private PivotGridBuilder SetEvent(string key, string handler)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(handler);
        _events[key] = handler;
        return this;
    }

    /// <summary>Writes the grid markup and initialization script.</summary>
    /// <param name="writer">The target writer.</param>
    /// <param name="encoder">The HTML encoder supplied by the view engine.</param>
    /// <exception cref="InvalidOperationException">Required configuration is missing or invalid.</exception>
    public void WriteTo(TextWriter writer, HtmlEncoder encoder)
    {
        ArgumentNullException.ThrowIfNull(writer);
        ArgumentNullException.ThrowIfNull(encoder);

        if (string.IsNullOrWhiteSpace(_id))
        {
            throw new InvalidOperationException(
                "A pivot grid requires Id to be set, because a stable element identifier is needed to address the grid.");
        }

        if (!IsValidElementId(_id))
        {
            throw new InvalidOperationException(
                $"\"{_id}\" is not a valid element identifier. Use letters, digits, hyphens, and underscores.");
        }

        var fields = _fields.Build();
        if (fields.Count == 0)
        {
            throw new InvalidOperationException(
                "A pivot grid requires at least one field. Configure fields with the Fields method.");
        }

        var configId = $"{_id}-config";
        var payload = new Dictionary<string, object?>(_options, StringComparer.Ordinal)
        {
            ["fields"] = fields
        };

        // Derived here rather than at the call site so every declarative path agrees:
        // a localized app gets its locale pack without any grid asking for one, and an
        // explicit Locale still wins because _options was copied first.
        payload.TryAdd("locale", CultureInfo.CurrentUICulture.TwoLetterISOLanguageName);

        // Omitted entirely when nothing was declared, so the widget keeps passing
        // its own renderer defaults through untouched.
        if (_events.Count > 0)
        {
            payload["events"] = new SortedDictionary<string, object?>(_events, StringComparer.Ordinal);
        }

        if (_filters.Count > 0)
        {
            payload["filters"] = _filters;
        }

        // Only the labels: the modal's columns are formatter functions, which a
        // configuration written as JSON cannot carry.
        if (_drillDownLabels.Count > 0)
        {
            payload["drillDownModalOptions"] = new SortedDictionary<string, object?>(StringComparer.Ordinal)
            {
                ["labels"] = _drillDownLabels
            };
        }

        if (_topN.Count > 0)
        {
            payload["topN"] = _topN;
        }

        if (_valueFilters.Count > 0)
        {
            payload["valueFilters"] = _valueFilters;
        }

        // Conditional rules are drawn by the renderer, so they ride with the other
        // presentation options rather than at the top level.
        if (_conditionalRules.Count > 0)
        {
            _rendererOptions["conditionalRules"] = _conditionalRules;
        }

        if (_rendererOptions.Count > 0)
        {
            payload["rendererOptions"] = new SortedDictionary<string, object?>(_rendererOptions, StringComparer.Ordinal);
        }

        // Serialized in key order rather than declaration order, so the same
        // configuration produces the same bytes whichever API declared it and in
        // whatever order — which is what makes the two sample pages comparable.
        var ordered = new SortedDictionary<string, object?>(payload, StringComparer.Ordinal);

        var json = JsonSerializer.Serialize(ordered, SerializerOptions)
            // Prevent any string value from terminating the surrounding script block.
            .Replace("<", "\\u003c", StringComparison.Ordinal);

        var cssClass = string.IsNullOrWhiteSpace(_cssClass)
            ? "pivotforge-grid"
            : $"pivotforge-grid {_cssClass}";

        writer.Write($"<div id=\"{encoder.Encode(_id)}\" class=\"{encoder.Encode(cssClass)}\"");
        writer.Write($" data-pivotforge-config=\"{encoder.Encode(configId)}\"></div>");
        writer.Write($"<script type=\"application/json\" id=\"{encoder.Encode(configId)}\">");
        writer.Write(json);
        writer.Write("</script>");
        writer.Write("<script>PivotForge.create(");
        // _id is written unencoded into this JS string literal. That is safe only because
        // IsValidElementId (checked above) restricts it to letters, digits, '-', and '_' —
        // none of which can terminate the string literal or the surrounding <script> block.
        writer.Write($"document.getElementById(\"{_id}\"), ");
        writer.Write($"JSON.parse(document.getElementById(\"{configId}\").textContent));");
        writer.Write("</script>");
    }

    private static bool IsValidElementId(string id) =>
        id.All(character => char.IsLetterOrDigit(character) || character is '-' or '_');
}
