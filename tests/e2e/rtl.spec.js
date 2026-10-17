const { test, expect } = require("@playwright/test");

// Right to left: declared with rtlEnabled, or inherited from the page.
test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto("/Home/TagHelpers");
  await page.waitForSelector(".pivot-table__table td");
});

async function build(page, options = {}) {
  await page.evaluate(async options => {
    document.querySelectorAll("#rtlHost, #rtlDesigner").forEach(node => node.remove());
    const host = document.createElement("div");
    host.id = "rtlHost";
    host.style.width = "600px";
    // First on the page, so every pointer gesture lands inside the viewport.
    document.body.prepend(host);
    if (options.designer) {
      const designer = document.createElement("div");
      designer.id = "rtlDesigner";
      document.body.appendChild(designer);
    }

    window.rtlWidget = PivotForge.create(host, {
      autoLoad: false,
      allowFiltering: true,
      allowExcelExport: true,
      ...(options.rtlEnabled === undefined ? {} : { rtlEnabled: options.rtlEnabled }),
      ...(options.designer ? { fieldDesigner: "#rtlDesigner" } : {}),
      fields: [
        { dataField: "Region", caption: "Bölge", area: "row" },
        { dataField: "SalesPerson", caption: "Satışçı", area: "column" },
        { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
      ]
    });
    await window.rtlWidget.refresh();
  }, options);
  await page.waitForSelector("#rtlHost .pivot-table__table td");
}

// Where the first body row's region header sits, against the grid's box.
async function headerSide(page) {
  return page.evaluate(() => {
    const host = document.querySelector("#rtlHost");
    const header = host.querySelector("tbody .pivot-table__row-header, tbody .pivot-table__subtotal-header");
    const hostRect = host.getBoundingClientRect();
    const rect = header.getBoundingClientRect();
    return {
      fromLeft: Math.round(rect.left - hostRect.left),
      fromRight: Math.round(hostRect.right - rect.right)
    };
  });
}

test("a declared RTL grid freezes its row headers on the right, and they stay there when scrolled", async ({ page }) => {
  await build(page, { rtlEnabled: true });

  await expect(page.locator("#rtlHost")).toHaveAttribute("dir", "rtl");
  let side = await headerSide(page);
  expect(side.fromRight).toBeLessThan(4);

  // Scrolled towards the far (left) end, the frozen headers do not move.
  await page.evaluate(() => { document.querySelector("#rtlHost").scrollLeft = -10000; });
  side = await headerSide(page);
  expect(side.fromRight).toBeLessThan(4);
  expect(page.errors).toEqual([]);
});

test("a page that reads right to left mirrors the grid without a declaration, and false pins it", async ({ page }) => {
  await page.evaluate(() => { document.documentElement.dir = "rtl"; });
  await build(page);
  expect((await headerSide(page)).fromRight).toBeLessThan(4);

  await build(page, { rtlEnabled: false });
  await expect(page.locator("#rtlHost")).toHaveAttribute("dir", "ltr");
  expect((await headerSide(page)).fromLeft).toBeLessThan(4);
});

test("the arrow keys move the way they point", async ({ page }) => {
  await build(page, { rtlEnabled: true });
  const cells = page.locator("#rtlHost tbody tr").first().locator("td[data-selection-target='cell']");
  const first = await cells.nth(0).boundingBox();

  await cells.nth(0).click();
  await page.keyboard.press("ArrowLeft");
  const focused = await page.evaluate(() => document.activeElement.getBoundingClientRect().left);

  // The next column is to the left on screen.
  expect(focused).toBeLessThan(first.x);
});

test("dragging a column's resize handle away from the column widens it", async ({ page }) => {
  await build(page, { rtlEnabled: true });
  // A value column's header: the one that carries a handle once the row headers' does.
  const header = page.locator("#rtlHost thead th:has(.pivot-table__resize-handle)").last();
  const before = (await header.boundingBox()).width;
  const handle = await header.locator(".pivot-table__resize-handle").boundingBox();

  // The handle is on the column's left edge in RTL.
  expect(handle.x).toBeLessThan((await header.boundingBox()).x + 10);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x - 60, handle.y + handle.height / 2, { steps: 5 });
  await page.mouse.up();

  expect((await header.boundingBox()).width).toBeGreaterThan(before + 40);
});

test("the filter picker opens right to left under its funnel, and the export is a right-to-left sheet", async ({ page }) => {
  await build(page, { rtlEnabled: true });
  const funnel = page.locator("#rtlHost thead .pivot-table__filter-button").first();
  await funnel.click();
  const dialog = page.locator(".pivot-filter-picker__dialog").last();
  await expect(dialog).toBeVisible();

  const [funnelBox, dialogBox] = [await funnel.boundingBox(), await dialog.boundingBox()];
  await expect(page.locator(".pivot-filter-picker.is-open")).toHaveAttribute("dir", "rtl");
  // Its right edge lines up with the funnel's.
  expect(Math.abs(dialogBox.x + dialogBox.width - (funnelBox.x + funnelBox.width))).toBeLessThan(2);
  await page.keyboard.press("Escape");

  const model = await page.evaluate(() => window.rtlWidget.renderer.getExcelExportModel({}));
  expect(model.rightToLeft).toBe(true);
  expect(page.errors).toEqual([]);
});

test("the designer mirrors, and a grabbed chip moves the way the arrow points", async ({ page }) => {
  await build(page, { rtlEnabled: true, designer: true });
  await expect(page.locator("#rtlDesigner")).toHaveAttribute("dir", "rtl");

  const filters = await page.locator('#rtlDesigner .pivot-zone[data-zone="filter"]').boundingBox();
  const columns = await page.locator('#rtlDesigner .pivot-zone[data-zone="column"]').boundingBox();
  // Filters sit to the right of Columns.
  expect(filters.x).toBeGreaterThan(columns.x);

  // So ArrowRight carries a column chip into Filters.
  await page.locator('#rtlDesigner .pivot-chip[data-field="SalesPerson"]').focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.locator('#rtlDesigner .pivot-zone[data-zone="filter"] .pivot-chip[data-field="SalesPerson"]'))
    .toHaveCount(1);
  expect(page.errors).toEqual([]);
});
