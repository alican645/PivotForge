const { test, expect } = require("@playwright/test");

// The designer used HTML5 drag-and-drop, which never fires on a touch device,
// so it was unusable on a tablet or a phone. These run in a touch-enabled
// context and drive real PointerEvents with pointerType "touch".
test.use({ hasTouch: true, viewport: { width: 900, height: 900 } });

const PAGE = "/Home/TagHelpers";
const zoneBody = area => `[data-zone="${area}"] .pivot-zone__body`;
const chipIn = (area, field) => `${zoneBody(area)} .pivot-chip[data-field="${field}"]`;
const availableChip = field => `.pivot-field-list .pivot-chip[data-field="${field}"]`;

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-zone__body .pivot-chip");
});

// Drives a finger drag from `from` (optionally its grip) to the centre of `to`.
// Pointer capture means every event after the press belongs to the source, so
// they are all dispatched there — exactly as a browser would deliver them.
async function touchDrag(page, { from, grip = true, to, offsetY = 0 }) {
  await page.evaluate(async ({ from, grip, to, offsetY }) => {
    const chip = document.querySelector(from);
    const target = document.querySelector(to);
    // The press has to originate on the grip itself, not merely inside the
    // chip: the grip is what carries touch-action, and the designer reads the
    // event's own target to decide whether a finger may start a drag.
    const source = grip ? chip.querySelector(".pivot-chip__grip") : chip;
    const start = source.getBoundingClientRect();
    const end = target.getBoundingClientRect();
    const at = (x, y) => ({
      pointerId: 11, pointerType: "touch", isPrimary: true, button: 0, buttons: 1,
      clientX: x, clientY: y, bubbles: true, cancelable: true
    });
    const startX = start.left + start.width / 2;
    const startY = start.top + start.height / 2;
    const endX = end.left + end.width / 2;
    // Offset lets a test aim at a half rather than a midpoint: releasing exactly
    // on a chip's centre line is the boundary between "before it" and "after
    // it", which is no place to assert a reorder from.
    const endY = end.top + end.height / 2 + offsetY;

    source.dispatchEvent(new PointerEvent("pointerdown", at(startX, startY)));
    // Two moves: the first crosses the drag threshold, the second lands.
    source.dispatchEvent(new PointerEvent("pointermove", at(startX, startY + 12)));
    source.dispatchEvent(new PointerEvent("pointermove", at(endX, endY)));
    source.dispatchEvent(new PointerEvent("pointerup", at(endX, endY)));
  }, { from, grip, to, offsetY });
}

test("the grip is the only part of a chip that takes the gesture from the browser", async ({ page }) => {
  const chip = page.locator(chipIn("row", "Region"));

  const chipTouchAction = await chip.evaluate(node => getComputedStyle(node).touchAction);
  const gripTouchAction = await chip.locator(".pivot-chip__grip")
    .evaluate(node => getComputedStyle(node).touchAction);

  // A finger on the chip body still scrolls the panel; only the grip drags.
  expect(chipTouchAction).toBe("auto");
  expect(gripTouchAction).toBe("none");
});

test("a finger drag from the grip places an available field", async ({ page }) => {
  await expect(page.locator(chipIn("row", "Quarter"))).toHaveCount(0);

  await touchDrag(page, { from: availableChip("Quarter"), to: zoneBody("row") });

  await expect(page.locator(chipIn("row", "Quarter"))).toHaveCount(1);
  expect(page.errors).toEqual([]);
});

test("a finger drag from the chip body moves nothing, so the list stays scrollable", async ({ page }) => {
  await touchDrag(page, { from: availableChip("Quarter"), grip: false, to: zoneBody("row") });

  await expect(page.locator(chipIn("row", "Quarter"))).toHaveCount(0);
  await expect(page.locator(availableChip("Quarter"))).toHaveCount(1);
  expect(page.errors).toEqual([]);
});

test("a finger can reorder within a zone", async ({ page }) => {
  const before = await page.locator(`${zoneBody("row")} .pivot-chip`).evaluateAll(
    nodes => nodes.map(node => node.dataset.field));
  expect(before).toEqual(["Region", "Category"]);

  // Above Region's centre line: "insert before Region".
  await touchDrag(page, {
    from: chipIn("row", "Category"), to: chipIn("row", "Region"), offsetY: -6
  });

  const after = await page.locator(`${zoneBody("row")} .pivot-chip`).evaluateAll(
    nodes => nodes.map(node => node.dataset.field));
  expect(after).toEqual(["Category", "Region"]);
});

test("a finger can drag a placed field back to the available list", async ({ page }) => {
  await touchDrag(page, { from: chipIn("row", "Category"), to: ".pivot-field-list" });

  await expect(page.locator(chipIn("row", "Category"))).toHaveCount(0);
  await expect(page.locator(availableChip("Category"))).toHaveCount(1);
});

test("a finger drag of a measure into a dimension zone is refused, as with a mouse", async ({ page }) => {
  await touchDrag(page, { from: availableChip("Quantity"), to: zoneBody("row") });

  await expect(page.locator(chipIn("row", "Quantity"))).toHaveCount(0);
  expect(page.errors).toEqual([]);
});

test("tapping a chip control still works and does not start a drag", async ({ page }) => {
  await expect(page.locator(chipIn("row", "Category"))).toHaveCount(1);

  await page.locator(`${chipIn("row", "Category")} [data-action="remove"]`).tap();

  await expect(page.locator(chipIn("row", "Category"))).toHaveCount(0);
  expect(page.errors).toEqual([]);
});

test("the grip is a comfortable target on a coarse pointer", async ({ page }) => {
  const box = await page.locator(`${chipIn("row", "Region")} .pivot-chip__grip`).boundingBox();

  // WCAG 2.2 target-size minimum.
  expect(box.width).toBeGreaterThanOrEqual(24);
  expect(box.height).toBeGreaterThanOrEqual(24);
});
