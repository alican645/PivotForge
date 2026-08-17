const { test, expect } = require("@playwright/test");

// A three-level row hierarchy opens with every leaf visible and a total at every
// level, which is unreadable. These drive the declared per-field options through
// the whole chain in a real browser. The widget is built into a scratch
// container rather than by editing the demo, so the demo's own specs keep
// asserting the layout they were written against.
const PAGE = "/Home/TagHelpers";

const FIELDS = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  { dataField: "Category", caption: "Kategori", area: "row" },
  { dataField: "SalesPerson", caption: "Temsilci", area: "row" },
  { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
];

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table__table td");
});

// Builds a widget from `fields` into a fresh container and resolves once its
// first result has rendered.
async function build(page, fields) {
  await page.evaluate(async fields => {
    document.querySelector("#scratchPivot")?.remove();
    const host = document.createElement("div");
    host.id = "scratchPivot";
    document.body.appendChild(host);

    window.scratchWidget = PivotForge.create(host, { fields, autoLoad: false });
    await window.scratchWidget.refresh();
  }, fields);

  await page.waitForSelector("#scratchPivot .pivot-table__table td");
}

const rowClasses = page => page.locator("#scratchPivot tbody tr").evaluateAll(
  rows => rows.map(row => row.className));

test("declaring nothing keeps every level totalled and expanded", async ({ page }) => {
  await build(page, FIELDS);

  const classes = await rowClasses(page);

  expect(classes.filter(name => name.includes("subtotal-row")).length).toBeGreaterThan(0);
  expect(classes.filter(name => name.includes("group-row")).length).toBe(0);
  expect(page.errors).toEqual([]);
});

test("a row field with show-totals off keeps its header and loses its sums", async ({ page }) => {
  const fields = FIELDS.map(field =>
    field.dataField === "Category" ? { ...field, showTotals: false } : field);

  await build(page, fields);
  const classes = await rowClasses(page);

  // Level 0 (Region) still totals; level 1 (Category) becomes a plain group
  // header — the label survives, which is the whole point of not just dropping
  // the row.
  expect(classes.filter(name => name.includes("subtotal-row")).length).toBeGreaterThan(0);
  expect(classes.filter(name => name.includes("group-row")).length).toBeGreaterThan(0);
  expect(page.errors).toEqual([]);
});

test("a row field declared collapsed opens closed, and can still be opened", async ({ page }) => {
  const fields = FIELDS.map(field =>
    field.dataField === "Region" ? { ...field, expanded: false } : field);

  await build(page, fields);

  const collapsed = await page.locator("#scratchPivot tbody tr").count();
  const expanded = await page.locator(
    '#scratchPivot .pivot-table__toggle[aria-expanded="true"]').count();
  expect(expanded).toBe(0);

  // The declaration is an initial state, not a lock.
  await page.locator("#scratchPivot .pivot-table__toggle").first().click();

  await expect.poll(() => page.locator("#scratchPivot tbody tr").count())
    .toBeGreaterThan(collapsed);
  expect(page.errors).toEqual([]);
});

test("expanded is applied once, so a later render does not re-collapse", async ({ page }) => {
  const fields = FIELDS.map(field =>
    field.dataField === "Region" ? { ...field, expanded: false } : field);

  await build(page, fields);
  await page.locator("#scratchPivot .pivot-table__toggle").first().click();
  const opened = await page.locator("#scratchPivot tbody tr").count();

  // A refresh re-renders the same renderer; re-applying the declaration here
  // would make the level impossible to keep open.
  await page.evaluate(() => window.scratchWidget.refresh());

  await expect.poll(() => page.locator("#scratchPivot tbody tr").count()).toBe(opened);
});

test("declaring expanded on a column field is refused, not ignored", async ({ page }) => {
  const refused = await page.evaluate(fields => {
    try {
      PivotForge.PivotRequestBuilder.normalizeFields(
        fields.map(field => field.dataField === "Amount" ? { ...field, expanded: false } : field));
      return null;
    } catch (error) {
      return error.message;
    }
  }, FIELDS);

  expect(refused).toContain('"expanded" is only valid on a "row" field');
});
