const { test, expect } = require("@playwright/test");

// The demo pins tr-TR request localization and loads pivot-locale-tr.js, so it
// is the end-to-end proof that a locale derived from the request reaches every
// component -- no grid on the page declares one.
const PAGE = "/Home/TagHelpers";

test.beforeEach(async ({ page }) => {
  const problems = [];
  page.on("pageerror", error => problems.push(error.message));
  page.on("console", message => {
    if (message.type() === "warning" || message.type() === "error") {
      problems.push(message.text());
    }
  });
  page.problems = problems;
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table tbody tr");
});

test("the designer speaks the request's language without being told to", async ({ page }) => {
  await expect(page.locator(".pivot-zone__head").first()).toHaveText("Filtreler");
  await expect(page.locator(".pivot-zone__head", { hasText: "Satırlar" })).toHaveCount(1);
  await expect(page.locator(".pivot-zone__head", { hasText: "Değerler" })).toHaveCount(1);
  // A pack that failed to load would warn rather than throw, so silence is part
  // of the assertion.
  expect(page.problems).toEqual([]);
});

test("the rendered table's own controls are localized too", async ({ page }) => {
  await expect(page.locator(".pivot-table [role='grid']").first())
    .toHaveAttribute("aria-label", "Bölge ve kategori bazında satışlar");
  await expect(page.locator('.pivot-table__corner [data-action="header-filter"]').first())
    .toHaveAttribute("title", /alanını filtrele/);
  await expect(page.locator(".pivot-table__sort-button").first())
    .toHaveAttribute("title", /sırala/);
});

test("the value picker the designer opens is localized as well", async ({ page }) => {
  await page.locator('.pivot-table__corner [data-action="header-filter"]').first().click();
  const picker = page.locator(".pivot-filter-picker.is-open");

  await expect(picker.locator('[data-action="filter-apply"]')).toHaveText("Uygula");
  await expect(picker.locator('[data-action="filter-select-all"]')).toHaveText("Tümünü seç");
  expect(page.problems).toEqual([]);
});

test("English is what a grid gets when no pack answers to its locale", async ({ page }) => {
  // Driven directly rather than through the page, which is Turkish by
  // construction: what matters is that the fallback renders rather than fails.
  const texts = await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const renderer = new PivotForge.PivotTableRenderer(host, {});
    return renderer.resolveTexts();
  });

  expect(texts.rowLabels).toBe("Row Labels");
  expect(texts.noData).toBe("No data");
});
