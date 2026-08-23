const { test, expect } = require("@playwright/test");

// The declarative demo opens with Region and Category as row fields, which is
// what puts a funnel on the table's own header.
const PAGE = "/Home/TagHelpers";

const funnel = field => `.pivot-table__corner [data-action="header-filter"][data-field="${field}"]`;
const picker = ".pivot-filter-picker.is-open";
const pickerValue = `${picker} .pivot-filter-picker__value`;
const zoneBody = area => `[data-zone="${area}"] .pivot-zone__body`;
const chipIn = (area, field) => `${zoneBody(area)} .pivot-chip[data-field="${field}"]`;
const availableChip = field => `.pivot-field-list .pivot-chip[data-field="${field}"]`;

// Every pivot request the page makes; /field-values is what fills the picker
// rather than a pivot, so it is left out.
function trackRequests(page) {
  const requests = [];
  page.on("request", request => {
    if (request.method() === "POST" && request.url().includes("/pivotforge/") &&
      !request.url().includes("/field-values")) {
      requests.push(request.postDataJSON());
    }
  });
  return requests;
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table tbody tr");
});

test("every row field's header carries a funnel", async ({ page }) => {
  await expect(page.locator(funnel("Region"))).toHaveCount(1);
  await expect(page.locator(funnel("Category"))).toHaveCount(1);
  // Nothing is filtered yet, so no funnel claims otherwise.
  await expect(page.locator(funnel("Region"))).not.toHaveClass(/is-active/);
  // The funnel stands beside the sort button rather than replacing it.
  await expect(page.locator(".pivot-table__corner .pivot-table__sort-button").first())
    .toBeVisible();
});

test("filtering from the header reaches the request and marks the funnel", async ({ page }) => {
  const requests = trackRequests(page);

  await page.locator(funnel("Region")).click();
  await expect(page.locator(pickerValue).first()).toBeVisible();
  const values = await page.locator(`${pickerValue} span`).allTextContents();
  await page.locator(`${pickerValue} input`).nth(0).uncheck();
  await page.locator(`${picker} [data-action="filter-apply"]`).click();

  await expect.poll(() => requests.at(-1)?.filters).toEqual([
    { field: "Region", values: values.slice(1), mode: "Include" }
  ]);
  await expect(page.locator(funnel("Region"))).toHaveClass(/is-active/);
  // The field is filtered where it stands: it stays a row field and gains no
  // second chip in the Filters zone.
  await expect(page.locator(chipIn("row", "Region"))).toHaveCount(1);
  await expect(page.locator(chipIn("filter", "Region"))).toHaveCount(0);
  expect(page.errors).toEqual([]);
});

test("a header filter survives a drag in the designer", async ({ page }) => {
  const requests = trackRequests(page);

  await page.locator(funnel("Region")).click();
  await expect(page.locator(pickerValue).first()).toBeVisible();
  await page.locator(`${picker} [data-action="filter-mode"][data-mode="Exclude"]`).click();
  await page.locator(`${pickerValue} input`).nth(0).uncheck();
  const excluded = await page.locator(`${pickerValue} span`).nth(0).textContent();
  await page.locator(`${picker} [data-action="filter-apply"]`).click();
  await expect.poll(() => requests.at(-1)?.filters)
    .toEqual([{ field: "Region", values: [excluded], mode: "Exclude" }]);

  // The designer sends the layout state's filters with every edit, so this is
  // where a header filter kept outside that state would disappear.
  await page.dragAndDrop(availableChip("Quarter"), zoneBody("row"));
  await expect(page.locator(chipIn("row", "Quarter"))).toHaveCount(1);

  await expect.poll(() => requests.at(-1)?.filters)
    .toEqual([{ field: "Region", values: [excluded], mode: "Exclude" }]);
  await expect(page.locator(funnel("Region"))).toHaveClass(/is-active/);
  expect(page.errors).toEqual([]);
});

test("reopening the header picker shows the filter already in force", async ({ page }) => {
  await page.locator(funnel("Region")).click();
  await expect(page.locator(pickerValue).first()).toBeVisible();
  const count = await page.locator(pickerValue).count();
  await page.locator(`${pickerValue} input`).nth(0).uncheck();
  await page.locator(`${picker} [data-action="filter-apply"]`).click();
  await expect(page.locator(picker)).toHaveCount(0);

  await page.locator(funnel("Region")).click();
  await expect(page.locator(pickerValue)).toHaveCount(count);

  const checked = await page.locator(`${pickerValue} input`).evaluateAll(
    boxes => boxes.map(box => box.checked));
  expect(checked[0]).toBe(false);
  expect(checked.slice(1).every(Boolean)).toBe(true);
});

test("a filtered row field dragged into the Filters zone keeps its selection", async ({ page }) => {
  await page.locator(funnel("Region")).click();
  await expect(page.locator(pickerValue).first()).toBeVisible();
  await page.locator(`${pickerValue} input`).nth(0).uncheck();
  const remaining = await page.locator(pickerValue).count() - 1;
  await page.locator(`${picker} [data-action="filter-apply"]`).click();

  await page.dragAndDrop(chipIn("row", "Region"), zoneBody("filter"));

  await expect(page.locator(`${chipIn("filter", "Region")} .pivot-chip__filter-count`))
    .toHaveText(`(${remaining})`);
  await expect(page.locator(funnel("Region"))).toHaveCount(0);
  expect(page.errors).toEqual([]);
});

// The funnel's capability guard has no way in through the demo page, which
// always enables filtering — so this drives PivotTableRenderer directly, the
// way a host rendering through its own renderer options would.
test("the funnel is drawn only where there is a handler and a field", async ({ page }) => {
  const counts = await page.evaluate(async () => {
    // A real result rather than a fabricated one, so this test cannot pass
    // against a shape the renderer never actually receives.
    const declared = [
      { dataField: "Region", caption: "Bölge", area: "row" },
      { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
    ];
    const request = PivotForge.PivotRequestBuilder.buildRequest(declared);
    const response = await fetch("/pivotforge/pivot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, sourceRowCount: 1000 })
    });
    const result = await response.json();
    const key = PivotForge.PivotRequestBuilder.valueKey(
      declared.find(field => field.area === "data"));

    const draw = options => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      new PivotForge.PivotTableRenderer(host, {
        rowFields: ["Region"],
        rowFieldLabels: ["Bölge"],
        values: [{ key, label: "Tutar" }],
        ...options
      }).render(result);
      return host.querySelectorAll('[data-action="header-filter"]').length;
    };

    return {
      rows: result.rowHeaders?.length ?? 0,
      wired: draw({ onFilterRequested: () => {} }),
      withoutHandler: draw({}),
      withoutField: draw({ rowFields: [], rowFieldLabels: [], onFilterRequested: () => {} })
    };
  });

  expect(counts).toEqual({ rows: counts.rows, wired: 1, withoutHandler: 0, withoutField: 0 });
  expect(counts.rows).toBeGreaterThan(0);
  expect(page.errors).toEqual([]);
});
