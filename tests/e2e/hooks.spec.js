const { test, expect } = require("@playwright/test");

// DevExtreme's cell events and custom state storage, on a grid built into a
// scratch container of the demo page.
const FIELDS = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  { dataField: "Category", caption: "Kategori", area: "row" },
  { dataField: "Year", caption: "Yıl", area: "column" },
  { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
];

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto("/Home/TagHelpers");
  await page.waitForSelector(".pivot-table__table td");
});

test.afterEach(async ({ page }) => {
  expect(page.errors).toEqual([]);
});

// Handlers are attached before the first load, so they see the first draw.
async function build(page, attach, options = {}) {
  await page.evaluate(async ({ fields, attach, options }) => {
    document.querySelector("#hookHost")?.remove();
    const host = document.createElement("div");
    host.id = "hookHost";
    document.body.prepend(host);
    window.hookWidget = PivotForge.create(host, { fields, autoLoad: false, ...options });
    // eslint-disable-next-line no-new-func
    new Function("widget", attach)(window.hookWidget);
    await window.hookWidget.refresh();
  }, { fields: FIELDS, attach, options });
  await page.waitForSelector("#hookHost .pivot-table__table td");
}

test("cellPrepared describes every cell, and what it adds stays and is exported", async ({ page }) => {
  await build(page, `
    window.prepared = { data: 0, row: 0, column: 0 };
    widget.on("cellPrepared", e => {
      window.prepared[e.area]++;
      if (e.area === "data" && e.cell.columnType === "GT") {
        e.cellElement.classList.add("is-row-total");
      }
      if (e.area === "row" && e.cell.type === "T" && e.cell.path.length === 1 && e.cell.path[0] === "Ege") {
        e.cellElement.append(" ★");
      }
    });`);

  const seen = await page.evaluate(() => ({
    prepared: window.prepared,
    marked: document.querySelectorAll("#hookHost td.is-row-total").length,
    rows: document.querySelectorAll("#hookHost tbody tr:not([hidden])").length,
    exported: window.hookWidget.renderer.getExcelExportModel({}).rows
      .flatMap(row => row.cells.map(cell => cell.text))
      .filter(text => text.includes("★"))
  }));

  expect(seen.prepared.data).toBeGreaterThan(0);
  expect(seen.prepared.row).toBeGreaterThan(0);
  expect(seen.prepared.column).toBeGreaterThan(0);
  // One right-hand total per body row.
  expect(seen.marked).toBe(seen.rows);
  // The export reads the drawn text, so it carries what the handler added.
  expect(seen.exported.length).toBeGreaterThan(0);
});

test("a cancelled cellClick neither selects nor folds", async ({ page }) => {
  await build(page, `
    window.clicks = [];
    widget.on("cellClick", e => {
      window.clicks.push({ area: e.area, path: e.cell.path, type: e.cell.type });
      e.cancel = true;
    });`);

  const toggle = page.locator("#hookHost tbody .pivot-table__toggle").first();
  await toggle.click();
  await page.locator("#hookHost tbody td.pivot-table__value").first().click();

  const seen = await page.evaluate(() => ({
    clicks: window.clicks,
    selection: window.hookWidget.renderer.getSelection(),
    expanded: document.querySelector("#hookHost tbody .pivot-table__toggle").getAttribute("aria-expanded")
  }));

  expect(seen.clicks[0].area).toBe("row");
  expect(seen.clicks[0].path).toHaveLength(1);
  expect(seen.clicks[1].area).toBe("data");
  expect(seen.selection).toBeNull();
  expect(seen.expanded).toBe("true");
});

test("contextMenuPreparing adds an item, runs it, and an emptied list opens no menu", async ({ page }) => {
  await build(page, `
    widget.on("contextMenuPreparing", e => {
      if (e.area === "data") {
        e.items.push({ label: "Değeri not al", onClick: picked => { window.picked = picked.cell.value; } });
      } else {
        e.items.length = 0;
      }
    });`);

  const cell = page.locator("#hookHost tbody td.pivot-table__value").first();
  await cell.click({ button: "right" });
  const item = page.locator(".pivot-cell-menu__item", { hasText: "Değeri not al" });
  await expect(item).toBeVisible();
  // The built-in entries are still there.
  expect(await page.locator(".pivot-cell-menu__item").count()).toBeGreaterThan(1);
  await item.click();
  const picked = await page.evaluate(() => window.picked);
  expect(typeof picked).toBe("number");
  await expect(page.locator(".pivot-cell-menu")).toHaveCount(0);

  // A group header's own menu, emptied by the page.
  await page.locator("#hookHost tbody th:has(.pivot-table__toggle)").first().click({ button: "right" });
  await expect(page.locator(".pivot-cell-menu")).toHaveCount(0);
});

test("a cancelled expandValueChanging leaves the group as it is", async ({ page }) => {
  await build(page, `
    window.changes = [];
    widget.on("expandValueChanging", e => {
      window.changes.push({ area: e.area, path: e.path, expanded: e.expanded });
      e.cancel = !e.expanded;
    });`);

  const toggle = page.locator("#hookHost tbody .pivot-table__toggle").first();
  await toggle.click();
  const seen = await page.evaluate(() => ({
    changes: window.changes,
    expanded: document.querySelector("#hookHost tbody .pivot-table__toggle").getAttribute("aria-expanded")
  }));

  expect(seen.changes).toEqual([{ area: "row", path: [expect.any(String)], expanded: false }]);
  expect(seen.expanded).toBe("true");
});

test("custom state storage saves through the page and a promised load brings the view back", async ({ page }) => {
  const options = {
    stateStoring: "custom",
    customLoad: "stateApi.load",
    customSave: "stateApi.save"
  };
  await page.evaluate(() => {
    window.savedStates = [];
    window.stateApi = {
      load: () => new Promise(resolve => setTimeout(() => resolve(window.savedStates.at(-1) ?? null), 50)),
      save: state => { window.savedStates.push(state); }
    };
  });

  await build(page, "", options);
  await page.evaluate(() => window.hookWidget.sortBy({ mode: "RowLabel", direction: "Descending", field: "Region" }));
  expect(await page.evaluate(() => window.savedStates.at(-1)?.rowSort?.direction)).toBe("Descending");

  await page.evaluate(() => window.hookWidget.dispose());
  await build(page, "", options);
  const restored = await page.evaluate(() => ({
    request: window.hookWidget.request.rowSort?.direction,
    first: window.hookWidget.result.rowHeaders[0][0],
    regions: [...new Set(window.hookWidget.result.rowHeaders.map(header => header[0]))]
  }));

  expect(restored.request).toBe("Descending");
  expect(restored.first).toBe([...restored.regions].sort((a, b) => b.localeCompare(a, "tr"))[0]);
});
