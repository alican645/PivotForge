const { test, expect } = require("@playwright/test");

const PAGE = "/Home/TagHelpers";

const columnField = '.pivot-table__column-field [data-action="header-filter"]';
const picker = ".pivot-filter-picker.is-open";

function trackRequests(page) {
  const requests = [];
  page.on("request", request => {
    if (request.method() === "POST" && request.url().includes("/pivotforge/") &&
      !request.url().includes("/field-values")) {
      requests.push(request.postDataJSON());
    }
  });
  return requests;
}

const columnHeaders = page => page.locator(".pivot-table__column-header").allTextContents();

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table tbody tr");
});

test("the column axis names its field, which the value headers never did", async ({ page }) => {
  // The whole reason this feature needed layout work: "2024" is a value, and a
  // funnel on it would read as filtering that column rather than that field.
  const cell = page.locator(".pivot-table__column-field").first();

  await expect(cell).toContainText("Yıl");
  await expect(page.locator(columnField)).toBeVisible();
});

test("the row field names moved to a row of their own and still work", async ({ page }) => {
  const cells = page.locator(".pivot-table thead tr:last-child .pivot-table__corner");

  await expect(cells).toHaveCount(2);
  await expect(cells.first()).toContainText("Bölge");
  await expect(cells.first().locator('[data-action="header-filter"]')).toBeVisible();
  await expect(cells.first().locator(".pivot-table__sort-button")).toBeVisible();
});

test("filtering from the column funnel narrows the columns", async ({ page }) => {
  const requests = trackRequests(page);
  const before = await columnHeaders(page);
  expect(before.length).toBeGreaterThan(1);

  await page.locator(columnField).click();
  await expect(page.locator(`${picker} .pivot-filter-picker__value`).first()).toBeVisible();

  // Unchecking the first value: the list opens with everything selected.
  await page.locator(`${picker} .pivot-filter-picker__value`).first().click();
  await page.locator(`${picker} [data-action="filter-apply"]`).click();

  await expect.poll(() => requests.at(-1)?.filters).toEqual([
    { field: "Year", values: before.slice(1), mode: "Include" }
  ]);
  await expect.poll(() => columnHeaders(page)).toEqual(before.slice(1));
  expect(page.errors).toEqual([]);
});

test("the column funnel marks itself while its field is restricted", async ({ page }) => {
  await expect(page.locator(columnField)).not.toHaveClass(/is-active/);

  await page.locator(columnField).click();
  await expect(page.locator(`${picker} .pivot-filter-picker__value`).first()).toBeVisible();
  await page.locator(`${picker} .pivot-filter-picker__value`).first().click();
  await page.locator(`${picker} [data-action="filter-apply"]`).click();

  await expect(page.locator(columnField)).toHaveClass(/is-active/);
});

test("reopening the column funnel shows the restriction already in force", async ({ page }) => {
  await page.locator(columnField).click();
  await expect(page.locator(`${picker} .pivot-filter-picker__value`).first()).toBeVisible();
  const dropped = await page.locator(`${picker} .pivot-filter-picker__value`).first().textContent();
  await page.locator(`${picker} .pivot-filter-picker__value`).first().click();
  await page.locator(`${picker} [data-action="filter-apply"]`).click();
  await expect(page.locator(picker)).toHaveCount(0);

  await page.locator(columnField).click();
  const checked = page.locator(`${picker} .pivot-filter-picker__value input:checked`);

  await expect(checked).toHaveCount(2);
  await expect(page.locator(`${picker} .pivot-filter-picker__value`, { hasText: dropped.trim() })
    .locator("input")).not.toBeChecked();
});

test("a level of a grouped column axis names itself too", async ({ page }) => {
  // The grouping page puts one date column on two column levels, so each level
  // needs its own name and its own funnel -- a field name would not tell them apart.
  await page.goto("/Home/Grouping");
  await page.waitForSelector(".pivot-table tbody tr");

  const names = await page.locator(".pivot-table__column-field").allTextContents();

  expect(names.map(name => name.replace("▼", "").trim())).toEqual(["Çeyrek", "Haftanın Günü"]);
  await expect(page.locator(columnField)).toHaveCount(2);
});

test("without a way to filter, the table keeps the shape it always had", async ({ page }) => {
  // The renderer's capability rule: no callback, no control -- and here, no cell
  // for the control to sit in either.
  const shape = await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const result = {
      rowHeaders: [["Ege"]],
      columnHeaders: [["2024"]],
      cells: [{ row: 0, column: 0, values: { Amount_sum: 5 } }],
      rowTotals: [], columnTotals: [], subtotals: [], grandTotals: { Amount_sum: 5 }
    };
    const settings = {
      rowFields: ["Region"], rowFieldLabels: ["Bölge"],
      columnFields: ["Year"], columnFieldLabels: ["Yıl"],
      values: [{ key: "Amount_sum", label: "Tutar" }]
    };

    const withoutFilter = new PivotForge.PivotTableRenderer(host, settings);
    withoutFilter.render(result);
    const plain = host.querySelectorAll(".pivot-table__column-field").length;

    const withFilter = new PivotForge.PivotTableRenderer(host, {
      ...settings,
      onFilterRequested: () => {}
    });
    withFilter.render(result);
    const filterable = host.querySelectorAll(".pivot-table__column-field").length;

    host.remove();
    return { plain, filterable };
  });

  expect(shape).toEqual({ plain: 0, filterable: 1 });
});

// Every header row has to cover the same number of columns, or the value headers
// slide out from under the columns they name. Read as a total of colSpan rather
// than a cell count, because the corner block is one wide cell on some rows and
// several narrow ones on others.
const headWidths = page => page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll(".pivot-table thead tr"));
  // A cell with a rowSpan occupies the rows below it without appearing in them,
  // so the width has to be counted as the browser lays the grid out rather than
  // as a sum of each row's own cells.
  const carried = [];
  return rows.map((row, index) => {
    let width = carried[index] ?? 0;

    for (const cell of row.cells) {
      width += cell.colSpan;

      for (let below = 1; below < cell.rowSpan; below++) {
        carried[index + below] = (carried[index + below] ?? 0) + cell.colSpan;
      }
    }

    return width;
  });
});

// A rowSpan reaching past the head would push the corner block into the body.
const cornerSpans = page => page.evaluate(() => Array.from(
  document.querySelectorAll(".pivot-table thead .pivot-table__corner"),
  cell => cell.rowSpan));

test("every header row covers the table's full width", async ({ page }) => {
  const widths = await headWidths(page);

  expect(widths.length).toBeGreaterThan(1);
  expect(new Set(widths).size).toBe(1);
});

test("a deeper column axis keeps its header rows aligned", async ({ page }) => {
  // Two column levels and two row levels: the case where a corner cell that kept
  // the old rowSpan would reach past the head into the body.
  await page.goto("/Home/Grouping");
  await page.waitForSelector(".pivot-table tbody tr");

  const widths = await headWidths(page);
  const spans = await cornerSpans(page);

  expect(new Set(widths).size).toBe(1);
  expect(spans.every(span => span === 1)).toBe(true);
});

test("a second measure keeps the header rows aligned too", async ({ page }) => {
  // A second data field adds a measure row, whose corner needs a filler of its
  // own or everything below it shifts one column left.
  const widths = await page.evaluate(async () => {
    const host = document.createElement("div");
    host.id = "twoMeasures";
    document.body.appendChild(host);
    const widget = PivotForge.create(host, {
      autoLoad: false,
      allowFiltering: true,
      fields: [
        { dataField: "Region", caption: "Bölge", area: "row" },
        { dataField: "Category", caption: "Kategori", area: "row" },
        { dataField: "Year", caption: "Yıl", area: "column" },
        { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" },
        { dataField: "Quantity", caption: "Adet", area: "data", aggregation: "sum" }
      ]
    });
    await widget.refresh();

    const rows = Array.from(host.querySelectorAll("thead tr"));
    const result = rows.map(row =>
      Array.from(row.cells).reduce((total, cell) => total + cell.colSpan, 0));
    host.remove();
    return result;
  });

  // One row per column level, one measure row, one row-field row.
  expect(widths).toHaveLength(3);
  expect(new Set(widths).size).toBe(1);
});

test("a table with no column fields keeps the shape it always had", async ({ page }) => {
  // Nothing to name, so no cell to name it in -- and the row fields stay on the
  // only header row rather than moving under a blank one.
  const shape = await page.evaluate(async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const widget = PivotForge.create(host, {
      autoLoad: false,
      allowFiltering: true,
      fields: [
        { dataField: "Region", caption: "Bölge", area: "row" },
        { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
      ]
    });
    await widget.refresh();

    const result = {
      headRows: host.querySelectorAll("thead tr").length,
      fieldCells: host.querySelectorAll(".pivot-table__column-field").length,
      firstRowNamesTheRowField:
        host.querySelector("thead tr .pivot-table__corner")?.textContent.includes("Bölge") ?? false
    };
    host.remove();
    return result;
  });

  expect(shape).toEqual({ headRows: 1, fieldCells: 0, firstRowNamesTheRowField: true });
});

test("a hidden column field is not named", async ({ page }) => {
  // A field the reader cannot see must not get a funnel. The case that decides
  // it is a column axis that is *entirely* hidden: with one visible field left
  // the level count hides the mistake, because only as many cells are drawn as
  // there are levels.
  const shape = await page.evaluate(async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const widget = PivotForge.create(host, {
      autoLoad: false,
      allowFiltering: true,
      fields: [
        { dataField: "Region", caption: "Bölge", area: "row" },
        { dataField: "Quarter", caption: "Çeyrek", area: "column", visible: false },
        { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
      ]
    });
    await widget.refresh();

    const result = {
      headRows: host.querySelectorAll("thead tr").length,
      fieldCells: host.querySelectorAll(".pivot-table__column-field").length
    };
    host.remove();
    return result;
  });

  // No visible column field is no column axis at all: the old shape, unchanged.
  expect(shape).toEqual({ headRows: 1, fieldCells: 0 });

  const names = await page.evaluate(async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const widget = PivotForge.create(host, {
      autoLoad: false,
      allowFiltering: true,
      fields: [
        { dataField: "Region", caption: "Bölge", area: "row" },
        { dataField: "Year", caption: "Yıl", area: "column" },
        { dataField: "Quarter", caption: "Çeyrek", area: "column", visible: false },
        { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
      ]
    });
    await widget.refresh();

    const result = Array.from(
      host.querySelectorAll(".pivot-table__column-field"),
      cell => cell.textContent.replace("▼", "").trim());
    host.remove();
    return result;
  });

  expect(names).toEqual(["Yıl"]);
});

test("the exported workbook carries the field names it shows", async ({ page }) => {
  // The export model is read off the rendered table, so a header row added to
  // the screen has to arrive in the spreadsheet as a header row.
  const model = await page.evaluate(async () => {
    // Built into a scratch container rather than read off the demo's own grid,
    // which exposes no handle -- the shape under test is the renderer's, not
    // that page's.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const widget = PivotForge.create(host, {
      autoLoad: false,
      allowFiltering: true,
      allowExcelExport: true,
      fields: [
        { dataField: "Region", caption: "Bölge", area: "row" },
        { dataField: "Year", caption: "Yıl", area: "column" },
        { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
      ]
    });
    await widget.refresh();
    const model = widget.renderer.getExcelExportModel({});
    host.remove();
    return model;
  });

  expect(model.headerRowCount).toBe(2);
  expect(JSON.stringify(model.rows[0])).toContain("Yıl");
  expect(JSON.stringify(model.rows[1])).toContain("Bölge");
});
