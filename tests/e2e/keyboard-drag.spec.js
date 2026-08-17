const { test, expect } = require("@playwright/test");

// The designer could only be operated with a pointer: chips were not focusable
// at all. These drive the real keyboard through a real browser, because the
// thing under test is focus — which a stub can only approximate.
const PAGE = "/Home/TagHelpers";
const zoneBody = area => `[data-zone="${area}"] .pivot-zone__body`;
const chipIn = (area, field) => `${zoneBody(area)} .pivot-chip[data-field="${field}"]`;
const availableChip = field => `.pivot-field-list .pivot-chip[data-field="${field}"]`;

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-zone__body .pivot-chip");
});

const focusedField = page => page.evaluate(
  () => document.activeElement?.dataset?.field ?? null);

const fieldsIn = (page, area) => page.locator(`${zoneBody(area)} .pivot-chip`)
  .evaluateAll(nodes => nodes.map(node => node.dataset.field));

test("a chip takes focus and reports itself as grabbable", async ({ page }) => {
  await page.locator(chipIn("row", "Region")).focus();

  expect(await focusedField(page)).toBe("Region");
  await expect(page.locator(chipIn("row", "Region")))
    .toHaveAttribute("aria-grabbed", "false");
});

test("each zone costs exactly one tab stop, not one per chip", async ({ page }) => {
  const stops = await page.locator(".pivot-chip[tabindex='0']").count();
  const chips = await page.locator(".pivot-chip").count();
  // The demo declares no filter field, so that zone is empty and contributes
  // no stop — a tab stop belongs to a chip, not to a zone heading.
  const populated = await page.locator(".pivot-chip").evaluateAll(
    nodes => new Set(nodes.map(node => node.closest("[data-zone]").dataset.zone)).size);

  expect(stops).toBe(populated);
  expect(chips).toBeGreaterThan(stops);
});

test("chip controls are not separate tab stops", async ({ page }) => {
  const controls = page.locator(".pivot-chip button");
  await expect(controls.first()).toBeAttached();

  const tabbable = await controls.evaluateAll(
    nodes => nodes.filter(node => node.tabIndex >= 0).length);

  expect(tabbable).toBe(0);
});

test("Space then ArrowDown then Space reorders a zone", async ({ page }) => {
  expect(await fieldsIn(page, "row")).toEqual(["Region", "Category"]);

  await page.locator(chipIn("row", "Region")).focus();
  await page.keyboard.press("Space");
  await expect(page.locator(chipIn("row", "Region"))).toHaveClass(/is-keyboard-moving/);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");

  await expect.poll(() => fieldsIn(page, "row")).toEqual(["Category", "Region"]);
  expect(page.errors).toEqual([]);
});

test("Escape puts a picked-up field back down and changes nothing", async ({ page }) => {
  const before = await fieldsIn(page, "row");

  await page.locator(chipIn("row", "Region")).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");

  await expect(page.locator(chipIn("row", "Region"))).not.toHaveClass(/is-keyboard-moving/);
  expect(await fieldsIn(page, "row")).toEqual(before);
});

test("arrow keys carry a field from the available list into a zone", async ({ page }) => {
  await expect(page.locator(chipIn("column", "Quarter"))).toHaveCount(0);

  await page.locator(availableChip("Quarter")).focus();
  await page.keyboard.press("Space");
  // available -> filter -> column
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");

  await expect(page.locator(chipIn("column", "Quarter"))).toHaveCount(1);
  expect(page.errors).toEqual([]);
});

test("a move the field's role forbids is refused rather than performed", async ({ page }) => {
  await page.locator(availableChip("Quantity")).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");

  await expect(page.locator('[data-zone="filter"]')).toHaveClass(/is-drop-refused/);

  await page.keyboard.press("Space");

  await expect(page.locator(chipIn("filter", "Quantity"))).toHaveCount(0);
  await expect(page.locator(availableChip("Quantity"))).toHaveCount(1);
});

test("a field carried back to the available list is unplaced", async ({ page }) => {
  await page.locator(chipIn("row", "Category")).focus();
  await page.keyboard.press("Space");
  // row -> column -> filter -> available
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Space");

  await expect(page.locator(availableChip("Category"))).toHaveCount(1);
  await expect(page.locator(chipIn("row", "Category"))).toHaveCount(0);
});

test("focus follows the field through the re-render its move causes", async ({ page }) => {
  await page.locator(availableChip("Quarter")).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");

  await expect(page.locator(chipIn("filter", "Quarter"))).toHaveCount(1);
  // Losing focus here would drop the user back at the top of the document and
  // make a second move impossible without reaching for the mouse.
  await expect.poll(() => focusedField(page)).toBe("Quarter");
});

test("Delete removes the focused field", async ({ page }) => {
  await page.locator(chipIn("row", "Category")).focus();
  await page.keyboard.press("Delete");

  await expect(page.locator(chipIn("row", "Category"))).toHaveCount(0);
  await expect(page.locator(availableChip("Category"))).toHaveCount(1);
});

test("Enter opens the settings modal for the focused field", async ({ page }) => {
  await page.locator(chipIn("data", "Amount")).focus();
  await page.keyboard.press("Enter");

  await expect(page.locator(".pivot-value-settings")).toHaveClass(/is-open/);
  await expect(page.locator(
    '.pivot-value-settings [data-action="aggregation"][data-selected="true"]'))
    .toHaveAttribute("data-value", "sum");
});

test("a filter field reaches its value picker without a pointer", async ({ page }) => {
  await page.locator(availableChip("Quarter")).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await expect(page.locator(chipIn("filter", "Quarter"))).toHaveCount(1);

  await page.keyboard.press("Enter");
  await page.locator('.pivot-value-settings [data-action="filter-values"]').click();

  await expect(page.locator(".pivot-filter-picker.is-open")).toBeVisible();
  await expect(page.locator(".pivot-filter-picker__value")).toHaveCount(4);
});
