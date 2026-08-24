const { test, expect } = require("@playwright/test");

// Both demo pages declare state-storing="Session" with the same key, which is
// also what makes them a pair worth testing: the tag helper and the HTML helper
// have to persist identically.
const PAGES = ["/Home/TagHelpers", "/Home/HtmlHelper"];
const STORAGE_KEY = "pivotforge:state:tagHelperDemo";

const zoneBody = area => `[data-zone="${area}"] .pivot-zone__body`;
const chipIn = (area, field) => `${zoneBody(area)} .pivot-chip[data-field="${field}"]`;
const availableChip = field => `.pivot-field-list .pivot-chip[data-field="${field}"]`;

async function open(page, url) {
  await page.goto(url);
  await page.waitForSelector(".pivot-zone__body .pivot-chip");
}

const storedState = page => page.evaluate(
  key => JSON.parse(sessionStorage.getItem(key) ?? "null"), STORAGE_KEY);

for (const url of PAGES) {
  test(`a rearranged layout survives a reload on ${url}`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await open(page, url);
    await expect(page.locator(chipIn("row", "Region"))).toHaveCount(1);

    await page.dragAndDrop(availableChip("Quarter"), zoneBody("row"));
    await expect(page.locator(chipIn("row", "Quarter"))).toHaveCount(1);
    await expect.poll(async () => (await storedState(page))?.layout?.rows)
      .toContain("Quarter");

    await open(page, url);

    await expect(page.locator(chipIn("row", "Quarter"))).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

test("a renamed caption survives a reload", async ({ page }) => {
  await open(page, PAGES[0]);

  await page.locator(`${chipIn("row", "Region")} [data-action="settings"]`).click();
  await page.fill('.pivot-value-settings [data-action="caption"]', "Satış Bölgesi");
  await page.locator('.pivot-value-settings [data-action="rename"]').click();
  await expect(page.locator(`${chipIn("row", "Region")} .pivot-chip__label`))
    .toHaveText("Satış Bölgesi");

  await open(page, PAGES[0]);

  await expect(page.locator(`${chipIn("row", "Region")} .pivot-chip__label`))
    .toHaveText("Satış Bölgesi");
});

test("a filter selection survives a reload and still filters", async ({ page }) => {
  await open(page, PAGES[0]);

  await page.dragAndDrop(availableChip("Quarter"), zoneBody("filter"));
  await page.locator(`${chipIn("filter", "Quarter")} [data-action="filter"]`).click();
  await expect(page.locator(".pivot-filter-picker__value").first()).toBeVisible();
  await page.locator(".pivot-filter-picker__value input").nth(1).uncheck();
  await page.locator('.pivot-filter-picker.is-open [data-action="filter-apply"]').click();
  await expect(page.locator(`${chipIn("filter", "Quarter")} .pivot-chip__filter-count`))
    .toHaveText("(3)");

  await open(page, PAGES[0]);

  // The chip count proves the layout came back; the request proves the filter is
  // actually being applied rather than merely displayed.
  await expect(page.locator(`${chipIn("filter", "Quarter")} .pivot-chip__filter-count`))
    .toHaveText("(3)");
  const state = await storedState(page);
  expect(state.filters).toEqual([
    { field: "Quarter", values: expect.arrayContaining(["Ç1"]), mode: "Include" }
  ]);
});

test("an aggregation change survives a reload", async ({ page }) => {
  await open(page, PAGES[0]);

  await page.locator(`${chipIn("data", "Amount")} [data-action="settings"]`).click();
  await page.locator('.pivot-value-settings [data-action="aggregation"][data-value="average"]')
    .click();
  await expect(page.locator(
    '.pivot-value-settings [data-action="aggregation"][data-selected="true"]'))
    .toHaveAttribute("data-value", "average");

  await open(page, PAGES[0]);
  await page.locator(`${chipIn("data", "Amount")} [data-action="settings"]`).click();

  await expect(page.locator(
    '.pivot-value-settings [data-action="aggregation"][data-selected="true"]'))
    .toHaveAttribute("data-value", "average");
});

test("a corrupt entry loads the declared layout instead of breaking the page", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));

  await page.goto(PAGES[0]);
  await page.evaluate(key => sessionStorage.setItem(key, "{ not json"), STORAGE_KEY);
  await open(page, PAGES[0]);

  await expect(page.locator(chipIn("row", "Region"))).toHaveCount(1);
  await expect(page.locator(chipIn("column", "Year"))).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("storage is per key, so a page without one is untouched", async ({ page }) => {
  await open(page, PAGES[0]);
  await page.dragAndDrop(availableChip("Quarter"), zoneBody("row"));
  await expect.poll(async () => (await storedState(page))?.layout?.rows).toContain("Quarter");

  const keys = await page.evaluate(() => Object.keys(sessionStorage));

  expect(keys).toEqual([STORAGE_KEY]);
});

// The conditional panel is the only part of the grid whose result the reader
// creates from nothing, so losing it on reload is the most visible kind of
// loss. Both sample pages also declare a rule in markup, which makes this the
// case worth checking: the stored list must replace the declared one rather
// than being added to it, or every reload would double the declarations.
for (const url of PAGES) {
  test(`a conditional rule the reader added survives a reload on ${url}`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await open(page, url);
    await page.waitForSelector(".pivot-table table td");

    const declared = await page.locator('.pivot-table table td[class*="is-conditional-"]').count();
    expect(declared).toBeGreaterThan(0);

    await page.locator(".pivot-table table tbody td[data-selection-target='cell']")
      .first().click({ button: "right" });
    await page.locator(".pivot-cell-menu__item", { hasText: "Koşullu biçimlendirme ekle" }).click();
    const panel = page.locator(".pivot-conditional-panel");
    await expect(panel).toBeVisible();
    await panel.locator("select").selectOption("greaterThan");
    await panel.locator('input[type="number"]').first().fill("0");
    await panel.locator('input[type="radio"][value="blue"]').check();
    await panel.locator('button[type="submit"]').click();

    const blue = await page.locator(".pivot-table table td.is-conditional-blue").count();
    expect(blue).toBeGreaterThan(0);
    await expect.poll(async () => (await storedState(page))?.conditionalRules?.length)
      .toBeGreaterThan(0);

    await open(page, url);
    await page.waitForSelector(".pivot-table table td");

    await expect(page.locator(".pivot-table table td.is-conditional-blue")).toHaveCount(blue);
    // The declared rule is still in the list rather than duplicated out of it.
    await expect.poll(async () => (await storedState(page))?.conditionalRules?.length)
      .toBe(2);
    expect(errors).toEqual([]);
  });
}

test("clearing the rules is remembered too", async ({ page }) => {
  // The declarative pages wire no page code, so the widget is caught from the
  // ready event the same way a consuming page would catch it.
  await page.addInitScript(() => {
    document.addEventListener(
      "pivotforge:ready",
      event => { window.grid = event.detail.widget; },
      true);
  });
  await open(page, PAGES[0]);
  await page.waitForSelector(".pivot-table table td");
  const highlighted = page.locator('.pivot-table table td[class*="is-conditional-"]');
  expect(await highlighted.count()).toBeGreaterThan(0);

  await page.evaluate(() => window.grid.clearConditionalRules());
  await expect(highlighted).toHaveCount(0);

  await open(page, PAGES[0]);
  await page.waitForSelector(".pivot-table table td");

  // The declared rule does not come back: the reader turned it off, and a
  // declaration that reappeared on every reload could never be turned off.
  await expect(highlighted).toHaveCount(0);
});
