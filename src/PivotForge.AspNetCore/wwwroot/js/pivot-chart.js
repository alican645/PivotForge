(function (root) {
  const PivotForge = root.PivotForge ??= {};

  const SVG_NS = "http://www.w3.org/2000/svg";

  // The forms a pivot is drawn in. Each answers a different question about the
  // same numbers: column and bar compare categories side by side (bar when the
  // labels are long), stacked column shows how a category's total splits, and
  // line follows a category order that means something -- months, years.
  const CHART_TYPES = ["column", "stackedColumn", "bar", "line"];

  // Eight hues is what the palette holds and what a reader can still tell
  // apart. A ninth series is not given a made-up colour: the chart shows the
  // first eight and says so, and the grid below still shows everything.
  const MAX_SERIES = 8;

  const TEXTS = {
    chart: "Chart",
    chartType: "Chart type",
    column: "Column",
    stackedColumn: "Stacked",
    bar: "Bar",
    line: "Line",
    measure: "Value",
    noData: "No data to chart",
    blank: "(blank)",
    total: "Total",
    seriesCapped: "Showing the first {0} of {1} series.",
    keyboardHint: "Use the arrow keys to move between categories."
  };

  function format(template, ...args) {
    return String(template).replace(/\{(\d+)\}/g, (match, index) => String(args[Number(index)] ?? match));
  }

  // Accepts what a page would naturally write: true for the default chart, a
  // type name, or an object. Type names are matched without regard to case, so
  // the "StackedColumn" a Razor enum serializes to and the "stackedColumn" a
  // script writes are the same chart.
  function normalizeChart(chart) {
    if (chart === null || chart === undefined || chart === false) {
      return null;
    }

    const declared = chart === true ? {} : typeof chart === "string" ? { type: chart } : chart;
    if (typeof declared !== "object") {
      throw new Error("chart must be true, a chart type name or an options object.");
    }

    const type = normalizeType(declared.type ?? "column");
    if (type === null) {
      return null;
    }

    const position = String(declared.position ?? "top").toLowerCase();
    if (position !== "top" && position !== "bottom") {
      throw new Error(`Unknown chart position "${declared.position}". Expected "top" or "bottom".`);
    }

    const height = declared.height === undefined || declared.height === null ? 320 : Number(declared.height);
    if (!Number.isFinite(height) || height < 120) {
      throw new Error("chart height must be a number of pixels, at least 120.");
    }

    if (declared.visible !== undefined && typeof declared.visible !== "boolean") {
      throw new Error("chart visible must be true or false.");
    }

    return {
      type,
      position,
      height,
      valueKey: declared.valueKey ?? null,
      // A chart can be declared and start hidden, for a page where the table
      // comes first and the chart is one toolbar click away.
      visible: declared.visible !== false
    };
  }

  function normalizeType(type) {
    const name = String(type ?? "").toLowerCase();
    if (name === "none") {
      return null;
    }

    const found = CHART_TYPES.find(candidate => candidate.toLowerCase() === name);
    if (!found) {
      throw new Error(`Unknown chart type "${type}". Expected one of: ${CHART_TYPES.join(", ")}.`);
    }

    return found;
  }

  function headerKey(header) {
    return JSON.stringify(header ?? []);
  }

  function readValue(values, valueKey) {
    const value = values?.[valueKey];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  // What the chart plots, read off a pivot result: one category per outermost
  // row group, one series per outermost column group (or the value itself when
  // nothing is on the columns). The outermost level is what a reader takes in
  // at a glance; the levels inside it are what the grid is for.
  //
  // Every number comes from the result as the engine computed it -- a group's
  // subtotal rather than a sum of its rows -- so an average or a distinct count
  // is charted as correctly as a sum.
  function chartModel(result, options = {}) {
    const valueKey = options.valueKey;
    const blank = options.blankText ?? TEXTS.blank;
    const total = options.totalText ?? TEXTS.total;
    const maxSeries = options.maxSeries ?? MAX_SERIES;
    const rowHeaders = result?.rowHeaders ?? [];
    const columnHeaders = result?.columnHeaders ?? [];
    const rowDepth = Math.max(0, ...rowHeaders.map(header => header?.length ?? 0));
    const columnDepth = Math.max(0, ...columnHeaders.map(header => header?.length ?? 0));
    const label = value => (value === null || value === undefined || value === "" ? blank : String(value));

    const cells = new Map((result?.cells ?? []).map(cell => [`${cell.row}:${cell.column}`, cell.values]));
    const rowTotals = new Map((result?.rowTotals ?? []).map(totalRow => [totalRow.index, totalRow.values]));
    const subtotals = new Map((result?.subtotals ?? [])
      .filter(subtotal => subtotal.rowHeader?.length === 1)
      .map(subtotal => [headerKey(subtotal.rowHeader), subtotal]));
    const columnSubtotals = new Map((result?.columnSubtotals ?? [])
      .filter(subtotal => subtotal.columnHeader?.length === 1)
      .map(subtotal => [headerKey(subtotal.columnHeader), subtotal]));

    // Categories: the row groups when there is more than one row level, else
    // the rows themselves. A grid with no row field is one row, its total.
    const categories = [];
    if (rowDepth > 1) {
      const seen = new Set();
      for (const header of rowHeaders) {
        const key = headerKey([header[0]]);
        if (!seen.has(key)) {
          seen.add(key);
          categories.push({ label: label(header[0]), group: subtotals.get(key) ?? null, row: null });
        }
      }
    } else {
      rowHeaders.forEach((header, index) => {
        categories.push({ label: rowDepth === 0 ? total : label(header[0]), group: null, row: index });
      });
    }

    // Series, likewise: the column groups when there is more than one column
    // level, else the columns. No column field means one series, the value.
    let series;
    if (columnDepth === 0) {
      series = [{
        label: options.valueLabel ?? valueKey,
        read: category => category.group
          ? readValue(category.group.totals, valueKey)
          : readValue(rowTotals.get(category.row) ?? cells.get(`${category.row}:0`), valueKey)
      }];
    } else if (columnDepth === 1) {
      series = columnHeaders.map((header, column) => ({
        label: label(header[0]),
        read: category => category.group
          ? readValue(category.group.cells?.find(cell => cell.column === column)?.values, valueKey)
          : readValue(cells.get(`${category.row}:${column}`), valueKey)
      }));
    } else {
      const seen = new Set();
      series = [];
      for (const header of columnHeaders) {
        const key = headerKey([header[0]]);
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        const outer = header[0];
        series.push({
          label: label(outer),
          read: category => category.group
            ? readValue(category.group.columnSubtotals
              ?.find(cell => cell.columnHeader?.length === 1 && cell.columnHeader[0] === outer)?.values, valueKey)
            : readValue(columnSubtotals.get(key)?.cells?.find(cell => cell.index === category.row)?.values, valueKey)
        });
      }
    }

    const shown = series.slice(0, maxSeries);
    return {
      valueKey,
      categories: categories.map(category => category.label),
      series: shown.map(item => ({ label: item.label, values: categories.map(category => item.read(category)) })),
      totalSeries: series.length
    };
  }

  // Round steps (1, 2, 2.5, 5 x 10^n) spanning the data and always zero: a
  // bar measured from anywhere but zero lies about its length.
  function niceTicks(min, max, count = 5) {
    let low = Math.min(0, min);
    let high = Math.max(0, max);
    if (low === high) {
      high = low === 0 ? 1 : high + Math.abs(high);
    }

    const rough = (high - low) / Math.max(1, count);
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].map(factor => factor * magnitude).find(candidate => candidate >= rough);
    low = Math.floor(low / step) * step;
    high = Math.ceil(high / step) * step;

    const ticks = [];
    // Counted rather than accumulated, so 0.1 + 0.2 never puts a tick at
    // 0.30000000000000004.
    for (let index = 0; low + index * step <= high + step / 1e6; index++) {
      const tick = Number((low + index * step).toPrecision(12));
      ticks.push(tick === 0 ? 0 : tick);
    }

    return ticks;
  }

  // The value range the marks need: stacked marks reach as far as a
  // category's positives (or negatives) add up to.
  function valueExtent(model, stacked) {
    let min = 0;
    let max = 0;
    model.categories.forEach((category, index) => {
      if (stacked) {
        let up = 0;
        let down = 0;
        for (const series of model.series) {
          const value = series.values[index];
          if (value > 0) {
            up += value;
          } else if (value < 0) {
            down += value;
          }
        }
        max = Math.max(max, up);
        min = Math.min(min, down);
        return;
      }

      for (const series of model.series) {
        const value = series.values[index];
        if (value !== null) {
          max = Math.max(max, value);
          min = Math.min(min, value);
        }
      }
    });

    return { min, max };
  }

  // Axis labels are short: "1,2 Mn" rather than the cell's "1.234.567,00 TL".
  // The exact figure is a hover away, in the cell's own format.
  function axisFormatter(valueDefinition, culture) {
    const showAs = valueDefinition?.showAs;
    const percentShowAs = showAs === "percentOfRowTotal" || showAs === "percentOfColumnTotal" ||
      showAs === "percentOfGrandTotal" || showAs === "percentOfParentRowTotal" ||
      showAs === "percentOfParentColumnTotal" || showAs === "percentDifferenceFromPrevious";
    const formatType = valueDefinition?.format?.type;

    if (percentShowAs || formatType === "percent") {
      const percent = new Intl.NumberFormat(culture ?? undefined, { style: "percent", maximumFractionDigits: 1 });
      return value => percent.format(percentShowAs ? value : value / 100);
    }

    const compact = new Intl.NumberFormat(culture ?? undefined, {
      notation: "compact",
      compactDisplay: "short",
      maximumFractionDigits: 1
    });
    return value => compact.format(value);
  }

  // A rectangle with its data end rounded and its baseline end square, so a
  // bar reads as growing out of the axis. Drawn for any of the four directions.
  function barPath(x, y, width, height, radius, end) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    const right = x + width;
    const bottom = y + height;
    switch (end) {
      case "top":
        return `M${x},${bottom}V${y + r}Q${x},${y} ${x + r},${y}H${right - r}Q${right},${y} ${right},${y + r}V${bottom}Z`;
      case "bottom":
        return `M${x},${y}V${bottom - r}Q${x},${bottom} ${x + r},${bottom}H${right - r}Q${right},${bottom} ${right},${bottom - r}V${y}Z`;
      case "right":
        return `M${x},${y}H${right - r}Q${right},${y} ${right},${y + r}V${bottom - r}Q${right},${bottom} ${right - r},${bottom}H${x}Z`;
      case "left":
        return `M${right},${y}H${x + r}Q${x},${y} ${x},${y + r}V${bottom - r}Q${x},${bottom} ${x + r},${bottom}H${right}Z`;
      default:
        return `M${x},${y}H${right}V${bottom}H${x}Z`;
    }
  }

  // Colour belongs to the series, not to where it falls in the list: a filter
  // that takes "2023" away must not repaint "2024". Slots are handed out in the
  // palette's order the first time a series is seen and kept after that; a
  // slot whose series has gone is given away only once no unused one is left.
  class SeriesColors {
    constructor() {
      this.slots = new Map();
    }

    reset() {
      this.slots.clear();
    }

    assign(labels) {
      const visible = new Set(labels.map(label => this.slots.get(label)).filter(slot => slot !== undefined));
      return labels.map(label => {
        if (this.slots.has(label)) {
          return this.slots.get(label);
        }

        const taken = new Set(this.slots.values());
        let slot = [...Array(MAX_SERIES).keys()].find(candidate => !taken.has(candidate));
        if (slot === undefined) {
          slot = [...Array(MAX_SERIES).keys()].find(candidate => !visible.has(candidate)) ?? 0;
          for (const [owner, ownerSlot] of this.slots) {
            if (ownerSlot === slot) {
              this.slots.delete(owner);
            }
          }
        }

        this.slots.set(label, slot);
        visible.add(slot);
        return slot;
      });
    }
  }

  function svg(tagName, attributes = {}) {
    const node = root.document.createElementNS(SVG_NS, tagName);
    for (const [name, value] of Object.entries(attributes)) {
      node.setAttribute(name, String(value));
    }
    return node;
  }

  function html(tagName, className, text) {
    const node = root.document.createElement(tagName);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  // Cuts a label down to what fits, by an estimate of the font's average
  // advance: measuring every label would cost a layout per label per draw.
  function fitLabel(text, width, charWidth = 6.6) {
    const max = Math.max(1, Math.floor(width / charWidth));
    return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
  }

  class PivotChart {
    // host: the element the chart lives in. options:
    //   texts            strings over the English defaults
    //   culture          number formatting culture for the axis
    //   formatValue      (value, valueDefinition) => text, the grid's own format
    //   onChange         ({ type, valueKey }) when the reader switches either
    constructor(host, options = {}) {
      if (!host) {
        throw new Error("PivotChart requires a host element.");
      }

      this.host = host;
      this.options = options;
      this.texts = { ...TEXTS, ...(options.texts ?? {}) };
      this.colors = new SeriesColors();
      this.scope = null;
      this.state = { type: options.type ?? "column", valueKey: options.valueKey ?? null };
      this.height = options.height ?? 320;
      this.activeIndex = -1;
      this.host.classList.add("pivot-chart");
      this.host.setAttribute("role", "group");
      this.host.setAttribute("aria-label", this.texts.chart);

      if (typeof root.ResizeObserver === "function") {
        let lastWidth = 0;
        this.resizeObserver = new root.ResizeObserver(entries => {
          const width = Math.round(entries[0]?.contentRect?.width ?? 0);
          if (width > 0 && width !== lastWidth) {
            lastWidth = width;
            this.draw();
          }
        });
        this.resizeObserver.observe(this.host);
      }
    }

    // values: the value definitions on screen (key, label, format, showAs...).
    // scope: names what the series are (the column fields); when it changes the
    // colour slots start afresh, since "2024" on one axis is not "2024" on another.
    render(result, { values = [], scope = "" } = {}) {
      this.result = result;
      this.values = values;
      if (scope !== this.scope) {
        this.scope = scope;
        this.colors.reset();
      }

      if (!values.some(value => value.key === this.state.valueKey)) {
        this.state = { ...this.state, valueKey: values[0]?.key ?? null };
      }

      this.draw();
    }

    setState(state) {
      this.state = { ...this.state, ...state };
      this.draw();
    }

    change(state) {
      this.setState(state);
      this.options.onChange?.({ ...this.state });
    }

    valueDefinition() {
      return this.values?.find(value => value.key === this.state.valueKey) ?? null;
    }

    // A redraw replaces the scroller. When it had focus -- a reader stepping
    // through categories while the box resizes -- focus and the category it
    // was on carry over to the new one rather than being lost with the old.
    draw() {
      const active = root.document?.activeElement;
      const hadFocus = Boolean(active?.classList?.contains("pivot-chart__scroller") && this.host.contains?.(active));
      this.redrawing = true;
      try {
        this.drawContent();
      } finally {
        this.redrawing = false;
      }

      if (hadFocus) {
        this.host.querySelector?.(".pivot-chart__scroller")?.focus?.({ preventScroll: true });
      }
    }

    drawContent() {
      if (!this.result || this.disposed) {
        return;
      }

      const definition = this.valueDefinition();
      this.model = chartModel(this.result, {
        valueKey: this.state.valueKey,
        valueLabel: definition?.label,
        blankText: this.texts.blank,
        totalText: this.texts.total
      });
      this.slots = this.colors.assign(this.model.series.map(series => series.label));
      this.activeIndex = Math.min(this.activeIndex, this.model.categories.length - 1);

      const header = this.createHeader(definition);
      const legend = this.createLegend();
      const plot = html("div", "pivot-chart__plot");
      this.plotNode = plot;
      this.host.replaceChildren(...[header, legend, this.createNote(), plot].filter(Boolean));

      const hasData = this.model.series.some(series => series.values.some(value => value !== null));
      if (!definition || !hasData) {
        plot.appendChild(html("div", "pivot-chart__empty", this.texts.noData));
        return;
      }

      this.drawPlot(plot, definition);
    }

    createHeader(definition) {
      const header = html("div", "pivot-chart__header");

      // One value at a time, so there is only ever one axis: two measures of
      // different scale on one chart would make one of them unreadable.
      if (this.values.length > 1) {
        const select = html("select", "pivot-chart__measure");
        select.setAttribute("aria-label", this.texts.measure);
        for (const value of this.values) {
          const option = html("option", null, value.label ?? value.key);
          option.value = value.key;
          option.selected = value.key === this.state.valueKey;
          select.appendChild(option);
        }
        select.addEventListener("change", () => this.change({ valueKey: select.value }));
        header.appendChild(select);
      } else {
        header.appendChild(html("span", "pivot-chart__title", definition?.label ?? definition?.key ?? ""));
      }

      const types = html("div", "pivot-chart__types");
      types.setAttribute("role", "group");
      types.setAttribute("aria-label", this.texts.chartType);
      for (const type of CHART_TYPES) {
        const button = html("button", "pivot-chart__type", this.texts[type]);
        button.type = "button";
        button.dataset.chartType = type;
        button.setAttribute("aria-pressed", String(type === this.state.type));
        button.addEventListener("click", () => {
          if (type !== this.state.type) {
            this.change({ type });
          }
        });
        types.appendChild(button);
      }
      header.appendChild(types);
      return header;
    }

    // Only for two series or more: one series is named by the header already.
    createLegend() {
      if (this.model.series.length < 2) {
        return null;
      }

      const legend = html("ul", "pivot-chart__legend");
      this.model.series.forEach((series, index) => {
        const item = html("li", "pivot-chart__legend-item");
        const swatch = html("span", "pivot-chart__swatch");
        swatch.style.setProperty("--pivot-series", `var(--pt-series-${this.slots[index] + 1})`);
        swatch.setAttribute("aria-hidden", "true");
        item.append(swatch, html("span", null, series.label));
        legend.appendChild(item);
      });
      return legend;
    }

    createNote() {
      return this.model.totalSeries > this.model.series.length
        ? html("p", "pivot-chart__note", format(this.texts.seriesCapped, this.model.series.length, this.model.totalSeries))
        : null;
    }

    drawPlot(plot, definition) {
      const model = this.model;
      const type = this.state.type;
      const horizontal = type === "bar";
      const stacked = type === "stackedColumn";
      const grouped = type === "column" || type === "bar";
      const seriesCount = model.series.length;
      const categoryCount = model.categories.length;
      const tickFormat = axisFormatter(definition, this.options.culture);
      const extent = valueExtent(model, stacked);
      const ticks = niceTicks(extent.min, extent.max);
      const low = ticks[0];
      const high = ticks[ticks.length - 1];
      const tickTexts = ticks.map(tickFormat);

      const available = Math.max(240, Math.round(plot.clientWidth || this.host.clientWidth || 640));
      // A band holds a category's marks plus the air either side of them; a
      // chart with more categories than fit scrolls rather than squeezing its
      // bars to slivers.
      const markSize = grouped ? 24 : type === "stackedColumn" ? 24 : 0;
      const minBand = grouped ? Math.max(28, seriesCount * 10 + 12) : stacked ? 28 : 24;

      let width;
      let height;
      let margin;
      let band;
      if (horizontal) {
        const longest = Math.max(...model.categories.map(category => category.length));
        margin = { top: 8, right: 24, bottom: 28, left: Math.min(160, Math.max(48, longest * 6.6 + 12)) };
        const preferredBand = Math.min(48, Math.max(minBand, seriesCount * 14 + 12));
        band = Math.max(minBand, Math.min(preferredBand, (this.height - margin.top - margin.bottom) / categoryCount));
        width = available;
        height = Math.round(margin.top + margin.bottom + band * categoryCount);
      } else {
        const longestTick = Math.max(...tickTexts.map(text => text.length));
        margin = { top: 12, right: 16, bottom: 32, left: Math.max(36, longestTick * 6.6 + 14) };
        band = Math.max(minBand, (available - margin.left - margin.right) / categoryCount);
        width = Math.round(margin.left + margin.right + band * categoryCount);
        height = this.height;
      }

      const innerWidth = width - margin.left - margin.right;
      const innerHeight = height - margin.top - margin.bottom;
      // Value -> pixel along the value axis, from the plot's own origin.
      const scale = value => (horizontal
        ? ((value - low) / (high - low)) * innerWidth
        : innerHeight - ((value - low) / (high - low)) * innerHeight);
      const zero = scale(0);

      const node = svg("svg", {
        class: "pivot-chart__svg",
        width,
        height,
        viewBox: `0 0 ${width} ${height}`,
        role: "img",
        "aria-label": this.describe(definition)
      });
      const frame = svg("g", { transform: `translate(${margin.left},${margin.top})` });
      node.appendChild(frame);

      // The hovered category's band, under everything else.
      const highlight = svg("rect", { class: "pivot-chart__band", visibility: "hidden", "aria-hidden": "true" });
      frame.appendChild(highlight);

      // Recessive scaffolding next, so every mark is drawn over it.
      const grid = svg("g", { class: "pivot-chart__grid", "aria-hidden": "true" });
      ticks.forEach((tick, index) => {
        const at = Math.round(scale(tick)) + 0.5;
        const line = horizontal
          ? svg("line", { x1: at, x2: at, y1: 0, y2: innerHeight })
          : svg("line", { x1: 0, x2: innerWidth, y1: at, y2: at });
        if (tick === 0) {
          line.setAttribute("class", "pivot-chart__baseline");
        }
        grid.appendChild(line);
        const text = horizontal
          ? svg("text", { x: at, y: innerHeight + 18, "text-anchor": "middle" })
          : svg("text", { x: -8, y: at, "text-anchor": "end", "dominant-baseline": "middle" });
        text.textContent = tickTexts[index];
        grid.appendChild(text);
      });
      frame.appendChild(grid);

      // Category labels along the category axis, cut to their band.
      const axis = svg("g", { class: "pivot-chart__categories", "aria-hidden": "true" });
      model.categories.forEach((category, index) => {
        const center = band * index + band / 2;
        const text = horizontal
          ? svg("text", { x: -8, y: center, "text-anchor": "end", "dominant-baseline": "middle" })
          : svg("text", { x: center, y: innerHeight + 20, "text-anchor": "middle" });
        text.textContent = fitLabel(category, horizontal ? margin.left - 12 : band - 6);
        if (text.textContent !== category) {
          const title = svg("title");
          title.textContent = category;
          text.appendChild(title);
        }
        axis.appendChild(text);
      });
      frame.appendChild(axis);

      const marks = svg("g", { class: "pivot-chart__marks", "aria-hidden": "true" });
      frame.appendChild(marks);
      const color = index => `var(--pt-series-${this.slots[index] + 1})`;

      if (grouped) {
        const gap = 2;
        const size = Math.max(2, Math.min(markSize, (band * 0.72 - gap * (seriesCount - 1)) / seriesCount));
        const groupSize = size * seriesCount + gap * (seriesCount - 1);
        model.series.forEach((series, seriesIndex) => {
          series.values.forEach((value, index) => {
            if (value === null) {
              return;
            }
            const offset = band * index + (band - groupSize) / 2 + seriesIndex * (size + gap);
            const end = scale(value);
            const length = Math.abs(end - zero);
            const path = horizontal
              ? barPath(Math.min(zero, end), offset, length, size, 4, value < 0 ? "left" : "right")
              : barPath(offset, Math.min(zero, end), size, length, 4, value < 0 ? "bottom" : "top");
            marks.appendChild(svg("path", { d: path, fill: color(seriesIndex), class: "pivot-chart__bar" }));
          });
        });
      } else if (stacked) {
        const size = Math.max(4, Math.min(markSize, band * 0.6));
        model.categories.forEach((category, index) => {
          const offset = band * index + (band - size) / 2;
          let up = 0;
          let down = 0;
          const segments = model.series
            .map((series, seriesIndex) => ({ value: series.values[index], seriesIndex }))
            .filter(segment => segment.value !== null && segment.value !== 0);
          const lastUp = segments.filter(segment => segment.value > 0).pop();
          const lastDown = segments.filter(segment => segment.value < 0).pop();
          for (const segment of segments) {
            const from = segment.value > 0 ? up : down;
            const to = from + segment.value;
            if (segment.value > 0) {
              up = to;
            } else {
              down = to;
            }
            const outer = segment === lastUp || segment === lastDown;
            // A 2px cut of the surface between segments, taken from the
            // segment's outer end, so stacked pieces never fuse into one block.
            let top = Math.min(scale(from), scale(to));
            let length = Math.abs(scale(to) - scale(from));
            if (!outer && length > 3) {
              length -= 2;
              if (segment.value > 0) {
                top += 2;
              }
            }
            const end = outer ? (segment.value > 0 ? "top" : "bottom") : null;
            marks.appendChild(svg("path", {
              d: barPath(offset, top, size, length, 4, end),
              fill: color(segment.seriesIndex),
              class: "pivot-chart__bar"
            }));
          }
        });
      } else {
        model.series.forEach((series, seriesIndex) => {
          // A gap in the data is a gap in the line, not a dive to zero.
          let path = "";
          let drawing = false;
          series.values.forEach((value, index) => {
            if (value === null) {
              drawing = false;
              return;
            }
            const x = band * index + band / 2;
            path += `${drawing ? "L" : "M"}${x},${scale(value)}`;
            drawing = true;
          });
          marks.appendChild(svg("path", { d: path, stroke: color(seriesIndex), class: "pivot-chart__line" }));
          series.values.forEach((value, index) => {
            if (value !== null) {
              marks.appendChild(svg("circle", {
                cx: band * index + band / 2,
                cy: scale(value),
                r: 4,
                fill: color(seriesIndex),
                class: "pivot-chart__marker"
              }));
            }
          });
        });
      }

      const tooltip = html("div", "pivot-chart__tooltip");
      tooltip.setAttribute("role", "status");
      tooltip.hidden = true;

      const scroller = html("div", "pivot-chart__scroller");
      scroller.tabIndex = 0;
      scroller.setAttribute("aria-label", `${this.describe(definition)}. ${this.texts.keyboardHint}`);
      scroller.appendChild(node);
      plot.append(scroller, tooltip);

      const geometry = { horizontal, band, margin, innerWidth, innerHeight };
      const show = index => this.showCategory(index, { highlight, tooltip, scroller, geometry, definition });

      // The whole band answers, not only the mark: a thin bar or a 4px marker
      // is a hard target, and a reader comparing series wants all of them.
      scroller.addEventListener("pointermove", event => {
        const box = node.getBoundingClientRect();
        const along = horizontal
          ? event.clientY - box.top - margin.top
          : event.clientX - box.left - margin.left;
        const across = horizontal
          ? event.clientX - box.left - margin.left
          : event.clientY - box.top - margin.top;
        const inside = across >= 0 && across <= (horizontal ? innerWidth : innerHeight);
        const index = Math.floor(along / band);
        show(inside && index >= 0 && index < categoryCount ? index : -1);
      });
      scroller.addEventListener("pointerleave", () => show(-1));
      scroller.addEventListener("blur", () => {
        if (!this.redrawing) {
          show(-1);
        }
      });
      scroller.addEventListener("keydown", event => {
        const next = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (next) {
          event.preventDefault();
          const from = this.activeIndex < 0 ? (next > 0 ? -1 : categoryCount) : this.activeIndex;
          show(Math.max(0, Math.min(categoryCount - 1, from + next)));
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          show(event.key === "Home" ? 0 : categoryCount - 1);
        } else if (event.key === "Escape") {
          show(-1);
        }
      });

      if (this.activeIndex >= 0) {
        show(this.activeIndex);
      }
    }

    showCategory(index, { highlight, tooltip, scroller, geometry, definition }) {
      this.activeIndex = index;
      if (index < 0) {
        highlight.setAttribute("visibility", "hidden");
        tooltip.hidden = true;
        return;
      }

      const { horizontal, band, margin, innerWidth, innerHeight } = geometry;
      const start = band * index;
      for (const [name, value] of Object.entries(horizontal
        ? { x: 0, y: start, width: innerWidth, height: band }
        : { x: start, y: 0, width: band, height: innerHeight })) {
        highlight.setAttribute(name, String(value));
      }
      highlight.setAttribute("visibility", "visible");

      const formatValue = this.options.formatValue ?? (value => String(value));
      tooltip.replaceChildren(html("div", "pivot-chart__tooltip-title", this.model.categories[index]));
      this.model.series.forEach((series, seriesIndex) => {
        const row = html("div", "pivot-chart__tooltip-row");
        const swatch = html("span", "pivot-chart__swatch");
        swatch.style.setProperty("--pivot-series", `var(--pt-series-${this.slots[seriesIndex] + 1})`);
        swatch.setAttribute("aria-hidden", "true");
        const value = series.values[index];
        row.append(
          swatch,
          html("span", "pivot-chart__tooltip-label", series.label),
          html("span", "pivot-chart__tooltip-value", value === null ? "–" : formatValue(value, definition)));
        tooltip.appendChild(row);
      });
      tooltip.hidden = false;

      // Beside the band, flipped to its other side near the edge, and kept
      // inside the plot however far the chart has scrolled.
      const plotWidth = this.plotNode.clientWidth || innerWidth;
      const tipWidth = tooltip.offsetWidth || 160;
      const tipHeight = tooltip.offsetHeight || 60;
      let left;
      let top;
      if (horizontal) {
        left = margin.left + innerWidth / 2 - tipWidth / 2;
        top = margin.top + start + band + 4;
        if (top + tipHeight > this.plotNode.clientHeight) {
          top = margin.top + start - tipHeight - 4;
        }
      } else {
        const bandLeft = margin.left + start - scroller.scrollLeft;
        left = bandLeft + band + 8;
        if (left + tipWidth > plotWidth) {
          left = bandLeft - tipWidth - 8;
        }
        top = margin.top + 4;
      }
      tooltip.style.left = `${Math.max(0, Math.min(left, plotWidth - tipWidth))}px`;
      tooltip.style.top = `${Math.max(0, top)}px`;
    }

    // What a screen reader is told the picture is; the grid is the table view.
    describe(definition) {
      const typeText = this.texts[this.state.type] ?? this.state.type;
      const label = definition?.label ?? definition?.key ?? "";
      return `${this.texts.chart}: ${label} (${typeText})`;
    }

    dispose() {
      this.disposed = true;
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      this.host.replaceChildren();
    }
  }

  // DevExtreme's bindChart options. Its own fallback for an unknown display
  // mode is an axis per measure; that is named here so a typo is not silent.
  const DISPLAY_MODES = ["separateAxes", "singleAxis", "splitPanes"];
  const DATA_FIELD_PLACES = ["series", "args", "both"];

  function pickName(value, names, option) {
    if (value === undefined || value === null) {
      return null;
    }

    const found = names.find(name => name.toLowerCase() === String(value).toLowerCase());
    if (!found) {
      throw new Error(`Unknown ${option} "${value}". Expected one of: ${names.join(", ")}.`);
    }

    return found;
  }

  function normalizeBinding(options = {}) {
    if (typeof options !== "object" || options === null) {
      throw new Error("bindChart options must be an object.");
    }

    for (const name of ["processCell", "customizeSeries", "customizeChart"]) {
      if (options[name] !== undefined && options[name] !== null && typeof options[name] !== "function") {
        throw new Error(`bindChart ${name} must be a function.`);
      }
    }

    return {
      dataFieldsDisplayMode: pickName(options.dataFieldsDisplayMode, DISPLAY_MODES, "dataFieldsDisplayMode") ??
        "separateAxes",
      putDataFieldsInto: pickName(options.putDataFieldsInto, DATA_FIELD_PLACES, "putDataFieldsInto"),
      alternateDataFields: options.alternateDataFields !== false,
      inverted: options.inverted === true,
      processCell: options.processCell ?? null,
      customizeSeries: options.customizeSeries ?? null,
      customizeChart: options.customizeChart ?? null
    };
  }

  function pathKey(path) {
    return path.map(value => value ?? "").join("\u001f");
  }

  // Every path an axis shows, the grand total first, then each group before
  // the groups and items inside it, in the engine's order. A path under a
  // collapsed group is not on screen and is left out; the collapsed group
  // itself stays, as the one total it is folded to.
  function axisPaths(headers, collapsed) {
    const paths = [{ path: [], index: null }];
    const seen = new Set();
    const hidden = path => {
      for (let level = 1; level < path.length; level++) {
        if (collapsed?.has(pathKey(path.slice(0, level)))) {
          return true;
        }
      }
      return false;
    };

    (headers ?? []).forEach((header, index) => {
      if (!header?.length) {
        return;
      }

      for (let level = 1; level <= header.length; level++) {
        const path = header.slice(0, level);
        const key = pathKey(path);
        if (seen.has(key) || hidden(path)) {
          continue;
        }

        seen.add(key);
        paths.push({ path, index: level === header.length ? index : null });
      }
    });

    return paths;
  }

  function deepMerge(target, source) {
    if (Array.isArray(source)) {
      const base = Array.isArray(target) ? [...target] : [];
      source.forEach((item, index) => {
        base[index] = deepMerge(base[index], item);
      });
      return base;
    }

    if (source && typeof source === "object" && !(source instanceof Function)) {
      const base = target && typeof target === "object" && !Array.isArray(target) ? { ...target } : {};
      for (const [name, value] of Object.entries(source)) {
        base[name] = deepMerge(base[name], value);
      }
      return base;
    }

    return source === undefined ? target : source;
  }

  // What DevExtreme's bindChart writes to a chart, read off a pivot result:
  // one data item per row path x column path x measure, totals included, of
  // which only the deepest level showing on each axis is charted unless
  // processCell says otherwise. context carries what the result does not:
  //   values            the measures on screen (key, label, format...)
  //   rowFields         the row fields, columnFields likewise
  //   collapsedRows     keys of the folded row groups, collapsedColumns likewise
  //   grandTotalText    the grand total's name on either axis
  //   formatPath        (value) => the header text the grid shows
  //   formatValue       (value, valueDefinition) => the grid's text for a value
  function chartBinding(result, context = {}, options = {}) {
    const settings = normalizeBinding(options);
    const values = context.values ?? [];
    const grandTotalText = context.grandTotalText ?? "Grand Total";
    const formatPath = context.formatPath ??
      (value => (value === null || value === undefined || value === "" ? TEXTS.blank : String(value)));
    const formatValue = context.formatValue ?? (value => String(value));
    const rowHeaders = result?.rowHeaders ?? [];
    const columnHeaders = result?.columnHeaders ?? [];
    const rowDepth = Math.max(0, ...rowHeaders.map(header => header?.length ?? 0));
    const columnDepth = Math.max(0, ...columnHeaders.map(header => header?.length ?? 0));

    const cells = new Map((result?.cells ?? []).map(cell => [`${cell.row}:${cell.column}`, cell.values]));
    const rowTotals = new Map((result?.rowTotals ?? []).map(total => [total.index, total.values]));
    const columnTotals = new Map((result?.columnTotals ?? []).map(total => [total.index, total.values]));
    const subtotals = new Map((result?.subtotals ?? []).map(subtotal => [pathKey(subtotal.rowHeader ?? []), subtotal]));
    const columnSubtotals = new Map((result?.columnSubtotals ?? [])
      .map(subtotal => [pathKey(subtotal.columnHeader ?? []), subtotal]));

    // The nine crossings of a leaf, a group and the grand total on each axis.
    const read = (row, column) => {
      const rowGrand = row.path.length === 0;
      const columnGrand = column.path.length === 0;
      if (rowGrand && columnGrand) {
        return result?.grandTotals;
      }
      if (rowGrand) {
        if (column.index !== null) {
          return columnTotals.get(column.index) ?? (rowDepth === 0 ? cells.get(`0:${column.index}`) : undefined);
        }
        return columnSubtotals.get(pathKey(column.path))?.totals;
      }
      if (row.index !== null) {
        if (columnGrand) {
          return rowTotals.get(row.index) ?? (columnDepth === 0 ? cells.get(`${row.index}:0`) : undefined);
        }
        return column.index !== null
          ? cells.get(`${row.index}:${column.index}`)
          : columnSubtotals.get(pathKey(column.path))?.cells?.find(cell => cell.index === row.index)?.values;
      }

      const group = subtotals.get(pathKey(row.path));
      if (columnGrand) {
        return group?.totals;
      }
      if (column.index !== null) {
        return group?.cells?.find(cell => cell.column === column.index)?.values;
      }
      const key = pathKey(column.path);
      return group?.columnSubtotals?.find(cell => pathKey(cell.columnHeader ?? []) === key)?.values;
    };

    const rows = axisPaths(rowHeaders, context.collapsedRows);
    const columns = axisPaths(columnHeaders, context.collapsedColumns);
    const maxRowLevel = Math.max(...rows.map(row => row.path.length));
    const maxColumnLevel = Math.max(...columns.map(column => column.path.length));
    const texts = path => (path.length === 0 ? [grandTotalText] : path.map(formatPath));
    const multiple = values.length > 1;
    const place = settings.putDataFieldsInto ??
      (multiple && settings.dataFieldsDisplayMode !== "singleAxis" ? "series" : null);
    const intoSeries = place === "series" || place === "both";
    const intoArgs = place === "args" || place === "both";

    const dataSource = [];
    // Which measure a series plots, for the axis (and pane) it is drawn on.
    const seriesFields = new Map();
    const emit = (row, column, dataIndex) => {
      const definition = values[dataIndex];
      const rowTexts = texts(row.path);
      const columnTexts = texts(column.path);
      const measure = definition.label ?? definition.key;
      let series = (settings.inverted ? columnTexts : rowTexts).join(" - ");
      let arg = (settings.inverted ? rowTexts : columnTexts).join("/");
      if (intoSeries) {
        series += ` | ${measure}`;
      }
      if (intoArgs) {
        arg += ` | ${measure}`;
      }

      const cellValues = read(row, column);
      const dataValues = values.map(value => readValue(cellValues, value.key));
      const cell = {
        rowPath: [...row.path],
        rowPathFormatted: row.path.map(formatPath),
        rowFields: context.rowFields ?? [],
        maxRowLevel,
        columnPath: [...column.path],
        columnPathFormatted: column.path.map(formatPath),
        columnFields: context.columnFields ?? [],
        maxColumnLevel,
        dataFields: values,
        dataIndex,
        dataValues,
        visible: row.path.length === maxRowLevel && column.path.length === maxColumnLevel,
        chartDataItem: { series, arg, val: dataValues[dataIndex] }
      };

      const changed = settings.processCell?.(cell);
      if (changed && typeof changed === "object") {
        const item = changed.chartDataItem ? { ...cell.chartDataItem, ...changed.chartDataItem } : cell.chartDataItem;
        Object.assign(cell, changed, { chartDataItem: item });
      }

      if (cell.visible) {
        dataSource.push(cell.chartDataItem);
        seriesFields.set(cell.chartDataItem.series, definition);
      }
    };

    if (settings.alternateDataFields) {
      rows.forEach(row => columns.forEach(column => values.forEach((_, index) => emit(row, column, index))));
    } else {
      values.forEach((_, index) => rows.forEach(row => columns.forEach(column => emit(row, column, index))));
    }

    const mode = settings.dataFieldsDisplayMode;
    const axisOf = definition => ({
      name: definition.key,
      title: definition.label ?? definition.key,
      valueType: "numeric",
      label: { customizeText: info => formatValue(info.value, definition) },
      ...(mode === "splitPanes" ? { pane: definition.key } : {})
    });
    let chartOptions = {
      valueAxis: mode === "singleAxis" || values.length === 0
        ? [{
          valueType: "numeric",
          ...(values.length === 1 ? { title: values[0].label ?? values[0].key } : {}),
          label: { customizeText: info => formatValue(info.value, values[0] ?? null) }
        }]
        : values.map(axisOf),
      ...(mode === "splitPanes" ? { panes: values.map(value => ({ name: value.key })) } : {})
    };
    if (settings.customizeChart) {
      const changed = settings.customizeChart(chartOptions);
      if (changed && typeof changed === "object") {
        chartOptions = deepMerge(chartOptions, changed);
      }
    }

    return {
      dataSource,
      seriesTemplate: {
        nameField: "series",
        customizeSeries: seriesName => {
          const definition = seriesFields.get(seriesName);
          const seriesOptions = {};
          if (definition && mode !== "singleAxis" && values.length > 0) {
            seriesOptions.axis = definition.key;
            if (mode === "splitPanes") {
              seriesOptions.pane = definition.key;
            }
          }
          return settings.customizeSeries?.(seriesName, seriesOptions) ?? seriesOptions;
        }
      },
      ...chartOptions
    };
  }

  PivotChart.TYPES = CHART_TYPES;
  PivotChart.TEXTS = TEXTS;
  PivotChart.MAX_SERIES = MAX_SERIES;
  PivotChart.normalize = normalizeChart;
  PivotChart.model = chartModel;
  PivotChart.niceTicks = niceTicks;
  PivotChart.axisFormatter = axisFormatter;
  PivotChart.SeriesColors = SeriesColors;
  PivotChart.binding = chartBinding;
  PivotChart.normalizeBinding = normalizeBinding;
  PivotChart.DISPLAY_MODES = DISPLAY_MODES;
  PivotForge.PivotChart = PivotChart;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PivotChart;
  }
})(typeof window !== "undefined" ? window : globalThis);
