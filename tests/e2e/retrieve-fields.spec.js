const { test, expect } = require("@playwright/test");

// DevExtreme's retrieveFields against the demo's real fields endpoint: the
// record type's fields, offered unplaced in the field chooser beside the
// declared ones, and nothing the allow-list keeps back.
const FIELDS = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
];

const dialog = ".pivot-field-chooser";
const chip = field => `${dialog} [data-zone="available"] .pivot-chip[data-field="${field}"]`;

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

async function build(page, fields) {
  await page.evaluate(async fields => {
    const host = document.createElement("div");
    host.id = "discoverHost";
    document.body.prepend(host);
    window.discoverWidget = PivotForge.create(host, { fields, retrieveFields: true, fieldChooser: true, autoLoad: false });
    await window.discoverWidget.refresh();
    window.discoverWidget.showFieldChooser();
  }, fields);
  await expect(page.locator(dialog)).toBeVisible();
}

test("the record type's fields are offered, a date as one group of its year, quarter and month", async ({ page }) => {
  await build(page, FIELDS);

  await expect(page.locator(chip("SalesPerson"))).toContainText("Sales Person");
  // The group is listed once, by its first level, under the date's name.
  await expect(page.locator(chip("OrderDate:year"))).toContainText("Order Date");
  await expect(page.locator(chip("OrderDate:year"))).toHaveClass(/is-group/);
  await expect(page.locator(chip("OrderDate:month"))).toHaveCount(0);
  // Off the demo's allow-list, so never offered.
  await expect(page.locator(chip("CustomerEmail"))).toHaveCount(0);
  // A declared field is listed once, under its own caption.
  await expect(page.locator(chip("Region"))).toHaveCount(1);
  await expect(page.locator(chip("Region"))).toContainText("Bölge");
});

test("a discovered date ticked in the chooser reaches the grid with all its levels", async ({ page }) => {
  await build(page, FIELDS);

  await page.locator(`${chip("OrderDate:year")} [data-action="place"]`).check();

  await expect.poll(() => page.evaluate(() => window.discoverWidget.request.columns.map(column => column.interval)))
    .toEqual(["year", "quarter", "month"]);
  await expect(page.locator("#discoverHost .pivot-table__table thead")).toContainText("2024");
});

test("a grid declaring no fields lists them all and asks to place a measure", async ({ page }) => {
  await build(page, []);

  await expect(page.locator(chip("Amount"))).toHaveCount(1);
  await expect(page.locator("#discoverHost .pivot-table__empty")).toBeVisible();

  await page.locator(`${chip("Amount")} [data-action="place"]`).check();
  await expect(page.locator("#discoverHost .pivot-table__table td").first()).toBeVisible();
});
