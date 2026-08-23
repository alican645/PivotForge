const { test, expect } = require("@playwright/test");

const PAGE = "/Home/Grouping";
const picker = ".pivot-filter-picker.is-open";
const operator = `${picker} [data-action="filter-operator"]`;
const argument = index => `${picker} [data-action="filter-argument"][data-index="${index}"]`;

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table tbody tr");
});

// A grid of its own, so the demo's specs keep asserting the layout they were
// written against and each case can declare exactly the field it is about.
async function build(page, fields) {
  await page.evaluate(async fields => {
    document.querySelector("#dateScratch")?.remove();
    const host = document.createElement("div");
    host.id = "dateScratch";
    document.body.appendChild(host);

    window.dateWidget = PivotForge.create(host, { fields, autoLoad: false, allowFiltering: true });
    await window.dateWidget.refresh();
  }, fields);

  await page.waitForSelector("#dateScratch .pivot-table__table td");
}

const DATE_FIELD = [
  { dataField: "OrderDate", caption: "Tarih", area: "row" },
  { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
];

async function openCondition(page, field, chosen = "Between") {
  await page.evaluate(field => window.dateWidget.openHeaderFilter(field), field);
  await page.waitForSelector(picker);
  await page.locator(operator).selectOption(chosen);
}

const argumentTypes = page => page.locator(`${picker} [data-action="filter-argument"]`)
  .evaluateAll(inputs => inputs.map(input => input.getAttribute("type")));

const rowLabels = page =>
  page.locator("#dateScratch tbody tr th:first-child").allTextContents();

test("a range over dates is picked from a calendar", async ({ page }) => {
  await build(page, DATE_FIELD);
  await openCondition(page, "OrderDate");

  await expect.poll(() => argumentTypes(page)).toEqual(["date", "date"]);
  expect(page.errors).toEqual([]);
});

test("a range over text stays a text box", async ({ page }) => {
  await build(page, [
    { dataField: "Region", caption: "Bölge", area: "row" },
    { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
  ]);
  await openCondition(page, "Region");

  await expect.poll(() => argumentTypes(page)).toEqual(["text", "text"]);
});

test("a grouped month level is not a date, because its values are month names", async ({ page }) => {
  // The case that settles the whole approach. The field behind this level is a
  // date column, but the level reads "Haziran" and the engine compares it as
  // text -- so a calendar here would produce an argument the comparison ignores.
  await build(page, [
    { dataField: "OrderDate", caption: "Ay", area: "row", groupInterval: "month" },
    { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
  ]);
  await openCondition(page, "OrderDate:month");

  await expect.poll(() => argumentTypes(page)).toEqual(["text", "text"]);
});

test("a grouped year level is a number rather than a date", async ({ page }) => {
  // "2024" is a year to a reader and a number to both the engine and this
  // picker, which is the order the engine reads it in.
  await build(page, [
    { dataField: "OrderDate", caption: "Yıl", area: "row", groupInterval: "year" },
    { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
  ]);
  await openCondition(page, "OrderDate:year");

  await expect.poll(() => argumentTypes(page)).toEqual(["text", "text"]);
});

test("switching to a text condition takes the calendar away again", async ({ page }) => {
  // The reachable version of the mistake: the value list is already loaded, so
  // the field is known to hold dates -- but "contains" matches text, and a
  // calendar there would hand it a spelling for a comparison that is not
  // happening.
  await build(page, DATE_FIELD);
  await openCondition(page, "OrderDate");
  await expect.poll(() => argumentTypes(page)).toEqual(["date", "date"]);

  await page.locator(operator).selectOption("Contains");
  await expect.poll(() => argumentTypes(page)).toEqual(["text", "text"]);

  await page.locator(operator).selectOption("GreaterThan");
  await expect.poll(() => argumentTypes(page)).toEqual(["date", "date"]);
});

test("the dates picked actually narrow the table", async ({ page }) => {
  // What the control is for: a calendar hands back an ISO date, which is the one
  // spelling the engine reads as a date rather than as text.
  await build(page, DATE_FIELD);
  const before = await rowLabels(page);
  expect(before.length).toBeGreaterThan(3);

  await openCondition(page, "OrderDate");
  await page.locator(argument(0)).fill("2024-01-01");
  await page.locator(argument(1)).fill("2024-03-31");
  await page.locator(`${picker} [data-action="filter-apply"]`).click();

  await expect.poll(() => rowLabels(page).then(labels => labels.length))
    .toBeLessThan(before.length);

  const after = await rowLabels(page);
  const dated = after.filter(label => /\d{2}\/\d{2}\/\d{4}/.test(label));
  expect(dated.length).toBeGreaterThan(0);
  // The invariant label is MM/DD/YYYY, so the quarter shows as months 01 to 03.
  expect(dated.every(label => /^0[123]\/\d{2}\/2024/.test(label))).toBe(true);
});

test("reopening shows the range already in force", async ({ page }) => {
  await build(page, DATE_FIELD);
  await openCondition(page, "OrderDate");
  await page.locator(argument(0)).fill("2024-01-01");
  await page.locator(argument(1)).fill("2024-03-31");
  await page.locator(`${picker} [data-action="filter-apply"]`).click();
  await expect(page.locator(picker)).toHaveCount(0);

  await page.evaluate(() => window.dateWidget.openHeaderFilter("OrderDate"));
  await page.waitForSelector(picker);

  await expect(page.locator(operator)).toHaveValue("Between");
  await expect(page.locator(argument(0))).toHaveValue("2024-01-01");
  await expect(page.locator(argument(1))).toHaveValue("2024-03-31");
  await expect.poll(() => argumentTypes(page)).toEqual(["date", "date"]);
});

test("an argument a calendar cannot hold is kept rather than erased", async ({ page }) => {
  // A range typed before this existed, or written by hand into a stored view.
  // Swapping in a control that cannot display it would drop it on sight.
  await build(page, DATE_FIELD);
  await page.evaluate(() =>
    window.dateWidget.setFilter("OrderDate", ["1 Ocak 2024", "2024-03-31"], "Include", "Between"));
  await page.evaluate(() => window.dateWidget.openHeaderFilter("OrderDate"));
  await page.waitForSelector(picker);

  await expect.poll(() => argumentTypes(page)).toEqual(["text", "date"]);
  await expect(page.locator(argument(0))).toHaveValue("1 Ocak 2024");
});

test("only a condition that needs the values asks for them", async ({ page }) => {
  // Opening on the value list fetches it to show it. Opening straight into a
  // condition is the case worth pinning: "contains" has nothing to ask for,
  // while a comparison needs the list only to decide the argument control.
  await build(page, DATE_FIELD);

  const counted = async (operator, values) => {
    await page.evaluate(([operator, values]) => {
      window.dateWidget.setFilter("OrderDate", values, "Include", operator);
    }, [operator, values]);

    const requests = [];
    const listener = request => {
      if (request.url().includes("/field-values")) {
        requests.push(request.url());
      }
    };
    page.on("request", listener);
    await page.evaluate(() => window.dateWidget.openHeaderFilter("OrderDate"));
    await page.waitForSelector(picker);
    await page.waitForTimeout(300);
    page.off("request", listener);
    await page.locator(`${picker} [data-action="filter-cancel"]`).click();
    return requests.length;
  };

  expect(await counted("Contains", ["2024"])).toBe(0);
  expect(await counted("Between", ["2024-01-01", "2024-03-31"])).toBeGreaterThan(0);
});
