const { test, expect } = require("@playwright/test");

// The tree row header layout: the compact column drawn as a tree. Built into a
// scratch container so the demo's own specs keep the layout they assert on.
const PAGE = "/Home/TagHelpers";

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
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table__table td");
});

async function build(page, layoutMode) {
  await page.evaluate(async ({ fields, layoutMode }) => {
    window.scratchWidget?.dispose();
    document.querySelector("#scratchPivot")?.remove();
    const host = document.createElement("div");
    host.id = "scratchPivot";
    document.body.appendChild(host);

    window.scratchWidget = PivotForge.create(host, { fields, rendererOptions: { layoutMode }, autoLoad: false });
    await window.scratchWidget.refresh();
  }, { fields: FIELDS, layoutMode });

  await page.waitForSelector("#scratchPivot .pivot-table__table td");
}

const scratch = selector => `#scratchPivot ${selector}`;

// A header's text without the toggle's glyph.
const labelOf = locator => locator.evaluate(cell =>
  [...cell.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join("").trim());

const visibleBodyRows = page => page.locator(scratch("tbody tr")).evaluateAll(rows =>
  rows.filter(row => row.offsetParent !== null).length);

test("a tree is the compact column, with the levels named and the parent rows named for their group", async ({ page }) => {
  await build(page, "compact");
  const compactParent = await labelOf(page.locator(scratch(".pivot-table__subtotal-header")).first());

  await build(page, "tree");
  const table = page.locator(scratch(".pivot-table__table"));
  await expect(table).toHaveClass(/is-tree/);
  await expect(table).toHaveClass(/is-compact/);

  // One header cell over both row fields, naming them in order. (The column
  // field's name sits in a corner cell too, when it can be sorted.)
  const rowCorner = page.locator(scratch(".pivot-table__corner:not(.pivot-table__column-field)"));
  await expect(rowCorner).toHaveCount(1);
  await expect(rowCorner).toContainText("Bölge / Kategori");

  // "Ege Total" in compact is "Ege" in a tree: the row is the parent node.
  const treeParent = await labelOf(page.locator(scratch(".pivot-table__subtotal-header")).first());
  expect(treeParent.length).toBeGreaterThan(0);
  expect(compactParent.startsWith(treeParent)).toBe(true);
  expect(compactParent).not.toBe(treeParent);

  // A child is indented one level, which is also what draws its guide line.
  const indent = await page.locator(scratch(".pivot-table__row-header.is-compact")).first()
    .evaluate(cell => cell.style.getPropertyValue("--pivot-indent"));
  expect(indent).toBe("18px");

  expect(page.errors).toEqual([]);
});

test("collapsing a parent node hides its children and keeps its own row", async ({ page }) => {
  await build(page, "tree");
  const before = await visibleBodyRows(page);

  await page.locator(scratch(".pivot-table__toggle")).first().click();

  const after = await visibleBodyRows(page);
  expect(after).toBeLessThan(before);
  await expect(page.locator(scratch(".pivot-table__subtotal-header")).first()).toBeVisible();
  expect(page.errors).toEqual([]);
});
