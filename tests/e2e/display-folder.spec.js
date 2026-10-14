const { test, expect } = require("@playwright/test");

// display-folder groups the field list under folder headings that open and
// close. Built with its own designer so the demo's field list stays as it is.
const PAGE = "/Home/TagHelpers";

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table__table td");

  await page.evaluate(async () => {
    for (const id of ["folderDesigner", "folderPivot"]) {
      const host = document.createElement("div");
      host.id = id;
      document.body.appendChild(host);
    }

    const widget = PivotForge.create("#folderPivot", {
      fields: [
        { dataField: "Region", caption: "Bölge", area: "row", displayFolder: "Müşteri" },
        { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum", displayFolder: "Satış" },
        { dataField: "Category", caption: "Kategori", area: "available", role: "dimension" },
        { dataField: "Quantity", caption: "Miktar", area: "available", role: "measure", displayFolder: "Satış" },
        { dataField: "Discount", caption: "İskonto", area: "available", role: "measure", displayFolder: "Satış" },
        { dataField: "SalesPerson", caption: "Satış Temsilcisi", area: "available", role: "dimension", displayFolder: "Müşteri" }
      ],
      autoLoad: false,
      fieldDesigner: "#folderDesigner"
    });
    await widget.refresh();
  });
  await page.waitForSelector("#folderDesigner .pivot-field-folder");
});

const list = page => page.locator("#folderDesigner .pivot-field-list");
const folder = (page, name) => list(page).locator(`.pivot-field-folder[data-folder="${name}"]`);
const chip = (page, field) => list(page).locator(`.pivot-chip[data-field="${field}"]`);

test("fields are listed under their folders, which close and open", async ({ page }) => {
  // Loose fields first, then each folder with its fields under it.
  const order = await list(page).locator(":scope > *").evaluateAll(nodes => nodes.map(node =>
    node.dataset.folder ? `[${node.dataset.folder}]` : node.dataset.field));
  expect(order).toEqual(["Category", "[Satış]", "Quantity", "Discount", "[Müşteri]", "SalesPerson"]);

  await expect(folder(page, "Satış")).toHaveAttribute("aria-expanded", "true");
  await folder(page, "Satış").click();
  await expect(folder(page, "Satış")).toHaveAttribute("aria-expanded", "false");
  await expect(chip(page, "Quantity")).toHaveCount(0);
  await expect(chip(page, "SalesPerson")).toHaveCount(1);

  await folder(page, "Satış").click();
  await expect(chip(page, "Quantity")).toHaveCount(1);
  expect(page.errors).toEqual([]);
});

test("a search opens a closed folder to show what matches", async ({ page }) => {
  await folder(page, "Satış").click();
  await page.locator('#folderDesigner [data-action="search"]').fill("Mik");

  await expect(chip(page, "Quantity")).toHaveCount(1);
  await expect(chip(page, "Discount")).toHaveCount(0);
  expect(page.errors).toEqual([]);
});
