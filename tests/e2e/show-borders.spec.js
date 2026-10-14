const { test, expect } = require("@playwright/test");

// show-borders, built into scratch containers so the demo grid keeps its look:
// true frames the grid, false clears the body lines but keeps the header's.
const PAGE = "/Home/TagHelpers";

const FIELDS = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  { dataField: "Year", caption: "Yıl", area: "column" },
  { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
];

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table__table td");

  await page.evaluate(async fields => {
    for (const [id, showBorders] of [["framedPivot", true], ["plainPivot", false], ["defaultPivot", null]]) {
      const host = document.createElement("div");
      host.id = id;
      document.body.appendChild(host);
      const widget = PivotForge.create(host, { fields, autoLoad: false, rendererOptions: { showBorders } });
      await widget.refresh();
    }
  }, FIELDS);
  await page.waitForSelector("#defaultPivot .pivot-table__table td");
});

const style = (page, selector, property) =>
  page.locator(selector).first().evaluate((element, name) => getComputedStyle(element)[name], property);

test("show-borders frames the grid, clears the body lines, or leaves the default", async ({ page }) => {
  await expect(page.locator("#framedPivot .pivot-table__table")).toHaveClass(/is-bordered/);
  expect(await style(page, "#framedPivot .pivot-table__table", "borderTopWidth")).toBe("1px");
  expect(await style(page, "#framedPivot .pivot-table__table", "borderLeftWidth")).toBe("1px");

  await expect(page.locator("#plainPivot .pivot-table__table")).toHaveClass(/is-borderless/);
  expect(await style(page, "#plainPivot tbody td", "borderBottomColor")).toBe("rgba(0, 0, 0, 0)");
  expect(await style(page, "#plainPivot tbody td", "borderRightColor")).toBe("rgba(0, 0, 0, 0)");
  // The header keeps its lines, and no cell changes size for the lines it lost.
  expect(await style(page, "#plainPivot thead th", "borderBottomColor")).not.toBe("rgba(0, 0, 0, 0)");
  expect(await style(page, "#plainPivot tbody td", "borderBottomWidth")).toBe("1px");

  const table = page.locator("#defaultPivot .pivot-table__table");
  await expect(table).not.toHaveClass(/is-bordered|is-borderless/);
  expect(await style(page, "#defaultPivot .pivot-table__table", "borderTopWidth")).toBe("0px");
  expect(await style(page, "#defaultPivot tbody td", "borderBottomColor")).not.toBe("rgba(0, 0, 0, 0)");
  expect(page.errors).toEqual([]);
});
