(function (root) {
  const PivotForge = root.PivotForge ??= {};

  // DevExtreme's RemoteStore: the grid groups and sums on a DataSourceLoader
  // backend (DevExtreme.AspNet.Data, or anything that answers its load options)
  // instead of on the PivotForge endpoints. It asks for the summaries a pivot is
  // built from -- one request per depth of the row axis, each grouping the rows
  // down to that depth and then every column level -- and hands them to
  // ResultAssembler, which builds what the /pivot endpoint would have returned.

  const assembler = () => PivotForge.ResultAssembler ??
    (typeof require === "function" ? require("./pivot-result-assembler.js") : null);

  // The engine's aggregations the protocol has a summary type for.
  const SUMMARY_TYPES = { sum: "sum", count: "count", average: "avg", min: "min", max: "max" };
  const DATE_PARTS = { year: "Year", month: "Month", day: "Day", dayOfWeek: "DayOfWeek" };
  const FILTER_ARGUMENTS = { Equals: 1, Contains: 1, StartsWith: 1, EndsWith: 1, Between: 2, GreaterThan: 1, LessThan: 1, Blank: 0 };
  const TEXT_OPERATORS = { Contains: "contains", StartsWith: "startswith", EndsWith: "endswith" };
  const DISCOVERY_SAMPLE = 20;
  const DEFAULT_LIMIT = 1000;

  // A filter that keeps nothing: the protocol has no "false", so the load that
  // would carry it is not sent at all.
  const NOTHING = Symbol("nothing");

  // ---- What a remote grid can declare ----

  // Checked where the fields are declared, so a summary the protocol cannot ask
  // for fails at creation rather than as a wrong number.
  function validateFields(fields) {
    for (const field of fields) {
      const name = field.caption ?? field.dataField;
      if (field.expression !== null && field.expression !== undefined) {
        throw new Error(
          `Field "${name}" is a calculated field; a remote store has no formula engine, so declare it on the server's data instead.`);
      }

      if (field.selector !== null && field.selector !== undefined) {
        throw new Error(`Field "${name}" names a selector, which only the PivotForge endpoints can run.`);
      }

      if (field.sortingMethod !== null && field.sortingMethod !== undefined) {
        throw new Error(`Field "${name}" names a sorting method, which only the PivotForge endpoints can run.`);
      }

      const measure = field.area === "data" || field.role === "measure";
      if (measure && field.aggregation && !Object.hasOwn(SUMMARY_TYPES, field.aggregation)) {
        throw new Error(
          `Field "${name}" is summarized by "${field.aggregation}", which a remote store cannot ask for. ` +
          `Expected one of: ${Object.keys(SUMMARY_TYPES).join(", ")}.`);
      }
    }
  }

  function validateRequest(request) {
    if ((request.topN?.length ?? 0) > 0) {
      throw new Error("A remote store cannot rank groups (topN); the ranking needs every group's total first.");
    }

    if ((request.valueFilters?.length ?? 0) > 0) {
      throw new Error("A remote store cannot filter groups by their values (valueFilters).");
    }
  }

  // ---- Expressions ----

  function join(operator, conditions) {
    const kept = conditions.filter(condition => condition !== null);
    if (kept.length === 0) {
      return null;
    }

    return kept.length === 1 ? kept[0] : kept.flatMap((condition, index) => (index === 0 ? [condition] : [operator, condition]));
  }

  const not = condition => ["!", condition];

  function selectorOf(field, interval) {
    return DATE_PARTS[interval] ? `${field}.${DATE_PARTS[interval]}` : field;
  }

  // The rows one group key stands for, on the field the group was made of.
  function keyCondition(level, key) {
    if (key === null || key === undefined) {
      return [level.field, "=", null];
    }

    switch (level.interval) {
      case "quarter": {
        const first = 3 * (key - 1) + 1;
        const month = `${level.field}.Month`;
        return [[month, ">=", first], "and", [month, "<", first + 3]];
      }
      case "range":
        return [[level.field, ">=", key], "and", [level.field, "<", key + level.binSize]];
      default:
        return [selectorOf(level.field, level.interval), "=", key];
    }
  }

  function keysCondition(level, keys, excludes) {
    const conditions = keys.map(key => keyCondition(level, key));
    return excludes ? join("and", conditions.map(not)) : join("or", conditions);
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

  // ---- The store ----

  function createRemoteStore(options, { fetchImpl = null, resolveFunction = null } = {}) {
    if (!options || typeof options !== "object") {
      throw new Error('A remote store is declared as { type: "remote", loadUrl } or { type: "remote", load }.');
    }

    const load = typeof options.load === "string" ? resolveFunction?.(options.load) : options.load;
    if (!load && typeof options.loadUrl !== "string") {
      throw new Error('A remote store needs a "loadUrl" or a "load" function.');
    }

    if (options.load && typeof load !== "function") {
      throw new Error(`The remote store's load function "${options.load}" was not found on the page.`);
    }

    const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : DEFAULT_LIMIT;
    // The type each undeclared plain field's values turned out to be, learnt
    // from the keys the backend sent. A filter on a field of known type is a
    // condition on its values; on one never seen, its values are read first.
    const observedTypes = new Map();

    function observe(field, key) {
      if (key === null || key === undefined || key === "" || observedTypes.has(field.toLowerCase())) {
        return;
      }

      const type = typeof key === "number" ? "Number"
        : typeof key === "string" ? (assembler().isIsoDate(key) ? "Date" : "String")
          : null;
      if (type) {
        observedTypes.set(field.toLowerCase(), type);
      }
    }

    function typeOf(field, dataTypes) {
      return dataTypeOf(field, dataTypes) ?? observedTypes.get(String(field).toLowerCase()) ?? null;
    }

    // DevExtreme.AspNet.Data's client: every load option a query parameter,
    // the structured ones as JSON.
    async function loadFromUrl(loadOptions, signal) {
      const query = Object.entries(loadOptions)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(
          typeof value === "object" ? JSON.stringify(value) : String(value))}`)
        .join("&");
      const settings = {
        url: query ? `${options.loadUrl}${options.loadUrl.includes("?") ? "&" : "?"}${query}` : options.loadUrl,
        method: "GET",
        headers: { Accept: "application/json", ...(options.headers ?? {}) }
      };
      options.onBeforeSend?.("load", settings);

      const fetcher = fetchImpl ?? root.fetch?.bind(root);
      const response = await fetcher(settings.url, { method: settings.method, headers: settings.headers, signal });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(payload?.message ?? `The remote store's load failed with status ${response.status}.`);
        error.status = response.status;
        throw error;
      }

      return payload;
    }

    async function send(loadOptions, signal) {
      const payload = load ? await load(loadOptions, { signal }) : await loadFromUrl(loadOptions, signal);
      if (Array.isArray(payload)) {
        return { data: payload, totalCount: -1, summary: null };
      }

      if (!payload || !Array.isArray(payload.data)) {
        throw new Error("The remote store's load returned neither an array nor { data }.");
      }

      return payload;
    }

    // ---- Filters ----

    function levelOf(field, interval, binSize) {
      return { field, interval: interval ?? null, binSize: binSize ?? null };
    }

    // What a header label is the label of, without asking the server. Undefined
    // when the label alone cannot say (an untyped plain field): then the
    // field's values are read and labelled, which is always exact.
    function labelKey(level, labelText, dataType, labels) {
      if (labelText === "" || labelText === null) {
        return level.interval || dataType === "Number" || dataType === "Date" || dataType === "String"
          ? { key: null }
          : undefined;
      }

      const culture = labels.culture;
      switch (level.interval) {
        case "year":
        case "day":
          return /^-?\d+$/.test(labelText) ? { key: Number(labelText) } : { none: true };
        case "quarter": {
          const match = /^Q([1-4])$/.exec(labelText);
          return match ? { key: Number(match[1]) } : { none: true };
        }
        case "month": {
          const index = culture.months.indexOf(labelText);
          return index >= 0 ? { key: index + 1 } : { none: true };
        }
        case "dayOfWeek": {
          const index = culture.days.indexOf(labelText);
          return index >= 0 ? { key: index } : { none: true };
        }
        case "range": {
          const start = labels.rangeStart(labelText);
          return start !== null && labels.label(start, "range", level.binSize) === labelText ? { key: start } : { none: true };
        }
        default:
          break;
      }

      if (dataType === "String") {
        return { key: labelText };
      }

      if (dataType === "Number") {
        const number = labels.invariantNumberOf(labelText);
        return number !== null && labels.text(number) === labelText ? { key: number } : { none: true };
      }

      if (dataType === "Date") {
        const match = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}):(\d{2}))?$/.exec(labelText);
        return match
          ? { key: `${match[3]}-${match[1]}-${match[2]}T${match[4] ?? "00"}:${match[5] ?? "00"}:${match[6] ?? "00"}` }
          : { none: true };
      }

      return undefined;
    }

    async function domain(level, context) {
      const id = JSON.stringify(level);
      if (!context.domains.has(id)) {
        context.domains.set(id, send({
          group: [groupOf(level, false)]
        }, context.signal).then(payload => payload.data.map(group => {
          if (!level.interval) {
            observe(level.field, group.key);
          }

          return group.key;
        })));
      }

      return context.domains.get(id);
    }

    function kindFor(level, keys, dataTypes) {
      const declared = dataTypeOf(level.field, dataTypes);
      return assembler().kindOf(keys.find(key => key !== null && key !== undefined && key !== "") ?? null, declared);
    }

    // One filter as an expression on the server, NOTHING when it keeps no row,
    // or null when it restricts nothing.
    async function filterCondition(filter, context) {
      const operator = filter.operator ?? "Equals";
      if (filter.values.length < (FILTER_ARGUMENTS[operator] ?? 1)) {
        return null;
      }

      const level = levelOf(filter.field, filter.interval, filter.binSize);
      const excludes = filter.mode === "Exclude";
      const dataType = typeOf(level.field, context.dataTypes);
      const { labels } = context;

      if (operator === "Equals") {
        const mapped = filter.values.map(value => labelKey(level, value, dataType, labels));
        if (mapped.every(entry => entry !== undefined)) {
          const keys = mapped.filter(entry => !entry.none).map(entry => entry.key);
          // A blank plain text label is a null or an empty string.
          if (!level.interval && dataType === "String" && filter.values.includes("")) {
            keys.push("");
          }

          return resolved(level, keys, excludes);
        }
      }

      if (TEXT_OPERATORS[operator] && !level.interval && dataType === "String") {
        if ((filter.values[0] ?? "") === "") {
          return excludes ? NOTHING : null;
        }

        const condition = [level.field, TEXT_OPERATORS[operator], filter.values[0]];
        return excludes ? not(condition) : condition;
      }

      if (operator === "Blank" && (level.interval || dataType === "Number" || dataType === "Date")) {
        return resolved(level, [null], excludes);
      }

      // Anything else is decided the engine's way, on the labels of the
      // values the field holds.
      const keys = await domain(level, context);
      const kind = kindFor(level, keys, context.dataTypes);
      const matching = keys.filter(key =>
        context.matches(labels.label(key, level.interval, level.binSize, kind), operator, filter.values));
      return resolved(level, matching, excludes);
    }

    function resolved(level, keys, excludes) {
      if (keys.length === 0) {
        return excludes ? null : NOTHING;
      }

      return keysCondition(level, keys, excludes);
    }

    async function filterExpression(filters, context) {
      const conditions = [];
      for (const filter of filters ?? []) {
        const condition = await filterCondition(filter, context);
        if (condition === NOTHING) {
          return NOTHING;
        }

        conditions.push(condition);
      }

      return join("and", conditions);
    }

    function context(request, culture, signal) {
      const labels = assembler().createLabels(culture);
      return {
        labels,
        matches: createPredicates(labels),
        dataTypes: request.dataTypes ?? {},
        domains: new Map(),
        signal
      };
    }

    // ---- The pivot ----

    function groupOf(level, isExpanded) {
      return {
        selector: level.field,
        ...(level.interval === "range" ? { groupInterval: level.binSize }
          : level.interval ? { groupInterval: level.interval } : {}),
        isExpanded
      };
    }

    function levelsOf(levels) {
      return levels.map(level => (typeof level === "string"
        ? levelOf(level, null, null)
        : levelOf(level.field, level.interval, level.binSize)));
    }

    function summariesOf(values) {
      return values.map(value => ({ selector: value.field, summaryType: SUMMARY_TYPES[value.aggregation] }));
    }

    function valuesOf(summary, keys) {
      return Object.fromEntries(keys.map((key, index) => {
        const value = summary?.[index];
        return [key, value === undefined || value === null ? null : Number(value)];
      }));
    }

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

    async function pivot(request, { culture = null, signal = null } = {}) {
      validateRequest(request);
      const ctx = context(request, culture, signal);
      const rows = levelsOf(request.rows);
      const columns = levelsOf(request.columns);
      const keys = request.values.map(value => assembler().valueKey(value));
      const filter = await filterExpression(request.filters, ctx);
      if (filter === NOTHING) {
        return assembler().assemble(emptyScan(keys), request, { culture });
      }

      const groupSummary = summariesOf(request.values);
      // The deepest row request first: its rows arrive in the order the grid
      // first meets them, as records would.
      const depths = columns.length === 0
        ? [rows.length]
        : Array.from({ length: rows.length + 1 }, (_, index) => rows.length - index);
      const totalsDepth = columns.length === 0 ? rows.length : 0;

      const responses = await Promise.all(depths.map(depth => {
        const grouped = [...rows.slice(0, depth), ...columns];
        return send({
          ...(grouped.length > 0
            ? { group: grouped.map((level, index) => groupOf(level, index < grouped.length - 1)), groupSummary }
            : { take: 1 }),
          ...(filter ? { filter } : {}),
          ...(depth === totalsDepth ? { totalSummary: groupSummary, requireTotalCount: true } : {})
        }, signal).then(payload => ({ depth, payload }));
      }));

      return assembler().assemble(scanOf(responses, rows, columns, keys, ctx, totalsDepth), request, { culture });
    }

    // Lays the grouped summaries out the way PivotEngine.Scan leaves its
    // buckets: each crossing of a row path and a column path, by depth.
    function scanOf(responses, rows, columns, keys, ctx, totalsDepth) {
      const { keyOf } = assembler();
      const rowCount = rows.length;
      const columnCount = columns.length;
      const scan = emptyScan(keys);
      const rowIndex = new Map();
      const columnIndex = new Map();
      scan.columnLevelValues = columns.map(() => []);
      scan.rowKinds = rows.map(() => null);
      scan.columnKinds = columns.map(() => null);
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

      const levelKind = (level, key) => assembler().kindOf(key, dataTypeOf(level.field, ctx.dataTypes));

      for (const { depth, payload } of responses) {
        const grouped = [...rows.slice(0, depth), ...columns];

        const walk = (groups, level, path) => {
          for (const group of groups ?? []) {
            const definition = grouped[level];
            const axisLevel = level < depth ? level : level - depth;
            const kinds = level < depth ? scan.rowKinds : scan.columnKinds;
            if (!definition.interval) {
              observe(definition.field, group.key);
              if (kinds[axisLevel] === null) {
                kinds[axisLevel] = levelKind(definition, group.key);
              }
            }

            const label = ctx.labels.label(group.key, definition.interval, definition.binSize,
              definition.interval ? null : levelKind(definition, group.key) ?? kinds[axisLevel]);
            const next = [...path, label];
            const rowPath = next.slice(0, Math.min(next.length, depth));
            const columnPath = next.slice(depth);

            // Children first at the deepest row level, so a row is known
            // before its total is placed.
            if (Array.isArray(group.items) && level < grouped.length - 1) {
              walk(group.items, level + 1, next);
            }

            place(rowPath, columnPath, valuesOf(group.summary, keys));
          }
        };

        // Without a group the data is records, not groups.
        if (grouped.length > 0) {
          walk(payload.data, 0, []);
        }

        if (depth === totalsDepth) {
          scan.sourceRowCount = Number.isInteger(payload.totalCount) && payload.totalCount >= 0
            ? payload.totalCount
            : grouped.length > 0
              ? (payload.data ?? []).reduce((count, group) => count + (group.count ?? 0), 0)
              : (payload.data ?? []).length;
          place([], [], valuesOf(payload.summary, keys));
        }
      }

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

    // ---- Field values (the filter picker) ----

    async function fieldValues({ field, interval = null, binSize = null, filters = [], dataTypes = {} } = {},
      { culture = null, signal = null } = {}) {
      const ctx = context({ dataTypes }, culture, signal);
      const filter = await filterExpression(filters, ctx);
      const level = levelOf(field, interval, binSize);
      const keys = filter === NOTHING
        ? []
        : (await send({ group: [groupOf(level, false)], ...(filter ? { filter } : {}) }, signal)).data.map(group => group.key);
      const kind = kindFor(level, keys, dataTypes);

      const seen = new Map();
      let hasBlank = false;
      for (const key of keys) {
        const label = ctx.labels.label(key, interval, binSize, kind);
        if (label === "") {
          hasBlank = true;
        } else if (!seen.has(label)) {
          seen.set(label, key);
        }
      }

      const intervalOrder = ctx.labels.intervalOrder(interval);
      const entries = [...seen];
      let ordered;
      if (intervalOrder) {
        ordered = entries.map(([label]) => label).sort(intervalOrder);
      } else if (entries.length > 0 && entries.every(([, key]) => typeof key === "number")) {
        ordered = entries.sort(([, left], [, right]) => left - right).map(([label]) => label);
      } else if (entries.length > 0 && entries.every(([, key]) => typeof key === "boolean")) {
        ordered = entries.sort(([, left], [, right]) => Number(left) - Number(right)).map(([label]) => label);
      } else if (entries.length > 0 && kind === "Date") {
        ordered = entries.sort(([, left], [, right]) => Date.parse(left) - Date.parse(right)).map(([label]) => label);
      } else {
        ordered = entries.map(([label]) => label).sort(ctx.labels.collate);
      }

      const values = hasBlank ? ["", ...ordered] : ordered;
      return {
        field,
        values: values.slice(0, limit),
        totalCount: values.length,
        truncated: values.length > limit,
        limit
      };
    }

    // ---- Drill-down ----

    async function drillDown({ request, rowPath = [], columnPath = [], valueKey = null } = {},
      { culture = null, signal = null } = {}) {
      const ctx = context(request, culture, signal);
      const path = (levels, labels) => levelsOf(levels).slice(0, labels.length).map((level, index) => ({
        field: level.field,
        interval: level.interval,
        binSize: level.binSize,
        values: [labels[index] ?? ""],
        mode: "Include"
      }));
      const filter = await filterExpression(
        [...(request.filters ?? []), ...path(request.rows, rowPath), ...path(request.columns, columnPath)], ctx);
      if (filter === NOTHING) {
        return { records: [], totalCount: 0, truncated: false, limit, valueKey };
      }

      const payload = await send({ take: limit, requireTotalCount: true, ...(filter ? { filter } : {}) }, signal);
      const totalCount = Number.isInteger(payload.totalCount) && payload.totalCount >= 0
        ? payload.totalCount
        : payload.data.length;
      return {
        records: payload.data.slice(0, limit),
        totalCount,
        truncated: totalCount > limit,
        limit,
        valueKey
      };
    }

    // ---- Field discovery (retrieveFields) ----

    // DevExtreme reads the first twenty records; PivotFieldDiscovery's rules
    // say what each key becomes.
    async function fields({ signal = null } = {}) {
      const payload = await send({ skip: 0, take: DISCOVERY_SAMPLE }, signal);
      const records = payload.data.filter(record => record && typeof record === "object");
      if (records.length === 0) {
        return { fields: [] };
      }

      const discovered = [];
      for (const name of Object.keys(records[0])) {
        if (name.startsWith("__")) {
          continue;
        }

        const value = records.map(record => record[name]).find(entry => entry !== null && entry !== undefined);
        const dataType = value === undefined ? "string"
          : typeof value === "number" ? "number"
            : typeof value === "boolean" ? "string"
              : value instanceof Date || assembler().isIsoDate(value) ? "date"
                : typeof value === "string" ? "string"
                  : null;
        if (dataType === null) {
          continue;
        }

        if (dataType !== "date") {
          discovered.push({ dataField: name, dataType, groupInterval: null, groupName: null, groupIndex: null });
          continue;
        }

        ["year", "quarter", "month"].forEach((groupInterval, groupIndex) => discovered.push({
          dataField: name, dataType, groupInterval, groupName: name, groupIndex
        }));
      }

      return { fields: discovered };
    }

    return { pivot, fieldValues, drillDown, fields, load: send, limit };
  }

  function dataTypeOf(field, dataTypes) {
    if (!field || !dataTypes) {
      return null;
    }

    const lower = field.toLowerCase();
    const entry = Object.entries(dataTypes).find(([name]) => name.toLowerCase() === lower);
    return entry ? entry[1] : null;
  }

  PivotForge.RemoteStore = {
    create: createRemoteStore,
    validateFields,
    validateRequest,
    SUMMARY_TYPES
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PivotForge.RemoteStore;
  }
})(typeof window !== "undefined" ? window : globalThis);
