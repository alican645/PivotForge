const { test, expect } = require("@playwright/test");

// Against the real endpoint: the narrowing happens in the engine, and the
// request the widget builds has to be one the server accepts.
test("showRelevantValues narrows a field's values by the other fields' filters", async ({ page }) => {
  await page.goto("/Home/TagHelpers");
  await page.waitForSelector(".pivot-table table tbody tr");

  const lists = await page.evaluate(async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const create = showRelevantValues => PivotForge.create(host, {
      autoLoad: false,
      allowFiltering: true,
      showRelevantValues,
      fields: [
        { dataField: "Region", caption: "Bölge", area: "row" },
        { dataField: "SalesPerson", caption: "Satışçı", area: "filter" },
        { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
      ]
    });

    const all = create(false);
    const regions = (await all.fieldValues("Region")).values;
    all.dispose();

    const relevant = create(true);
    const people = (await relevant.fieldValues("SalesPerson")).values;
    await relevant.setFilter("SalesPerson", [people[0]]);
    const narrowed = (await relevant.fieldValues("Region")).values;
    // Its own filter never narrows a field: every salesperson is still listed.
    const ownList = (await relevant.fieldValues("SalesPerson")).values;
    // A filter nobody passes leaves nothing to list -- proof the server applied it.
    await relevant.setFilter("SalesPerson", ["__nobody__"]);
    const none = (await relevant.fieldValues("Region")).values;
    relevant.dispose();
    host.remove();

    return { regions, narrowed, people, ownList, none };
  });

  expect(lists.narrowed.length).toBeGreaterThan(0);
  expect(lists.narrowed.every(region => lists.regions.includes(region))).toBe(true);
  expect(lists.ownList).toEqual(lists.people);
  expect(lists.none).toEqual([]);
});
