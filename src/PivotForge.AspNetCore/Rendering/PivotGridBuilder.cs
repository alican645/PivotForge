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

    private PivotGridBuilder Set(string key, object? value)
    {
        _options[key] = value;
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
