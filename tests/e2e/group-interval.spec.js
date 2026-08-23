const { test, expect } = require("@playwright/test");

// The demo page declares OrderDate three times at three intervals, and nothing
// else: it is the end-to-end proof that one date column carries a hierarchy.
const PAGE = "/Home/Grouping";

const CALENDAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

// The months of each year, in the order they are drawn. A year opens with its
// own subtotal header row, and the month rows that follow belong to it -- so
// reading the whole column flat would splice three years into one sequence.
function monthsByYear(page) {
  return page.evaluate(() => {
    const years = new Map();
    let current = null;

    for (const row of document.querySelectorAll(".pivot-table tbody tr")) {
      const cells = Array.from(row.querySelectorAll("th"));
      const opener = cells[0]?.textContent.match(/(\d{4})/);

      if (opener) {
        current = opener[1];
        years.set(current, years.get(current) ?? []);
        continue;
      }

      const month = cells[1]?.textContent.trim();
      if (current && month) {
        years.get(current).push(month);
      }
    }

    return Object.fromEntries(years);
  });
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table tbody tr");
});

test("months read as names and run in calendar order", async ({ page }) => {
  const years = await monthsByYear(page);

  expect(Object.keys(years).length).toBeGreaterThan(1);

  for (const [year, months] of Object.entries(years)) {
    // Alphabetically Ağustos would lead and Şubat would trail. The assertion is
    // per year because each year is its own sequence under the year level.
    expect(months, year).toEqual(CALENDAR.filter(month => months.includes(month)));
    expect(months.length).toBeGreaterThan(1);
  }

  expect(page.errors).toEqual([]);
});

test("the year level groups the months under it", async ({ page }) => {
  const years = Object.keys(await monthsByYear(page));

  expect(years.length).toBeGreaterThan(1);
  expect(years).toEqual([...years].sort());
});

test("the same column also carries the column axis", async ({ page }) => {
  const quarters = await page.locator(".pivot-table thead th").allTextContents();
  const found = quarters.map(text => text.trim()).filter(text => /^Q[1-4]$/.test(text));

  expect(found).toEqual([...found].sort());
  expect(found.length).toBeGreaterThan(1);
});

test("each grouped level is its own chip in the designer", async ({ page }) => {
  // Keyed by column alone, the second level would overwrite the first and the
  // designer would show one chip where the layout has two.
  const chips = page.locator('[data-zone="row"] .pivot-chip');

  await expect(chips).toHaveCount(2);
  await expect(chips.nth(0)).toContainText("Yıl");
  await expect(chips.nth(1)).toContainText("Ay");
});

test("filtering a month level lists months rather than timestamps", async ({ page }) => {
  const funnel = '.pivot-table__corner [data-action="header-filter"][data-field="OrderDate:month"]';
  await page.locator(funnel).click();

  const values = page.locator(".pivot-filter-picker.is-open .pivot-filter-picker__value span");
  await expect(values.first()).toBeVisible();
  const listed = await values.allTextContents();

  expect(listed.every(value => /^[A-Za-zÇĞİÖŞÜçğıöşü]+$/.test(value.trim()))).toBe(true);
  expect(page.errors).toEqual([]);
});

test("a month filter actually restricts the table", async ({ page }) => {
  const funnel = '.pivot-table__corner [data-action="header-filter"][data-field="OrderDate:month"]';
  const picker = ".pivot-filter-picker.is-open";

  await page.locator(funnel).click();
  await expect(page.locator(`${picker} .pivot-filter-picker__value`).first()).toBeVisible();
  await page.locator(`${picker} [data-action="filter-clear"]`).click();
  await page.locator(`${picker} .pivot-filter-picker__value input`).nth(0).check();
  const kept = (await page.locator(`${picker} .pivot-filter-picker__value span`).nth(0).textContent()).trim();
  await page.locator(`${picker} [data-action="filter-apply"]`).click();

  await expect.poll(async () => {
    const months = Object.values(await monthsByYear(page)).flat();
    return [...new Set(months)];
  }).toEqual([kept]);
  expect(page.errors).toEqual([]);
});
