const { test, expect } = require("@playwright/test");

// A value's text: the format's short form, and a page function by name that
// has the last word. Built into a scratch container so the demo grid keeps
// its own look.
const PAGE = "/Home/TagHelpers";

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table__table td");

  await page.evaluate(async () => {
    window.scratchTexts = { amount: ({ valueText }) => `${valueText} ✓` };
    const host = document.createElement("div");
    host.id = "textPivot";
    document.body.appendChild(host);
    const widget = PivotForge.create(host, {
      fields: [
        { dataField: "Region", caption: "Bölge", area: "row" },
        { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum",
          format: { compact: true }, customizeText: "scratchTexts.amount" },
        { dataField: "Quantity", caption: "Miktar", area: "data", aggregation: "sum" }
      ],
      autoLoad: false,
      rendererOptions: { culture: "tr-TR" }
    });
    await widget.refresh();
  });
  await page.waitForSelector("#textPivot .pivot-table__table td");
});

test("a short-form value runs through the page's customizeText; the other value is untouched", async ({ page }) => {
  const columnOf = async key => page.locator(`#textPivot .pivot-table__value-header[data-value-key="${key}"]`)
    .first().evaluate(cell => cell.dataset.columnIndex);
  const texts = async key => page.locator(`#textPivot tbody td[data-column-index="${await columnOf(key)}"]`)
    .allTextContents();

  const amounts = await texts("Amount_sum");
  expect(amounts.length).toBeGreaterThan(0);
  for (const text of amounts) {
    // Short form ("1,2 Mn", "950 B") and then the page's mark.
    expect(text).toMatch(/^\(?[\d.,]+\s?(B|Mn|Mr)?\)? ✓$/);
  }
  expect(amounts.some(text => /(B|Mn|Mr) ✓$/.test(text))).toBe(true);

  for (const text of await texts("Quantity_sum")) {
    expect(text).not.toContain("✓");
  }
  expect(page.errors).toEqual([]);
});
