const { test, expect } = require("@playwright/test");

// A group header's own menu: every group of that field's level opens or
// closes at once, on either axis (DevExtreme's Expand All / Collapse All).
const FIELDS = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  { dataField: "Category", caption: "Kategori", area: "row" },
  { dataField: "Year", caption: "Yıl", area: "column" },
  { dataField: "Quarter", caption: "Çeyrek", area: "column" },
  { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
];

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto("/Home/TagHelpers");
  await page.waitForSelector(".pivot-table__table td");
});

async function build(page, rendererOptions = {}) {
  await page.evaluate(async ({ fields, rendererOptions }) => {
    document.querySelector("#menuPivot")?.remove();
    const host = document.createElement("div");
    host.id = "menuPivot";
    document.body.prepend(host);
    window.menuWidget = PivotForge.create(host, { fields, rendererOptions, autoLoad: false });
    await window.menuWidget.refresh();
  }, { fields: FIELDS, rendererOptions });
  await page.waitForSelector("#menuPivot .pivot-table__table td");
}

const rowToggles = state => `#menuPivot tbody .pivot-table__toggle:not(.is-column)[aria-expanded="${state}"]`;
const columnToggles = state => `#menuPivot thead .pivot-table__toggle.is-column[aria-expanded="${state}"]`;
const menuItem = action => `.pivot-cell-menu [data-context-action="${action}"]`;

test("a region header's menu closes and opens every region at once", async ({ page }) => {
  await build(page);
  const regions = await page.locator(rowToggles(true)).count();
  expect(regions).toBeGreaterThan(1);

  await page.locator("#menuPivot tbody th[data-row-level='0']").first().click({ button: "right" });
  // Nothing is closed yet, so there is nothing to open.
  await expect(page.locator(menuItem("expand-level"))).toBeDisabled();
  await expect(page.locator(menuItem("collapse-level"))).toHaveText("Collapse all Bölge");
  await page.locator(menuItem("collapse-level")).click();

  await expect(page.locator(rowToggles(true))).toHaveCount(0);
  await expect(page.locator(rowToggles(false))).toHaveCount(regions);

  await page.locator("#menuPivot tbody th[data-row-level='0']").first().click({ button: "right" });
  await expect(page.locator(menuItem("collapse-level"))).toBeDisabled();
  await page.locator(menuItem("expand-level")).click();
  await expect(page.locator(rowToggles(false))).toHaveCount(0);
  expect(page.errors).toEqual([]);
});

test("a year header's menu folds every year, and the innermost level has no menu", async ({ page }) => {
  await build(page);
  const years = await page.locator(columnToggles(true)).count();

  await page.locator("#menuPivot thead th:has(.pivot-table__toggle.is-column)").first().click({ button: "right" });
  await expect(page.locator(menuItem("collapse-level"))).toHaveText("Collapse all Yıl");
  await page.locator(menuItem("collapse-level")).click();
  await expect(page.locator(columnToggles(false))).toHaveCount(years);

  // A category header is the innermost row level: its groups do not fold.
  await page.locator("#menuPivot tbody th[data-row-level='1']").first().click({ button: "right" });
  await expect(page.locator(".pivot-cell-menu")).toHaveCount(0);
  expect(page.errors).toEqual([]);
});

test("the menu key opens a row header's menu, and contextMenu: false leaves headers alone", async ({ page }) => {
  await build(page);
  await page.locator("#menuPivot tbody th[data-row-level='0']").first().focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.locator(menuItem("collapse-level"))).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".pivot-cell-menu")).toHaveCount(0);

  await build(page, { contextMenu: false });
  await page.locator("#menuPivot tbody th[data-row-level='0']").first().click({ button: "right" });
  await expect(page.locator(".pivot-cell-menu")).toHaveCount(0);
});
