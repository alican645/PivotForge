const { test, expect } = require("@playwright/test");

// DevExtreme's groupName/groupIndex hierarchy: the date's year, quarter and
// month declared as one group, listed once, moved and removed as one block.
const PAGE = "/Home/TagHelpers";

const FIELDS = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" },
  { groupName: "Date", dataField: "OrderDate", dataType: "date", caption: "Sipariş tarihi" },
  { groupName: "Date", groupIndex: 0, groupInterval: "year", caption: "Yıl" },
  { groupName: "Date", groupIndex: 1, groupInterval: "quarter", caption: "Çeyrek" },
  { groupName: "Date", groupIndex: 2, groupInterval: "month", caption: "Ay" }
];

const LEVELS = ["OrderDate:year", "OrderDate:quarter", "OrderDate:month"];
const zoneChips = area => `#groupDesigner .pivot-zone[data-zone="${area}"] .pivot-zone__body .pivot-chip`;
const listed = field => `#groupDesigner .pivot-field-list .pivot-chip[data-field="${field}"]`;

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table__table td");
  await page.evaluate(() => localStorage.clear());
});

test.afterEach(async ({ page }) => {
  expect(page.errors).toEqual([]);
});

async function build(page) {
  await page.evaluate(async fields => {
    for (const id of ["groupDesigner", "groupPivot"]) {
      const host = document.createElement("div");
      host.id = id;
      document.body.prepend(host);
    }
    window.groupWidget = PivotForge.create("#groupPivot", {
      fields,
      autoLoad: false,
      fieldDesigner: "#groupDesigner",
      stateStoring: "local",
      stateKey: "groups"
    });
    await window.groupWidget.refresh();
  }, FIELDS);
  await page.waitForSelector("#groupDesigner .pivot-field-list");
}

// One drag of the listed group onto the columns places all its levels.
const placeGroup = page => page.locator(`${listed("OrderDate:year")} .pivot-chip__grip`)
  .dragTo(page.locator('#groupDesigner .pivot-zone[data-zone="column"] .pivot-zone__body'));

const namesIn = (page, area) => page.locator(zoneChips(area))
  .evaluateAll(chips => chips.map(chip => chip.dataset.field));

test("the group is listed once under its own caption, and dropping it places every level", async ({ page }) => {
  await build(page);

  await expect(page.locator(listed("OrderDate:year"))).toHaveClass(/is-group/);
  await expect(page.locator(listed("OrderDate:year"))).toContainText("Sipariş tarihi");
  await expect(page.locator(listed("OrderDate:quarter"))).toHaveCount(0);

  await placeGroup(page);

  await expect.poll(() => namesIn(page, "column")).toEqual(LEVELS);
  await expect(page.locator(zoneChips("column")).first()).toHaveClass(/is-group-first/);
  await expect(page.locator(zoneChips("column")).last()).toHaveClass(/is-group-last/);
  await expect.poll(() => page.evaluate(() => window.groupWidget.request.columns.map(column => column.interval)))
    .toEqual(["year", "quarter", "month"]);
});

test("dragging one level carries the whole group, and × takes it all away", async ({ page }) => {
  await build(page);
  await placeGroup(page);
  await expect.poll(() => namesIn(page, "column")).toEqual(LEVELS);

  await page.locator(`${zoneChips("column")}[data-field="OrderDate:quarter"] .pivot-chip__grip`)
    .dragTo(page.locator(`${zoneChips("row")}[data-field="Region"]`));

  await expect.poll(() => namesIn(page, "column")).toEqual([]);
  await expect.poll(async () => (await namesIn(page, "row")).filter(name => name.startsWith("OrderDate")))
    .toEqual(LEVELS);

  await page.locator(`${zoneChips("row")}[data-field="OrderDate:month"] [data-action="remove"]`).click();
  await expect.poll(() => namesIn(page, "row")).toEqual(["Region"]);
});

test("a stored view brings the group back whole", async ({ page }) => {
  await build(page);
  await placeGroup(page);
  await expect.poll(() => namesIn(page, "column")).toEqual(LEVELS);

  await page.reload();
  await page.waitForSelector(".pivot-table__table td");
  await build(page);

  await expect.poll(() => namesIn(page, "column")).toEqual(LEVELS);
  await expect(page.locator("#groupPivot .pivot-table__table thead")).toContainText("2024");
});
