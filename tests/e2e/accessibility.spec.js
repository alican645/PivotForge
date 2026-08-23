const { test, expect } = require("@playwright/test");

// The table carried aria-selected on plain rows and cells, where it is an
// unsupported attribute a screen reader drops — the selection was visible and
// nothing more. These assert the declared grid semantics that make it real,
// in a browser, because an accessibility tree is not something a stub has.
const PAGE = "/Home/TagHelpers";

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table__table td");
});

test("the table declares itself a grid, with a name and a row count", async ({ page }) => {
  const table = page.locator(".pivot-table__table");

  await expect(table).toHaveAttribute("role", "grid");
  await expect(table).toHaveAttribute("aria-multiselectable", "false");
  await expect(table).toHaveAttribute("aria-rowcount", /^[1-9]/);

  // An unnamed grid is announced as "grid" and nothing else.
  const name = await table.getAttribute("aria-label");
  expect(name?.trim().length).toBeGreaterThan(0);
});

test("every row and cell carries a role, so the tree has no holes", async ({ page }) => {
  const unroled = await page.locator(".pivot-table__table").evaluate(table => {
    const missing = [];
    table.querySelectorAll("tr, td, th, thead, tbody").forEach(node => {
      if (!node.getAttribute("role")) {
        missing.push(`${node.tagName}.${node.className}`);
      }
    });
    return missing;
  });

  expect(unroled).toEqual([]);
});

test("head cells are column headers and row labels are row headers", async ({ page }) => {
  await expect(page.locator(".pivot-table__table thead th").first())
    .toHaveAttribute("role", "columnheader");
  await expect(page.locator(".pivot-table__table tbody th").first())
    .toHaveAttribute("role", "rowheader");
  await expect(page.locator(".pivot-table__table tbody td").first())
    .toHaveAttribute("role", "gridcell");
});

test("aria-rowindex counts from the head and reaches every body row", async ({ page }) => {
  const indexes = await page.locator(".pivot-table__table tr:not([aria-hidden='true'])")
    .evaluateAll(rows => rows.map(row => Number(row.getAttribute("aria-rowindex"))));

  expect(indexes.length).toBeGreaterThan(1);
  expect(indexes.every(Number.isInteger)).toBe(true);
  expect(indexes[0]).toBe(1);
  // Strictly increasing: two rows claiming the same position is worse than none.
  expect(indexes.every((value, at) => at === 0 || value > indexes[at - 1])).toBe(true);
});

test("a selected cell announces itself as selected", async ({ page }) => {
  const cell = page.locator(".pivot-table__table tbody td").first();
  await cell.click();

  await expect(cell).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("td[aria-selected='true']")).toHaveCount(1);
  expect(page.errors).toEqual([]);
});

test("a sortable header states the sort it carries", async ({ page }) => {
  // A row field's own header, named rather than taken by position: the header
  // block also holds the grand total, which the page declares a sort on.
  const header = page.locator(".pivot-table__corner.is-sortable").first();
  await expect(header).toHaveAttribute("aria-sort", "none");

  await header.locator(".pivot-table__sort-button").click();

  await expect(header).toHaveAttribute("aria-sort", /ascending|descending/);
});

test("a collapse toggle has a name and states whether it is expanded", async ({ page }) => {
  const toggle = page.locator(".pivot-table__toggle").first();
  await expect(toggle).toBeAttached();

  const label = await toggle.getAttribute("aria-label");
  expect(label?.trim().length).toBeGreaterThan(0);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  await toggle.click();

  await expect(page.locator(".pivot-table__toggle").first())
    .toHaveAttribute("aria-expanded", "false");
});

test("each designer zone names the chips it holds", async ({ page }) => {
  const named = await page.locator('.pivot-zone__body, .pivot-field-list').evaluateAll(
    bodies => bodies.map(body => {
      const id = body.getAttribute("aria-labelledby");
      return {
        role: body.getAttribute("role"),
        label: id ? document.getElementById(id)?.textContent?.trim() : null
      };
    }));

  expect(named.length).toBe(5);
  named.forEach(entry => {
    expect(entry.role).toBe("group");
    // Without this the chip is announced as "Bölge, düğme" with nothing saying
    // which zone it currently sits in.
    expect(entry.label?.length ?? 0).toBeGreaterThan(0);
  });
});

test("the field search box is labelled, not merely placeheld", async ({ page }) => {
  const search = page.locator('.pivot-search input[data-action="search"]');

  const label = await search.getAttribute("aria-label");
  expect(label?.trim().length).toBeGreaterThan(0);
});

test("two designers on one page do not share a heading id", async ({ page }) => {
  const duplicates = await page.evaluate(() => {
    const seen = new Map();
    document.querySelectorAll("[id]").forEach(node => {
      seen.set(node.id, (seen.get(node.id) ?? 0) + 1);
    });
    return [...seen].filter(([, count]) => count > 1).map(([id]) => id);
  });

  expect(duplicates).toEqual([]);
});
