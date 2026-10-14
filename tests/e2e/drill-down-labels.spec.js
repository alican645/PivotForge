const { test, expect } = require("@playwright/test");

// Both declarative pages rename one detail modal text -- the search box's --
// and leave the rest to the locale pack. The rename must show, and the pack's
// words must survive it.
const PAGES = ["/Home/TagHelpers", "/Home/HtmlHelper"];

for (const path of PAGES) {
  test(`${path}: a declared label shows and the pack keeps the others`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(path);
    await page.waitForSelector("#pivotGrid .pivot-table__table td");

    await page.locator("#pivotGrid tbody td").first().dblclick();
    await page.waitForSelector(".pivot-drill-down-modal.is-open");

    const modal = page.locator(".pivot-drill-down-modal");
    await expect(modal.locator('.pivot-drill-down-toolbar input[type="search"]'))
      .toHaveAttribute("placeholder", "Satışlarda ara");
    // Declaring one label used to replace the pack's whole set with English.
    await expect(modal.locator(".pivot-panel-head .pivot-button").first()).toHaveText("Kapat");
    expect(errors).toEqual([]);
  });
}
