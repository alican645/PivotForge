const { test, expect } = require("@playwright/test");

// Sorting by a summary value (DevExpress sortBySummaryField / sortBySummaryPath)
// on both axes: rows by a column's value, keeping each group's rows together,
// and columns by a row's value.

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

async function open(page, path) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(path);
  await page.waitForSelector(".pivot-table tbody tr");
  return errors;
}

// "₺1.234.567" -> 1234567, in the Turkish format the demo pages use.
const amount = text => Number(text.replace(/[^\d,-]/g, "").replace(",", "."));

const descending = numbers => numbers.every((value, index) => index === 0 || numbers[index - 1] >= value);
const ascending = numbers => numbers.every((value, index) => index === 0 || numbers[index - 1] <= value);

const grandTotalRow = ".pivot-table tbody tr:last-child";
const columnTotals = async page =>
  (await page.locator(`${grandTotalRow} .pivot-table__column-total`).allTextContents()).map(amount);

test("a row value sort keeps each region's categories together, both ordered by value", async ({ page }) => {
  const errors = await open(page, "/Home/TagHelpers");
  const requests = trackRequests(page);
  const totalHeader = page.locator(".pivot-table__measure-header .pivot-table__sort-button");

  // The page opens sorted by the total, largest first; a click turns it around.
  await totalHeader.click();
  await expect.poll(() => requests.at(-1)?.rowSort?.direction).toBe("Ascending");
  await expect(page.locator(".pivot-table__measure-header")).toHaveAttribute("aria-sort", "ascending");

  const subtotals = (await page.locator(".pivot-table__subtotal-row .pivot-table__subtotal-total")
    .allTextContents()).map(amount);
  expect(subtotals.length).toBeGreaterThan(1);
  expect(ascending(subtotals)).toBe(true);

  // Under every region header its categories run by their own totals, and no
  // region shows up twice.
  const groups = await page.evaluate(() => {
    const result = [];
    for (const row of document.querySelectorAll(".pivot-table tbody tr")) {
      if (row.classList.contains("pivot-table__subtotal-row")) {
        result.push({ region: row.querySelector("th").textContent, totals: [] });
      } else if (row.classList.contains("pivot-table__detail-row")) {
        result.at(-1).totals.push(row.querySelector(".pivot-table__row-total").textContent);
      }
    }
    return result;
  });
  expect(new Set(groups.map(group => group.region)).size).toBe(groups.length);
  for (const group of groups) {
    expect(ascending(group.totals.map(amount))).toBe(true);
  }

  expect(errors).toEqual([]);
});

test("the grand total row's arrow orders the columns by their totals", async ({ page }) => {
  const errors = await open(page, "/Home/TagHelpers");
  const requests = trackRequests(page);
  const arrow = page.locator(`${grandTotalRow} .pivot-table__row-total-label .pivot-table__sort-button`);

  await arrow.click();
  await expect.poll(() => requests.at(-1)?.fieldSorts?.find(sort => sort.field === "Year"))
    .toEqual({ field: "Year", direction: "Descending", valueKey: "Amount_sum" });
  await expect.poll(async () => descending(await columnTotals(page))).toBe(true);
  await expect(page.locator(`${grandTotalRow} .pivot-table__row-total-label`).first())
    .toHaveAttribute("aria-sort", "descending");

  await arrow.click();
  await expect.poll(() => requests.at(-1)?.fieldSorts?.find(sort => sort.field === "Year")?.direction)
    .toBe("Ascending");
  await expect.poll(async () => ascending(await columnTotals(page))).toBe(true);

  // The year field's own arrow takes the columns back to label order.
  await page.locator(".pivot-table__column-field .pivot-table__sort-button").click();
  await expect.poll(() => requests.at(-1)?.fieldSorts?.find(sort => sort.field === "Year"))
    .toEqual({ field: "Year", direction: "Ascending" });
  await expect.poll(async () => (await page.locator(".pivot-table__column-header .pivot-table__sort-label")
    .allTextContents())
    .map(text => text.trim())).toEqual(["2024", "2025", "2026"]);

  expect(errors).toEqual([]);
});

test("the cell menu orders the columns by one region's subtotal row", async ({ page }) => {
  const errors = await open(page, "/Home/TagHelpers");
  const requests = trackRequests(page);
  const firstSubtotal = page.locator(".pivot-table__subtotal-row").first();
  const region = (await firstSubtotal.locator("th").first().textContent())
    .replace("▾", "").replace("Genel Toplam", "").trim();

  await firstSubtotal.locator(".pivot-table__subtotal-value").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Sütunları bu satıra göre sırala" }).click();

  await expect.poll(() => requests.at(-1)?.fieldSorts?.find(sort => sort.field === "Year"))
    .toEqual({ field: "Year", direction: "Descending", valueKey: "Amount_sum", summaryPath: [region] });
  await expect.poll(async () => descending((await page.locator(".pivot-table__subtotal-row").first()
    .locator(".pivot-table__subtotal-value").allTextContents()).map(amount))).toBe(true);

  expect(errors).toEqual([]);
});
