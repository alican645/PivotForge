const { test, expect } = require("@playwright/test");

// The panel is packaged, so the page that proves it needs no code of its own.
// Both declarative samples wire nothing beyond their markup: whatever works
// here is the package working, not the demo.
const PAGES = ["/Home/TagHelpers", "/Home/HtmlHelper"];

const menuItem = page => page.locator(".pivot-cell-menu__item", { hasText: "Koşullu biçimlendirme ekle" });
const panel = page => page.locator(".pivot-conditional-panel");
const highlighted = page => page.locator('.pivot-table table td[class*="is-conditional-"]');

// A value cell that carries a measure, which is what the menu entry needs.
const valueCell = page => page.locator(".pivot-table table tbody td[data-selection-target='cell']").first();

async function openPanel(page) {
  await valueCell(page).click({ button: "right" });
  await menuItem(page).click();
  await expect(panel(page)).toBeVisible();
}

async function addRule(page, { threshold, color = "red", operator = null }) {
  await openPanel(page);

  if (operator) {
    await panel(page).locator("select").selectOption(operator);
  }

  await panel(page).locator('input[type="number"]').first().fill(String(threshold));
  await panel(page).locator(`input[type="radio"][value="${color}"]`).check();
  await panel(page).locator('button[type="submit"]').click();
  await expect(panel(page)).toBeHidden();
}

for (const path of PAGES) {
  test.beforeEach(async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.errors = errors;
  });

  test(`${path}: the cell menu offers conditional formatting`, async ({ page }) => {
    await page.goto(path);
    await page.waitForSelector(".pivot-table table td");

    await valueCell(page).click({ button: "right" });

    await expect(menuItem(page)).toHaveCount(1);
    await expect(menuItem(page)).toBeEnabled();
  });

  // The point of the whole change: the entry used to open nothing.
  test(`${path}: the menu entry opens the packaged panel`, async ({ page }) => {
    await page.goto(path);
    await page.waitForSelector(".pivot-table table td");

    await openPanel(page);

    await expect(panel(page).locator("select")).toBeVisible();
    assertNoErrors(page);
  });

  test(`${path}: a rule added from the panel colours the cells it matches`, async ({ page }) => {
    await page.goto(path);
    await page.waitForSelector(".pivot-table table td");

    const before = await highlighted(page).count();
    // Zero is below every amount on the sample pages, so "greater than" must
    // reach every value cell that carries the measure.
    await addRule(page, { threshold: 0, color: "red", operator: "greaterThan" });

    await expect.poll(() => page.locator(".pivot-table table td.is-conditional-red").count())
      .toBeGreaterThan(before);
    assertNoErrors(page);
  });

  // A rule is a way of painting numbers, not of choosing them, so applying one
  // must not go back to the server.
  test(`${path}: applying a rule costs no pivot request`, async ({ page }) => {
    await page.goto(path);
    await page.waitForSelector(".pivot-table table td");

    let requests = 0;
    page.on("request", request => {
      if (request.url().includes("/pivotforge/pivot")) {
        requests++;
      }
    });

    await addRule(page, { threshold: 0, operator: "greaterThan" });
    await expect(page.locator(".pivot-table table td.is-conditional-red").first()).toBeVisible();

    expect(requests).toBe(0);
  });

  test(`${path}: the threshold decides which cells are coloured`, async ({ page }) => {
    await page.goto(path);
    await page.waitForSelector(".pivot-table table td");

    // A threshold no amount reaches must colour nothing, or the rule is not
    // being evaluated at all.
    await addRule(page, { threshold: 999999999, color: "blue", operator: "greaterThan" });

    await expect(page.locator(".pivot-table table td.is-conditional-blue")).toHaveCount(0);
  });

  test(`${path}: clearing takes the highlight away again`, async ({ page }) => {
    await page.goto(path);
    await page.waitForSelector(".pivot-table table td");

    await addRule(page, { threshold: 0, color: "red", operator: "greaterThan" });
    await expect(page.locator(".pivot-table table td.is-conditional-red").first()).toBeVisible();

    await openPanel(page);
    await panel(page).locator("button.is-secondary").click();

    await expect(page.locator(".pivot-table table td.is-conditional-red")).toHaveCount(0);
  });

  test(`${path}: between reveals its second bound`, async ({ page }) => {
    await page.goto(path);
    await page.waitForSelector(".pivot-table table td");
    await openPanel(page);

    const bounds = panel(page).locator('input[type="number"]');
    await expect(bounds.nth(1)).toBeHidden();

    await panel(page).locator("select").selectOption("between");

    await expect(bounds.nth(1)).toBeVisible();
  });

  // Both sample pages declare a rule in markup, so "nothing was added" is a
  // count that did not move rather than a count of zero.
  test(`${path}: escape closes the panel without adding a rule`, async ({ page }) => {
    await page.goto(path);
    await page.waitForSelector(".pivot-table table td");
    const declared = await highlighted(page).count();
    expect(declared).toBeGreaterThan(0);
    await openPanel(page);

    await page.keyboard.press("Escape");

    await expect(panel(page)).toBeHidden();
    await expect(highlighted(page)).toHaveCount(declared);
  });

  test(`${path}: a blank threshold keeps the panel open rather than adding nothing`, async ({ page }) => {
    await page.goto(path);
    await page.waitForSelector(".pivot-table table td");
    const declared = await highlighted(page).count();
    await openPanel(page);

    await panel(page).locator('input[type="number"]').first().fill("");
    await panel(page).locator('button[type="submit"]').click();

    await expect(panel(page)).toBeVisible();
    await expect(highlighted(page)).toHaveCount(declared);
  });

  // A rule written in Razor and one added by the reader end up in the same
  // list, so adding must not discard what the markup declared.
  test(`${path}: a runtime rule joins the declared one rather than replacing it`, async ({ page }) => {
    await page.goto(path);
    await page.waitForSelector(".pivot-table table td");
    const declaredColor = await page.locator(".pivot-table table td.is-conditional-green").count();
    expect(declaredColor).toBeGreaterThan(0);

    await addRule(page, { threshold: 999999999, color: "blue", operator: "greaterThan" });

    await expect(page.locator(".pivot-table table td.is-conditional-green"))
      .toHaveCount(declaredColor);
  });
}

function assertNoErrors(page) {
  expect(page.errors ?? []).toEqual([]);
}

// The demo page hands its own detail modal to the renderer but not its own
// conditional panel, so it must get the packaged one too -- and its rules must
// survive the saved-view round trip the page performs itself.
test("/: the full demo uses the packaged panel", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".pivot-table table td");

  await openPanel(page);
  await panel(page).locator("select").selectOption("greaterThan");
  await panel(page).locator('input[type="number"]').first().fill("0");
  await panel(page).locator('input[type="radio"][value="amber"]').check();
  await panel(page).locator('button[type="submit"]').click();

  await expect(page.locator(".pivot-table table td.is-conditional-amber").first()).toBeVisible();
});
