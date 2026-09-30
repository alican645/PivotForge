const { test, expect } = require("@playwright/test");

// Sorting reached only the row axis: the column axis named its fields just to
// hang a funnel on them, so its values could be filtered but never reordered,
// and with a single value no column header could sort the rows either.

const columnSort = ".pivot-table__column-field .pivot-table__sort-button";

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

const columnHeaders = page => page.locator(".pivot-table__column-header").allTextContents();

async function open(page, path) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(path);
  await page.waitForSelector(".pivot-table tbody tr");
  return errors;
}

for (const path of ["/Home/TagHelpers", "/Home/HtmlHelper", "/Home/Index"]) {
  test(`${path}: the column field header orders its values and flips on a second click`, async ({ page }) => {
    const errors = await open(page, path);
    const requests = trackRequests(page);
    const before = (await columnHeaders(page)).map(text => text.trim());
    expect(before.length).toBeGreaterThan(1);
    const field = await page.locator(".pivot-table__column-field [data-action=\"header-filter\"]")
      .first().getAttribute("data-field");

    const ascending = [...before].sort((a, b) => a.localeCompare(b, "tr"));

    await page.locator(columnSort).first().click();
    await expect.poll(() => requests.at(-1)?.fieldSorts?.find(sort => sort.field === field))
      .toEqual({ field, direction: "Ascending" });
    await expect.poll(async () => (await columnHeaders(page)).map(text => text.trim()))
      .toEqual(ascending);
    await expect(page.locator(".pivot-table__column-field").first()).toHaveAttribute("aria-sort", "ascending");

    await page.locator(columnSort).first().click();
    await expect.poll(() => requests.at(-1)?.fieldSorts?.find(sort => sort.field === field))
      .toEqual({ field, direction: "Descending" });
    await expect.poll(async () => (await columnHeaders(page)).map(text => text.trim()))
      .toEqual([...ascending].reverse());
    await expect(page.locator(".pivot-table__column-field").first()).toHaveAttribute("aria-sort", "descending");
    await expect(page.locator(`${columnSort} .pivot-table__sort-indicator`).first()).toHaveText("▼");

    expect(errors).toEqual([]);
  });

  test(`${path}: the column field header still carries its funnel`, async ({ page }) => {
    await open(page, path);

    await expect(page.locator(".pivot-table__column-field [data-action=\"header-filter\"]").first())
      .toBeVisible();
  });
}

test("with a single value, a column header sorts the rows by that column", async ({ page }) => {
  const errors = await open(page, "/Home/TagHelpers");
  const requests = trackRequests(page);
  const header = page.locator(".pivot-table__column-header").first();
  const year = (await header.textContent()).replace(/[↕▲▼]/g, "").trim();

  await header.locator(".pivot-table__sort-button").click();

  await expect.poll(() => requests.at(-1)?.rowSort).toMatchObject({
    mode: "RowTotalValue",
    direction: "Descending",
    columnPath: [year]
  });
  await expect(page.locator(".pivot-table__column-header").first()).toHaveAttribute("aria-sort", "descending");
  expect(errors).toEqual([]);
});
