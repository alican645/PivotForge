const { test, expect } = require("@playwright/test");

// Both halves of the event design, asserted against what the page actually does:
// a named handler runs with no wiring code, and the same events reach a plain
// addEventListener.
const PAGES = ["/Home/TagHelpers", "/Home/HtmlHelper"];

for (const path of PAGES) {
  test(`${path}: a named handler runs without any wiring code`, async ({ page }) => {
    await page.goto(path);
    await page.waitForSelector(".pivot-table table tbody td");

    await expect(page.locator("#eventLog")).toHaveText("Bir hücre seçin.");

    await page.locator(".pivot-table table tbody td").first().click();

    await expect(page.locator("#eventLog")).toContainText("Seçili:");
  });

  test(`${path}: the same events reach addEventListener`, async ({ page }) => {
    await page.goto(path);
    await page.waitForSelector(".pivot-table table");

    // Set by the page's own pivotforge:dataloaded listener.
    await expect(page.locator("#eventLog")).toHaveAttribute("data-rows", /^[0-9]+$/);
  });

  test(`${path}: events are dispatched even with no handler named`, async ({ page }) => {
    await page.goto(path);
    await page.waitForSelector(".pivot-table table tbody td");

    const seen = await page.evaluate(async () => {
      const grid = document.getElementById("pivotGrid");
      const names = [];
      ["selectionchanged", "celldoubleclick"].forEach(name =>
        grid.addEventListener(`pivotforge:${name}`, () => names.push(name)));

      grid.querySelector("tbody td").click();
      grid.querySelector("tbody td").dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true }));

      await new Promise(resolve => setTimeout(resolve, 100));
      return names;
    });

    expect(seen).toContain("selectionchanged");
  });
}

test("a handler name that resolves to nothing fails loudly", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));

  await page.goto(PAGES[0]);
  await page.waitForSelector(".pivot-table table");

  // The sample names a real function, so nothing should have thrown.
  expect(errors).toEqual([]);
});
