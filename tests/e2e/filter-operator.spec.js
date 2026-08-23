const { test, expect } = require("@playwright/test");

const PAGE = "/Home/TagHelpers";

const funnel = field => `.pivot-table__corner [data-action="header-filter"][data-field="${field}"]`;
const picker = ".pivot-filter-picker.is-open";
const operator = `${picker} [data-action="filter-operator"]`;
const argument = index => `${picker} [data-action="filter-argument"][data-index="${index}"]`;

// Every pivot request the page makes; /field-values fills the picker rather than
// the table, so it is left out.
function trackRequests(page) {
  const requests = [];
  page.on("request", request => {
    if (request.method() === "POST" && request.url().includes("/pivotforge/") &&
      !request.url().includes("/field-values")) {
      requests.push(request.postDataJSON());
    }
  });
  return requests;
}

const rowLabels = page =>
  page.locator(".pivot-table tbody tr th:first-child").allTextContents();

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table tbody tr");
});

test("the picker opens on the value list, with the condition row beside it", async ({ page }) => {
  await page.locator(funnel("Region")).click();

  await expect(page.locator(operator)).toHaveValue("Equals");
  await expect(page.locator(`${picker} .pivot-filter-picker__list`)).toBeVisible();
  await expect(page.locator(argument(0))).toBeHidden();
});

test("a condition replaces the value list and reaches the request", async ({ page }) => {
  const requests = trackRequests(page);
  const before = await rowLabels(page);

  await page.locator(funnel("Region")).click();
  await expect(page.locator(`${picker} .pivot-filter-picker__value`).first()).toBeVisible();

  await page.locator(operator).selectOption("StartsWith");
  // The list answered a different question, so it goes away rather than sitting
  // there looking like it still applies.
  await expect(page.locator(`${picker} .pivot-filter-picker__list`)).toBeHidden();
  await expect(page.locator(`${picker} .pivot-filter-picker__toolbar`)).toBeHidden();

  await page.locator(argument(0)).fill("Mar");
  await page.locator(`${picker} [data-action="filter-apply"]`).click();

  await expect.poll(() => requests.at(-1)?.filters).toEqual([
    { field: "Region", values: ["Mar"], mode: "Include", operator: "StartsWith" }
  ]);

  // Polled: the request landing and the table being redrawn are two events.
  await expect.poll(() => rowLabels(page).then(labels => labels.length))
    .toBeLessThan(before.length);
  const after = await rowLabels(page);
  // No other region survives. Stated as an absence because the column also holds
  // a subtotal header, whose label carries a collapse arrow, and the grand total
  // row, which belongs to no region at all.
  expect(after.some(label => label.includes("Marmara"))).toBe(true);
  expect(after.some(label => /Ege|Akdeniz|Anadolu|Karadeniz/.test(label))).toBe(false);
  expect(page.errors).toEqual([]);
});

test("exclude negates the condition rather than needing an operator of its own", async ({ page }) => {
  const requests = trackRequests(page);

  await page.locator(funnel("Region")).click();
  await expect(page.locator(`${picker} .pivot-filter-picker__value`).first()).toBeVisible();
  await page.locator(operator).selectOption("Contains");
  await page.locator(argument(0)).fill("Anadolu");
  await page.locator(`${picker} [data-action="filter-mode"][data-mode="Exclude"]`).click();
  await page.locator(`${picker} [data-action="filter-apply"]`).click();

  await expect.poll(() => requests.at(-1)?.filters).toEqual([
    { field: "Region", values: ["Anadolu"], mode: "Exclude", operator: "Contains" }
  ]);

  await expect.poll(() => rowLabels(page)
    .then(labels => labels.some(label => label.includes("Anadolu")))).toBe(false);
  expect((await rowLabels(page)).length).toBeGreaterThan(0);
});

test("a half-typed range cannot be applied", async ({ page }) => {
  await page.locator(funnel("Region")).click();
  await expect(page.locator(`${picker} .pivot-filter-picker__value`).first()).toBeVisible();

  await page.locator(operator).selectOption("Between");
  await expect(page.locator(argument(1))).toBeVisible();

  await page.locator(argument(0)).fill("A");
  await expect(page.locator(`${picker} [data-action="filter-apply"]`)).toBeDisabled();

  await page.locator(argument(1)).fill("D");
  await expect(page.locator(`${picker} [data-action="filter-apply"]`)).toBeEnabled();
});

test("reopening the picker shows the condition already in force", async ({ page }) => {
  await page.locator(funnel("Region")).click();
  await expect(page.locator(`${picker} .pivot-filter-picker__value`).first()).toBeVisible();
  await page.locator(operator).selectOption("Contains");
  await page.locator(argument(0)).fill("Ege");
  await page.locator(`${picker} [data-action="filter-apply"]`).click();
  await expect(page.locator(picker)).toHaveCount(0);

  await page.locator(funnel("Region")).click();

  await expect(page.locator(operator)).toHaveValue("Contains");
  await expect(page.locator(argument(0))).toHaveValue("Ege");
  await expect(page.locator(funnel("Region"))).toHaveClass(/is-active/);
  expect(page.errors).toEqual([]);
});

test("a condition on a field in the Filters zone names itself on the chip", async ({ page }) => {
  // A count would mean nothing there: "(3)" beside a field filtered by
  // "contains" would be naming its three typed characters.
  await page.dragAndDrop(
    '.pivot-field-list .pivot-chip[data-field="Quarter"]',
    '[data-zone="filter"] .pivot-zone__body');

  const chip = '[data-zone="filter"] .pivot-chip[data-field="Quarter"]';
  await page.locator(`${chip} [data-action="filter"]`).click();
  await expect(page.locator(`${picker} .pivot-filter-picker__value`).first()).toBeVisible();
  await page.locator(operator).selectOption("EndsWith");
  await page.locator(argument(0)).fill("2");
  await page.locator(`${picker} [data-action="filter-apply"]`).click();

  await expect(page.locator(`${chip} .pivot-chip__filter-count`)).toHaveText("(ile biter)");
  expect(page.errors).toEqual([]);
});
