const { test, expect } = require("@playwright/test");

// The demo's declarative page carries the same field catalog as the docs:
// Region/Category in rows, Year in columns, Amount in data, and four fields
// parked in the available list — two dimensions and two measures.
const PAGE = "/Home/TagHelpers";

const zone = area => `[data-zone="${area}"]`;
const zoneBody = area => `${zone(area)} .pivot-zone__body`;
const chipIn = (area, field) => `${zoneBody(area)} .pivot-chip[data-field="${field}"]`;
const availableChip = field => `.pivot-field-list .pivot-chip[data-field="${field}"]`;

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-zone__body .pivot-chip");
});

test("an available dimension can be dragged into a populated zone", async ({ page }) => {
  await page.dragAndDrop(availableChip("Quarter"), chipIn("column", "Year"));

  await expect(page.locator(chipIn("column", "Quarter"))).toHaveCount(1);
  expect(page.errors).toEqual([]);
});

test("a chip in a populated zone shows the drop indicator while hovering it", async ({ page }) => {
  const source = page.locator(availableChip("Quarter"));
  const target = page.locator(chipIn("column", "Year"));

  await source.hover();
  await page.mouse.down();
  // Two moves: the first starts the drag, the second lands on the target chip.
  await target.hover();
  await target.hover();

  await expect(target).toHaveClass(/is-drop-(before|after)/);
  await page.mouse.up();
});

test("an empty zone shows that it is a drop target", async ({ page }) => {
  // The filter zone starts empty, so there is no chip to draw an edge on.
  await expect(page.locator(`${zoneBody("filter")} .pivot-chip`)).toHaveCount(0);

  const source = page.locator(availableChip("Quarter"));
  const target = page.locator(zoneBody("filter"));

  await source.hover();
  await page.mouse.down();
  await target.hover();
  await target.hover();

  await expect(page.locator(zone("filter"))).toHaveClass(/is-empty-drop-target/);
  await page.mouse.up();
});

test("a measure dragged over a dimension-only zone is visibly refused", async ({ page }) => {
  const source = page.locator(availableChip("Quantity"));
  const target = page.locator(chipIn("column", "Year"));

  await source.hover();
  await page.mouse.down();
  await target.hover();
  await target.hover();

  await expect(page.locator(zone("column"))).toHaveClass(/is-drop-refused/);
  await page.mouse.up();

  // The rule itself still holds: a measure must not land in columns.
  await expect(page.locator(chipIn("column", "Quantity"))).toHaveCount(0);
});

test("reordering within a zone still works", async ({ page }) => {
  const before = await page.locator(`${zoneBody("row")} .pivot-chip`).evaluateAll(
    nodes => nodes.map(node => node.dataset.field));
  expect(before).toEqual(["Region", "Category"]);

  await page.dragAndDrop(chipIn("row", "Category"), chipIn("row", "Region"));

  const after = await page.locator(`${zoneBody("row")} .pivot-chip`).evaluateAll(
    nodes => nodes.map(node => node.dataset.field));
  expect(after).toEqual(["Category", "Region"]);
  expect(page.errors).toEqual([]);
});

test("a field can be dropped into an empty zone", async ({ page }) => {
  await expect(page.locator(`${zoneBody("filter")} .pivot-chip`)).toHaveCount(0);

  await page.dragAndDrop(availableChip("Quarter"), zoneBody("filter"));

  await expect(page.locator(chipIn("filter", "Quarter"))).toHaveCount(1);
  expect(page.errors).toEqual([]);
});

test("zone highlights do not survive the drag that caused them", async ({ page }) => {
  // A refused hover, then an allowed one: the refusal must not stay behind on
  // the zone the pointer already left.
  const source = page.locator(availableChip("Quantity"));
  await source.hover();
  await page.mouse.down();
  await page.locator(chipIn("column", "Year")).hover();
  await page.locator(chipIn("column", "Year")).hover();
  await expect(page.locator(zone("column"))).toHaveClass(/is-drop-refused/);

  await page.locator(zoneBody("data")).hover();
  await page.locator(zoneBody("data")).hover();
  await expect(page.locator(zone("column"))).not.toHaveClass(/is-drop-refused/);
  await page.mouse.up();

  // And nothing is left highlighted once the drag is over.
  await expect(page.locator(".pivot-zone.is-drop-refused")).toHaveCount(0);
  await expect(page.locator(".pivot-zone.is-empty-drop-target")).toHaveCount(0);
});

test("the remove control is the first thing in every placed chip", async ({ page }) => {
  const order = await page.locator(chipIn("row", "Region")).evaluate(
    chip => Array.from(chip.children).map(child => child.className));

  expect(order[0]).toBe("pivot-chip__remove");
});

test("a value chip leads with remove, then settings, then the caption", async ({ page }) => {
  const order = await page.locator(chipIn("data", "Amount")).evaluate(
    chip => Array.from(chip.children).map(child => child.className));

  expect(order).toEqual(["pivot-chip__remove", "pivot-chip__settings", "pivot-chip__label"]);
});

test("value settings open in a modal, not inside the chip", async ({ page }) => {
  await expect(page.locator(".pivot-value-settings")).toHaveCount(0);

  await page.locator(`${chipIn("data", "Amount")} [data-action="settings"]`).click();

  await expect(page.locator(".pivot-value-settings.is-open")).toHaveCount(1);
  await expect(page.locator(`${chipIn("data", "Amount")} select`)).toHaveCount(0);
  await expect(
    page.locator('.pivot-value-settings [data-action="aggregation"]')).toHaveValue("sum");
});

test("a setting changed in the modal reaches the pivot", async ({ page }) => {
  await page.locator(`${chipIn("data", "Amount")} [data-action="settings"]`).click();
  await page.selectOption('.pivot-value-settings [data-action="aggregation"]', "average");

  // The designer re-renders on every edit; the modal must survive it.
  await expect(page.locator(".pivot-value-settings.is-open")).toHaveCount(1);
  await expect(
    page.locator('.pivot-value-settings [data-action="aggregation"]')).toHaveValue("average");
  expect(page.errors).toEqual([]);
});

test("a placed field can be dragged back to the available list", async ({ page }) => {
  await expect(page.locator(chipIn("row", "Category"))).toHaveCount(1);

  await page.dragAndDrop(chipIn("row", "Category"), ".pivot-field-list-panel");

  await expect(page.locator(chipIn("row", "Category"))).toHaveCount(0);
  await expect(page.locator(availableChip("Category"))).toHaveCount(1);
  expect(page.errors).toEqual([]);
});

test("the last value field cannot be dragged out of Values", async ({ page }) => {
  const source = page.locator(chipIn("data", "Amount"));
  const target = page.locator(".pivot-field-list-panel");

  await source.hover();
  await page.mouse.down();
  await target.hover();
  await target.hover();
  await expect(target).toHaveClass(/is-drop-refused/);
  await page.mouse.up();

  await expect(page.locator(chipIn("data", "Amount"))).toHaveCount(1);
});
