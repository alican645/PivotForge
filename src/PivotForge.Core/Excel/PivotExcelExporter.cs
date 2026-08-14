using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Xml;

namespace PivotForge.Core.Excel;

/// <summary>Exports a pivot-oriented document as an Office Open XML workbook.</summary>
public sealed class PivotExcelExporter
{
    private const int DataStartRow = 4;
    private static readonly UTF8Encoding Utf8 = new(false);

    /// <summary>Creates an XLSX workbook in memory.</summary>
    /// <param name="document">The workbook content and layout.</param>
    /// <returns>The XLSX file bytes.</returns>
    public byte[] Export(PivotExcelDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);

        var layout = BuildLayout(document);
        var styles = BuildStyles(layout.Placements);

        using var output = new MemoryStream();

        using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
        {
            WriteEntry(archive, "[Content_Types].xml", WriteContentTypes);
            WriteEntry(archive, "_rels/.rels", WritePackageRelationships);
            WriteEntry(archive, "xl/workbook.xml", writer => WriteWorkbook(writer, document.SheetName));
            WriteEntry(archive, "xl/_rels/workbook.xml.rels", WriteWorkbookRelationships);
            WriteEntry(archive, "xl/styles.xml", writer => WriteStyles(writer, styles));
            WriteEntry(archive, "xl/worksheets/sheet1.xml", writer => WriteWorksheet(writer, document, layout, styles));
        }

        return output.ToArray();
    }

    private static SheetLayout BuildLayout(PivotExcelDocument document)
    {
        var placements = new List<CellPlacement>();
        var occupied = new HashSet<(int Row, int Column)>();
        var maxColumn = 1;

        for (var rowIndex = 0; rowIndex < document.Rows.Count; rowIndex++)
        {
            var columnIndex = 1;

            foreach (var cell in document.Rows[rowIndex].Cells)
            {
                while (occupied.Contains((rowIndex, columnIndex)))
                {
                    columnIndex++;
                }

                var rowSpan = Math.Max(1, cell.RowSpan);
                var columnSpan = Math.Max(1, cell.ColumnSpan);
                placements.Add(new CellPlacement(rowIndex, columnIndex, rowSpan, columnSpan, cell));

                for (var row = rowIndex; row < rowIndex + rowSpan; row++)
                {
                    for (var column = columnIndex; column < columnIndex + columnSpan; column++)
                    {
                        occupied.Add((row, column));
                    }
                }

                maxColumn = Math.Max(maxColumn, columnIndex + columnSpan - 1);
                columnIndex += columnSpan;
            }
        }

        return new SheetLayout(placements, maxColumn);
    }

    private static StyleCatalog BuildStyles(IReadOnlyList<CellPlacement> placements)
    {
        var keys = new List<StyleKey>
        {
            new("title", null, PivotExcelHighlight.None),
            new("metadata", null, PivotExcelHighlight.None)
        };

        foreach (var placement in placements)
        {
            var key = new StyleKey(
                placement.Cell.Role.ToString(),
                placement.Cell.Number is null ? null : placement.Cell.NumberFormat ?? "#,##0.00",
                placement.Cell.Highlight);

            if (!keys.Contains(key))
            {
                keys.Add(key);
            }
        }

        var numberFormats = keys
            .Select(key => key.NumberFormat)
            .Where(format => !string.IsNullOrWhiteSpace(format))
            .Distinct(StringComparer.Ordinal)
            .Select((format, index) => (Format: format!, Id: 164 + index))
            .ToDictionary(item => item.Format, item => item.Id, StringComparer.Ordinal);

        return new StyleCatalog(keys, numberFormats);
    }

    private static void WriteWorksheet(
        XmlWriter writer,
        PivotExcelDocument document,
        SheetLayout layout,
        StyleCatalog styles)
    {
        writer.WriteStartDocument();
        writer.WriteStartElement("worksheet", SpreadsheetNamespace);
        writer.WriteAttributeString("xmlns", "r", null, RelationshipsNamespace);

        var frozenRows = Math.Max(0, document.HeaderRowCount) + DataStartRow - 1;
        var frozenColumns = Math.Max(0, document.FrozenColumnCount);

        if (frozenRows > 0 || frozenColumns > 0)
        {
            writer.WriteStartElement("sheetViews");
            writer.WriteStartElement("sheetView");
            writer.WriteAttributeString("workbookViewId", "0");
            writer.WriteStartElement("pane");
            if (frozenColumns > 0) writer.WriteAttributeString("xSplit", frozenColumns.ToString(CultureInfo.InvariantCulture));
            if (frozenRows > 0) writer.WriteAttributeString("ySplit", frozenRows.ToString(CultureInfo.InvariantCulture));
            writer.WriteAttributeString("topLeftCell", $"{ColumnName(frozenColumns + 1)}{frozenRows + 1}");
            writer.WriteAttributeString("state", "frozen");
            writer.WriteEndElement();
            writer.WriteEndElement();
            writer.WriteEndElement();
        }

        writer.WriteStartElement("sheetFormatPr");
        writer.WriteAttributeString("defaultRowHeight", "18");
        writer.WriteEndElement();
        WriteColumns(writer, layout);
        writer.WriteStartElement("sheetData");
        WriteTextRow(writer, 1, document.Title, styles.IndexOf(new("title", null, PivotExcelHighlight.None)));
        WriteTextRow(writer, 2, $"{document.FilterLabel}: {document.FilterSummary}", styles.IndexOf(new("metadata", null, PivotExcelHighlight.None)));

        foreach (var rowGroup in layout.Placements.GroupBy(placement => placement.Row).OrderBy(group => group.Key))
        {
            var excelRow = DataStartRow + rowGroup.Key;
            writer.WriteStartElement("row");
            writer.WriteAttributeString("r", excelRow.ToString(CultureInfo.InvariantCulture));

            foreach (var placement in rowGroup.OrderBy(item => item.Column))
            {
                WriteCell(writer, excelRow, placement, styles);
            }

            writer.WriteEndElement();
        }

        writer.WriteEndElement();

        var merges = layout.Placements
            .Where(placement => placement.RowSpan > 1 || placement.ColumnSpan > 1)
            .Select(placement => CellRange(
                DataStartRow + placement.Row,
                placement.Column,
                DataStartRow + placement.Row + placement.RowSpan - 1,
                placement.Column + placement.ColumnSpan - 1))
            .Prepend($"A1:{ColumnName(layout.MaxColumn)}1")
            .Prepend($"A2:{ColumnName(layout.MaxColumn)}2")
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        writer.WriteStartElement("mergeCells");
        writer.WriteAttributeString("count", merges.Length.ToString(CultureInfo.InvariantCulture));
        foreach (var range in merges)
        {
            writer.WriteStartElement("mergeCell");
            writer.WriteAttributeString("ref", range);
            writer.WriteEndElement();
        }
        writer.WriteEndElement();

        writer.WriteEndElement();
        writer.WriteEndDocument();
    }

    private static void WriteColumns(XmlWriter writer, SheetLayout layout)
    {
        var widths = Enumerable.Range(1, layout.MaxColumn).ToDictionary(column => column, _ => 118d);

        foreach (var placement in layout.Placements)
        {
            var width = Math.Max(56, placement.Cell.Width / placement.ColumnSpan);
            for (var column = placement.Column; column < placement.Column + placement.ColumnSpan; column++)
            {
                widths[column] = Math.Max(widths[column], width);
            }
        }

        writer.WriteStartElement("cols");
        foreach (var (column, pixels) in widths)
        {
            writer.WriteStartElement("col");
            writer.WriteAttributeString("min", column.ToString(CultureInfo.InvariantCulture));
            writer.WriteAttributeString("max", column.ToString(CultureInfo.InvariantCulture));
            writer.WriteAttributeString("width", Math.Clamp((pixels - 5) / 7d, 8, 60).ToString("0.##", CultureInfo.InvariantCulture));
            writer.WriteAttributeString("customWidth", "1");
            writer.WriteEndElement();
        }
        writer.WriteEndElement();
    }

    private static void WriteCell(XmlWriter writer, int row, CellPlacement placement, StyleCatalog styles)
    {
        var cell = placement.Cell;
        var key = new StyleKey(
            cell.Role.ToString(),
            cell.Number is null ? null : cell.NumberFormat ?? "#,##0.00",
            cell.Highlight);

        writer.WriteStartElement("c");
        writer.WriteAttributeString("r", $"{ColumnName(placement.Column)}{row}");
        writer.WriteAttributeString("s", styles.IndexOf(key).ToString(CultureInfo.InvariantCulture));

        if (cell.Number is not null)
        {
            writer.WriteStartElement("v");
            writer.WriteString(cell.Number.Value.ToString(CultureInfo.InvariantCulture));
            writer.WriteEndElement();
        }
        else
        {
            writer.WriteAttributeString("t", "inlineStr");
            writer.WriteStartElement("is");
            writer.WriteStartElement("t");
            writer.WriteAttributeString("xml", "space", null, "preserve");
            writer.WriteString(SanitizeText(cell.Text));
            writer.WriteEndElement();
            writer.WriteEndElement();
        }

        writer.WriteEndElement();
    }

    private static void WriteTextRow(XmlWriter writer, int row, string text, int styleIndex)
    {
        writer.WriteStartElement("row");
        writer.WriteAttributeString("r", row.ToString(CultureInfo.InvariantCulture));
        writer.WriteStartElement("c");
        writer.WriteAttributeString("r", $"A{row}");
        writer.WriteAttributeString("s", styleIndex.ToString(CultureInfo.InvariantCulture));
        writer.WriteAttributeString("t", "inlineStr");
        writer.WriteStartElement("is");
        writer.WriteElementString("t", SanitizeText(text));
        writer.WriteEndElement();
        writer.WriteEndElement();
        writer.WriteEndElement();
    }

    private static void WriteStyles(XmlWriter writer, StyleCatalog catalog)
    {
        writer.WriteStartDocument();
        writer.WriteStartElement("styleSheet", SpreadsheetNamespace);

        writer.WriteStartElement("numFmts");
        writer.WriteAttributeString("count", catalog.NumberFormats.Count.ToString(CultureInfo.InvariantCulture));
        foreach (var (format, id) in catalog.NumberFormats.OrderBy(item => item.Value))
        {
            writer.WriteStartElement("numFmt");
            writer.WriteAttributeString("numFmtId", id.ToString(CultureInfo.InvariantCulture));
            writer.WriteAttributeString("formatCode", format);
            writer.WriteEndElement();
        }
        writer.WriteEndElement();

        WriteFonts(writer);
        WriteFills(writer);
        WriteBorders(writer);

        writer.WriteStartElement("cellStyleXfs");
        writer.WriteAttributeString("count", "1");
        WriteXf(writer, 0, 0, 0, 0, false, false, "left");
        writer.WriteEndElement();

        writer.WriteStartElement("cellXfs");
        writer.WriteAttributeString("count", catalog.Keys.Count.ToString(CultureInfo.InvariantCulture));
        foreach (var key in catalog.Keys)
        {
            var role = key.Role;
            var fontId = role is "title" or nameof(PivotExcelCellRole.Header) or nameof(PivotExcelCellRole.RowHeader) or nameof(PivotExcelCellRole.Subtotal) or nameof(PivotExcelCellRole.Total) or nameof(PivotExcelCellRole.GrandTotal) ? 1 : 0;
            var fillId = ResolveFillId(key);
            var numberFormatId = key.NumberFormat is null ? 0 : catalog.NumberFormats[key.NumberFormat];
            var horizontal = role is nameof(PivotExcelCellRole.Value) or nameof(PivotExcelCellRole.Subtotal) or nameof(PivotExcelCellRole.Total) or nameof(PivotExcelCellRole.GrandTotal) ? "right" : "left";
            WriteXf(writer, numberFormatId, fontId, fillId, role is "title" or "metadata" ? 0 : 1, numberFormatId > 0, true, horizontal);
        }
        writer.WriteEndElement();

        writer.WriteStartElement("cellStyles");
        writer.WriteAttributeString("count", "1");
        writer.WriteStartElement("cellStyle");
        writer.WriteAttributeString("name", "Normal");
        writer.WriteAttributeString("xfId", "0");
        writer.WriteAttributeString("builtinId", "0");
        writer.WriteEndElement();
        writer.WriteEndElement();
        writer.WriteEndElement();
        writer.WriteEndDocument();
    }

    private static int ResolveFillId(StyleKey key)
    {
        if (key.Highlight != PivotExcelHighlight.None)
        {
            return key.Highlight switch
            {
                PivotExcelHighlight.Green => 7,
                PivotExcelHighlight.Amber => 8,
                PivotExcelHighlight.Red => 9,
                PivotExcelHighlight.Blue => 10,
                _ => 0
            };
        }

        return key.Role switch
        {
            "title" => 2,
            "metadata" => 3,
            nameof(PivotExcelCellRole.Header) => 4,
            nameof(PivotExcelCellRole.Subtotal) => 5,
            nameof(PivotExcelCellRole.Total) or nameof(PivotExcelCellRole.GrandTotal) => 6,
            _ => 0
        };
    }

    private static void WriteFonts(XmlWriter writer)
    {
        writer.WriteStartElement("fonts");
        writer.WriteAttributeString("count", "2");
        WriteFont(writer, false);
        WriteFont(writer, true);
        writer.WriteEndElement();
    }

    private static void WriteFont(XmlWriter writer, bool bold)
    {
        writer.WriteStartElement("font");
        if (bold) writer.WriteElementString("b", "");
        writer.WriteStartElement("sz");
        writer.WriteAttributeString("val", bold ? "11" : "10");
        writer.WriteEndElement();
        writer.WriteStartElement("name");
        writer.WriteAttributeString("val", "Aptos");
        writer.WriteEndElement();
        writer.WriteEndElement();
    }

    private static void WriteFills(XmlWriter writer)
    {
        var colors = new string?[] { null, null, "E2E8F0", "F8FAFC", "EEF2F7", "EEFBF8", "F1F5F9", "DCFCE7", "FEF3C7", "FEE2E2", "DBEAFE" };
        writer.WriteStartElement("fills");
        writer.WriteAttributeString("count", colors.Length.ToString(CultureInfo.InvariantCulture));

        for (var index = 0; index < colors.Length; index++)
        {
            writer.WriteStartElement("fill");
            writer.WriteStartElement("patternFill");
            writer.WriteAttributeString("patternType", index == 0 ? "none" : index == 1 ? "gray125" : "solid");
            if (colors[index] is { } color)
            {
                writer.WriteStartElement("fgColor");
                writer.WriteAttributeString("rgb", $"FF{color}");
                writer.WriteEndElement();
                writer.WriteStartElement("bgColor");
                writer.WriteAttributeString("indexed", "64");
                writer.WriteEndElement();
            }
            writer.WriteEndElement();
            writer.WriteEndElement();
        }

        writer.WriteEndElement();
    }

    private static void WriteBorders(XmlWriter writer)
    {
        writer.WriteStartElement("borders");
        writer.WriteAttributeString("count", "2");
        writer.WriteStartElement("border");
        writer.WriteElementString("left", "");
        writer.WriteElementString("right", "");
        writer.WriteElementString("top", "");
        writer.WriteElementString("bottom", "");
        writer.WriteElementString("diagonal", "");
        writer.WriteEndElement();
        writer.WriteStartElement("border");
        foreach (var side in new[] { "left", "right", "top", "bottom" })
        {
            writer.WriteStartElement(side);
            writer.WriteAttributeString("style", "thin");
            writer.WriteStartElement("color");
            writer.WriteAttributeString("rgb", "FFD8DEE8");
            writer.WriteEndElement();
            writer.WriteEndElement();
        }
        writer.WriteElementString("diagonal", "");
        writer.WriteEndElement();
        writer.WriteEndElement();
    }

    private static void WriteXf(XmlWriter writer, int numberFormatId, int fontId, int fillId, int borderId, bool applyNumberFormat, bool applyAlignment, string horizontal)
    {
        writer.WriteStartElement("xf");
        writer.WriteAttributeString("numFmtId", numberFormatId.ToString(CultureInfo.InvariantCulture));
        writer.WriteAttributeString("fontId", fontId.ToString(CultureInfo.InvariantCulture));
        writer.WriteAttributeString("fillId", fillId.ToString(CultureInfo.InvariantCulture));
        writer.WriteAttributeString("borderId", borderId.ToString(CultureInfo.InvariantCulture));
        writer.WriteAttributeString("xfId", "0");
        if (fillId > 0) writer.WriteAttributeString("applyFill", "1");
        if (borderId > 0) writer.WriteAttributeString("applyBorder", "1");
        if (applyNumberFormat) writer.WriteAttributeString("applyNumberFormat", "1");
        if (applyAlignment)
        {
            writer.WriteAttributeString("applyAlignment", "1");
            writer.WriteStartElement("alignment");
            writer.WriteAttributeString("horizontal", horizontal);
            writer.WriteAttributeString("vertical", "center");
            writer.WriteAttributeString("wrapText", "1");
            writer.WriteEndElement();
        }
        writer.WriteEndElement();
    }

    private static void WriteContentTypes(XmlWriter writer)
    {
        writer.WriteStartDocument();
        writer.WriteStartElement("Types", "http://schemas.openxmlformats.org/package/2006/content-types");
        WriteContentTypeDefault(writer, "rels", "application/vnd.openxmlformats-package.relationships+xml");
        WriteContentTypeDefault(writer, "xml", "application/xml");
        WriteContentTypeOverride(writer, "/xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml");
        WriteContentTypeOverride(writer, "/xl/worksheets/sheet1.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml");
        WriteContentTypeOverride(writer, "/xl/styles.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml");
        writer.WriteEndElement();
        writer.WriteEndDocument();
    }

    private static void WriteContentTypeDefault(XmlWriter writer, string extension, string contentType)
    {
        writer.WriteStartElement("Default");
        writer.WriteAttributeString("Extension", extension);
        writer.WriteAttributeString("ContentType", contentType);
        writer.WriteEndElement();
    }

    private static void WriteContentTypeOverride(XmlWriter writer, string partName, string contentType)
    {
        writer.WriteStartElement("Override");
        writer.WriteAttributeString("PartName", partName);
        writer.WriteAttributeString("ContentType", contentType);
        writer.WriteEndElement();
    }

    private static void WritePackageRelationships(XmlWriter writer)
    {
        writer.WriteStartDocument();
        writer.WriteStartElement("Relationships", PackageRelationshipsNamespace);
        WriteRelationship(writer, "rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", "xl/workbook.xml");
        writer.WriteEndElement();
        writer.WriteEndDocument();
    }

    private static void WriteWorkbook(XmlWriter writer, string sheetName)
    {
        writer.WriteStartDocument();
        writer.WriteStartElement("workbook", SpreadsheetNamespace);
        writer.WriteAttributeString("xmlns", "r", null, RelationshipsNamespace);
        writer.WriteStartElement("sheets");
        writer.WriteStartElement("sheet");
        writer.WriteAttributeString("name", SanitizeSheetName(sheetName));
        writer.WriteAttributeString("sheetId", "1");
        writer.WriteAttributeString("r", "id", RelationshipsNamespace, "rId1");
        writer.WriteEndElement();
        writer.WriteEndElement();
        writer.WriteEndElement();
        writer.WriteEndDocument();
    }

    private static void WriteWorkbookRelationships(XmlWriter writer)
    {
        writer.WriteStartDocument();
        writer.WriteStartElement("Relationships", PackageRelationshipsNamespace);
        WriteRelationship(writer, "rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet", "worksheets/sheet1.xml");
        WriteRelationship(writer, "rId2", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles", "styles.xml");
        writer.WriteEndElement();
        writer.WriteEndDocument();
    }

    private static void WriteRelationship(XmlWriter writer, string id, string type, string target)
    {
        writer.WriteStartElement("Relationship");
        writer.WriteAttributeString("Id", id);
        writer.WriteAttributeString("Type", type);
        writer.WriteAttributeString("Target", target);
        writer.WriteEndElement();
    }

    private static void WriteEntry(ZipArchive archive, string path, Action<XmlWriter> write)
    {
        var entry = archive.CreateEntry(path, CompressionLevel.Fastest);
        using var stream = entry.Open();
        using var writer = XmlWriter.Create(stream, new XmlWriterSettings
        {
            Encoding = Utf8,
            Indent = false,
            CloseOutput = false
        });
        write(writer);
    }

    private static string ColumnName(int column)
    {
        var name = "";
        while (column > 0)
        {
            column--;
            name = (char)('A' + column % 26) + name;
            column /= 26;
        }
        return name;
    }

    private static string CellRange(int firstRow, int firstColumn, int lastRow, int lastColumn) =>
        $"{ColumnName(firstColumn)}{firstRow}:{ColumnName(lastColumn)}{lastRow}";

    private static string SanitizeText(string? value) => string.Concat((value ?? "").Where(character =>
        XmlConvert.IsXmlChar(character) && (!char.IsControl(character) || character is '\t' or '\n' or '\r')));

    private static string SanitizeSheetName(string? value)
    {
        var name = string.Concat((value ?? "Pivot Table").Where(character => !"[]:*?/\\".Contains(character))).Trim();
        return string.IsNullOrEmpty(name) ? "Pivot Table" : name[..Math.Min(31, name.Length)];
    }

    private const string SpreadsheetNamespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    private const string RelationshipsNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    private const string PackageRelationshipsNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";

    private sealed record CellPlacement(int Row, int Column, int RowSpan, int ColumnSpan, PivotExcelCell Cell);
    private sealed record SheetLayout(IReadOnlyList<CellPlacement> Placements, int MaxColumn);
    private sealed record StyleKey(string Role, string? NumberFormat, PivotExcelHighlight Highlight);
    private sealed record StyleCatalog(IReadOnlyList<StyleKey> Keys, IReadOnlyDictionary<string, int> NumberFormats)
    {
        public int IndexOf(StyleKey key)
        {
            for (var index = 0; index < Keys.Count; index++)
            {
                if (Keys[index] == key)
                {
                    return index;
                }
            }

            throw new InvalidOperationException("Excel cell style was not registered.");
        }
    }
}
