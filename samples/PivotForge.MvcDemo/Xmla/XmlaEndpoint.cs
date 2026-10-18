using System.Globalization;
using System.Text;
using System.Xml;
using System.Xml.Linq;
using PivotForge.MvcDemo.Models;

namespace PivotForge.MvcDemo.Xmla;

// A stand-in for msmdpump.dll, the HTTP endpoint of SQL Server Analysis
// Services: SOAP Discover and Execute over the demo's SalesCube, answered in
// the rowset and MDDataSet formats a real server writes. It is here so a grid
// declared with xmla-url can be shown and tested without an OLAP server.
internal static class XmlaEndpoint
{
    private static readonly XNamespace Soap = "http://schemas.xmlsoap.org/soap/envelope/";
    private static readonly XNamespace Xmla = "urn:schemas-microsoft-com:xml-analysis";
    private static readonly XNamespace Rowset = "urn:schemas-microsoft-com:xml-analysis:rowset";
    private static readonly XNamespace MdDataSet = "urn:schemas-microsoft-com:xml-analysis:mddataset";
    private static readonly XNamespace Xsi = "http://www.w3.org/2001/XMLSchema-instance";

    public static IEndpointRouteBuilder MapDemoXmla(this IEndpointRouteBuilder endpoints, string pattern)
    {
        endpoints.MapPost(pattern, async (HttpRequest request, int? count) =>
        {
            string body;
            using (var reader = new StreamReader(request.Body, Encoding.UTF8))
            {
                body = await reader.ReadToEndAsync();
            }

            try
            {
                var envelope = XDocument.Parse(body);
                var command = envelope.Root?.Element(Soap + "Body")?.Elements().FirstOrDefault()
                    ?? throw new MdxException("The request carries no SOAP body.");
                var culture = CultureOf(command);
                var cube = SalesCube.Create(SampleSalesData.Create(count ?? 100), culture);

                var response = command.Name.LocalName switch
                {
                    "Discover" => Discover(cube, command),
                    "Execute" => Execute(cube, command),
                    _ => throw new MdxException($"Unknown XMLA method {command.Name.LocalName}.")
                };
                return Xml(Envelope(response), StatusCodes.Status200OK);
            }
            catch (Exception error) when (error is MdxException or XmlException or FormatException)
            {
                return Xml(Fault(error.Message), StatusCodes.Status500InternalServerError);
            }
        });
        return endpoints;
    }

    private static IResult Xml(XDocument document, int status) =>
        Results.Text(document.ToString(SaveOptions.DisableFormatting), "text/xml; charset=utf-8", Encoding.UTF8, status);

    private static XDocument Envelope(XElement body) =>
        new(new XElement(Soap + "Envelope", new XAttribute(XNamespace.Xmlns + "soap", Soap), new XElement(Soap + "Body", body)));

    private static XDocument Fault(string message) =>
        Envelope(new XElement(Soap + "Fault",
            new XElement("faultcode", "XMLAnalysisError.0xc10a0000"),
            new XElement("faultstring", message),
            new XElement("detail", new XElement(Xmla + "Error",
                new XAttribute("ErrorCode", "3238658048"),
                new XAttribute("Description", message),
                new XAttribute("Source", "PivotForge demo XMLA")))));

    private static CultureInfo CultureOf(XElement command)
    {
        var locale = command.Descendants().FirstOrDefault(element => element.Name.LocalName == "LocaleIdentifier")?.Value;
        return int.TryParse(locale, CultureInfo.InvariantCulture, out var lcid)
            ? CultureInfo.GetCultureInfo(lcid)
            : CultureInfo.GetCultureInfo("en-US");
    }

    private static string? Child(XElement element, string localName) =>
        element.Descendants().FirstOrDefault(child => child.Name.LocalName == localName)?.Value;

    // ---- Discover ----

    private static XElement Discover(SalesCube cube, XElement command)
    {
        var requestType = Child(command, "RequestType") ?? throw new MdxException("Discover needs a RequestType.");
        var restrictions = command.Descendants().FirstOrDefault(element => element.Name.LocalName == "RestrictionList");
        var catalog = restrictions is null ? null : Child(restrictions, "CATALOG_NAME");
        var cubeName = restrictions is null ? null : Child(restrictions, "CUBE_NAME");
        var matches =
            (catalog is null || string.Equals(catalog, SalesCube.CatalogName, StringComparison.OrdinalIgnoreCase)) &&
            (cubeName is null || string.Equals(cubeName, SalesCube.CubeName, StringComparison.OrdinalIgnoreCase));

        var rows = !matches ? [] : requestType.ToUpperInvariant() switch
        {
            "MDSCHEMA_CUBES" => [Row(("CATALOG_NAME", SalesCube.CatalogName), ("CUBE_NAME", SalesCube.CubeName), ("CUBE_CAPTION", SalesCube.CubeName))],
            "MDSCHEMA_DIMENSIONS" => cube.Dimensions.Select(dimension => Row(
                ("CATALOG_NAME", SalesCube.CatalogName), ("CUBE_NAME", SalesCube.CubeName),
                ("DIMENSION_NAME", dimension.Name), ("DIMENSION_UNIQUE_NAME", dimension.UniqueName),
                ("DIMENSION_CAPTION", dimension.Caption), ("DIMENSION_TYPE", dimension.Type.ToString(CultureInfo.InvariantCulture)),
                ("DIMENSION_IS_VISIBLE", "true"))).ToList(),
            "MDSCHEMA_HIERARCHIES" => cube.Dimensions.SelectMany(dimension => dimension.Hierarchies).Select(hierarchy => Row(
                ("CATALOG_NAME", SalesCube.CatalogName), ("CUBE_NAME", SalesCube.CubeName),
                ("DIMENSION_UNIQUE_NAME", hierarchy.Dimension.UniqueName), ("HIERARCHY_NAME", hierarchy.Name),
                ("HIERARCHY_UNIQUE_NAME", hierarchy.UniqueName), ("HIERARCHY_CAPTION", hierarchy.Caption),
                ("ALL_MEMBER", hierarchy.AllMember?.UniqueName ?? ""), ("HIERARCHY_DISPLAY_FOLDER", ""),
                ("HIERARCHY_IS_VISIBLE", "true"))).ToList(),
            "MDSCHEMA_LEVELS" => cube.Dimensions.SelectMany(dimension => dimension.Hierarchies)
                .SelectMany(hierarchy => hierarchy.Levels).Select(level => Row(
                    ("CATALOG_NAME", SalesCube.CatalogName), ("CUBE_NAME", SalesCube.CubeName),
                    ("DIMENSION_UNIQUE_NAME", level.Hierarchy.Dimension.UniqueName),
                    ("HIERARCHY_UNIQUE_NAME", level.Hierarchy.UniqueName), ("LEVEL_NAME", level.Name),
                    ("LEVEL_UNIQUE_NAME", level.UniqueName), ("LEVEL_CAPTION", level.Caption),
                    ("LEVEL_NUMBER", level.Number.ToString(CultureInfo.InvariantCulture)),
                    ("LEVEL_TYPE", level.IsAll ? "1" : "0"), ("LEVEL_IS_VISIBLE", "true"))).ToList(),
            "MDSCHEMA_MEASURES" => cube.Measures.Select(measure => Row(
                ("CATALOG_NAME", SalesCube.CatalogName), ("CUBE_NAME", SalesCube.CubeName),
                ("MEASURE_NAME", measure.Name), ("MEASURE_UNIQUE_NAME", measure.UniqueName),
                ("MEASURE_CAPTION", measure.Caption), ("MEASUREGROUP_NAME", SalesCube.MeasureGroup),
                ("MEASURE_DISPLAY_FOLDER", measure.DisplayFolder ?? ""), ("MEASURE_IS_VISIBLE", "true"))).ToList(),
            "MDSCHEMA_MEASUREGROUPS" => [Row(
                ("CATALOG_NAME", SalesCube.CatalogName), ("CUBE_NAME", SalesCube.CubeName),
                ("MEASUREGROUP_NAME", SalesCube.MeasureGroup), ("MEASUREGROUP_CAPTION", "Sales"))],
            _ => throw new MdxException($"The rowset {requestType} is not supported.")
        };

        return new XElement(Xmla + "DiscoverResponse", new XElement(Xmla + "return",
            new XElement(Rowset + "root", new XAttribute("xmlns", Rowset.NamespaceName), rows)));
    }

    private static XElement Row(params (string Name, string Value)[] columns) =>
        new(Rowset + "row", columns.Select(column => new XElement(Rowset + column.Name, column.Value)));

    // ---- Execute ----

    private static XElement Execute(SalesCube cube, XElement command)
    {
        var statementText = Child(command, "Statement") ?? throw new MdxException("Execute needs a Statement.");
        var catalog = command.Descendants().FirstOrDefault(element => element.Name.LocalName == "Catalog")?.Value;
        if (catalog is not null && !string.Equals(catalog, SalesCube.CatalogName, StringComparison.OrdinalIgnoreCase))
        {
            throw new MdxException($"The catalog '{catalog}' does not exist.");
        }

        var statement = MdxParser.Parse(statementText);
        var evaluator = new MdxEvaluator(cube);
        var content = statement.DrillthroughMaxRows is not null
            ? DrillthroughRowset(evaluator.Drillthrough(statement))
            : DataSet(evaluator.Execute(statement));

        return new XElement(Xmla + "ExecuteResponse", new XElement(Xmla + "return", content));
    }

    private static XElement DataSet(MdxEvaluator.Result result)
    {
        var axes = new List<XElement> { Axis("Axis0", result.Columns) };
        if (result.Rows is not null)
        {
            axes.Add(Axis("Axis1", result.Rows));
        }

        return new XElement(MdDataSet + "root",
            new XAttribute("xmlns", MdDataSet.NamespaceName),
            new XAttribute(XNamespace.Xmlns + "xsi", Xsi),
            new XElement(MdDataSet + "OlapInfo"),
            new XElement(MdDataSet + "Axes", axes),
            new XElement(MdDataSet + "CellData", result.Cells.OrderBy(cell => cell.Key).Select(cell =>
                new XElement(MdDataSet + "Cell",
                    new XAttribute("CellOrdinal", cell.Key),
                    new XElement(MdDataSet + "Value", new XAttribute(Xsi + "type", "xsd:double"),
                        cell.Value.ToString(CultureInfo.InvariantCulture))))));
    }

    private static XElement Axis(string name, IReadOnlyList<IReadOnlyList<CubeMember>> tuples) =>
        new(MdDataSet + "Axis", new XAttribute("name", name),
            new XElement(MdDataSet + "Tuples", tuples.Select(tuple =>
                new XElement(MdDataSet + "Tuple", tuple.Select(member =>
                    new XElement(MdDataSet + "Member",
                        new XAttribute("Hierarchy", member.Hierarchy.UniqueName),
                        new XElement(MdDataSet + "UName", member.UniqueName),
                        new XElement(MdDataSet + "Caption", member.Caption),
                        new XElement(MdDataSet + "LName", member.Level.UniqueName),
                        new XElement(MdDataSet + "LNum", member.Level.Number),
                        new XElement(MdDataSet + "DisplayInfo", 0),
                        new XElement(MdDataSet + "PARENT_UNIQUE_NAME", member.Parent?.UniqueName ?? ""),
                        new XElement(MdDataSet + "HIERARCHY_UNIQUE_NAME", member.Hierarchy.UniqueName)))))));

    // A drillthrough answers as a rowset whose columns are named [$Dimension].[Attribute]
    // and [Measure group].[Measure], escaped the way XML names have to be.
    private static XElement DrillthroughRowset(IReadOnlyList<SalesRecord> records)
    {
        static XElement Column(string name, object value) =>
            new(Rowset + XmlConvert.EncodeLocalName(name), Convert.ToString(value, CultureInfo.InvariantCulture));

        return new XElement(Rowset + "root", new XAttribute("xmlns", Rowset.NamespaceName),
            records.Select(record => new XElement(Rowset + "row",
                Column("[$Region].[Region]", record.Region),
                Column("[$Product].[Category]", record.Category),
                Column("[$Sales Person].[Sales Person]", record.SalesPerson),
                Column("[$Order Date].[Order Date]", record.OrderDate.ToString("s", CultureInfo.InvariantCulture)),
                Column("[Sales].[Amount]", record.Amount),
                Column("[Sales].[Quantity]", record.Quantity))));
    }
}
