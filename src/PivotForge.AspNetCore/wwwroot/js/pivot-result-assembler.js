(function (root) {
  const PivotForge = root.PivotForge ??= {};

  // The browser half of PivotEngine: everything the engine does after it has
  // summed the records. RemoteStore hands it summaries a DataSourceLoader
  // backend grouped, and it builds the same result the /pivot endpoint would --
  // the same headers in the same order, the same totals, the same display
  // modes -- so the renderer cannot tell where a grid's numbers came from. Each
  // stage keeps its C# counterpart's name, so the two can be read side by side.

  const RANGE_SEPARATOR = " – ";

  // ---- Labels and their order (PivotGroupLabels) ----

  const cultures = new Map();

  function cultureInfo(culture) {
    const name = culture || (typeof navigator !== "undefined" ? navigator.language : null) || "en-US";
    let info = cultures.get(name);
    if (info) {
      return info;
    }

    const month = new Intl.DateTimeFormat(name, { month: "long", timeZone: "UTC" });
    const weekday = new Intl.DateTimeFormat(name, { weekday: "long", timeZone: "UTC" });
    // 7 January 2001 was a Sunday, so day i is .NET's DayOfWeek i.
    const days = Array.from({ length: 7 }, (_, day) => weekday.format(Date.UTC(2001, 0, 7 + day)));
    const number = new Intl.NumberFormat(name, { maximumFractionDigits: 12, useGrouping: true });
    const parts = number.formatToParts(1234567.5);

    info = {
      name,
      months: Array.from({ length: 12 }, (_, index) => month.format(Date.UTC(2001, index, 1))),
      days,
      firstDay: firstDayOfWeek(name),
      group: parts.find(part => part.type === "group")?.value ?? ",",
      decimal: parts.find(part => part.type === "decimal")?.value ?? ".",
      number,
      // StringComparer.Create(culture, ignoreCase: true / false).
      ignoreCase: new Intl.Collator(name, { sensitivity: "accent" }),
      collator: new Intl.Collator(name)
    };
    cultures.set(name, info);
    return info;
  }

  function firstDayOfWeek(name) {
    try {
      const locale = new Intl.Locale(name);
      const week = locale.getWeekInfo?.() ?? locale.weekInfo;
      if (week?.firstDay) {
        return week.firstDay % 7;
      }
    } catch {
      // An engine without week data falls through to the common default.
    }

    return /-US$/i.test(name) || name === "en" ? 0 : 1;
  }

  function ordinal(left, right) {
    return left === right ? 0 : left < right ? -1 : 1;
  }

  // Number labels are the invariant text of the value, as the engine writes them.
  function invariantNumber(value) {
    return Number.isInteger(value) && Math.abs(value) < 1e21
      ? String(value)
      : value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
  }

  const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:\d{2})?$/;

  function isIsoDate(value) {
    return typeof value === "string" && ISO_DATE.test(value);
  }

  // Convert.ToString(date, InvariantCulture): a date as MM/dd/yyyy HH:mm:ss, a
  // date-only value without the time, an offset after it.
  function invariantDate(text) {
    const match = ISO_DATE.exec(text);
    if (!match) {
      return text;
    }

    const [, year, month, day, hour, minute, second, zone] = match;
    const date = `${month}/${day}/${year}`;
    if (hour === undefined) {
      return date;
    }

    const time = `${date} ${hour}:${minute}:${second ?? "00"}`;
    return zone && zone !== "Z" ? `${time} ${zone}` : time;
  }

  // The kind a level's values arrived as (LevelKinds).
  function kindOf(value, declared) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    if (typeof value === "number") {
      return "Number";
    }

    if (declared === "Date" || (declared !== "String" && isIsoDate(value))) {
      return "Date";
    }

    return "Auto";
  }

  function createLabels(culture) {
    const info = cultureInfo(culture);

    function text(value, kind) {
      if (value === null || value === undefined) {
        return "";
      }

      if (typeof value === "number") {
        return invariantNumber(value);
      }

      if (typeof value === "boolean") {
        return value ? "True" : "False";
      }

      return kind === "Date" ? invariantDate(String(value)) : String(value);
    }

    function formatBound(bound) {
      return info.number.format(bound);
    }

    function rangeLabel(value, binSize) {
      const start = Math.floor(value / binSize) * binSize;
      return `${formatBound(start)}${RANGE_SEPARATOR}${formatBound(start + binSize)}`;
    }

    function parseCultureNumber(textValue) {
      const normalized = String(textValue).trim()
        .split(info.group).join("")
        .split(info.decimal).join(".");
      return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(normalized) ? Number(normalized) : null;
    }

    function rangeStart(labelText) {
      const separator = labelText?.indexOf(RANGE_SEPARATOR) ?? -1;
      return separator > 0 ? parseCultureNumber(labelText.slice(0, separator)) : null;
    }

    // A group key from the server, as the header the engine would have written.
    function label(value, interval, binSize, kind) {
      if (!interval || value === null || value === undefined || value === "") {
        return text(value, kind);
      }

      if (typeof value !== "number") {
        return text(value, kind);
      }

      switch (interval) {
        case "range":
          return binSize > 0 ? rangeLabel(value, binSize) : text(value, kind);
        case "year":
        case "day":
          return String(value);
        case "quarter":
          return `Q${value}`;
        case "month":
          return info.months[value - 1] ?? String(value);
        case "dayOfWeek":
          return info.days[value] ?? String(value);
        default:
          return text(value, kind);
      }
    }

    function ordinalComparer(ordinalOf) {
      return (left, right) => {
        const first = ordinalOf(left);
        const second = ordinalOf(right);
        if (first !== null && second !== null) {
          return first - second;
        }

        if (first === null && second === null) {
          return ordinal(left, right);
        }

        return first === null ? 1 : -1;
      };
    }

    function numberComparer(numberOf) {
      return (left, right) => {
        const first = numberOf(left);
        const second = numberOf(right);
        if (first !== null && second !== null) {
          return first < second ? -1 : first > second ? 1 : 0;
        }

        if (first === null && second === null) {
          return ordinal(left, right);
        }

        return first === null ? 1 : -1;
      };
    }

    function fromNames(names) {
      const order = new Map();
      names.forEach((name, index) => {
        const folded = name.toLocaleLowerCase(info.name);
        if (!order.has(folded)) {
          order.set(folded, index);
        }
      });

      return ordinalComparer(labelText => labelText === null || labelText === undefined
        ? null
        : order.get(String(labelText).toLocaleLowerCase(info.name)) ?? null);
    }

    function integer(labelText) {
      return typeof labelText === "string" && /^[+-]?\d+$/.test(labelText.trim()) ? Number(labelText) : null;
    }

    function intervalOrder(interval) {
      switch (interval) {
        case "year":
        case "day":
          return ordinalComparer(integer);
        case "quarter":
          return ordinalComparer(labelText =>
            typeof labelText === "string" && labelText.length === 2 && labelText[0] === "Q" && /\d/.test(labelText[1])
              ? Number(labelText[1])
              : null);
        case "month":
          return fromNames(info.months);
        case "dayOfWeek":
          return fromNames(Array.from({ length: 7 }, (_, offset) => info.days[(info.firstDay + offset) % 7]));
        case "range":
          return numberComparer(rangeStart);
        default:
          return null;
      }
    }

    function invariantNumberOf(labelText) {
      const trimmed = typeof labelText === "string" ? labelText.trim() : "";
      return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed) ? Number(trimmed) : null;
    }

    function dateNumberOf(labelText) {
      if (!labelText) {
        return null;
      }

      const invariant = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}):(\d{2}))?/.exec(labelText);
      if (invariant) {
        const [, month, day, year, hour = "0", minute = "0", second = "0"] = invariant;
        return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
      }

      const parsed = Date.parse(labelText);
      return Number.isNaN(parsed) ? null : parsed;
    }

    function typeOrder(type) {
      switch (type) {
        case "Number":
          return numberComparer(invariantNumberOf);
        case "Date":
          return numberComparer(dateNumberOf);
        default:
          return null;
      }
    }

    return {
      culture: info,
      label,
      text,
      intervalOrder,
      typeOrder,
      rangeStart,
      parseCultureNumber,
      dateNumberOf,
      invariantNumberOf,
      ignoreCase: (left, right) => info.ignoreCase.compare(left ?? "", right ?? ""),
      collate: (left, right) => info.collator.compare(left ?? "", right ?? "")
    };
  }

  // ---- Shared pieces ----

  const keyOf = path => JSON.stringify(path);

  function levelKey(level) {
    if (typeof level === "string") {
      return level;
    }

    if (level.interval === "range") {
      return `${level.field}:range${level.binSize ?? ""}`;
    }

    return level.interval ? `${level.field}:${level.interval}` : level.field;
  }

  function levelField(level) {
    return typeof level === "string" ? level : level.field;
  }

  function levelInterval(level) {
    return typeof level === "string" ? null : level.interval ?? null;
  }

  function valueKey(value) {
    return `${value.field}_${String(value.aggregation).toLowerCase()}`;
  }

  function startsWith(header, prefix) {
    return header.length >= prefix.length && prefix.every((value, level) => header[level] === value);
  }

  function getValue(values, key) {
    if (!values) {
      return null;
    }

    const value = values[key];
    return value === undefined ? null : value;
  }

  const difference = (current, previous) => (current === null || previous === null ? null : current - previous);
  const divide = (numerator, denominator) =>
    numerator === null || denominator === null || denominator === 0 ? null : numerator / denominator;
  const oneWhenNonZero = value => (value === null || value === 0 ? null : 1);

  const isVariation = definition =>
    definition.showAs === "differenceFromPrevious" || definition.showAs === "percentDifferenceFromPrevious";
  const isParentShare = definition =>
    definition.showAs === "percentOfParentRowTotal" || definition.showAs === "percentOfParentColumnTotal";

  // ---- Axis order (AxisOrder, ValueComparer, ResolveLevelSorts) ----

  function namesLevel(name, level) {
    return name === levelKey(level) || name === levelField(level);
  }

  function resolveLevelSorts(levels, fieldSorts) {
    if (!fieldSorts || fieldSorts.length === 0) {
      return [];
    }

    return levels.map(level => fieldSorts.find(sort => namesLevel(sort.field, level)) ?? null);
  }

  function valueComparer(level, observed, dataTypes, labels) {
    return labels.intervalOrder(level ? levelInterval(level) : null) ??
      labels.typeOrder(observed) ??
      labels.typeOrder(level ? dataTypeOf(levelField(level), dataTypes) : null) ??
      labels.ignoreCase;
  }

  function dataTypeOf(field, dataTypes) {
    if (!field || !dataTypes) {
      return null;
    }

    const lower = field.toLowerCase();
    const entry = Object.entries(dataTypes).find(([name]) => name.toLowerCase() === lower);
    return entry ? entry[1] : null;
  }

  // A rank map orders a level's labels the way the source keeps its members
  // (an OLAP cube's member order) instead of by what the labels say.
  function rankComparer(ranks) {
    if (!ranks) {
      return null;
    }

    const rankOf = label => ranks.get(label) ?? Number.MAX_SAFE_INTEGER;
    return (left, right) => rankOf(left) - rankOf(right);
  }

  function axisOrder(levels, sorts, kinds, dataTypes, labels, arrival, ranks = []) {
    const neutral = [];
    const byLabel = [];
    const ranked = levels.map((_, index) => rankComparer(ranks[index] ?? null));

    levels.forEach((level, index) => {
      const sort = sorts[index] ?? null;
      const value = ranked[index] ?? valueComparer(level, kinds[index] ?? null, dataTypes, labels);
      neutral[index] = value;
      byLabel[index] = sort?.sortBy === "DisplayText" ? labels.ignoreCase
        : sort?.sortBy === "None" ? null
          : value;
    });

    const labelsAt = level => (level < byLabel.length ? byLabel[level] : labels.ignoreCase);

    return {
      direction: level => sorts[level]?.direction ?? null,
      labels: labelsAt,
      neutral: level => (level < neutral.length ? neutral[level] : labels.ignoreCase),
      ranked: level => ranked[level] ?? null,
      compare(left, right, level) {
        const comparer = labelsAt(level);
        return comparer
          ? comparer(left[level] ?? null, right[level] ?? null)
          : arrival(left, level) - arrival(right, level);
      }
    };
  }

  function rowAxisOrder(levels, sorts, kinds, dataTypes, labels, arrivedHeaders, ranks) {
    let firstSeen = null;
    return axisOrder(levels, sorts, kinds, dataTypes, labels, (path, level) => {
      if (!firstSeen) {
        firstSeen = new Map();
        arrivedHeaders.forEach((header, index) => {
          for (let depth = 1; depth <= header.length; depth++) {
            const key = keyOf(header.slice(0, depth));
            if (!firstSeen.has(key)) {
              firstSeen.set(key, index);
            }
          }
        });
      }

      return firstSeen.get(keyOf(path.slice(0, level + 1))) ?? Number.MAX_SAFE_INTEGER;
    }, ranks);
  }

  function columnAxisOrder(levels, sorts, kinds, dataTypes, labels, levelValues, levelRanks) {
    const ranks = levelValues.map(values => {
      const rank = new Map();
      let blank = Number.MAX_SAFE_INTEGER;
      values.forEach((value, index) => {
        if (value !== null && value !== undefined) {
          if (!rank.has(value)) {
            rank.set(value, index);
          }
        } else {
          blank = Math.min(blank, index);
        }
      });
      return { rank, blank };
    });

    return axisOrder(levels, sorts, kinds, dataTypes, labels, (path, level) => {
      const value = path[level];
      return value !== null && value !== undefined
        ? ranks[level].rank.get(value) ?? Number.MAX_SAFE_INTEGER
        : ranks[level].blank;
    }, levelRanks);
  }

  // A stable sort by comparer, LINQ's OrderBy.
  function orderBy(items, compare) {
    return items
      .map((item, index) => ({ item, index }))
      .sort((left, right) => compare(left.item, right.item) || left.index - right.index)
      .map(entry => entry.item);
  }

  // ---- Column headers (CreateColumnHeaders, OrderColumnLevels) ----

  function createColumnHeaders(observedHeaders, levelValues, levels, order, neutral, labels) {
    if (observedHeaders.length === 0) {
      return observedHeaders;
    }

    const ordered = levelValues.map((values, level) => {
      if (neutral) {
        return orderBy(values, order.neutral(level));
      }

      const direction = order.direction(level);
      if (direction) {
        const comparer = order.labels(level);
        if (comparer) {
          return direction === "Descending"
            ? orderBy(values, (left, right) => comparer(right, left))
            : orderBy(values, comparer);
        }

        return direction === "Descending" ? [...values].reverse() : values;
      }

      // An undeclared level keeps its arrival order, unless its labels are an
      // interval's, whose order the engine knows, or the source ranked them.
      const known = labels.intervalOrder(levels[level] ? levelInterval(levels[level]) : null) ?? order.ranked(level);
      return known ? orderBy(values, known) : values;
    });

    const headers = [];
    const append = (current, level) => {
      if (level === ordered.length) {
        headers.push([...current]);
        return;
      }

      for (const value of ordered[level]) {
        current.push(value);
        append(current, level + 1);
        current.pop();
      }
    };
    append([], 0);
    return headers;
  }

  function orderColumnSubtotals(subtotals, columnHeaders) {
    const lastColumn = subtotal => {
      for (let column = columnHeaders.length - 1; column >= 0; column--) {
        if (startsWith(columnHeaders[column], subtotal.columnHeader)) {
          return column;
        }
      }

      return -1;
    };

    return orderBy(subtotals, (left, right) =>
      lastColumn(left) - lastColumn(right) || right.columnHeader.length - left.columnHeader.length);
  }

  // ---- Display modes (TransformValues and its helpers) ----

  function groupStarts(columnHeaders) {
    const starts = new Array(columnHeaders.length).fill(false);
    for (let column = 1; column < columnHeaders.length; column++) {
      const header = columnHeaders[column];
      starts[column] = !startsWith(columnHeaders[column - 1], header.slice(0, Math.max(0, header.length - 1)));
    }

    return starts;
  }

  function startsAfresh(definition, starts, column) {
    return definition.allowCrossGroupCalculation === false && column < starts.length && starts[column];
  }

  function transformCellValue(raw, rowTotal, columnTotal, grandTotal, previous, runningTotal, showAs) {
    switch (showAs) {
      case "percentOfRowTotal": return divide(raw, rowTotal);
      case "percentOfColumnTotal": return divide(raw, columnTotal);
      case "percentOfGrandTotal": return divide(raw, grandTotal);
      case "differenceFromPrevious": return difference(raw, previous);
      case "percentDifferenceFromPrevious": return divide(difference(raw, previous), previous);
      case "runningTotal": return runningTotal;
      default: return raw;
    }
  }

  function transformRowTotal(raw, grandTotal, showAs) {
    switch (showAs) {
      case "percentOfRowTotal": return oneWhenNonZero(raw);
      case "percentOfColumnTotal":
      case "percentOfGrandTotal": return divide(raw, grandTotal);
      case "differenceFromPrevious":
      case "percentDifferenceFromPrevious": return null;
      default: return raw;
    }
  }

  function transformColumnTotal(raw, grandTotal, previous, runningTotal, showAs) {
    switch (showAs) {
      case "percentOfRowTotal":
      case "percentOfGrandTotal": return divide(raw, grandTotal);
      case "percentOfColumnTotal": return oneWhenNonZero(raw);
      case "differenceFromPrevious": return difference(raw, previous);
      case "percentDifferenceFromPrevious": return divide(difference(raw, previous), previous);
      case "runningTotal": return runningTotal;
      default: return raw;
    }
  }

  function transformGrandTotal(raw, showAs) {
    switch (showAs) {
      case "percentOfRowTotal":
      case "percentOfColumnTotal":
      case "percentOfGrandTotal": return oneWhenNonZero(raw);
      case "differenceFromPrevious":
      case "percentDifferenceFromPrevious": return null;
      default: return raw;
    }
  }

  function transformColumnSubtotal(raw, rowTotal, columnTotal, grandTotal, showAs) {
    switch (showAs) {
      case "percentOfRowTotal": return divide(raw, rowTotal);
      case "percentOfColumnTotal": return divide(raw, columnTotal);
      case "percentOfGrandTotal": return divide(raw, grandTotal);
      case "differenceFromPrevious":
      case "percentDifferenceFromPrevious": return null;
      default: return raw;
    }
  }

  function transformCellMatrix(rowCount, columnCount, starts, definitions, rawCells, rawRowTotals, rawColumnTotals, rawGrandTotals) {
    const valuesByCell = new Map();
    for (const key of rawCells.keys()) {
      valuesByCell.set(key, {});
    }

    for (let row = 0; row < rowCount; row++) {
      for (const definition of definitions) {
        const key = valueKey(definition);
        let runningTotal = 0;
        let hasRunningTotal = false;
        let previous = null;

        for (let column = 0; column < columnCount; column++) {
          if (startsAfresh(definition, starts, column)) {
            runningTotal = 0;
            hasRunningTotal = false;
            previous = null;
          }

          const cellKey = `${row},${column}`;
          const raw = getValue(rawCells.get(cellKey), key);
          if (raw !== null) {
            runningTotal += raw;
            hasRunningTotal = true;
          }

          const transformed = transformCellValue(
            raw,
            getValue(rawRowTotals.get(row), key),
            getValue(rawColumnTotals.get(column), key),
            getValue(rawGrandTotals, key),
            previous,
            hasRunningTotal ? runningTotal : null,
            definition.showAs);

          if (transformed !== null || valuesByCell.has(cellKey)) {
            if (!valuesByCell.has(cellKey)) {
              valuesByCell.set(cellKey, {});
            }

            valuesByCell.get(cellKey)[key] = transformed;
          }

          if (raw !== null) {
            previous = raw;
          }
        }
      }
    }

    return [...valuesByCell]
      .map(([cellKey, values]) => {
        const [row, column] = cellKey.split(",").map(Number);
        return { row, column, values };
      })
      .sort((left, right) => left.row - right.row || left.column - right.column);
  }

  function transformRowTotalValues(rawValues, definitions, rawGrandTotals) {
    return Object.fromEntries(definitions.map(definition => [
      valueKey(definition),
      transformRowTotal(getValue(rawValues, valueKey(definition)), getValue(rawGrandTotals, valueKey(definition)), definition.showAs)
    ]));
  }

  function transformColumnSubtotalValues(rawValues, rawRowTotals, rawColumnTotals, definitions, rawGrandTotals) {
    return Object.fromEntries(definitions.map(definition => {
      const key = valueKey(definition);
      return [key, transformColumnSubtotal(
        getValue(rawValues, key),
        getValue(rawRowTotals, key),
        getValue(rawColumnTotals, key),
        getValue(rawGrandTotals, key),
        definition.showAs)];
    }));
  }

  function transformColumnTotals(columnCount, starts, definitions, rawColumnTotals, rawGrandTotals) {
    const totals = Array.from({ length: columnCount }, () => ({}));

    for (const definition of definitions) {
      const key = valueKey(definition);
      let runningTotal = 0;
      let hasRunningTotal = false;
      let previous = null;

      for (let column = 0; column < columnCount; column++) {
        if (startsAfresh(definition, starts, column)) {
          runningTotal = 0;
          hasRunningTotal = false;
          previous = null;
        }

        const raw = getValue(rawColumnTotals.get(column), key);
        if (raw !== null) {
          runningTotal += raw;
          hasRunningTotal = true;
        }

        totals[column][key] = transformColumnTotal(
          raw, getValue(rawGrandTotals, key), previous, hasRunningTotal ? runningTotal : null, definition.showAs);
        if (raw !== null) {
          previous = raw;
        }
      }
    }

    return totals.map((values, index) => ({ index, values }));
  }

  function transformValues(rowHeaders, columnHeaders, definitions, raw) {
    const starts = groupStarts(columnHeaders);
    const rowTotalLookup = new Map(raw.rowTotals.map(total => [total.index, total.values]));
    const columnTotalLookup = new Map(raw.columnTotals.map(total => [total.index, total.values]));
    const cellLookup = new Map(raw.cells.map(cell => [`${cell.row},${cell.column}`, cell.values]));
    const columnSubtotalTotals = new Map(raw.columnSubtotals.map(subtotal => [keyOf(subtotal.columnHeader), subtotal.totals]));

    const result = {
      cells: transformCellMatrix(rowHeaders.length, columnHeaders.length, starts, definitions,
        cellLookup, rowTotalLookup, columnTotalLookup, raw.grandTotals),
      rowTotals: raw.rowTotals.map(total => ({
        index: total.index,
        values: transformRowTotalValues(total.values, definitions, raw.grandTotals)
      })),
      columnTotals: transformColumnTotals(columnHeaders.length, starts, definitions, columnTotalLookup, raw.grandTotals),
      subtotals: raw.subtotals.map(subtotal => ({
        rowHeader: subtotal.rowHeader,
        cells: transformCellMatrix(1, columnHeaders.length, starts, definitions,
          new Map(subtotal.cells.map(cell => [`0,${cell.column}`, cell.values])),
          new Map([[0, subtotal.totals]]), columnTotalLookup, raw.grandTotals),
        totals: transformRowTotalValues(subtotal.totals, definitions, raw.grandTotals),
        columnSubtotals: subtotal.columnSubtotals.map(cell => ({
          columnHeader: cell.columnHeader,
          values: transformColumnSubtotalValues(cell.values, subtotal.totals,
            columnSubtotalTotals.get(keyOf(cell.columnHeader)), definitions, raw.grandTotals)
        }))
      })),
      columnSubtotals: raw.columnSubtotals.map(subtotal => ({
        columnHeader: subtotal.columnHeader,
        cells: subtotal.cells.map(cell => ({
          index: cell.index,
          values: transformColumnSubtotalValues(cell.values, rowTotalLookup.get(cell.index),
            subtotal.totals, definitions, raw.grandTotals)
        })),
        // Its own cell in the grand total row: its row total is the grand total,
        // and it is its own column total.
        totals: transformColumnSubtotalValues(subtotal.totals, raw.grandTotals, subtotal.totals, definitions, raw.grandTotals)
      })),
      grandTotals: Object.fromEntries(definitions.map(definition => [
        valueKey(definition),
        transformGrandTotal(getValue(raw.grandTotals, valueKey(definition)), definition.showAs)
      ]))
    };

    return definitions.some(definition => isParentShare(definition) || isVariation(definition))
      ? applyNavigatedCalculations(result, definitions, parentShareSource(rowHeaders, columnHeaders, raw))
      : result;
  }

  // An axis reference: a header (index and path), a group (path) or the root.
  const ROOT = { index: null, path: [] };
  const groupRef = path => (path.length === 0 ? ROOT : { index: null, path });
  const isRoot = ref => ref.index === null && ref.path.length === 0;
  const parentOf = ref => (isRoot(ref) ? null : groupRef(ref.path.slice(0, -1)));

  function parentShareSource(rowHeaders, columnHeaders, raw) {
    const previousColumns = new Map();
    const byDepth = new Map();
    columnHeaders.forEach((path, index) => {
      for (let depth = 1; depth <= path.length; depth++) {
        const prefix = path.slice(0, depth);
        const key = keyOf(prefix);
        if (previousColumns.has(key)) {
          continue;
        }

        previousColumns.set(key, byDepth.get(depth) ?? null);
        byDepth.set(depth, depth === path.length ? { index, path } : groupRef(prefix));
      }
    });

    const cells = new Map(raw.cells.map(cell => [`${cell.row},${cell.column}`, cell.values]));
    const rowTotals = new Map(raw.rowTotals.map(total => [total.index, total.values]));
    const columnTotals = new Map(raw.columnTotals.map(total => [total.index, total.values]));
    const groupTotals = new Map();
    const groupCells = new Map();
    const crossings = new Map();
    for (const subtotal of raw.subtotals) {
      const key = keyOf(subtotal.rowHeader);
      groupTotals.set(key, subtotal.totals);
      groupCells.set(key, new Map(subtotal.cells.map(cell => [cell.column, cell.values])));
      crossings.set(key, new Map(subtotal.columnSubtotals.map(cell => [keyOf(cell.columnHeader), cell.values])));
    }

    const columnGroupTotals = new Map();
    const columnGroupCells = new Map();
    for (const subtotal of raw.columnSubtotals) {
      const key = keyOf(subtotal.columnHeader);
      columnGroupTotals.set(key, subtotal.totals);
      columnGroupCells.set(key, new Map(subtotal.cells.map(cell => [cell.index, cell.values])));
    }

    return {
      previousColumn(column, crossGroups) {
        if (isRoot(column) || !previousColumns.has(keyOf(column.path))) {
          return null;
        }

        const previous = previousColumns.get(keyOf(column.path));
        return previous !== null && (crossGroups ||
          keyOf(previous.path.slice(0, -1)) === keyOf(column.path.slice(0, -1)))
          ? previous
          : null;
      },
      rowDetail: row => ({ index: row, path: rowHeaders[row] }),
      columnDetail: column => ({ index: column, path: columnHeaders[column] }),
      value(row, column, key) {
        let values;
        if (isRoot(row) && isRoot(column)) {
          values = raw.grandTotals;
        } else if (isRoot(row)) {
          values = column.index !== null
            ? columnTotals.get(column.index)
            : columnGroupTotals.get(keyOf(column.path));
        } else if (row.index !== null) {
          values = isRoot(column) ? rowTotals.get(row.index)
            : column.index !== null ? cells.get(`${row.index},${column.index}`)
              : columnGroupCells.get(keyOf(column.path))?.get(row.index);
        } else {
          values = isRoot(column) ? groupTotals.get(keyOf(row.path))
            : column.index !== null ? groupCells.get(keyOf(row.path))?.get(column.index)
              : crossings.get(keyOf(row.path))?.get(keyOf(column.path));
        }

        return values ? getValue(values, key) : null;
      }
    };
  }

  function applyNavigatedCalculations(result, definitions, source) {
    const shares = definitions.filter(definition => isParentShare(definition) || isVariation(definition));

    const share = (transformed, row, column) => {
      const values = { ...transformed };
      for (const definition of shares) {
        const key = valueKey(definition);
        const raw = source.value(row, column, key);
        if (isVariation(definition)) {
          const previousColumn = source.previousColumn(column, definition.allowCrossGroupCalculation !== false);
          const previous = previousColumn === null ? null : source.value(row, previousColumn, key);
          const change = difference(raw, previous);
          values[key] = definition.showAs === "differenceFromPrevious" ? change : divide(change, previous);
          continue;
        }

        const byRow = definition.showAs === "percentOfParentRowTotal";
        const rowParent = parentOf(row);
        const columnParent = parentOf(column);
        const parent = byRow
          ? rowParent ? source.value(rowParent, column, key) : null
          : columnParent ? source.value(row, columnParent, key) : null;
        const atRoot = byRow ? rowParent === null : columnParent === null;
        values[key] = atRoot ? oneWhenNonZero(raw) : divide(raw, parent);
      }

      return values;
    };

    return {
      cells: result.cells.map(cell => ({
        row: cell.row,
        column: cell.column,
        values: share(cell.values, source.rowDetail(cell.row), source.columnDetail(cell.column))
      })),
      rowTotals: result.rowTotals.map(total => ({
        index: total.index,
        values: share(total.values, source.rowDetail(total.index), ROOT)
      })),
      columnTotals: result.columnTotals.map(total => ({
        index: total.index,
        values: share(total.values, ROOT, source.columnDetail(total.index))
      })),
      subtotals: result.subtotals.map(subtotal => {
        const row = groupRef(subtotal.rowHeader);
        return {
          rowHeader: subtotal.rowHeader,
          cells: subtotal.cells.map(cell => ({
            row: cell.row,
            column: cell.column,
            values: share(cell.values, row, source.columnDetail(cell.column))
          })),
          totals: share(subtotal.totals, row, ROOT),
          columnSubtotals: subtotal.columnSubtotals.map(cell => ({
            columnHeader: cell.columnHeader,
            values: share(cell.values, row, groupRef(cell.columnHeader))
          }))
        };
      }),
      columnSubtotals: result.columnSubtotals.map(subtotal => {
        const column = groupRef(subtotal.columnHeader);
        return {
          columnHeader: subtotal.columnHeader,
          cells: subtotal.cells.map(cell => ({
            index: cell.index,
            values: share(cell.values, source.rowDetail(cell.index), column)
          })),
          totals: share(subtotal.totals, ROOT, column)
        };
      }),
      grandTotals: share(result.grandTotals, ROOT, ROOT)
    };
  }

  // ---- Empty rows and columns (DropEmpty) ----

  function renumber(count, live) {
    const map = new Map();
    for (let index = 0; index < count; index++) {
      if (live.has(index)) {
        map.set(index, map.size);
      }
    }

    return map;
  }

  function remapTotals(totals, map) {
    return totals
      .filter(total => map.has(total.index))
      .map(total => ({ index: map.get(total.index), values: total.values }))
      .sort((left, right) => left.index - right.index);
  }

  // live: the rows and columns to keep when the caller knows them better than
  // these cells do -- a page holds only some of the rows a column has values in.
  function dropEmpty(rowHeaders, columnHeaders, values, live = null) {
    const holds = cellValues => Object.values(cellValues).some(value => value !== null && value !== undefined);
    const liveRows = live?.rows ?? new Set();
    const liveColumns = live?.columns ?? new Set();
    for (const cell of live ? [] : values.cells) {
      if (holds(cell.values)) {
        liveRows.add(cell.row);
        liveColumns.add(cell.column);
      }
    }

    if (liveRows.size === rowHeaders.length && liveColumns.size === columnHeaders.length) {
      return { rowHeaders, columnHeaders, values };
    }

    const rowMap = renumber(rowHeaders.length, liveRows);
    const columnMap = renumber(columnHeaders.length, liveColumns);
    const remap = cells => cells
      .filter(cell => rowMap.has(cell.row) && columnMap.has(cell.column))
      .map(cell => ({ row: rowMap.get(cell.row), column: columnMap.get(cell.column), values: cell.values }));
    const survivingRows = [...rowMap.keys()].sort((a, b) => a - b).map(row => rowHeaders[row]);
    const survivingColumns = [...columnMap.keys()].sort((a, b) => a - b).map(column => columnHeaders[column]);
    const columnGroupSurvives = prefix => survivingColumns.some(header => startsWith(header, prefix));

    return {
      rowHeaders: survivingRows,
      columnHeaders: survivingColumns,
      values: {
        ...values,
        cells: remap(values.cells),
        rowTotals: remapTotals(values.rowTotals, rowMap),
        columnTotals: remapTotals(values.columnTotals, columnMap),
        subtotals: values.subtotals
          .filter(subtotal => survivingRows.some(header => startsWith(header, subtotal.rowHeader)))
          .map(subtotal => ({
            rowHeader: subtotal.rowHeader,
            cells: remap(subtotal.cells),
            totals: subtotal.totals,
            columnSubtotals: subtotal.columnSubtotals.filter(cell => columnGroupSurvives(cell.columnHeader))
          })),
        columnSubtotals: values.columnSubtotals
          .filter(subtotal => columnGroupSurvives(subtotal.columnHeader))
          .map(subtotal => ({
            columnHeader: subtotal.columnHeader,
            cells: remapTotals(subtotal.cells, rowMap),
            totals: subtotal.totals
          }))
      }
    };
  }

  // ---- Sorting by value (SummaryLookup, SortColumns, SortRows) ----

  function summaryLookup(rowHeaders, columnHeaders, values) {
    const rowDepth = rowHeaders.length > 0 ? rowHeaders[0].length : 0;
    const columnDepth = columnHeaders.length > 0 ? columnHeaders[0].length : 0;
    const index = headers => {
      const map = new Map();
      headers.forEach((header, position) => {
        if (!map.has(keyOf(header))) {
          map.set(keyOf(header), position);
        }
      });
      return map;
    };
    const rows = index(rowHeaders);
    const columns = index(columnHeaders);
    const cells = new Map(values.cells.map(cell => [`${cell.row},${cell.column}`, cell.values]));
    const rowTotals = new Map(values.rowTotals.map(total => [total.index, total.values]));
    const columnTotals = new Map(values.columnTotals.map(total => [total.index, total.values]));
    const subtotals = new Map();
    for (const subtotal of values.subtotals) {
      if (!subtotals.has(keyOf(subtotal.rowHeader))) {
        subtotals.set(keyOf(subtotal.rowHeader), subtotal);
      }
    }

    const columnSubtotals = new Map();
    for (const subtotal of values.columnSubtotals) {
      if (!columnSubtotals.has(keyOf(subtotal.columnHeader))) {
        columnSubtotals.set(keyOf(subtotal.columnHeader), subtotal);
      }
    }

    const classify = (path, depth) => (path.length === 0 ? "total"
      : path.length === depth ? "leaf"
        : path.length < depth ? "group"
          : "unknown");

    function getValues(rowPath, columnPath) {
      const row = classify(rowPath, rowDepth);
      const column = classify(columnPath, columnDepth);
      if (row === "unknown" || column === "unknown") {
        return null;
      }

      const rowIndex = row === "leaf" ? rows.get(keyOf(rowPath)) ?? null : null;
      const columnIndex = column === "leaf" ? columns.get(keyOf(columnPath)) ?? null : null;
      if ((row === "leaf" && rowIndex === null) || (column === "leaf" && columnIndex === null)) {
        return null;
      }

      const subtotal = row === "group" ? subtotals.get(keyOf(rowPath)) : null;
      const columnSubtotal = column === "group" ? columnSubtotals.get(keyOf(columnPath)) : null;
      if ((row === "group" && !subtotal) || (column === "group" && !columnSubtotal)) {
        return null;
      }

      switch (`${row}:${column}`) {
        case "leaf:leaf": return cells.get(`${rowIndex},${columnIndex}`) ?? null;
        case "leaf:group": return columnSubtotal.cells.find(cell => cell.index === rowIndex)?.values ?? null;
        case "leaf:total": return rowTotals.get(rowIndex) ?? null;
        case "group:leaf": return subtotal.cells.find(cell => cell.column === columnIndex)?.values ?? null;
        case "group:group": return subtotal.columnSubtotals.find(cell => keyOf(cell.columnHeader) === keyOf(columnPath))?.values ?? null;
        case "group:total": return subtotal.totals;
        case "total:leaf": return columnTotals.get(columnIndex) ?? null;
        case "total:group": return columnSubtotal.totals;
        default: return values.grandTotals;
      }
    }

    return {
      sortValue(rowPath, columnPath, definition) {
        const found = getValues(rowPath, columnPath);
        const value = getValue(found, valueKey(definition));
        // An empty average is NaN in DevExtreme's comparer, not a missing value.
        return {
          value,
          isNaN: found !== null && value === null &&
            definition.aggregation === "average" && (definition.showAs ?? "normal") === "normal"
        };
      }
    };
  }

  function compareGroupValues(left, right, direction) {
    const leftDefined = left.value !== null || left.isNaN;
    const rightDefined = right.value !== null || right.isNaN;
    let comparison;
    if (leftDefined !== rightDefined) {
      comparison = leftDefined ? 1 : -1;
    } else if (left.isNaN || right.isNaN) {
      comparison = 0;
    } else if (left.value === null && right.value === null) {
      comparison = 0;
    } else {
      comparison = left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
    }

    return direction === "Descending" ? -comparison : comparison;
  }

  function resolveGroupValues(headers, levelSorts, lookup, request, axisIsRows) {
    if (levelSorts.every(sort => !sort?.valueKey)) {
      return [];
    }

    return levelSorts.map((sort, level) => {
      if (!sort?.valueKey || !request.values.some(value => valueKey(value) === sort.valueKey)) {
        return null;
      }

      const definition = request.values.find(value => valueKey(value) === sort.valueKey);
      const path = sort.summaryPath ?? [];
      const seen = new Map();
      return headers.map(header => {
        const group = header.slice(0, level + 1);
        const key = keyOf(group);
        if (!seen.has(key)) {
          seen.set(key, axisIsRows
            ? lookup().sortValue(group, path, definition)
            : lookup().sortValue(path, group, definition));
        }

        return seen.get(key);
      });
    });
  }

  // DevExtreme sorts sibling arrays on their own; with NaN in play the
  // comparer is not transitive, so the engine sorts groups level by level the
  // way V8 does -- which here is simply the engine's own sort.
  function sortSiblingGroups(source, headers, compare, depth = 0) {
    if (source.length < 2 || depth >= headers[source[0]].length) {
      return source;
    }

    const groups = [];
    const byLabel = new Map();
    for (const index of source) {
      const label = headers[index][depth];
      if (!byLabel.has(label)) {
        byLabel.set(label, []);
        groups.push(byLabel.get(label));
      }

      byLabel.get(label).push(index);
    }

    const order = groups.map((_, index) => index).sort((left, right) => compare(groups[left][0], groups[right][0]));
    return order.flatMap(index => sortSiblingGroups(groups[index], headers, compare, depth + 1));
  }

  function compareRows(left, right, rowHeaders, levelSorts, groupValues, order) {
    const leftHeader = rowHeaders[left];
    const rightHeader = rowHeaders[right];
    const depth = Math.max(leftHeader.length, rightHeader.length);

    for (let level = 0; level < depth; level++) {
      let labelComparison = order.compare(leftHeader, rightHeader, level);
      if (labelComparison === 0) {
        labelComparison = ordinal(leftHeader[level] ?? null, rightHeader[level] ?? null);
      }

      if (labelComparison === 0) {
        continue;
      }

      const sort = levelSorts[level] ?? null;
      const values = groupValues[level] ?? null;
      if (sort && values) {
        const valueComparison = compareGroupValues(values[left], values[right], sort.direction);
        return valueComparison !== 0 ? valueComparison
          : sort.direction === "Descending" ? -labelComparison : labelComparison;
      }

      return sort?.direction === "Descending" ? -labelComparison : labelComparison;
    }

    return 0;
  }

  function sortRowsByLevel(rowOrder, rowHeaders, levelSorts, lookup, request, order) {
    const groupValues = resolveGroupValues(rowHeaders, levelSorts, lookup, request, true);
    const compare = (left, right) => compareRows(left, right, rowHeaders, levelSorts, groupValues, order);
    return groupValues.some(level => level?.some(value => value.isNaN))
      ? sortSiblingGroups(rowOrder, rowHeaders, compare)
      : orderBy(rowOrder, compare);
  }

  function resolveRowFieldLevel(rowLevels, field) {
    if (!field || !String(field).trim()) {
      return 0;
    }

    const index = rowLevels.findIndex(level => namesLevel(field, level));
    return index < 0 ? 0 : index;
  }

  // The rows as they came, in the shape sortRows leaves: a total for each.
  function keepRows(rowHeaders, values) {
    const rowTotals = new Map(values.rowTotals.map(total => [total.index, total.values]));
    return {
      headers: rowHeaders,
      cells: values.cells,
      rowTotals: rowHeaders.map((_, index) => ({ index, values: rowTotals.get(index) ?? {} })),
      columnSubtotals: values.columnSubtotals
    };
  }

  function sortRows(rowHeaders, cells, rowTotals, columnSubtotals, lookup, request, order) {
    if (rowHeaders.length === 0) {
      return { headers: rowHeaders, cells, rowTotals, columnSubtotals };
    }

    let rowOrder = rowHeaders.map((_, index) => index);
    const sort = request.rowSort ?? null;
    if (!sort) {
      rowOrder = sortRowsByLevel(rowOrder, rowHeaders, resolveLevelSorts(request.rows, request.fieldSorts), lookup, request, order);
    } else if (sort.mode === "RowLabel") {
      const level = resolveRowFieldLevel(request.rows, sort.field);
      rowOrder = orderBy(rowOrder, (left, right) => order.compare(rowHeaders[left], rowHeaders[right], level));
      if (sort.direction === "Descending") {
        rowOrder.reverse();
      }
    } else if (sort.mode === "RowTotalValue" && sort.valueKey && String(sort.valueKey).trim()) {
      rowOrder = sortRowsByLevel(rowOrder, rowHeaders,
        request.rows.map(level => ({
          field: levelKey(level), direction: sort.direction, valueKey: sort.valueKey, summaryPath: sort.columnPath ?? null
        })),
        lookup, request, order);
    }

    const rowMap = new Map(rowOrder.map((oldRow, newRow) => [oldRow, newRow]));
    const rowTotalLookup = new Map(rowTotals.map(total => [total.index, total]));
    return {
      headers: rowOrder.map(row => rowHeaders[row]),
      cells: cells
        .map(cell => ({ row: rowMap.get(cell.row), column: cell.column, values: cell.values }))
        .sort((left, right) => left.row - right.row || left.column - right.column),
      rowTotals: rowOrder.map((oldRow, newRow) => ({
        index: newRow,
        values: rowTotalLookup.get(oldRow)?.values ?? {}
      })),
      columnSubtotals: columnSubtotals.map(subtotal => ({
        columnHeader: subtotal.columnHeader,
        cells: remapTotals(subtotal.cells, rowMap),
        totals: subtotal.totals
      }))
    };
  }

  function sortColumns(populated, request, columnOrder, observedHeaders) {
    const columnHeaders = populated.columnHeaders;
    const levelSorts = resolveLevelSorts(request.columns, request.fieldSorts);
    if (columnHeaders.length < 2 || !levelSorts.some(sort => sort)) {
      return populated;
    }

    let lookupValue = null;
    const lookup = () => (lookupValue ??= summaryLookup(populated.rowHeaders, columnHeaders, populated.values));
    const groupValues = resolveGroupValues(columnHeaders, levelSorts, lookup, request, false);

    const compare = (left, right) => {
      const leftHeader = columnHeaders[left];
      const rightHeader = columnHeaders[right];
      for (let level = 0; level < leftHeader.length; level++) {
        if (leftHeader[level] === rightHeader[level]) {
          continue;
        }

        let positional = left - right;
        const labelSort = levelSorts[level] ?? null;
        if (labelSort) {
          positional = columnOrder.compare(leftHeader, rightHeader, level);
          if (labelSort.direction === "Descending") {
            positional = -positional;
          }
        }

        const values = groupValues[level] ?? null;
        if (labelSort && values) {
          const valueComparison = compareGroupValues(values[left], values[right], labelSort.direction);
          return valueComparison !== 0 ? valueComparison : positional;
        }

        return positional;
      }

      return left - right;
    };

    const source = columnHeaders.map((_, index) => index);
    let order;
    if (groupValues.some(level => level?.some(value => value.isNaN))) {
      const observed = new Map(observedHeaders.map((header, index) => [keyOf(header), index]));
      order = sortSiblingGroups(
        orderBy(source, (left, right) =>
          (observed.get(keyOf(columnHeaders[left])) ?? Number.MAX_SAFE_INTEGER) -
          (observed.get(keyOf(columnHeaders[right])) ?? Number.MAX_SAFE_INTEGER)),
        columnHeaders, compare);
    } else {
      order = orderBy(source, compare);
    }

    if (order.every((column, position) => column === position)) {
      return populated;
    }

    const columnMap = new Map(order.map((oldColumn, newColumn) => [oldColumn, newColumn]));
    const sortedHeaders = order.map(column => columnHeaders[column]);
    const values = populated.values;
    const remap = cells => cells
      .map(cell => ({ row: cell.row, column: columnMap.get(cell.column), values: cell.values }))
      .sort((left, right) => left.row - right.row || left.column - right.column);

    return {
      rowHeaders: populated.rowHeaders,
      columnHeaders: sortedHeaders,
      values: {
        ...values,
        cells: remap(values.cells),
        columnTotals: remapTotals(values.columnTotals, columnMap),
        subtotals: values.subtotals.map(subtotal => ({
          rowHeader: subtotal.rowHeader,
          cells: remap(subtotal.cells),
          totals: subtotal.totals,
          columnSubtotals: subtotal.columnSubtotals
        })),
        columnSubtotals: orderColumnSubtotals(values.columnSubtotals, sortedHeaders)
      }
    };
  }

  // ---- Running totals (PivotRunningTotals) ----

  function applyRunningTotals(result, definitions) {
    const running = definitions.filter(definition => definition.runningTotal === "Row" || definition.runningTotal === "Column");
    if (running.length === 0) {
      return result;
    }

    const separator = "\u001f";
    const pathKey = path => path.map(value => value ?? "").join(separator);
    const parentKey = path => pathKey(path.slice(0, Math.max(0, path.length - 1)));
    const copy = values => ({ ...values });
    const at = (map, key) => {
      if (!map.has(key)) {
        map.set(key, {});
      }

      return map.get(key);
    };
    const firstIndex = (headers, prefix) => {
      const index = headers.findIndex(header => startsWith(header, prefix));
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    };

    const cells = new Map(result.cells.map(cell => [`${cell.row},${cell.column}`, copy(cell.values)]));
    const rowTotals = new Map(result.rowTotals.map(total => [total.index, copy(total.values)]));
    const columnTotals = new Map(result.columnTotals.map(total => [total.index, copy(total.values)]));
    const subtotals = orderBy(result.subtotals.map(subtotal => ({
      path: subtotal.rowHeader,
      first: firstIndex(result.rowHeaders, subtotal.rowHeader),
      cells: new Map(subtotal.cells.map(cell => [cell.column, copy(cell.values)])),
      totals: copy(subtotal.totals),
      crossings: new Map(subtotal.columnSubtotals.map(cell => [pathKey(cell.columnHeader), { path: cell.columnHeader, values: copy(cell.values) }])),
      crossing(key, path) {
        if (!this.crossings.has(key)) {
          this.crossings.set(key, { path, values: {} });
        }

        return this.crossings.get(key).values;
      }
    })), (left, right) => left.first - right.first || left.path.length - right.path.length);
    const columnSubtotals = orderBy(result.columnSubtotals.map(subtotal => ({
      path: subtotal.columnHeader,
      first: firstIndex(result.columnHeaders, subtotal.columnHeader),
      cells: new Map(subtotal.cells.map(cell => [cell.index, copy(cell.values)])),
      totals: copy(subtotal.totals)
    })), (left, right) => left.first - right.first || left.path.length - right.path.length);

    const run = (positions, key, crossGroups) => {
      let sum = 0;
      let has = false;
      let parent = null;
      for (const [values, positionParent] of positions) {
        if (!crossGroups && parent !== null && positionParent !== parent) {
          sum = 0;
          has = false;
        }

        parent = positionParent;
        const value = values[key];
        if (value !== null && value !== undefined) {
          sum += value;
          has = true;
        }

        if (has) {
          values[key] = sum;
        }
      }
    };

    const byLevel = list => {
      const levels = new Map();
      for (const entry of list) {
        if (!levels.has(entry.path.length)) {
          levels.set(entry.path.length, []);
        }

        levels.get(entry.path.length).push(entry);
      }

      return [...levels.values()];
    };

    const rows = result.rowHeaders.map((_, index) => index);
    const columns = result.columnHeaders.map((_, index) => index);
    const cellAt = (row, column) => at(cells, `${row},${column}`);

    for (const definition of running) {
      const key = valueKey(definition);
      const crossGroups = definition.allowCrossGroupCalculation !== false;

      if (definition.runningTotal === "Column") {
        for (const column of columns) {
          run(rows.map(row => [cellAt(row, column), parentKey(result.rowHeaders[row])]), key, crossGroups);
        }

        for (const subtotal of columnSubtotals) {
          run(rows.map(row => [at(subtotal.cells, row), parentKey(result.rowHeaders[row])]), key, crossGroups);
        }

        run(rows.map(row => [at(rowTotals, row), parentKey(result.rowHeaders[row])]), key, crossGroups);
        for (const level of byLevel(subtotals)) {
          for (const column of columns) {
            run(level.map(subtotal => [at(subtotal.cells, column), parentKey(subtotal.path)]), key, crossGroups);
          }

          for (const columnSubtotal of columnSubtotals) {
            const groupKey = pathKey(columnSubtotal.path);
            run(level.map(subtotal => [subtotal.crossing(groupKey, columnSubtotal.path), parentKey(subtotal.path)]), key, crossGroups);
          }

          run(level.map(subtotal => [subtotal.totals, parentKey(subtotal.path)]), key, crossGroups);
        }
      } else {
        for (const row of rows) {
          run(columns.map(column => [cellAt(row, column), parentKey(result.columnHeaders[column])]), key, crossGroups);
        }

        for (const subtotal of subtotals) {
          run(columns.map(column => [at(subtotal.cells, column), parentKey(result.columnHeaders[column])]), key, crossGroups);
        }

        run(columns.map(column => [at(columnTotals, column), parentKey(result.columnHeaders[column])]), key, crossGroups);
        for (const level of byLevel(columnSubtotals)) {
          for (const row of rows) {
            run(level.map(subtotal => [at(subtotal.cells, row), parentKey(subtotal.path)]), key, crossGroups);
          }

          for (const rowSubtotal of subtotals) {
            run(level.map(subtotal => [rowSubtotal.crossing(pathKey(subtotal.path), subtotal.path), parentKey(subtotal.path)]), key, crossGroups);
          }

          run(level.map(subtotal => [subtotal.totals, parentKey(subtotal.path)]), key, crossGroups);
        }
      }
    }

    const nonEmpty = values => Object.keys(values).length > 0;
    const subtotalByPath = new Map(subtotals.map(subtotal => [pathKey(subtotal.path), subtotal]));
    const columnSubtotalByPath = new Map(columnSubtotals.map(subtotal => [pathKey(subtotal.path), subtotal]));

    return {
      ...result,
      cells: [...cells]
        .filter(([, values]) => nonEmpty(values))
        .map(([cellKey, values]) => {
          const [row, column] = cellKey.split(",").map(Number);
          return { row, column, values };
        })
        .sort((left, right) => left.row - right.row || left.column - right.column),
      rowTotals: result.rowTotals.map(total => ({ index: total.index, values: rowTotals.get(total.index) })),
      columnTotals: result.columnTotals.map(total => ({ index: total.index, values: columnTotals.get(total.index) })),
      subtotals: result.subtotals.map(subtotal => {
        const mutable = subtotalByPath.get(pathKey(subtotal.rowHeader));
        return {
          rowHeader: subtotal.rowHeader,
          cells: [...mutable.cells]
            .filter(([, values]) => nonEmpty(values))
            .sort(([left], [right]) => left - right)
            .map(([column, values]) => ({ row: 0, column, values })),
          totals: mutable.totals,
          columnSubtotals: [...mutable.crossings.values()]
            .filter(crossing => nonEmpty(crossing.values))
            .map(crossing => ({ columnHeader: crossing.path, values: crossing.values }))
        };
      }),
      columnSubtotals: result.columnSubtotals.map(subtotal => {
        const mutable = columnSubtotalByPath.get(pathKey(subtotal.columnHeader));
        return {
          columnHeader: subtotal.columnHeader,
          cells: [...mutable.cells]
            .filter(([, values]) => nonEmpty(values))
            .sort(([left], [right]) => left - right)
            .map(([index, values]) => ({ index, values })),
          totals: mutable.totals
        };
      })
    };
  }

  // ---- Buckets (what PivotEngine.Scan leaves) ----

  function emptyScan(keys) {
    return {
      rowHeaders: [],
      columnHeaders: [],
      columnLevelValues: [],
      rowKinds: [],
      columnKinds: [],
      cells: new Map(),
      rowTotals: new Map(),
      columnTotals: new Map(),
      subtotals: new Map(),
      columnSubtotals: new Map(),
      // What an empty bucket finalizes to: no records counts to zero.
      grandTotals: Object.fromEntries(keys.map(key => [key, key.endsWith("_count") ? 0 : null])),
      sourceRowCount: 0
    };
  }

  // Collects summaries a store read, each for a crossing of a row path and a
  // column path of any depth, into the buckets assemble() reads: a full path
  // on both axes is a cell, an empty one a total, a partial one a subtotal.
  // The first value placed for a bucket wins.
  function createScan(rowCount, columnCount, keys) {
    const scan = emptyScan(keys);
    const rowIndex = new Map();
    const columnIndex = new Map();
    scan.columnLevelValues = Array.from({ length: columnCount }, () => []);
    scan.rowKinds = Array.from({ length: rowCount }, () => null);
    scan.columnKinds = Array.from({ length: columnCount }, () => null);
    scan.grandTotals = null;

    const indexOf = (index, headers, path) => {
      const key = keyOf(path);
      if (!index.has(key)) {
        index.set(key, headers.length);
        headers.push(path);
      }

      return index.get(key);
    };
    const setOnce = (map, key, values) => {
      if (!map.has(key)) {
        map.set(key, values);
      }
    };

    function place(rowPath, columnPath, values) {
      const rowFull = rowPath.length === rowCount;
      const columnFull = columnPath.length === columnCount;
      let row = null;
      let column = null;

      if (rowFull && columnFull) {
        row = indexOf(rowIndex, scan.rowHeaders, rowPath);
        column = indexOf(columnIndex, scan.columnHeaders, columnPath);
        columnPath.forEach((label, level) => {
          if (!scan.columnLevelValues[level].includes(label)) {
            scan.columnLevelValues[level].push(label);
          }
        });
        setOnce(scan.cells, `${row},${column}`, values);
      }

      if (rowFull && columnPath.length === 0 && rowIndex.has(keyOf(rowPath))) {
        setOnce(scan.rowTotals, rowIndex.get(keyOf(rowPath)), values);
      }

      if (rowPath.length === 0 && columnFull && columnIndex.has(keyOf(columnPath))) {
        setOnce(scan.columnTotals, columnIndex.get(keyOf(columnPath)), values);
      }

      if (rowPath.length === 0 && columnPath.length === 0) {
        scan.grandTotals ??= values;
      }

      const rowGroup = rowPath.length > 0 && rowPath.length < rowCount;
      const columnGroup = columnPath.length > 0 && columnPath.length < columnCount;

      if (rowGroup && (columnFull || columnPath.length === 0)) {
        const key = keyOf(rowPath);
        if (!scan.subtotals.has(key)) {
          scan.subtotals.set(key, { rowHeader: rowPath, cells: new Map(), totals: null });
        }

        const subtotal = scan.subtotals.get(key);
        if (columnPath.length === 0) {
          subtotal.totals ??= values;
        }

        if (columnFull && columnIndex.has(keyOf(columnPath))) {
          setOnce(subtotal.cells, columnIndex.get(keyOf(columnPath)), values);
        }
      }

      if (columnGroup) {
        const key = keyOf(columnPath);
        if (!scan.columnSubtotals.has(key)) {
          scan.columnSubtotals.set(key, { columnHeader: columnPath, cells: new Map(), totals: null, rowGroups: new Map() });
        }

        const subtotal = scan.columnSubtotals.get(key);
        if (rowFull && rowIndex.has(keyOf(rowPath))) {
          setOnce(subtotal.cells, rowIndex.get(keyOf(rowPath)), values);
        } else if (rowPath.length === 0) {
          subtotal.totals ??= values;
        } else if (rowGroup) {
          setOnce(subtotal.rowGroups, keyOf(rowPath), values);
        }
      }
    }

    // A column known to hold values somewhere, though maybe not in the rows
    // placed: a page's columns are the whole result's.
    function observeColumn(columnPath) {
      if (columnPath.length !== columnCount) {
        return;
      }

      indexOf(columnIndex, scan.columnHeaders, columnPath);
      columnPath.forEach((label, level) => {
        if (!scan.columnLevelValues[level].includes(label)) {
          scan.columnLevelValues[level].push(label);
        }
      });
    }

    function finish() {
      // Nothing matched: no headers at all, as when no record reaches a bucket.
      // An axis without fields needs nothing more: its one empty path is
      // complete at every depth, so place() fills it like any other.
      if (scan.sourceRowCount === 0) {
        return emptyScan(keys);
      }

      scan.rowKinds = scan.rowKinds.map(kind => kind ?? "Auto");
      scan.columnKinds = scan.columnKinds.map(kind => kind ?? "Auto");
      for (const subtotal of scan.subtotals.values()) {
        subtotal.totals ??= {};
      }

      for (const subtotal of scan.columnSubtotals.values()) {
        subtotal.totals ??= {};
      }

      return scan;
    }

    return { scan, place, observeColumn, finish };
  }

  // ---- The engine's filter rule (PivotFilterPredicates), for labels in hand ----

  function createPredicates(labels) {
    const culture = labels.culture;
    const fold = text => String(text ?? "").toLocaleLowerCase(culture.name);

    function compare(text, argument) {
      const other = argument ?? "";
      const left = labels.invariantNumberOf(text);
      const right = labels.invariantNumberOf(other);
      if (left !== null && right !== null) {
        return left < right ? -1 : left > right ? 1 : 0;
      }

      const leftDate = labels.dateNumberOf(text);
      const rightDate = labels.dateNumberOf(other);
      if (leftDate !== null && rightDate !== null) {
        return leftDate < rightDate ? -1 : leftDate > rightDate ? 1 : 0;
      }

      return labels.ignoreCase(text, other);
    }

    return function matches(value, operator, args) {
      const text = value ?? "";
      switch (operator) {
        case "Contains": return fold(text).includes(fold(args[0]));
        case "StartsWith": return fold(text).startsWith(fold(args[0]));
        case "EndsWith": return fold(text).endsWith(fold(args[0]));
        case "Between": return compare(text, args[0]) >= 0 && compare(text, args[1]) <= 0;
        case "GreaterThan": return compare(text, args[0]) > 0;
        case "LessThan": return compare(text, args[0]) < 0;
        case "Blank": return text.length === 0;
        default: return args.includes(value);
      }
    };
  }

  // ---- The whole pass (ExecuteCore after Scan) ----

  // scan: what the summaries came to before anything was ordered --
  //   rowHeaders / columnHeaders: leaf paths in the order they arrived,
  //   columnLevelValues: each column level's labels in arrival order,
  //   rowKinds / columnKinds: each plain level's value kind,
  //   cells: Map "row,column" -> values (observed column indexes),
  //   rowTotals / columnTotals: Map index -> values,
  //   subtotals: Map pathKey -> { rowHeader, cells: Map column -> values, totals },
  //   columnSubtotals: Map pathKey -> { columnHeader, cells: Map row -> values,
  //     totals, rowGroups: Map rowPathKey -> values },
  //   grandTotals, sourceRowCount,
  //   rowRanks / columnRanks (optional): per level, a Map label -> rank giving
  //     the source's own member order.
  // paged: the scan holds one page of rows, already in order, and only rows
  // with values: the source ordered them and knew the whole result, so the
  // rows stay as they came and an empty column is one no row anywhere had.
  function assemble(scan, request, { culture = null, paged = false } = {}) {
    const labels = createLabels(culture);
    const definitions = request.values;
    const dataTypes = request.dataTypes ?? {};
    const rowOrder = rowAxisOrder(request.rows, resolveLevelSorts(request.rows, request.fieldSorts),
      scan.rowKinds, dataTypes, labels, scan.rowHeaders, scan.rowRanks ?? []);
    const columnOrder = columnAxisOrder(request.columns, resolveLevelSorts(request.columns, request.fieldSorts),
      scan.columnKinds, dataTypes, labels, scan.columnLevelValues, scan.columnRanks ?? []);
    const columnHeaders = createColumnHeaders(scan.columnHeaders, scan.columnLevelValues, request.columns,
      columnOrder, definitions.some(isVariation), labels);
    const columnLookup = new Map(columnHeaders.map((header, index) => [keyOf(header), index]));
    const remapColumn = observed => columnLookup.get(keyOf(scan.columnHeaders[observed]));

    const raw = {
      cells: [...scan.cells]
        .map(([cellKey, values]) => {
          const [row, observed] = cellKey.split(",").map(Number);
          return { row, column: remapColumn(observed), values };
        })
        .sort((left, right) => left.row - right.row || left.column - right.column),
      rowTotals: [...scan.rowTotals]
        .sort(([left], [right]) => left - right)
        .map(([index, values]) => ({ index, values })),
      columnTotals: [...scan.columnTotals]
        .map(([observed, values]) => ({ index: remapColumn(observed), values }))
        .sort((left, right) => left.index - right.index),
      grandTotals: scan.grandTotals,
      subtotals: [...scan.subtotals.values()].map(subtotal => ({
        rowHeader: subtotal.rowHeader,
        cells: [...subtotal.cells]
          .map(([observed, values]) => ({ row: 0, column: remapColumn(observed), values }))
          .sort((left, right) => left.column - right.column),
        totals: subtotal.totals,
        columnSubtotals: [...scan.columnSubtotals.values()]
          .filter(columnSubtotal => columnSubtotal.rowGroups.has(keyOf(subtotal.rowHeader)))
          .map(columnSubtotal => ({
            columnHeader: columnSubtotal.columnHeader,
            values: columnSubtotal.rowGroups.get(keyOf(subtotal.rowHeader))
          }))
      })),
      columnSubtotals: orderColumnSubtotals([...scan.columnSubtotals.values()].map(subtotal => ({
        columnHeader: subtotal.columnHeader,
        cells: [...subtotal.cells]
          .sort(([left], [right]) => left - right)
          .map(([index, values]) => ({ index, values })),
        totals: subtotal.totals
      })), columnHeaders)
    };

    const transformed = transformValues(scan.rowHeaders, columnHeaders, definitions, raw);
    const observed = () => {
      const seen = new Set(scan.columnHeaders.map(keyOf));
      return {
        rows: new Set(scan.rowHeaders.map((_, index) => index)),
        columns: new Set(columnHeaders.flatMap((header, index) => (seen.has(keyOf(header)) ? [index] : [])))
      };
    };
    let populated = request.hideEmptySummaryCells
      ? dropEmpty(scan.rowHeaders, columnHeaders, transformed, paged ? observed() : null)
      : { rowHeaders: scan.rowHeaders, columnHeaders, values: transformed };

    populated = sortColumns(populated, request, columnOrder, scan.columnHeaders);
    let lookupValue = null;
    const lookup = () => (lookupValue ??= summaryLookup(populated.rowHeaders, populated.columnHeaders, populated.values));
    const sorted = paged
      ? keepRows(populated.rowHeaders, populated.values)
      : sortRows(populated.rowHeaders, populated.values.cells, populated.values.rowTotals,
      populated.values.columnSubtotals, lookup, request, rowOrder);

    return applyRunningTotals({
      rowHeaders: sorted.headers,
      columnHeaders: populated.columnHeaders,
      cells: sorted.cells,
      rowTotals: sorted.rowTotals,
      columnTotals: populated.values.columnTotals,
      subtotals: populated.values.subtotals,
      columnSubtotals: sorted.columnSubtotals,
      grandTotals: populated.values.grandTotals,
      metadata: {
        sourceRowCount: scan.sourceRowCount,
        rowHeaderCount: sorted.headers.length,
        columnHeaderCount: populated.columnHeaders.length,
        cellCount: sorted.cells.length
      },
      valueRanges: []
    }, definitions);
  }

  PivotForge.ResultAssembler = {
    assemble,
    createLabels,
    kindOf,
    isIsoDate,
    levelKey,
    levelField,
    levelInterval,
    valueKey,
    keyOf,
    emptyScan,
    createScan,
    createPredicates,
    RANGE_SEPARATOR
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PivotForge.ResultAssembler;
  }
})(typeof window !== "undefined" ? window : globalThis);
