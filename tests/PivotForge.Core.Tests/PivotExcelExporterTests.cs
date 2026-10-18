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
    public void Export_WritesFontColorsAndBoldOverrides()
    {
        var document = new PivotExcelDocument
        {
            Rows =
            [
                new PivotExcelRow
                {
                    Cells =
                    [
                        new PivotExcelCell { Number = -1, FontColor = "#dc2626" },
                        new PivotExcelCell { Number = -2, FontColor = "DC2626" },
                        new PivotExcelCell { Number = 3, Bold = true },
                        new PivotExcelCell { Text = "Toplam", Role = PivotExcelCellRole.Total, Bold = false },
                        new PivotExcelCell { Number = 4, FontColor = "red" },
                        new PivotExcelCell { Number = 5, FontColor = "#DC2626", Bold = true }
                    ]
                }
            ]
        };

        using var archive = new ZipArchive(new MemoryStream(new PivotExcelExporter().Export(document)), ZipArchiveMode.Read);
        var styles = ReadXml(archive, "xl/styles.xml");
        var fonts = styles.Descendants(Spreadsheet + "font").ToArray();
        var formats = styles.Descendants(Spreadsheet + "cellXfs").Single().Elements(Spreadsheet + "xf").ToArray();
        var cells = ReadXml(archive, "xl/worksheets/sheet1.xml").Descendants(Spreadsheet + "c")
            .Where(cell => cell.Attribute("r")!.Value.EndsWith('4'))
            .ToArray();

        (string? Color, bool Bold) FontOf(XElement cell)
        {
            var format = formats[int.Parse(cell.Attribute("s")!.Value)];
            var font = fonts[int.Parse(format.Attribute("fontId")!.Value)];
            return (font.Element(Spreadsheet + "color")?.Attribute("rgb")?.Value, font.Element(Spreadsheet + "b") is not null);
        }

        Assert.Equal(fonts.Length, int.Parse(styles.Descendants(Spreadsheet + "fonts").Single().Attribute("count")!.Value));
        // One font for both spellings; Bold overrides the role either way; a non-hex colour is ignored.
        Assert.Equal(
            [("FFDC2626", false), ("FFDC2626", false), (null, true), (null, false), (null, false), ("FFDC2626", true)],
            cells.Select(FontOf));
        Assert.Equal(4, fonts.Length);
    }

    [Theory]
    [InlineData(false, null, "right", "left")]
    [InlineData(true, "1", "left", "right")]
    public void Export_WritesARightToLeftSheetWithMirroredAlignment(
        bool rightToLeft, string? expectedView, string valueAlignment, string headerAlignment)
    {
        var document = new PivotExcelDocument
        {
            RightToLeft = rightToLeft,
            Rows =
            [
                new PivotExcelRow
                {
                    Cells =
                    [
                        new PivotExcelCell { Text = "Ege", Role = PivotExcelCellRole.RowHeader },
                        new PivotExcelCell { Number = 1 }
                    ]
                }
            ]
        };

        using var archive = new ZipArchive(new MemoryStream(new PivotExcelExporter().Export(document)), ZipArchiveMode.Read);
        var worksheet = ReadXml(archive, "xl/worksheets/sheet1.xml");
        var formats = ReadXml(archive, "xl/styles.xml").Descendants(Spreadsheet + "cellXfs").Single()
            .Elements(Spreadsheet + "xf").ToArray();
        var cells = worksheet.Descendants(Spreadsheet + "c").Where(cell => cell.Attribute("r")!.Value.EndsWith('4')).ToArray();
        string AlignmentOf(XElement cell) =>
            formats[int.Parse(cell.Attribute("s")!.Value)].Element(Spreadsheet + "alignment")!.Attribute("horizontal")!.Value;

        Assert.Equal(expectedView, worksheet.Descendants(Spreadsheet + "sheetView").SingleOrDefault()?.Attribute("rightToLeft")?.Value);
        Assert.Equal(headerAlignment, AlignmentOf(cells[0]));
        Assert.Equal(valueAlignment, AlignmentOf(cells[1]));
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

    // A field header row over a 2026/2027 column header row and two regions spanning two rows.
    private static PivotExcelDocument FieldHeaderDocument(bool mergeRows = true, bool mergeColumns = true) => new()
    {
        HeaderRowCount = 2,
        FrozenColumnCount = 1,
        MergeRowFieldValues = mergeRows,
        MergeColumnFieldValues = mergeColumns,
        Rows =
        [
            new PivotExcelRow
            {
                Cells =
                [
                    new PivotExcelCell { Text = "Tutar", Role = PivotExcelCellRole.FieldHeader },
                    new PivotExcelCell { Text = "Yıl", ColumnSpan = 2, Role = PivotExcelCellRole.FieldHeader }
                ]
            },
            new PivotExcelRow
            {
                Cells =
                [
                    new PivotExcelCell { Text = "Bölge", Role = PivotExcelCellRole.Header },
                    new PivotExcelCell { Text = "2026", ColumnSpan = 2, Width = 200, Role = PivotExcelCellRole.Header }
                ]
            },
            new PivotExcelRow
            {
                Cells =
                [
                    new PivotExcelCell { Text = "Ege", RowSpan = 2, Role = PivotExcelCellRole.RowHeader },
                    new PivotExcelCell { Text = "1", Number = 1m },
                    new PivotExcelCell { Text = "2", Number = 2m }
                ]
            },
            new PivotExcelRow
            {
                Cells =
                [
                    new PivotExcelCell { Text = "3", Number = 3m },
                    new PivotExcelCell { Text = "4", Number = 4m }
                ]
            }
        ]
    };

    private static (XDocument Worksheet, XDocument Styles) Export(PivotExcelDocument document)
    {
        using var archive = new ZipArchive(new MemoryStream(new PivotExcelExporter().Export(document)), ZipArchiveMode.Read);
        return (ReadXml(archive, "xl/worksheets/sheet1.xml"), ReadXml(archive, "xl/styles.xml"));
    }

    private static string[] Merges(XDocument worksheet) =>
        worksheet.Descendants(Spreadsheet + "mergeCell").Select(element => element.Attribute("ref")!.Value).ToArray();

    private static string? TextAt(XDocument worksheet, string reference) =>
        worksheet.Descendants(Spreadsheet + "c")
            .SingleOrDefault(cell => cell.Attribute("r")?.Value == reference)
            ?.Descendants(Spreadsheet + "t").SingleOrDefault()?.Value;

    [Fact]
    public void HeadersAreMergedByDefault()
    {
        var (worksheet, _) = Export(FieldHeaderDocument());

        // Data starts on row 4: the field header row, the column headers, then the body.
        Assert.Contains("B4:C4", Merges(worksheet));
        Assert.Contains("B5:C5", Merges(worksheet));
        Assert.Contains("A6:A7", Merges(worksheet));
    }

    [Fact]
    public void UnmergedHeadersAreWrittenIntoEveryCellTheySpan_FieldHeadersStayMerged()
    {
        var (worksheet, _) = Export(FieldHeaderDocument(mergeRows: false, mergeColumns: false));
        var merges = Merges(worksheet);

        Assert.DoesNotContain("B5:C5", merges);
        Assert.DoesNotContain("A6:A7", merges);
        Assert.Contains("B4:C4", merges);
        Assert.Equal("2026", TextAt(worksheet, "B5"));
        Assert.Equal("2026", TextAt(worksheet, "C5"));
        Assert.Equal("Ege", TextAt(worksheet, "A6"));
        Assert.Equal("Ege", TextAt(worksheet, "A7"));
        // The body still lands beside the headers it belongs to.
        Assert.Equal("4", worksheet.Descendants(Spreadsheet + "c")
            .Single(cell => cell.Attribute("r")?.Value == "C7").Element(Spreadsheet + "v")?.Value);
    }

    [Fact]
    public void EachKindOfHeaderFollowsItsOwnFlag()
    {
        var (rowsOnly, _) = Export(FieldHeaderDocument(mergeRows: false));
        Assert.Contains("B5:C5", Merges(rowsOnly));
        Assert.DoesNotContain("A6:A7", Merges(rowsOnly));

        var (columnsOnly, _) = Export(FieldHeaderDocument(mergeColumns: false));
        Assert.DoesNotContain("B5:C5", Merges(columnsOnly));
        Assert.Contains("A6:A7", Merges(columnsOnly));
    }

    [Fact]
    public void AFieldHeaderIsBoldWithAGreyBorder_AndAWorkbookWithoutOneKeepsItsStyles()
    {
        var (worksheet, styles) = Export(FieldHeaderDocument());
        var borders = styles.Descendants(Spreadsheet + "border").ToArray();
        Assert.Equal(3, borders.Length);
        Assert.Contains("FF7E7E7E", borders[2].ToString());

        var styleIndex = int.Parse(worksheet.Descendants(Spreadsheet + "c")
            .Single(cell => cell.Attribute("r")?.Value == "A4").Attribute("s")!.Value);
        var xf = styles.Descendants(Spreadsheet + "cellXfs").Single().Elements(Spreadsheet + "xf").ElementAt(styleIndex);
        Assert.Equal("2", xf.Attribute("borderId")!.Value);
        Assert.Equal("1", xf.Attribute("fontId")!.Value);

        var plain = new PivotExcelDocument { Rows = [new PivotExcelRow { Cells = [new PivotExcelCell { Text = "x" }] }] };
        Assert.Equal(2, Export(plain).Styles.Descendants(Spreadsheet + "border").Count());
    }

    private static XDocument ReadXml(ZipArchive archive, string path)
    {
        using var stream = archive.GetEntry(path)!.Open();
        return XDocument.Load(stream);
    }
}
