const { test, expect } = require("@playwright/test");

// The designer's Σ Values chip moves several values between the columns and
// the rows, and the move is kept with the view.
const KEY = "pivotforge:state:valuesChipPivot";

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto("/Home/TagHelpers");
  await page.waitForSelector(".pivot-table__table td");
  await page.evaluate(key => localStorage.removeItem(key), KEY);
});

async function build(page, rendererOptions = {}) {
  await page.evaluate(async rendererOptions => {
    document.querySelectorAll("#valuesChipDesigner, #valuesChipPivot").forEach(node => node.remove());
    for (const id of ["valuesChipDesigner", "valuesChipPivot"]) {
      const host = document.createElement("div");
      host.id = id;
      document.body.appendChild(host);
    }

    window.valuesChipWidget = PivotForge.create("#valuesChipPivot", {
      fields: [
        { dataField: "Region", caption: "Bölge", area: "row" },
        { dataField: "Year", caption: "Yıl", area: "column" },
        { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" },
        { dataField: "Quantity", caption: "Miktar", area: "data", aggregation: "sum" }
      ],
      autoLoad: false,
      fieldDesigner: "#valuesChipDesigner",
      stateStoring: "local",
      rendererOptions
    });
    await window.valuesChipWidget.refresh();
  }, rendererOptions);
  await page.waitForSelector("#valuesChipPivot .pivot-table__table td");
}

const sigma = page => page.locator('#valuesChipDesigner .pivot-chip--values');
const measureHeaders = page => page.locator("#valuesChipPivot .pivot-table__measure-row-header");

test("dragging Σ Values onto Rows draws the values down the rows, and a reload keeps it", async ({ page }) => {
  await build(page);
  await expect(page.locator('#valuesChipDesigner .pivot-zone[data-zone="column"] .pivot-chip--values')).toHaveCount(1);
  await expect(measureHeaders(page)).toHaveCount(0);

  await sigma(page).locator(".pivot-chip__grip")
    .dragTo(page.locator('#valuesChipDesigner .pivot-zone[data-zone="row"] .pivot-zone__body'));

  await expect(page.locator('#valuesChipDesigner .pivot-zone[data-zone="row"] .pivot-chip--values')).toHaveCount(1);
  await expect(measureHeaders(page).first()).toHaveText("Tutar");

  // A new grid on the same key opens the way it was left.
  await build(page);
  await expect(page.locator('#valuesChipDesigner .pivot-zone[data-zone="row"] .pivot-chip--values')).toHaveCount(1);
  await expect(measureHeaders(page).first()).toHaveText("Tutar");
  expect(page.errors).toEqual([]);
});

test("the Σ chip moves back to the columns with the keyboard", async ({ page }) => {
  await build(page);
  await sigma(page).locator(".pivot-chip__grip")
    .dragTo(page.locator('#valuesChipDesigner .pivot-zone[data-zone="row"] .pivot-zone__body'));
  await expect(measureHeaders(page).first()).toHaveText("Tutar");

  await sigma(page).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");

  await expect(page.locator('#valuesChipDesigner .pivot-zone[data-zone="column"] .pivot-chip--values')).toHaveCount(1);
  await expect(measureHeaders(page)).toHaveCount(0);
  await expect(page.locator("#valuesChipPivot .pivot-table__value-header").first()).toBeVisible();
  expect(page.errors).toEqual([]);
});

test("a page declaring rows still remembers a reader who moved the values back", async ({ page }) => {
  await build(page, { valuesPosition: "rows" });
  await expect(page.locator('#valuesChipDesigner .pivot-zone[data-zone="row"] .pivot-chip--values')).toHaveCount(1);
  await expect(measureHeaders(page).first()).toHaveText("Tutar");

  await sigma(page).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(measureHeaders(page)).toHaveCount(0);

  await build(page, { valuesPosition: "rows" });
  await expect(page.locator('#valuesChipDesigner .pivot-zone[data-zone="column"] .pivot-chip--values')).toHaveCount(1);
  await expect(measureHeaders(page)).toHaveCount(0);
  expect(page.errors).toEqual([]);
});
