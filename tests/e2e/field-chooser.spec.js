const { test, expect } = require("@playwright/test");

// DevExtreme's field chooser popup: the field designer in a dialog on the
// grid's own layout, its three layouts, the "All fields" checkboxes, OK and
// Cancel, and a field button's menu.
const FIELDS = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  { dataField: "Year", caption: "Yıl", area: "column" },
  { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" },
  { dataField: "Category", caption: "Kategori", area: "available", role: "dimension" },
  { dataField: "Quantity", caption: "Adet", area: "available", role: "measure", displayFolder: "Ölçüler" }
];

const dialog = ".pivot-field-chooser";
const box = field => `${dialog} [data-zone="available"] .pivot-chip[data-field="${field}"] [data-action="place"]`;

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto("/Home/TagHelpers");
  await page.waitForSelector(".pivot-table__table td");
});

test.afterEach(async ({ page }) => {
  expect(page.errors).toEqual([]);
});

async function build(page, fieldChooser) {
  await page.evaluate(async ({ fields, fieldChooser }) => {
    document.querySelector("#chooserHost")?.remove();
    const host = document.createElement("div");
    host.id = "chooserHost";
    document.body.prepend(host);
    window.chooserWidget = PivotForge.create(host, { fields, fieldChooser, toolbar: ["fieldChooser"], locale: "tr", autoLoad: false });
    await window.chooserWidget.refresh();
  }, { fields: FIELDS, fieldChooser });
  await page.waitForSelector("#chooserHost .pivot-table__table td");
}

const request = page => page.evaluate(() => window.chooserWidget.request);

test("the toolbar opens it, and a ticked field reaches the grid at once", async ({ page }) => {
  await build(page, true);

  await page.locator('[data-toolbar-item="fieldChooser"]').click();
  await expect(page.locator(dialog)).toBeVisible();
  await expect(page.locator(`${dialog} .pivot-field-chooser__title`)).toHaveText("Alan seçici");
  await expect(page.locator(`${dialog} .pivot-section__head`)).toHaveText("Tüm alanlar");
  // Placed fields are listed too, ticked.
  await expect(page.locator(box("Region"))).toBeChecked();

  await page.locator(box("Category")).check();
  await expect.poll(async () => (await request(page)).columns).toContain("Category");
  // The redraw replaced the box; focus is back on the field, inside the dialog.
  expect(await page.evaluate(() => document.activeElement?.closest(".pivot-chip")?.dataset.field)).toBe("Category");
  await page.locator(box("Quantity")).check();
  await expect.poll(async () => (await request(page)).values.map(value => value.field)).toContain("Quantity");

  await page.locator(`${dialog} [data-action="close"]`).click();
  await expect(page.locator(dialog)).toHaveCount(0);
});

test("on demand, Cancel puts the layout back and OK applies it", async ({ page }) => {
  await build(page, { applyChangesMode: "onDemand" });
  const before = await request(page);

  await page.evaluate(() => window.chooserWidget.showFieldChooser());
  await page.locator(box("Category")).check();
  // Held back: the grid still asks for what it did.
  expect((await request(page)).columns).toEqual(before.columns);
  await page.locator(`${dialog} [data-action="cancel"]`).click();
  await expect(page.locator(dialog)).toHaveCount(0);

  await page.evaluate(() => window.chooserWidget.showFieldChooser());
  // Reopened on the layout as it was.
  await expect(page.locator(box("Category"))).not.toBeChecked();
  await page.locator(box("Category")).check();
  await page.locator(`${dialog} [data-action="ok"]`).click();
  await expect(page.locator(dialog)).toHaveCount(0);
  await expect.poll(async () => (await request(page)).columns).toContain("Category");

  // Escape is Cancel.
  await page.evaluate(() => window.chooserWidget.showFieldChooser());
  await page.locator(box("Quantity")).check();
  await page.keyboard.press("Escape");
  await expect(page.locator(dialog)).toHaveCount(0);
  expect((await request(page)).values.map(value => value.field)).not.toContain("Quantity");
});

test("the cell menu offers it", async ({ page }) => {
  await build(page, true);

  await page.locator("#chooserHost tbody td.pivot-table__value").first().click({ button: "right" });
  await page.locator(".pivot-cell-menu__item", { hasText: "Alan seçiciyi göster" }).click();
  await expect(page.locator(dialog)).toBeVisible();
});

test("each layout puts the list and the zones where DevExtreme does", async ({ page }) => {
  const boxes = async layout => {
    await build(page, { layout });
    await page.evaluate(() => window.chooserWidget.showFieldChooser());
    const rects = await page.evaluate(() => Object.fromEntries(
      ["available", "filter", "row", "column", "data"].map(zone => {
        const rect = document.querySelector(`.pivot-field-chooser [data-zone="${zone}"]`).getBoundingClientRect();
        return [zone, { left: rect.left, top: rect.top, bottom: rect.bottom }];
      })));
    await page.evaluate(() => window.chooserWidget.hideFieldChooser());
    return rects;
  };

  const zero = await boxes(0);
  expect(zero.row.left).toBeGreaterThan(zero.available.left);
  expect(zero.column.top).toBeGreaterThan(zero.row.top);
  expect(zero.filter.top).toBeGreaterThanOrEqual(zero.available.bottom - 1);

  const one = await boxes(1);
  expect(one.filter.left).toBeGreaterThan(one.available.left);
  expect(one.data.top).toBeGreaterThan(one.column.top);

  const two = await boxes(2);
  expect(two.filter.top).toBeGreaterThanOrEqual(two.available.bottom - 1);
  expect(two.column.left).toBeGreaterThan(two.filter.left);
  expect(two.row.top).toBeGreaterThan(two.filter.top);
});

test("on a phone the dialog fits the screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await build(page, true);
  await page.evaluate(() => window.chooserWidget.showFieldChooser());

  const overflow = await page.evaluate(() => {
    const dialogBox = document.querySelector(".pivot-field-chooser__dialog").getBoundingClientRect();
    return { right: dialogBox.right, width: window.innerWidth, scroll: document.documentElement.scrollWidth };
  });
  expect(overflow.right).toBeLessThanOrEqual(overflow.width);
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.width);
});

test("a field button's menu shows what contextMenuPreparing adds", async ({ page }) => {
  await build(page, true);
  await page.evaluate(() => {
    window.chooserWidget.on("contextMenuPreparing", event => {
      if (event.field) {
        event.items.push({ label: "Alan hakkında", onClick: picked => { window.aboutField = picked.field.dataField; } });
      }
    });
    window.chooserWidget.showFieldChooser();
  });

  await page.locator(`${dialog} [data-zone="row"] .pivot-chip[data-field="Region"]`).click({ button: "right" });
  await page.locator(".pivot-cell-menu__item", { hasText: "Alan hakkında" }).click();
  expect(await page.evaluate(() => window.aboutField)).toBe("Region");
});

test("the page's designer follows what the chooser changes", async ({ page }) => {
  await page.evaluate(async fields => {
    for (const id of ["chooserDesigner", "chooserHost"]) {
      document.getElementById(id)?.remove();
      const host = document.createElement("div");
      host.id = id;
      document.body.prepend(host);
    }
    window.chooserWidget = PivotForge.create("#chooserHost", {
      fields, fieldChooser: true, fieldDesigner: "#chooserDesigner", locale: "tr", autoLoad: false
    });
    await window.chooserWidget.refresh();
    window.chooserWidget.showFieldChooser();
  }, FIELDS);

  await page.locator(box("Category")).check();
  await expect(page.locator('#chooserDesigner [data-zone="column"] .pivot-chip[data-field="Category"]')).toHaveCount(1);
});
