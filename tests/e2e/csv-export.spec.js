const { test, expect } = require("@playwright/test");

// Reads the file the browser actually saved, rather than the string the page
// built: the download is the part that used to be missing.
async function download(page, run) {
  const waiting = page.waitForEvent("download");
  await run();
  const file = await waiting;
  const stream = await file.createReadStream();
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return { file, text: Buffer.concat(chunks).toString("utf8") };
}

const lines = text => text.replace(/^﻿/, "").split("\r\n");

// The demo page's CSV button, which now goes through the packaged export.
test("the toolbar's CSV button saves the visible grid", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.waitForSelector(".pivot-table table tbody tr");

  const { file, text } = await download(page, () => page.locator("#exportCsvButton").click());

  expect(file.suggestedFilename()).toMatch(/^pivotforge-\d{4}-\d{2}-\d{2}\.csv$/);
  // The byte-order mark leads, or a spreadsheet mangles every Turkish caption.
  expect(text.startsWith("﻿")).toBe(true);
  expect(text).toContain("Marmara");
  expect(errors).toEqual([]);
});

test("every line has the same number of fields as the header", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".pivot-table table tbody tr");

  const { text } = await download(page, () => page.locator("#exportCsvButton").click());

  // Counting fields means counting delimiters outside quotes, because a
  // Turkish-formatted number carries a comma of its own.
  const fieldCount = line => {
    let count = 1;
    let quoted = false;

    for (const character of line) {
      if (character === '"') {
        quoted = !quoted;
      } else if (character === "," && !quoted) {
        count++;
      }
    }

    return count;
  };

  const widths = new Set(lines(text).map(fieldCount));
  expect(widths.size).toBe(1);
});

// A naive scrape of the table carries these; reading the export model does not.
test("the file carries no sort arrows or expand chevrons", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".pivot-table table tbody tr");
  // Sort the grid first, so the header actually has an indicator to leak.
  await page.locator(".pivot-table table thead th.is-sortable").first().click();
  await page.waitForTimeout(300);

  const { text } = await download(page, () => page.locator("#exportCsvButton").click());

  expect(text).not.toMatch(/[▲▼▸▾↑↓]/);
});

test("the row count follows what the grid is showing", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".pivot-table table tbody tr");

  const before = await download(page, () => page.locator("#exportCsvButton").click());
  const beforeLines = lines(before.text).length;

  // Collapsing hides rows, and the export reads the table rather than the
  // result, so the file has to shrink with it.
  await page.locator("#collapseAllButton").click();
  await page.waitForTimeout(300);

  const after = await download(page, () => page.locator("#exportCsvButton").click());

  expect(lines(after.text).length).toBeLessThan(beforeLines);
});

// The declarative pages wire no export code at all: whatever works here is the
// package, reached through the widget the ready event hands over.
test("a declarative page exports without writing any export code", async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener(
      "pivotforge:ready",
      event => { window.grid = event.detail.widget; },
      true);
  });
  await page.goto("/Home/TagHelpers");
  await page.waitForSelector(".pivot-table table tbody tr");

  const { file, text } = await download(
    page,
    () => page.evaluate(() => PivotForge.download(window.grid.exportToCsv())));

  expect(file.suggestedFilename()).toMatch(/\.csv$/);
  expect(text).toContain("Bölge");
});

test("a declared delimiter and raw values reach the file", async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener(
      "pivotforge:ready",
      event => { window.grid = event.detail.widget; },
      true);
  });
  await page.goto("/Home/TagHelpers");
  await page.waitForSelector(".pivot-table table tbody tr");

  const { file, text } = await download(page, () => page.evaluate(() =>
    PivotForge.download(window.grid.exportToCsv({
      delimiter: ";",
      values: "raw",
      fileName: "satis.csv"
    }))));

  expect(file.suggestedFilename()).toBe("satis.csv");
  expect(text).toContain(";");
  // Raw numbers are invariant, so no thousands separator survives into them.
  const body = lines(text).at(-1);
  expect(body).toMatch(/;\d+(\.\d+)?/);
});
