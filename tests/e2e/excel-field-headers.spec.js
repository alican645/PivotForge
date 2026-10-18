const { test, expect } = require("@playwright/test");
const zlib = require("node:zlib");

// DevExtreme's exportPivotGrid field header rows and header merging, through
// the real /excel endpoint: the model the grid builds, and the workbook back.
const FIELDS = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  { dataField: "Category", caption: "Kategori", area: "row" },
  { dataField: "Year", caption: "Yıl", area: "column" },
  { dataField: "SalesPerson", caption: "Satıcı", area: "filter" },
  { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" },
  { dataField: "Quantity", caption: "Adet", area: "data", aggregation: "sum" }
];

// One entry of a zip, read through its central directory.
function unzipEntry(buffer, name) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let offset = buffer.readUInt32LE(end + 16);
  const count = buffer.readUInt16LE(end + 10);

  for (let index = 0; index < count; index++) {
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    if (buffer.toString("utf8", offset + 46, offset + 46 + nameLength) === name) {
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const data = buffer.subarray(start, start + size);
      return (method === 8 ? zlib.inflateRawSync(data) : data).toString("utf8");
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return null;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/Home/TagHelpers");
  await page.waitForSelector(".pivot-table__table td");
  await page.evaluate(async fields => {
    const host = document.createElement("div");
    host.id = "excelHost";
    document.body.prepend(host);
    window.excelWidget = PivotForge.create(host, {
      fields,
      autoLoad: false,
      allowExcelExport: true,
      // No header sorting, so the corner does not name the column fields itself.
      allowSorting: false,
      allowFiltering: false,
      excelExport: {
        exportFilterFieldHeaders: true,
        exportDataFieldHeaders: true,
        exportColumnFieldHeaders: true
      }
    });
    await window.excelWidget.refresh();
  }, FIELDS);
});

test("the model carries the field header rows above the table, frozen with it", async ({ page }) => {
  const model = await page.evaluate(() => window.excelWidget.renderer.getExcelExportModel(
    window.excelWidget.exportOptions()));
  const table = await page.evaluate(() => document.querySelector("#excelHost thead").rows.length);
  const texts = row => model.rows[row].cells.map(cell => cell.text);

  expect(texts(0)).toEqual(["Satıcı"]);
  expect(texts(1)).toEqual(["Tutar, Adet", "Yıl"]);
  expect(model.rows[1].cells[0].columnSpan).toBe(model.frozenColumnCount);
  expect(model.headerRowCount).toBe(table + 2);
  expect(model.rows.slice(0, 2).flatMap(row => row.cells).every(cell => cell.role === "FieldHeader")).toBe(true);
});

test("the workbook names the fields and leaves headers unmerged when asked", async ({ page }) => {
  const download = async options => {
    const base64 = await page.evaluate(async exportOptions => {
      const { blob } = await window.excelWidget.exportToExcel(exportOptions);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let text = "";
      bytes.forEach(byte => { text += String.fromCharCode(byte); });
      return btoa(text);
    }, options);
    return unzipEntry(Buffer.from(base64, "base64"), "xl/worksheets/sheet1.xml");
  };
  const merges = sheet => [...sheet.matchAll(/<mergeCell ref="([^"]+)"/g)].map(match => match[1]);

  const merged = await download({});
  for (const caption of ["Satıcı", "Tutar, Adet", "Yıl"]) {
    expect(merged).toContain(caption);
  }
  // Rows 1-2 are the title and filters, row 3 blank: the field rows are 4 and 5.
  expect(merges(merged).some(range => range.startsWith("A4:"))).toBe(true);
  const mergedCount = merges(merged).length;

  const unmerged = await download({ mergeRowFieldValues: false, mergeColumnFieldValues: false });
  // Only the title, the filter line and the field header rows stay merged.
  expect(merges(unmerged).length).toBeLessThan(mergedCount);
  expect(merges(unmerged).every(range => /^[A-Z]+[1245]:/.test(range))).toBe(true);
});

test("the corner can be left blank, as DevExtreme leaves it", async ({ page }) => {
  const corner = async exportRowFieldHeaders => page.evaluate(options => {
    const model = window.excelWidget.renderer.getExcelExportModel(window.excelWidget.exportOptions(options));
    return model.rows[2].cells[0].text;
  }, { exportRowFieldHeaders });

  expect(await corner(true)).toBe("Bölge");
  expect(await corner(false)).toBe("");
});
