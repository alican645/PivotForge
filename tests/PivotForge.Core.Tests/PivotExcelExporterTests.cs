using System.IO.Compression;
using System.Xml.Linq;
using PivotForge.Core.Excel;

namespace PivotForge.Core.Tests;

public sealed class PivotExcelExporterTests
{
    private static readonly XNamespace Spreadsheet = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

    [Fact]
    public void Export_WritesVisibleLayoutFiltersFormatsAndHighlights()
    {
        var document = new PivotExcelDocument
        {
            Title = "Satış Pivotu",
            FilterLabel = "Filtreler",
            FilterSummary = "Bölge: Marmara; Yıl: 2026",
            SheetName = "Satış/Pivot",
            HeaderRowCount = 1,
            FrozenColumnCount = 1,
            Rows =
            [
                new PivotExcelRow
                {
                    Cells =
                    [
                        new PivotExcelCell { Text = "2026", ColumnSpan = 2, Width = 240, Role = PivotExcelCellRole.Header }
                    ]
                },
                new PivotExcelRow
                {
                    Cells =
                    [
                        new PivotExcelCell { Text = "Marmara", Width = 150, Role = PivotExcelCellRole.RowHeader },
                        new PivotExcelCell
                        {
                            Text = "₺1.250,50",
                            Number = 1250.5m,
                            NumberFormat = "₺#,##0.00",
                            Role = PivotExcelCellRole.Value,
                            Highlight = PivotExcelHighlight.Red
                        }
                    ]
                }
            ]
        };

        var bytes = new PivotExcelExporter().Export(document);

        using var archive = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
        Assert.NotNull(archive.GetEntry("[Content_Types].xml"));
        Assert.NotNull(archive.GetEntry("xl/workbook.xml"));
        Assert.NotNull(archive.GetEntry("xl/styles.xml"));
        Assert.NotNull(archive.GetEntry("xl/worksheets/sheet1.xml"));

        var worksheet = ReadXml(archive, "xl/worksheets/sheet1.xml");
        var worksheetText = worksheet.ToString(SaveOptions.DisableFormatting);
        var styles = ReadXml(archive, "xl/styles.xml");
        var workbook = ReadXml(archive, "xl/workbook.xml");

        Assert.Contains("Satış Pivotu", worksheetText);
        Assert.Contains("Filtreler: Bölge: Marmara; Yıl: 2026", worksheetText);
        Assert.Contains("1250.5", worksheetText);
        Assert.Contains("A4:B4", worksheet.Descendants(Spreadsheet + "mergeCell").Select(element => element.Attribute("ref")?.Value));
        Assert.Contains("A1:B1", worksheet.Descendants(Spreadsheet + "mergeCell").Select(element => element.Attribute("ref")?.Value));

        var pane = Assert.Single(worksheet.Descendants(Spreadsheet + "pane"));
        Assert.Equal("1", pane.Attribute("xSplit")?.Value);
        Assert.Equal("4", pane.Attribute("ySplit")?.Value);
        Assert.Equal("B5", pane.Attribute("topLeftCell")?.Value);

        Assert.Contains(styles.Descendants(Spreadsheet + "numFmt"), element => element.Attribute("formatCode")?.Value == "₺#,##0.00");
        Assert.Contains(styles.Descendants(Spreadsheet + "fgColor"), element => element.Attribute("rgb")?.Value == "FFFEE2E2");
        Assert.Equal("SatışPivot", workbook.Descendants(Spreadsheet + "sheet").Single().Attribute("name")?.Value);
    }

    [Fact]
    public void Export_WritesFillColorsAndLetsAHighlightWin()
    {
        var document = new PivotExcelDocument
        {
            Rows =
            [
                new PivotExcelRow
                {
                    Cells =
                    [
                        new PivotExcelCell { Number = 1, FillColor = "#fcb27f" },
                        new PivotExcelCell { Number = 2, FillColor = "FCB27F" },
                        new PivotExcelCell { Number = 3, FillColor = "#FFF5EF", Highlight = PivotExcelHighlight.Blue },
                        new PivotExcelCell { Number = 4, FillColor = "orange" }
                    ]
                }
            ]
        };

        using var archive = new ZipArchive(new MemoryStream(new PivotExcelExporter().Export(document)), ZipArchiveMode.Read);
        var styles = ReadXml(archive, "xl/styles.xml");
        var fills = styles.Descendants(Spreadsheet + "fill").ToArray();
        var formats = styles.Descendants(Spreadsheet + "cellXfs").Single().Elements(Spreadsheet + "xf").ToArray();
        var cells = ReadXml(archive, "xl/worksheets/sheet1.xml").Descendants(Spreadsheet + "c")
            .Where(cell => cell.Element(Spreadsheet + "v") is not null)
            .ToArray();

        string? FillOf(XElement cell)
        {
            var format = formats[int.Parse(cell.Attribute("s")!.Value)];
            var fill = fills[int.Parse(format.Attribute("fillId")!.Value)];
            return fill.Descendants(Spreadsheet + "fgColor").SingleOrDefault()?.Attribute("rgb")?.Value;
        }

        Assert.Equal(fills.Length, int.Parse(styles.Descendants(Spreadsheet + "fills").Single().Attribute("count")!.Value));
        // One fill for both spellings; the highlight beats the shade; a non-hex colour is ignored.
        Assert.Equal(["FFFCB27F", "FFFCB27F", "FFDBEAFE", null], cells.Select(FillOf));
        Assert.DoesNotContain(fills, fill => fill.Descendants(Spreadsheet + "fgColor")
            .Any(color => color.Attribute("rgb")?.Value == "FFFFF5EF"));
    }

    [Fact]
    public void Document_UsesLanguageNeutralPackageDefaults()
    {
        var document = new PivotExcelDocument();

        Assert.Equal("Pivot Table", document.Title);
        Assert.Equal("Filters", document.FilterLabel);
        Assert.Equal("No active filters", document.FilterSummary);
        Assert.Equal("Pivot Table", document.SheetName);
    }

    [Fact]
    public void Export_HandlesRowSpanAndSanitizesInvalidXmlCharacters()
    {
        var document = new PivotExcelDocument
        {
            Rows =
            [
                new PivotExcelRow
                {
                    Cells =
                    [
                        new PivotExcelCell { Text = "Bölge\u0001", RowSpan = 2, Role = PivotExcelCellRole.Header },
                        new PivotExcelCell { Text = "Tutar", Role = PivotExcelCellRole.Header }
                    ]
                },
                new PivotExcelRow
                {
                    Cells = [new PivotExcelCell { Number = 10, NumberFormat = "#,##0", Role = PivotExcelCellRole.Total }]
                }
            ]
        };

        var bytes = new PivotExcelExporter().Export(document);
        using var archive = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
        var worksheet = ReadXml(archive, "xl/worksheets/sheet1.xml");

        Assert.Contains("A4:A5", worksheet.Descendants(Spreadsheet + "mergeCell").Select(element => element.Attribute("ref")?.Value));
        Assert.Contains("Bölge", worksheet.ToString());
        Assert.Equal(-1, worksheet.ToString().IndexOf('\u0001'));
    }

    private static XDocument ReadXml(ZipArchive archive, string path)
    {
        using var stream = archive.GetEntry(path)!.Open();
        return XDocument.Load(stream);
    }
}
