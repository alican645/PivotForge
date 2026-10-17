const { test, expect } = require("@playwright/test");

// Excel's "Defer layout update": edits change the panel only, until Update.
// Built with its own designer so the demo's own grid stays as it is.
test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto("/Home/TagHelpers");
  await page.waitForSelector(".pivot-table__table td");

  await page.evaluate(async () => {
    for (const id of ["deferDesigner", "deferPivot"]) {
      const host = document.createElement("div");
      host.id = id;
      document.body.appendChild(host);
    }

    window.deferRequests = 0;
    const widget = PivotForge.create("#deferPivot", {
      fields: [
        { dataField: "Region", caption: "Bölge", area: "row" },
        { dataField: "Category", caption: "Kategori", area: "row" },
        { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
      ],
      autoLoad: false,
      fieldDesigner: "#deferDesigner",
      deferLayoutUpdate: true
    });
    widget.on("dataLoading", () => { window.deferRequests++; });
    await widget.refresh();
  });
  await page.waitForSelector("#deferPivot .pivot-table__table td");
});

const designer = page => page.locator("#deferDesigner");
const rowHeaders = page => page.locator("#deferPivot thead th").allTextContents();

test("a held-back edit reaches the grid only when Update is pressed", async ({ page }) => {
  const update = designer(page).locator(".pivot-designer-footer__update");
  await expect(designer(page).locator(".pivot-designer-footer__defer input")).toBeChecked();
  await expect(update).toBeDisabled();
  const before = await page.evaluate(() => window.deferRequests);

  await designer(page).locator('.pivot-zone[data-zone="row"] .pivot-chip[data-field="Category"] [data-action="remove"]').click();

  // The panel shows the edit; the grid has not asked for anything.
  await expect(designer(page).locator('.pivot-zone[data-zone="row"] .pivot-chip[data-field="Category"]')).toHaveCount(0);
  await expect(update).toBeEnabled();
  expect(await page.evaluate(() => window.deferRequests)).toBe(before);
  expect((await rowHeaders(page)).join("|")).toContain("Kategori");

  await update.click();
  await expect(update).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.deferRequests)).toBe(before + 1);
  await expect.poll(async () => (await rowHeaders(page)).join("|")).not.toContain("Kategori");
  expect(page.errors).toEqual([]);
});
