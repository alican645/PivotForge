const { test, expect } = require("@playwright/test");

// The presentation options are declared on the sample pages. These assert they
// reach the renderer and change what it draws — a config payload carrying the
// right JSON would prove only that the builder serialized it.
const PAGES = ["/Home/TagHelpers", "/Home/HtmlHelper"];

for (const path of PAGES) {
  test(`${path}: a declared selection mode actually selects`, async ({ browser: _b, page }) => {
    await page.goto(path);
    await page.waitForSelector(".pivot-table table td");

    // selection-mode="Single" is declared on both pages; asserting the class the
    // renderer applies proves the option was applied, not merely serialized.
    await page.locator(".pivot-table table tbody td").first().click();

    await expect(page.locator(".pivot-table table .is-cell-selected")).toHaveCount(1);
  });

  test(`${path}: a declared context menu opens on right-click`, async ({ page }) => {
    await page.goto(path);
    await page.waitForSelector(".pivot-table table td");

    await page.locator(".pivot-table table tbody td").first().click({ button: "right" });

    await expect(page.locator(".pivot-cell-menu")).toHaveCount(1);
  });

  // These two assert options declared AWAY from the renderer's defaults
  // ("Toplam" and false), so a declaration that never arrived would change the
  // result. The rest of the sample declares defaults, which is right for a demo
  // but cannot prove anything on its own -- those are covered by transport below
  // and by the unit tests.
  test(`${path}: a declared total caption replaces the renderer's default`, async ({ page }) => {
    await page.goto(path);
    await page.waitForSelector(".pivot-table table");

    await expect(page.locator(".pivot-table table", { hasText: "Genel Toplam" }).first())
      .toBeVisible();
    await expect(page.locator(".pivot-table table th", { hasText: /^Toplam$/ }))
      .toHaveCount(0);
  });

  test(`${path}: declared repeat-row-labels changes how row headers render`, async ({ page }) => {
    await page.goto(path);
    await page.waitForSelector(".pivot-table table");

    // The class marks a repeat the renderer SUPPRESSED, so it appears when
    // repeatRowLabels is false. Both sample pages declare true, and the rows are
    // two levels deep, so a declaration that never arrived would leave some.
    await expect(page.locator(".pivot-table table .is-repeated")).toHaveCount(0);
  });

  test(`${path}: the config carries the declared presentation options`, async ({ page }) => {
    await page.goto(path);

    const config = JSON.parse(await page.locator("#pivotGrid-config").textContent());

    expect(config.rendererOptions).toEqual({
      selectionMode: "single",
      layoutMode: "tabular",
      contextMenu: true,
      subtotals: true,
      showGrandTotal: true,
      repeatRowLabels: true,
      minColumnWidth: 96,
      totalText: "Genel Toplam"
    });
  });
}

test("both declarative pages still emit an identical configuration", async ({ page }) => {
  const payloads = [];

  for (const path of PAGES) {
    await page.goto(path);
    payloads.push(await page.locator("#pivotGrid-config").textContent());
  }

  expect(payloads[0]).toBe(payloads[1]);
});

