const { test, expect } = require("@playwright/test");

// DevExtreme's showValues / showTotals on a measure: a value that gives up its
// detail cells keeps its subtotal and grand total columns, and the table stays
// a rectangle -- head, body and the export alike.
const FIELDS = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  { dataField: "Year", caption: "Yıl", area: "column" },
  { dataField: "Quarter", caption: "Çeyrek", area: "column" },
  { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" },
  { dataField: "Quantity", caption: "Adet", area: "data", aggregation: "sum", showValues: false },
  { dataField: "Discount", caption: "İndirim", area: "data", aggregation: "sum", showTotals: false, showValues: true }
];

test("a value without its detail cells stays in the subtotals and the grand total", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/Home/TagHelpers");
  await page.waitForSelector(".pivot-table__table td");

  const shape = await page.evaluate(async fields => {
    const host = document.createElement("div");
    host.id = "showValuesPivot";
    document.body.appendChild(host);
    const widget = PivotForge.create(host, { fields, autoLoad: false });
    await widget.refresh();

    const table = host.querySelector(".pivot-table__table");
    // Each row's width counting the cells reaching down into it from above.
    const rows = Array.from(table.rows).filter(row => !row.hidden);
    const carried = new Map();
    const widthOf = new Map();
    rows.forEach((row, index) => {
      let width = carried.get(index) ?? 0;
      for (const cell of row.cells) {
        width += cell.colSpan || 1;
        for (let below = 1; below < (cell.rowSpan || 1); below++) {
          carried.set(index + below, (carried.get(index + below) ?? 0) + (cell.colSpan || 1));
        }
      }
      widthOf.set(row, width);
    });
    const width = row => widthOf.get(row);
    const keysOf = selector => Array.from(table.querySelectorAll(selector)).map(cell => cell.dataset.valueKey);
    const unique = keys => [...new Set(keys)];
    const bodyIndexes = Array.from(table.tBodies[0].rows[0].cells)
      .filter(cell => cell.tagName === "TD")
      .map(cell => Number(cell.dataset.columnIndex));
    const model = widget.renderer.getExcelExportModel({});

    return {
      detail: unique(keysOf("thead .pivot-table__value-header:not(.pivot-table__column-subtotal-value-header):not(.pivot-table__total-value-header)")),
      subtotal: unique(keysOf("thead .pivot-table__column-subtotal-value-header")),
      total: unique(keysOf("thead .pivot-table__total-value-header")),
      widths: unique(rows.map(width)),
      contiguous: bodyIndexes.every((index, position) => position === 0 || index === bodyIndexes[position - 1] + 1),
      exportCells: model.rows.at(-1).cells.length,
      bodyCells: table.tBodies[0].rows[table.tBodies[0].rows.length - 1].cells.length
    };
  }, FIELDS);

  expect(shape.detail).toEqual(["Amount_sum", "Discount_sum"]);
  expect(shape.subtotal).toEqual(["Amount_sum", "Quantity_sum"]);
  expect(shape.total).toEqual(["Amount_sum", "Quantity_sum", "Discount_sum"]);
  // Every row as wide as every other, with no gap in the column indexes.
  expect(shape.widths).toHaveLength(1);
  expect(shape.contiguous).toBe(true);
  // The export reads the drawn table, so it carries the same narrower blocks.
  expect(shape.exportCells).toBe(shape.bodyCells);
  expect(errors).toEqual([]);
});

test("with virtual columns the window's cells keep their indexes and scrolling reaches the end", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto("/Home/TagHelpers");
  await page.waitForSelector(".pivot-table__table td");

  const seen = await page.evaluate(async () => {
    const host = document.createElement("div");
    host.style.width = "800px";
    document.body.prepend(host);
    const widget = PivotForge.create(host, {
      autoLoad: false,
      rendererOptions: { virtualColumns: true },
      fields: [
        { dataField: "Region", area: "row" },
        { dataField: "Year", area: "column" },
        { dataField: "OrderDate", area: "column" },
        { dataField: "Amount", area: "data", aggregation: "sum" },
        { dataField: "Quantity", area: "data", aggregation: "sum", showValues: false }
      ]
    });
    await widget.refresh();
    const container = host.querySelector(".pivot-table") ?? host;
    const indexes = () => Array.from(host.querySelector("tbody tr").cells)
      .filter(cell => cell.dataset.selectionTarget === "cell")
      .map(cell => Number(cell.dataset.columnIndex));
    const contiguous = list => list.every((index, position) => position === 0 || index === list[position - 1] + 1);

    const first = indexes();
    container.scrollLeft = container.scrollWidth;
    container.dispatchEvent(new Event("scroll"));
    await new Promise(resolve => setTimeout(resolve, 300));
    const last = indexes();
    const layout = widget.renderer.columnLayout;

    return {
      firstContiguous: contiguous(first.slice(0, -2)),
      lastContiguous: contiguous(last),
      // The right-hand totals: two values, ending the table.
      lastIndex: last.at(-1),
      expectedLast: widget.renderer.totalStart(1) + 1,
      narrowed: layout.width < 2 * (widget.result.columnHeaders.length + 3)
    };
  });

  expect(seen.firstContiguous).toBe(true);
  expect(seen.lastContiguous).toBe(true);
  expect(seen.lastIndex).toBe(seen.expectedLast);
  expect(seen.narrowed).toBe(true);
});
