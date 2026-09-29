const { test, expect } = require("@playwright/test");

// A phone: narrow, and a finger rather than a mouse. `isMobile` plus `hasTouch`
// is what makes Chromium answer `(pointer: coarse)`, which the stylesheet keys
// the touch-sized targets and the stacked zones on.
test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

const PAGE = "/Home/TagHelpers";
const pickerDialog = ".pivot-filter-picker.is-open .pivot-filter-picker__dialog";

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-zone__body .pivot-chip");
});

// Every rendered descendant of `selector` whose right edge passes the
// container's own -- the symptom the narrow layout used to show.
function overflowing(page, selector) {
  return page.evaluate(selector => {
    const box = document.querySelector(selector).getBoundingClientRect();
    return [...document.querySelectorAll(`${selector} *`)]
      .filter(node => node.getClientRects().length > 0)
      .filter(node => node.getBoundingClientRect().right > box.right + 0.5)
      .map(node => node.className || node.tagName);
  }, selector);
}

test("the page never scrolls sideways", async ({ page }) => {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(360);
});

test("the designer stacks its zones in one column", async ({ page }) => {
  const lefts = await page.locator(".pivot-zone").evaluateAll(zones =>
    zones.map(zone => Math.round(zone.getBoundingClientRect().left)));

  expect(lefts).toHaveLength(4);
  expect(new Set(lefts).size).toBe(1);
});

test("every chip control is big enough for a finger", async ({ page }) => {
  const controls = page.locator(
    ".pivot-zone .pivot-chip__remove, .pivot-zone .pivot-chip__settings, .pivot-chip__grip");
  const boxes = await controls.evaluateAll(nodes =>
    nodes.map(node => node.getBoundingClientRect()).map(box => [box.width, box.height]));

  expect(boxes.length).toBeGreaterThan(0);
  for (const [width, height] of boxes) {
    expect(width).toBeGreaterThanOrEqual(24);
    expect(height).toBeGreaterThanOrEqual(24);
  }
});

test("the filter picker keeps every control inside the dialog", async ({ page }) => {
  await page.locator('.pivot-table__corner [data-action="header-filter"][data-field="Region"]').tap();
  await expect(page.locator(`${pickerDialog} .pivot-filter-picker__value`).first()).toBeVisible();

  expect(await overflowing(page, pickerDialog)).toEqual([]);

  // A two-argument operator brings the condition row's inputs in.
  await page.selectOption(".pivot-filter-picker__operator", "Between");
  expect(await overflowing(page, pickerDialog)).toEqual([]);
});

test("the filter picker shows which mode is on", async ({ page }) => {
  await page.locator('.pivot-table__corner [data-action="header-filter"][data-field="Region"]').tap();
  const mode = page.locator(`${pickerDialog} [data-action="filter-mode"]`);
  await expect(mode.first()).toBeVisible();

  const background = mode => mode.evaluate(node => getComputedStyle(node).backgroundColor);
  const active = page.locator(`${pickerDialog} [data-action="filter-mode"][aria-pressed="true"]`);
  const idle = page.locator(`${pickerDialog} [data-action="filter-mode"][aria-pressed="false"]`);

  expect(await background(active)).not.toBe(await background(idle));
});

test("the field settings dialog fits the screen", async ({ page }) => {
  await page.locator('[data-zone="row"] .pivot-chip__settings').first().tap();
  const dialog = ".pivot-value-settings.is-open .pivot-value-settings__dialog";
  await expect(page.locator(dialog)).toBeVisible();

  const box = await page.locator(dialog).boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  expect(await overflowing(page, dialog)).toEqual([]);
});

// The narrow layout keys on the designer's own width and the pointer, so the
// desktop sidebar -- about as wide as a phone, but driven by a mouse -- keeps
// its two columns.
test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("the sidebar designer keeps two columns", async ({ page }) => {
    const lefts = await page.locator(".pivot-zone").evaluateAll(zones =>
      zones.map(zone => Math.round(zone.getBoundingClientRect().left)));

    expect(new Set(lefts).size).toBe(2);
  });
});
