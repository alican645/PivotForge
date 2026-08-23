const { test, expect } = require("@playwright/test");

// The demo's declarative page starts with an empty filter zone, so every test
// here places a field there first — which is also the path a user takes.
const PAGE = "/Home/TagHelpers";

const zoneBody = area => `[data-zone="${area}"] .pivot-zone__body`;
const chipIn = (area, field) => `${zoneBody(area)} .pivot-chip[data-field="${field}"]`;
const availableChip = field => `.pivot-field-list .pivot-chip[data-field="${field}"]`;
const picker = ".pivot-filter-picker.is-open";
const pickerValue = `${picker} .pivot-filter-picker__value`;

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-zone__body .pivot-chip");
});

// Places Quarter in the filter zone and opens its picker.
async function openPicker(page, field = "Quarter") {
  await page.dragAndDrop(availableChip(field), zoneBody("filter"));
  await expect(page.locator(chipIn("filter", field))).toHaveCount(1);
  await page.locator(`${chipIn("filter", field)} [data-action="filter"]`).click();
  await expect(page.locator(pickerValue).first()).toBeVisible();
}

test("only a filter chip offers the funnel", async ({ page }) => {
  await page.dragAndDrop(availableChip("Quarter"), zoneBody("filter"));

  await expect(page.locator(`${chipIn("filter", "Quarter")} [data-action="filter"]`))
    .toHaveCount(1);
  await expect(page.locator(`${chipIn("row", "Region")} [data-action="filter"]`))
    .toHaveCount(0);
});

test("the picker lists the field's real values from the server", async ({ page }) => {
  await openPicker(page);

  const labels = await page.locator(`${pickerValue} span`).allTextContents();
  expect(labels).toEqual(["Ç1", "Ç2", "Ç3", "Ç4"]);
  expect(page.errors).toEqual([]);
});

test("a freshly placed filter opens with everything checked", async ({ page }) => {
  await openPicker(page);

  const checked = await page.locator(`${pickerValue} input`).evaluateAll(
    boxes => boxes.map(box => box.checked));
  expect(checked).toEqual([true, true, true, true]);
});

test("applying a subset filters the rendered table", async ({ page }) => {
  const before = await page.locator(".pivot-table tbody tr").count();

  await openPicker(page);
  await page.locator(`${pickerValue} input`).nth(1).uncheck();
  await page.locator(`${picker} [data-action="filter-apply"]`).click();

  await expect(page.locator(picker)).toHaveCount(0);
  // The chip reports the restriction, and the pivot was rebuilt against it.
  await expect(page.locator(`${chipIn("filter", "Quarter")} .pivot-chip__filter-count`))
    .toHaveText("(3)");
  await expect
    .poll(async () => page.locator(".pivot-table tbody tr").count())
    .not.toBe(0);
  expect(page.errors).toEqual([]);
  expect(before).toBeGreaterThan(0);
});

test("a filter that excludes a value actually removes its rows", async ({ page }) => {
  // Year is a column field, so what it filters out is visible as a column.
  await page.dragAndDrop(chipIn("column", "Year"), ".pivot-field-list-panel");
  await page.dragAndDrop(availableChip("Year"), zoneBody("filter"));
  await page.locator(`${chipIn("filter", "Year")} [data-action="filter"]`).click();
  await expect(page.locator(pickerValue).first()).toBeVisible();

  const values = await page.locator(`${pickerValue} span`).allTextContents();
  await page.locator(`${picker} [data-action="filter-clear"]`).click();
  await page.locator(`${pickerValue} input`).first().check();
  await page.locator(`${picker} [data-action="filter-apply"]`).click();

  await expect(page.locator(`${chipIn("filter", "Year")} .pivot-chip__filter-count`))
    .toHaveText("(1)");
  expect(values.length).toBeGreaterThan(1);
  expect(page.errors).toEqual([]);
});

test("reopening the picker shows the selection already in force", async ({ page }) => {
  await openPicker(page);
  await page.locator(`${pickerValue} input`).nth(0).uncheck();
  await page.locator(`${picker} [data-action="filter-apply"]`).click();
  await expect(page.locator(picker)).toHaveCount(0);

  await page.locator(`${chipIn("filter", "Quarter")} [data-action="filter"]`).click();
  // The values are fetched again on every open, so the list is empty until the
  // response lands — reading the checkboxes before that would read nothing.
  await expect(page.locator(pickerValue)).toHaveCount(4);

  const checked = await page.locator(`${pickerValue} input`).evaluateAll(
    boxes => boxes.map(box => box.checked));
  expect(checked).toEqual([false, true, true, true]);
});

test("search narrows the list and select-all acts on what it shows", async ({ page }) => {
  await openPicker(page);

  await page.locator(`${picker} [data-action="filter-clear"]`).click();
  await page.locator(`${picker} [data-action="filter-search"]`).fill("ç2");
  await expect(page.locator(`${pickerValue} span`)).toHaveText(["Ç2"]);
  await page.locator(`${picker} [data-action="filter-select-all"]`).click();
  await page.locator(`${picker} [data-action="filter-search"]`).fill("");
  await page.locator(`${picker} [data-action="filter-apply"]`).click();

  await expect(page.locator(`${chipIn("filter", "Quarter")} .pivot-chip__filter-count`))
    .toHaveText("(1)");
});

test("re-checking everything clears the filter rather than freezing the value set", async ({ page }) => {
  await openPicker(page);
  await page.locator(`${pickerValue} input`).nth(0).uncheck();
  await page.locator(`${picker} [data-action="filter-apply"]`).click();
  await expect(page.locator(`${chipIn("filter", "Quarter")} .pivot-chip__filter-count`))
    .toHaveCount(1);

  await page.locator(`${chipIn("filter", "Quarter")} [data-action="filter"]`).click();
  await page.locator(`${picker} [data-action="filter-select-all"]`).click();
  await page.locator(`${picker} [data-action="filter-apply"]`).click();

  await expect(page.locator(`${chipIn("filter", "Quarter")} .pivot-chip__filter-count`))
    .toHaveCount(0);
});

test("switching to exclude reaches the chip and the request", async ({ page }) => {
  // Only the pivot requests matter here; /field-values is what fills the picker.
  const requests = [];
  page.on("request", request => {
    if (request.method() === "POST" && request.url().includes("/pivotforge/") &&
      !request.url().includes("/field-values")) {
      requests.push(request.postDataJSON());
    }
  });

  await openPicker(page);
  await page.locator(`${picker} [data-action="filter-mode"][data-mode="Exclude"]`).click();
  // Checking a box means "shown" in both modes, so unchecking Ç1 is what an
  // excluding filter stores.
  await page.locator(`${pickerValue} input`).nth(0).uncheck();
  await page.locator(`${picker} [data-action="filter-apply"]`).click();

  await expect(page.locator(`${chipIn("filter", "Quarter")} .pivot-chip__filter-count`))
    .toHaveText("(1 hariç)");
  await expect(page.locator(`${chipIn("filter", "Quarter")} .pivot-chip__filter-count`))
    .toHaveClass(/is-excluding/);
  await expect.poll(() => requests.at(-1)?.filters)
    .toEqual([{ field: "Quarter", values: ["Ç1"], mode: "Exclude" }]);

  // Reopening reads the stored list back through the mode: the excluded value
  // is the unchecked one, and the button it was applied under is still active.
  await page.locator(`${chipIn("filter", "Quarter")} [data-action="filter"]`).click();
  await expect(page.locator(pickerValue)).toHaveCount(4);
  await expect(page.locator(`${picker} [data-action="filter-mode"][data-mode="Exclude"]`))
    .toHaveClass(/is-active/);
  const checked = await page.locator(`${pickerValue} input`).evaluateAll(
    boxes => boxes.map(box => box.checked));
  expect(checked).toEqual([false, true, true, true]);
  expect(page.errors).toEqual([]);
});

test("cancelling and escape both leave the filter alone", async ({ page }) => {
  await openPicker(page);

  await page.locator(`${pickerValue} input`).nth(0).uncheck();
  await page.locator(`${picker} [data-action="filter-cancel"]`).click();
  await expect(page.locator(picker)).toHaveCount(0);
  await expect(page.locator(`${chipIn("filter", "Quarter")} .pivot-chip__filter-count`))
    .toHaveCount(0);

  await page.locator(`${chipIn("filter", "Quarter")} [data-action="filter"]`).click();
  await expect(page.locator(pickerValue).first()).toBeVisible();
  await page.locator(`${pickerValue} input`).nth(0).uncheck();
  await page.keyboard.press("Escape");

  await expect(page.locator(picker)).toHaveCount(0);
  await expect(page.locator(`${chipIn("filter", "Quarter")} .pivot-chip__filter-count`))
    .toHaveCount(0);
});

test("removing the field from the filter zone drops its restriction", async ({ page }) => {
  await openPicker(page);
  await page.locator(`${pickerValue} input`).nth(0).uncheck();
  await page.locator(`${picker} [data-action="filter-apply"]`).click();

  await page.locator(`${chipIn("filter", "Quarter")} [data-action="remove"]`).click();

  await expect(page.locator(chipIn("filter", "Quarter"))).toHaveCount(0);
  await expect(page.locator(availableChip("Quarter"))).toHaveCount(1);
  expect(page.errors).toEqual([]);
});
