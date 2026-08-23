const { test, expect } = require("@playwright/test");

const PAGE = "/Home/Ranking";

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table tbody tr");
});

// The page's own pivot, run twice against the same data: once as declared and
// once with the rankings removed, so the comparison is not against a number
// written down here.
async function bothWays(page) {
  return page.evaluate(async () => {
    const declared = [
      { dataField: "Region", caption: "Bölge", area: "row" },
      { dataField: "Category", caption: "Kategori", area: "row" },
      { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
    ];

    const run = async extras => {
      const request = PivotForge.PivotRequestBuilder.buildRequest(declared, extras);
      const response = await fetch("/pivotforge/pivot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request)
      });
      const result = await response.json();

      return {
        regions: [...new Set(result.rowHeaders.map(header => header[0]))],
        rows: result.rowHeaders.length,
        grandTotal: result.grandTotals["Amount_sum"],
        rowTotals: result.rowTotals.map(total => total.values["Amount_sum"])
      };
    };

    return {
      all: await run({}),
      ranked: await run({ topN: [{ field: "Region", count: 3 }] })
    };
  });
}

test("only the highest ranking groups survive", async ({ page }) => {
  const { all, ranked } = await bothWays(page);

  // The premise: there is something to drop.
  expect(all.regions.length).toBeGreaterThan(3);
  expect(ranked.regions).toHaveLength(3);
  expect(ranked.rows).toBeLessThan(all.rows);
});

test("the grand total equals the rows printed above it", async ({ page }) => {
  // The decision the whole feature turns on. A grand total still counting the
  // dropped regions is the one number a reader checks by hand.
  const { all, ranked } = await bothWays(page);

  const sum = ranked.rowTotals.reduce((total, value) => total + (value ?? 0), 0);

  expect(ranked.grandTotal).toBeCloseTo(sum, 2);
  expect(ranked.grandTotal).toBeLessThan(all.grandTotal);
});

test("an inner ranking counts inside each parent group", async ({ page }) => {
  // Counted per parent rather than across the table: three regions with two
  // categories each is six rows, not two.
  const { rowHeaders, regionCount } = await page.evaluate(async () => {
    const declared = [
      { dataField: "Region", caption: "Bölge", area: "row" },
      { dataField: "Category", caption: "Kategori", area: "row" },
      { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
    ];

    const request = PivotForge.PivotRequestBuilder.buildRequest(declared, {
      topN: [{ field: "Region", count: 3 }, { field: "Category", count: 2 }]
    });
    const response = await fetch("/pivotforge/pivot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });
    const result = await response.json();

    return {
      rowHeaders: result.rowHeaders,
      regionCount: new Set(result.rowHeaders.map(header => header[0])).size
    };
  });

  const perRegion = {};
  for (const [region] of rowHeaders) {
    perRegion[region] = (perRegion[region] ?? 0) + 1;
  }

  expect(regionCount).toBe(3);
  expect(Object.values(perRegion)).toEqual([2, 2, 2]);
  expect(rowHeaders).toHaveLength(6);
  expect(page.errors).toEqual([]);
});

test("bottom takes the other end of the same ranking", async ({ page }) => {
  const { top, bottom } = await page.evaluate(async () => {
    const declared = [
      { dataField: "Region", caption: "Bölge", area: "row" },
      { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
    ];

    const regions = async mode => {
      const request = PivotForge.PivotRequestBuilder.buildRequest(declared, {
        topN: [{ field: "Region", count: 2, mode }]
      });
      const response = await fetch("/pivotforge/pivot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request)
      });
      return (await response.json()).rowHeaders.map(header => header[0]);
    };

    return { top: await regions("Top"), bottom: await regions("Bottom") };
  });

  expect(top).toHaveLength(2);
  expect(bottom).toHaveLength(2);
  // The two ends of one ranking cannot be the same regions.
  expect(top.some(region => bottom.includes(region))).toBe(false);
});

test("a ranking that names no row level is refused", async ({ page }) => {
  const status = await page.evaluate(async () => {
    const response = await fetch("/pivotforge/pivot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: ["Region"],
        values: [{ field: "Amount", aggregation: "sum" }],
        topN: [{ field: "Category", count: 2 }]
      })
    });
    return response.status;
  });

  expect(status).toBe(400);
});
