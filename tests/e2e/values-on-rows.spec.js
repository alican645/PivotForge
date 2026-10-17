const { test, expect } = require("@playwright/test");

// values-position="Rows": each pivot row splits into one row per measure, the
// way DevExtreme draws dataFieldArea: "row". Built in a scratch container so
// the demo's own grid stays as it is.
test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto("/Home/TagHelpers");
  await page.waitForSelector(".pivot-table__table td");
});

async function draw(page, options) {
  return page.evaluate(async options => {
    document.querySelector("#rowsPivot")?.remove();
    const host = document.createElement("div");
    host.id = "rowsPivot";
    document.body.appendChild(host);
    const values = options.values ?? [
      { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" },
      { dataField: "Quantity", caption: "Miktar", area: "data", aggregation: "sum" }
    ];
    const widget = PivotForge.create(host, {
      autoLoad: false,
      allowExcelExport: true,
      fields: [
        { dataField: "Region", caption: "Bölge", area: "row" },
        ...(options.category ? [{ dataField: "Category", caption: "Kategori", area: "row" }] : []),
        { dataField: "Year", caption: "Yıl", area: "column" },
        ...values
      ],
      rendererOptions: {
        ...(options.valuesPosition ? { valuesPosition: options.valuesPosition } : {}),
        ...(options.layoutMode ? { layoutMode: options.layoutMode } : {})
      }
    });
    await widget.refresh();
    window.rowsWidget = widget;

    const table = host.querySelector("table");
    const body = Array.from(table.tBodies[0].rows);
    return {
      headRows: table.tHead.rows.length,
      valueHeaders: table.querySelectorAll("thead .pivot-table__value-header").length,
      // The row fields' corner sits on the head's last row when the column
      // fields have a row of their own names, so every corner cell is read.
      corner: Array.from(table.tHead.querySelectorAll(".pivot-table__corner"))
        .map(cell => cell.textContent.replace(/[↕▲▼]/g, "").trim()),
      cornerColumns: Array.from(table.tHead.rows).map(row =>
        Array.from(row.cells).reduce((sum, cell) => sum + cell.colSpan, 0)),
      measureLabels: body.map(row => row.querySelector(".pivot-table__measure-row-header")?.textContent.trim() ?? null),
      firstRowSpans: Array.from(body[0].cells).filter(cell => cell.tagName === "TH").map(cell => cell.rowSpan),
      cellsPerRow: body.map(row => Array.from(row.cells).reduce((sum, cell) => sum + cell.colSpan, 0)),
      grandTotalRows: body.filter(row => row.dataset.selectionRowKey === "grand-total").length,
      // value key -> the text of every value cell, in order
      byKey: Array.from(table.querySelectorAll("td[data-selection-target='cell']")).reduce((map, cell) => {
        const key = cell.closest("tr").querySelector(".pivot-table__measure-row-header")?.dataset.valueKey ?? "";
        (map[key] ??= []).push(cell.textContent.trim());
        return map;
      }, {}),
      frozen: widget.renderer.getExcelExportModel({}).frozenColumnCount
    };
  }, options);
}

test("each region splits into one row per measure, named in a values column", async ({ page }) => {
  const rows = await draw(page, { valuesPosition: "rows" });

  // No value-header row: the columns carry one value slot each.
  expect(rows.valueHeaders).toBe(0);
  expect(rows.corner).toContain("Bölge");
  expect(rows.corner).toContain("Values");
  expect(rows.measureLabels.filter(Boolean).slice(0, 4)).toEqual(["Tutar", "Miktar", "Tutar", "Miktar"]);
  expect(rows.firstRowSpans[0]).toBe(2);
  // The grand total splits too.
  expect(rows.grandTotalRows).toBe(2);
  // Every head row is as wide as the body's first row.
  expect(new Set(rows.cornerColumns)).toEqual(new Set([rows.cellsPerRow[0]]));
  // Every row spans the same width once the merged header is counted.
  const [first, second] = rows.cellsPerRow;
  expect(second + 1).toBe(first);
  // The region header and the values column stay frozen in the workbook.
  expect(rows.frozen).toBe(2);
  expect(page.errors).toEqual([]);
});

test("the numbers are the ones the columns layout shows", async ({ page }) => {
  const rows = await draw(page, { valuesPosition: "rows" });
  const columns = await page.evaluate(async () => {
    window.rowsWidget.renderer.options.valuesPosition = "columns";
    window.rowsWidget.renderer.rerenderLast();
    const table = document.querySelector("#rowsPivot table");
    return Array.from(table.querySelectorAll("td[data-selection-target='cell']")).reduce((map, cell) => {
      const key = window.rowsWidget.renderer.selectionMetadata.get(cell)?.valueKey;
      (map[key] ??= []).push(cell.textContent.trim());
      return map;
    }, {});
  });

  expect(rows.byKey.Amount_sum).toEqual(columns.Amount_sum);
  expect(rows.byKey.Quantity_sum).toEqual(columns.Quantity_sum);
});

test("with one measure the option changes nothing", async ({ page }) => {
  const one = [{ dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }];
  const rows = await draw(page, { valuesPosition: "rows", values: one });
  const columns = await draw(page, { values: one });

  expect(rows.corner).toEqual(columns.corner);
  expect(rows.cellsPerRow).toEqual(columns.cellsPerRow);
  expect(rows.measureLabels.every(label => label === null)).toBe(true);
});

test("nested rows and the compact layout split the same way", async ({ page }) => {
  const tabular = await draw(page, { valuesPosition: "rows", category: true });
  expect(tabular.firstRowSpans.slice(0, 2)).toEqual([2, 2]);
  expect(tabular.frozen).toBe(3);

  const compact = await draw(page, { valuesPosition: "rows", category: true, layoutMode: "compact" });
  expect(compact.firstRowSpans[0]).toBe(2);
  expect(compact.frozen).toBe(2);
  expect(page.errors).toEqual([]);
});

test("a value that gives up its total leaves a blank, so the rows stay aligned", async ({ page }) => {
  const rows = await draw(page, {
    valuesPosition: "rows",
    values: [
      { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" },
      { dataField: "Quantity", caption: "Miktar", area: "data", aggregation: "sum", showGrandTotals: false }
    ]
  });

  const [first, second] = rows.cellsPerRow;
  expect(second + 1).toBe(first);
  expect(page.errors).toEqual([]);
});
