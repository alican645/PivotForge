using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Html;

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

    /// <summary>Shows or hides the grand total.</summary>
    /// <param name="show">True to show the grand total.</param>
    /// <returns>This builder.</returns>
    public PivotGridBuilder ShowGrandTotal(bool show) => SetRenderer("showGrandTotal", show);

    /// <summary>Sets how row headers are arranged.</summary>
    /// <param name="mode">The layout mode.</param>
    /// <returns>This builder.</returns>
    public PivotGridBuilder LayoutMode(PivotGridLayoutMode mode) =>
        SetRenderer("layoutMode", mode == PivotGridLayoutMode.Compact ? "compact" : "tabular");

    /// <summary>Repeats a row label on every row it spans instead of only the first.</summary>
    /// <param name="repeat">True to repeat row labels.</param>
    /// <returns>This builder.</returns>
    public PivotGridBuilder RepeatRowLabels(bool repeat) => SetRenderer("repeatRowLabels", repeat);

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

        // Omitted entirely when nothing was declared, so the widget keeps passing
        // its own renderer defaults through untouched.
        if (_rendererOptions.Count > 0)
        {
            payload["rendererOptions"] = new Dictionary<string, object?>(_rendererOptions, StringComparer.Ordinal);
        }

        if (_events.Count > 0)
        {
            payload["events"] = new Dictionary<string, object?>(_events, StringComparer.Ordinal);
        }

        var json = JsonSerializer.Serialize(payload, SerializerOptions)
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
