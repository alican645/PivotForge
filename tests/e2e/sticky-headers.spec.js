const { test, expect } = require("@playwright/test");

// The frozen headers. They silently stopped being sticky once -- a broader
// rule outranked them -- and nothing noticed, because no test scrolled a table
// wide and tall enough to need them. These do.
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 500 });
  await page.goto("/Home/TagHelpers");
  await page.waitForSelector(".pivot-table__table td");
});

async function build(page, rtlEnabled) {
  await page.evaluate(async rtlEnabled => {
    document.querySelector("#stickyHost")?.remove();
    const host = document.createElement("div");
    host.id = "stickyHost";
    host.style.width = "700px";
    host.style.maxHeight = "220px";
    document.body.prepend(host);
    const widget = PivotForge.create(host, {
      autoLoad: false,
      rtlEnabled,
      fields: [
        { dataField: "Region", caption: "Bölge", area: "row" },
        { dataField: "SalesPerson", caption: "Satışçı", area: "row" },
        { dataField: "OrderDate", caption: "Tarih", area: "column" },
        { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
      ]
    });
    await widget.refresh();
  }, rtlEnabled);
  await page.waitForSelector("#stickyHost .pivot-table__table td");
}

for (const rtl of [false, true]) {
  test(`${rtl ? "RTL" : "LTR"}: row headers stay at the start edge and the head stays on top`, async ({ page }) => {
    await build(page, rtl);

    const edges = await page.evaluate(async rtl => {
      const host = document.querySelector("#stickyHost");
      const header = host.querySelector("tbody .pivot-table__row-header, tbody .pivot-table__subtotal-header");
      const headRows = [...host.querySelector("thead").rows];
      host.scrollLeft = rtl ? -1500 : 1500;
      host.scrollTop = 120;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const box = host.getBoundingClientRect();
      const rect = header.getBoundingClientRect();
      const rows = headRows.map(row => row.cells[0].getBoundingClientRect());
      return {
        startGap: Math.round(rtl ? box.right - rect.right : rect.left - box.left),
        firstTop: Math.round(rows[0].top - box.top),
        // Each head row sits below the one before it, not on top of it.
        stacked: rows.every((cell, index) => index === 0 || cell.top >= rows[index - 1].bottom - 1)
      };
    }, rtl);

    expect(Math.abs(edges.startGap)).toBeLessThan(4);
    expect(Math.abs(edges.firstTop)).toBeLessThan(4);
    expect(edges.stacked).toBe(true);
  });
}
