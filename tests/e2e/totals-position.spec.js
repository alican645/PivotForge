const { test, expect } = require("@playwright/test");

// totalsPosition: "after" -- a heading row opens each group and its subtotal
// closes it. Built into a scratch container so the demo's own specs keep the
// layout they assert on.
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

async function build(page, rendererOptions) {
  await page.evaluate(async ({ fields, rendererOptions }) => {
    window.scratchWidget?.dispose();
    document.querySelector("#scratchPivot")?.remove();
    const host = document.createElement("div");
    host.id = "scratchPivot";
    document.body.appendChild(host);

    window.scratchWidget = PivotForge.create(host, { fields, rendererOptions, autoLoad: false });
    await window.scratchWidget.refresh();
  }, { fields: FIELDS, rendererOptions });

  await page.waitForSelector("#scratchPivot .pivot-table__table td");
}

// Each visible body row as its kind: heading, detail, total or grand total.
const shape = page => page.locator("#scratchPivot tbody tr").evaluateAll(rows => rows
  .filter(row => row.offsetParent !== null)
  .map(row => row.classList.contains("pivot-table__group-row") ? "heading"
    : row.classList.contains("pivot-table__subtotal-row") ? "total"
      : row.querySelector(".pivot-table__grand-total, .pivot-table__row-total-label") ? "grand"
        : "detail"));

test("after: each group opens with a blank heading and closes with its total", async ({ page }) => {
  await build(page, { totalsPosition: "after" });
  const rows = await shape(page);

  expect(rows[0]).toBe("heading");
  // The first group's total comes after its details, not before them.
  const firstTotal = rows.indexOf("total");
  expect(firstTotal).toBeGreaterThan(1);
  expect(rows.slice(1, firstTotal).every(kind => kind === "detail")).toBe(true);

  // The heading's sums are on the total row, so its cells are blank.
  const headingCells = await page.locator("#scratchPivot tbody tr.pivot-table__group-row").first()
    .locator("td").allTextContents();
  expect(headingCells.every(text => text === "")).toBe(true);
  expect(page.errors).toEqual([]);
});

test("after: collapsing a group leaves its total row, toggle and all", async ({ page }) => {
  await build(page, { totalsPosition: "after" });

  await page.locator("#scratchPivot tbody tr.pivot-table__group-row .pivot-table__toggle").first().click();

  const first = page.locator("#scratchPivot tbody tr").first();
  await expect(first).toHaveClass(/pivot-table__subtotal-row/);
  await expect(first.locator(".pivot-table__toggle")).toHaveCount(1);
  expect(page.errors).toEqual([]);
});

test("before, the default, keeps the total as the group's own header", async ({ page }) => {
  await build(page, null);
  const rows = await shape(page);

  expect(rows[0]).toBe("total");
  expect(rows).not.toContain("heading");
  expect(page.errors).toEqual([]);
});
