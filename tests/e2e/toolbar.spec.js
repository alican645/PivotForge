const { test, expect } = require("@playwright/test");

// The toolbar both declarative pages switch on: a strip of buttons just above
// the grid, outside its scroll box.
const PAGES = ["/Home/TagHelpers", "/Home/HtmlHelper"];

for (const path of PAGES) {
  test.describe(path, () => {
    test.beforeEach(async ({ page }) => {
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      page.errors = errors;
      await page.goto(path);
      await page.waitForSelector("#pivotGrid .pivot-table__table td");
    });

    test("sits just before the grid and offers every button, Excel included", async ({ page }) => {
      const toolbar = page.locator("#pivotGrid").locator("xpath=preceding-sibling::*[1]");
      await expect(toolbar).toHaveClass(/pivot-toolbar/);
      await expect(toolbar).toHaveAttribute("role", "toolbar");

      const items = await toolbar.locator("button").evaluateAll(buttons =>
        buttons.map(button => button.dataset.toolbarItem));
      expect(items).toEqual(
        ["excel", "csv", "print", "expandAll", "collapseAll", "saveReport", "openReport", "fullscreen"]);
      expect(page.errors).toEqual([]);
    });

    test("collapse all folds the groups and expand all opens them again", async ({ page }) => {
      const visibleRows = () => page.locator("#pivotGrid tbody tr").evaluateAll(rows =>
        rows.filter(row => row.offsetParent !== null).length);
      const before = await visibleRows();

      await page.locator('.pivot-toolbar [data-toolbar-item="collapseAll"]').click();
      expect(await visibleRows()).toBeLessThan(before);

      await page.locator('.pivot-toolbar [data-toolbar-item="expandAll"]').click();
      expect(await visibleRows()).toBe(before);
      expect(page.errors).toEqual([]);
    });

    test("the CSV button saves the grid", async ({ page }) => {
      const download = page.waitForEvent("download");
      await page.locator('.pivot-toolbar [data-toolbar-item="csv"]').click();

      expect((await download).suggestedFilename()).toMatch(/^pivotforge-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(page.errors).toEqual([]);
    });
  });
}
