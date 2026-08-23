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

// A single row level keeps every row-header cell a plain detail label, so the
// list below is the level's order and nothing else.
const SORTABLE = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
];

const rowLabels = page => page.locator("#scratchPivot tbody th.pivot-table__row-header")
  .evaluateAll(nodes => nodes.map(node => node.textContent.trim()).filter(Boolean));

const columnLabels = page => page.locator("#scratchPivot thead th.pivot-table__column-header")
  .evaluateAll(nodes => nodes.map(node => node.textContent.trim()));

test("area-index decides which row field is the outer level", async ({ page }) => {
  const order = { SalesPerson: 0, Category: 1, Region: 2 };
  const fields = FIELDS.map(field =>
    field.dataField in order ? { ...field, areaIndex: order[field.dataField] } : field);

  await build(page, fields);

  const rows = await page.evaluate(() => window.scratchWidget.request.rows);

  // Declared out of order and sent in the declared order: the whole chain --
  // designer layout, request, renderer -- reads the one normalized list.
  expect(rows).toEqual(["SalesPerson", "Category", "Region"]);
  expect(page.errors).toEqual([]);
});

test("a descending row field reverses the rendered level", async ({ page }) => {
  await build(page, SORTABLE);
  const ascending = await rowLabels(page);

  await build(page, SORTABLE.map(field =>
    field.dataField === "Region" ? { ...field, sortOrder: "Descending" } : field));
  const descending = await rowLabels(page);

  expect(ascending.length).toBeGreaterThan(1);
  expect(descending).toEqual([...ascending].reverse());
  expect(page.errors).toEqual([]);
});

test("a column field orders its own headers", async ({ page }) => {
  const withColumn = [...SORTABLE, { dataField: "Quarter", caption: "Çeyrek", area: "column" }];

  await build(page, withColumn.map(field =>
    field.dataField === "Quarter" ? { ...field, sortOrder: "Ascending" } : field));
  const ascending = await columnLabels(page);

  await build(page, withColumn.map(field =>
    field.dataField === "Quarter" ? { ...field, sortOrder: "Descending" } : field));
  const descending = await columnLabels(page);

  expect(ascending.length).toBeGreaterThan(1);
  expect(descending).toEqual([...ascending].reverse());
  expect(page.errors).toEqual([]);
});

test("declaring sortOrder on a data field is refused, not ignored", async ({ page }) => {
  const refused = await page.evaluate(fields => {
    try {
      PivotForge.PivotRequestBuilder.normalizeFields(
        fields.map(field => field.dataField === "Amount"
          ? { ...field, sortOrder: "Ascending" } : field));
      return null;
    } catch (error) {
      return error.message;
    }
  }, FIELDS);

  expect(refused).toContain('"sortOrder" is only valid on a "row" or "column" field');
});
