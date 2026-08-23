const { test, expect } = require("@playwright/test");

const PAGE = "/Home/TagHelpers";

// The demo's source record carries CustomerEmail; Program.cs leaves it off the
// allow-list. Everything below asks for it one way or another.
const HIDDEN = "CustomerEmail";

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table tbody tr");
});

const post = (page, path, body) => page.evaluate(async ([path, body]) => {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.text() };
}, [path, body]);

test("a field the application did not list cannot be pivoted on", async ({ page }) => {
  const refused = await post(page, "/pivotforge/pivot", {
    rows: [HIDDEN],
    values: [{ field: "Amount", aggregation: "sum" }]
  });

  expect(refused.status).toBe(400);
  // The refusal must not confirm the field exists.
  expect(refused.body).not.toContain(HIDDEN);
});

test("a listed field on the same request still works", async ({ page }) => {
  // The guard has to be a guard rather than a wall: this is the request the page
  // itself makes, one field different.
  const allowed = await post(page, "/pivotforge/pivot", {
    rows: ["Region"],
    values: [{ field: "Amount", aggregation: "sum" }]
  });

  expect(allowed.status).toBe(200);
});

test("the value picker cannot list an unlisted field's values", async ({ page }) => {
  // Straight past the pivot: ask the endpoint what the column holds.
  const refused = await post(page, "/pivotforge/field-values", { field: HIDDEN });

  expect(refused.status).toBe(400);
});

test("the detail records hold only the listed fields", async ({ page }) => {
  // The request names nothing forbidden. Without the projection the whole source
  // record comes back anyway, email included.
  const response = await post(page, "/pivotforge/drill-down", {
    rows: ["Region"],
    values: [{ field: "Amount", aggregation: "sum" }],
    rowPath: ["Ege"],
    columnPath: [],
    sourceRowCount: 100
  });

  expect(response.status).toBe(200);
  const record = JSON.parse(response.body).records[0];
  expect(Object.keys(record).map(key => key.toLowerCase()))
    .not.toContain(HIDDEN.toLowerCase());
  expect(record).toHaveProperty("Region", "Ege");
});

test("the detail modal still fills its columns from the projected records", async ({ page }) => {
  // The projection changes the key casing the browser sees, so this proves the
  // modal resolves its columns against the keys it got rather than the ones it
  // declared.
  await page.locator(".pivot-table tbody td").first().dblclick();
  await page.waitForSelector(".pivot-drill-down-modal.is-open");
  // Polled: opening the modal and the records arriving are two events, and the
  // columns are resolved from the records.
  await expect
    .poll(() => page.locator(".pivot-drill-down-modal tbody tr").count())
    .toBeGreaterThan(0);

  const headers = await page
    .locator(".pivot-drill-down-modal thead th")
    .allTextContents();

  expect(headers).toContain("Bölge");
  expect(headers.length).toBeGreaterThan(1);
});
