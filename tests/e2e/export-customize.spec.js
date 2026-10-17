const { test, expect } = require("@playwright/test");

// The cell context an "exporting" handler reads comes from the real table, so
// it is checked against the real renderer, not a stub.
test("an exporting handler sees what each cell shows and can restyle it", async ({ page }) => {
  await page.goto("/Home/TagHelpers");
  await page.waitForSelector(".pivot-table table tbody tr");

  const { sources, posted } = await page.evaluate(async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const posted = [];
    const widget = PivotForge.create(host, {
      autoLoad: false,
      allowExcelExport: true,
      fields: [
        { dataField: "Region", caption: "Bölge", area: "row" },
        { dataField: "Year", caption: "Yıl", area: "column" },
        { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
      ]
    });
    await widget.refresh();

    const sources = [];
    widget.on("exporting", event => {
      for (const row of event.document.rows) {
        for (const cell of row.cells) {
          sources.push(cell.source);
          if (cell.source.area === "data" && typeof cell.source.value === "number") {
            cell.bold = true;
          }
        }
      }
      event.cancel = false;
    });

    // Only the request body is of interest; the file itself is the server's.
    const realFetch = window.fetch;
    window.fetch = async (url, init) => {
      if (String(url).endsWith("/excel")) {
        posted.push(JSON.parse(init.body));
      }
      return realFetch(url, init);
    };
    try {
      await widget.exportToExcel();
    } finally {
      window.fetch = realFetch;
      host.remove();
    }

    return { sources, posted };
  });

  const areas = new Set(sources.map(source => source.area));
  expect([...areas].sort()).toEqual(["column", "data", "row"]);

  const value = sources.find(source => source.area === "data" && typeof source.value === "number");
  expect(value.valueKey).toBe("Amount_sum");
  expect(value.rowPath.length).toBe(1);
  expect(value.columnPath.length).toBe(1);

  const cells = posted[0].rows.flatMap(row => row.cells);
  expect(cells.some(cell => "source" in cell)).toBe(false);
  expect(cells.some(cell => cell.bold === true)).toBe(true);
});
