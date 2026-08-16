const { test, expect } = require("@playwright/test");

// Initial sort and conditional rules are declared on both sample pages. These
// assert the effect on the rendered table, not the config payload — a payload
// check proves serialization, not that the grid started in that state.
const PAGES = ["/Home/TagHelpers", "/Home/HtmlHelper"];

for (const path of PAGES) {
  test(`${path}: the declared sort survives to the rendered rows`, async ({ page }) => {
    await page.goto(path);
    await page.waitForSelector(".pivot-table table tbody td");

    const regions = await page.locator(".pivot-table table tbody tr").evaluateAll(rows =>
      rows
        .map(row => row.querySelector("th")?.textContent?.trim() ?? "")
        .filter(text => text.length > 0));

    expect(regions.length).toBeGreaterThan(1);

    // A row sort by descending total cannot come out alphabetical. The renderer
    // re-sorts rows itself whenever it is not told a sort is active, which is
    // exactly how a declared sort would silently go missing.
    const alphabetical = [...new Set(regions)].sort((a, b) => a.localeCompare(b, "tr"));
    const rendered = [...new Set(regions)];
    expect(rendered).not.toEqual(alphabetical);
  });

  test(`${path}: the declared conditional rule highlights matching cells`, async ({ page }) => {
    await page.goto(path);
    await page.waitForSelector(".pivot-table table tbody td");

    const highlighted = page.locator(".pivot-table table .is-conditional-green");
    await expect(highlighted.first()).toBeAttached();
    await expect(highlighted.first()).toHaveAttribute("data-conditional-rule", "yuksek");
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
