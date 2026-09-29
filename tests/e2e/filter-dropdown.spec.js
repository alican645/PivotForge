const { test, expect } = require("@playwright/test");

// On a wide screen the value picker drops down under the funnel it was opened
// from; on a phone it stays the centred modal. The node suite checks the
// arithmetic against a stub; this checks it against real layout.
const PAGE = "/Home/TagHelpers";
const headerFunnel = field => `.pivot-table__corner [data-action="header-filter"][data-field="${field}"]`;
const picker = ".pivot-filter-picker.is-open";
const dialog = `${picker} .pivot-filter-picker__dialog`;
const pickerValue = `${picker} .pivot-filter-picker__value`;

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-zone__body .pivot-chip");
});

test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the header funnel drops the picker down under itself", async ({ page }) => {
    const funnel = page.locator(headerFunnel("Region"));
    await funnel.click();
    await expect(page.locator(pickerValue).first()).toBeVisible();

    const button = await funnel.boundingBox();
    const box = await page.locator(dialog).boundingBox();

    await expect(page.locator(picker)).toHaveClass(/is-anchored/);
    expect(Math.abs(box.y - (button.y + button.height + 4))).toBeLessThanOrEqual(1);
    expect(Math.abs(box.x - button.x)).toBeLessThanOrEqual(1);
    await expect(page.locator(dialog)).toHaveAttribute("aria-modal", "false");
  });

  test("the designer's funnel keeps the dropdown inside the window", async ({ page }) => {
    await page.dragAndDrop(
      '.pivot-field-list .pivot-chip[data-field="Quarter"]',
      '[data-zone="filter"] .pivot-zone__body');
    const funnel = page.locator('[data-zone="filter"] .pivot-chip[data-field="Quarter"] [data-action="filter"]');
    await funnel.click();
    await expect(page.locator(pickerValue).first()).toBeVisible();

    const box = await page.locator(dialog).boundingBox();

    await expect(page.locator(picker)).toHaveClass(/is-anchored/);
    expect(box.x).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width).toBeLessThanOrEqual(1280 - 8);
    expect(box.y).toBeGreaterThanOrEqual(8);
    expect(box.y + box.height).toBeLessThanOrEqual(800 - 8);
  });

  test("a click outside the dropdown closes it without applying", async ({ page }) => {
    await page.locator(headerFunnel("Region")).click();
    await page.locator(pickerValue).first().locator("input").uncheck();

    await page.mouse.click(1100, 120);

    await expect(page.locator(picker)).toHaveCount(0);
    await expect(page.locator(headerFunnel("Region"))).not.toHaveClass(/is-active/);
  });

  test("the dropdown follows its funnel when the page scrolls", async ({ page }) => {
    const funnel = page.locator(headerFunnel("Region"));
    await funnel.click();
    await expect(page.locator(pickerValue).first()).toBeVisible();

    await page.evaluate(() => window.scrollBy(0, 60));

    await expect.poll(async () => {
      const button = await funnel.boundingBox();
      const box = await page.locator(dialog).boundingBox();
      return Math.round(box.y - (button.y + button.height));
    }).toBe(4);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

  test("the header funnel still opens the centred modal", async ({ page }) => {
    await page.locator(headerFunnel("Region")).tap();
    await expect(page.locator(pickerValue).first()).toBeVisible();

    await expect(page.locator(picker)).not.toHaveClass(/is-anchored/);
    await expect(page.locator(dialog)).toHaveAttribute("aria-modal", "true");
  });
});
