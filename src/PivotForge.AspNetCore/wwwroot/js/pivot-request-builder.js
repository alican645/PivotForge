(function (root) {
  const PivotForge = root.PivotForge ??= {};

  const AREAS = ["row", "column", "data", "filter", "available"];
  const ROLES = ["dimension", "measure"];
  const AGGREGATIONS = ["sum", "count", "average", "min", "max", "countDistinct", "median", "variance", "standardDeviation", "variancePopulation", "standardDeviationPopulation", "first", "last"];
  // Not among the choices above: a calculated field's formula is its aggregation,
  // so this one is never picked, only implied by an expression.
  const CALCULATED = "calculated";
  // The summaries a formula may call without the server registering anything.
  // Anything else is a custom aggregate, which only the server can resolve.
  const FORMULA_FUNCTIONS = [
    "Sum", "Count", "Avg", "Average", "Min", "Max",
    "CountDistinct", "Median", "Var", "Variance", "StDev", "StdDev",
    "VarP", "StDevP", "First", "Last"
  ];
  const FORMAT_TYPES = ["number", "currency", "percent"];
  // How a negative number is written: with its sign, or in parentheses as
  // accounts write it.
  const NEGATIVE_FORMATS = ["minus", "parentheses"];
  const SORT_ORDERS = ["Ascending", "Descending"];
  const FILTER_MODES = ["Include", "Exclude"];
  // How many arguments each operator reads out of a filter's values, and with it
  // the list of operators there are. Below that count a condition restricts
  // nothing -- which is what a range looks like while it is being typed in.
  const FILTER_ARGUMENTS = {
    Equals: 1,
    Contains: 1,
    StartsWith: 1,
    EndsWith: 1,
    Between: 2,
    GreaterThan: 1,
    LessThan: 1,
    Blank: 0
  };
  const FILTER_OPERATORS = Object.keys(FILTER_ARGUMENTS);

  // The operators that put their argument in order rather than matching its text,
  // and so the only ones for which "what kind of value is this" changes anything.
  const COMPARISON_OPERATORS = ["Between", "GreaterThan", "LessThan"];

  // What the engine will read a value as. It tries an invariant number first, then
  // an invariant date, and falls back to collated text -- so "2024" is a number
  // rather than a year, and a picker that decided otherwise would offer a control
  // whose output the comparison ignores. Mirrored here rather than guessed at,
  // because the two have to agree for the argument to mean anything.
  const INVARIANT_NUMBER = /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)?(?:\.\d+)?$/;

  function comparisonType(value) {
    const text = String(value ?? "").trim();

    // Blank needs no branch of its own: it holds no digit and Date.parse rejects
    // it, so it falls through to text the way anything unreadable does.
    if (/\d/.test(text) && INVARIANT_NUMBER.test(text)) {
      return "number";
    }

    return Number.isNaN(Date.parse(text)) ? "text" : "date";
  }
  // Date groupings. Spelled as the engine's enum reads them, lowercased, because
  // that spelling is also half of a grouped level's identity.
  const GROUP_INTERVALS = ["year", "quarter", "month", "day", "dayOfWeek", "range"];
  // What a source column's values are converted to as they are read (DevExtreme's
  // dataType). Sent as the engine's enum name.
  const DATA_TYPES = ["string", "number", "date"];
  // A value's running total, DevExtreme's runningTotal: along each row or down
  // each column, after the display mode.
  const RUNNING_TOTALS = ["row", "column"];
  // What a row or column level's labels are compared by, DevExtreme's sortBy:
  // the value behind the label, its text, or the order the source yielded them.
  const SORT_BYS = ["value", "displayText", "none"];

  const TOP_N_MODES = ["Top", "Bottom"];
  // How a value filter compares a group's summary value. The two ranges read a
  // second bound; the rest read one.
  const VALUE_FILTER_OPERATORS = [
    "GreaterThan", "GreaterThanOrEqual", "LessThan", "LessThanOrEqual",
    "Equal", "NotEqual", "Between", "NotBetween"
  ];
  const isRangeOperator = operator => operator === "Between" || operator === "NotBetween";
  const SHOW_AS = [
    "normal",
    "percentOfRowTotal",
    "percentOfColumnTotal",
    "percentOfGrandTotal",
    "differenceFromPrevious",
    "percentDifferenceFromPrevious",
    "runningTotal",
    "percentOfParentRowTotal",
    "percentOfParentColumnTotal"
  ];

  // Mirrors PivotExpression on the server, so a formula typed into the designer is
  // refused where it was typed rather than by a failed request. Evaluation stays on
  // the server; this only reads the text and reports which fields it names. Errors
  // carry a code and the position, so a locale can word them and the editor can put
  // the caret where the problem is.
  // The functions that read another cell, as the engine's PivotExpression names
  // them: each takes a formula, and Slice a field and a whole number after it.
  const RELATIVE_FUNCTIONS = [
    "Prev", "Next", "PrevRow", "NextRow", "ParentRow", "ParentColumn",
    "RowTotal", "ColumnTotal", "GrandTotal", "Slice"
  ];

  function parseExpression(text) {
    const source = String(text ?? "");
    let position = 0;
    const summaries = [];
    const sliceFields = [];

    const fail = (code, detail, at = position) => {
      const messages = {
        empty: "A calculated field requires a formula.",
        end: detail
          ? `The formula ends where '${detail}' was expected.`
          : "The formula ends where a value was expected.",
        unexpected: `Unexpected '${detail}'.`,
        bareWord: `'${detail}' is not a value. Field names are written in brackets, as [${detail}].`,
        unclosed: "A field name is missing its closing ']'.",
        emptyReference: "A field reference names no field.",
        number: `'${detail}' is not a number.`,
        argument: `${detail}() takes a field in brackets, such as ${detail}([Amount]).`,
        sliceField: `${detail}() takes a field in brackets after the formula, such as ${detail}([Amount], [Year], -1).`,
        sliceOffset: `${detail}() moves a whole number of members, such as ${detail}([Amount], [Year], -1).`,
        expected: `Expected '${detail}'.`
      };
      const error = new Error(messages[code]);
      error.code = code;
      error.detail = detail ?? null;
      error.position = at;
      throw error;
    };

    const skip = () => {
      while (position < source.length && /\s/.test(source[position])) {
        position++;
      }
    };

    const consume = (...candidates) => {
      skip();
      if (position < source.length && candidates.includes(source[position])) {
        return source[position++];
      }

      return null;
    };

    const expect = expected => {
      if (consume(expected) === null) {
        fail(position < source.length ? "expected" : "end", expected);
      }
    };

    const fieldName = () => {
      const start = position;
      const close = source.indexOf("]", position + 1);
      if (close < 0) {
        fail("unclosed", null, start);
      }

      const name = source.slice(position + 1, close).trim();
      position = close + 1;
      if (name === "") {
        fail("emptyReference", null, start);
      }

      return name;
    };

    const primary = () => {
      skip();
      if (position >= source.length) {
        fail("end");
      }

      const current = source[position];

      if (current === "(") {
        position++;
        sum();
        expect(")");
        return;
      }

      if (current === "[") {
        summaries.push({ function: "Sum", field: fieldName() });
        return;
      }

      if (/[\d.]/.test(current)) {
        const start = position;
        while (position < source.length && /[\d.]/.test(source[position])) {
          position++;
        }

        const written = source.slice(start, position);
        if (!/^(\d+\.?\d*|\.\d+)$/.test(written)) {
          fail("number", written, start);
        }

        return;
      }

      if (/[\p{L}_]/u.test(current)) {
        const start = position;
        while (position < source.length && /[\p{L}\p{N}_]/u.test(source[position])) {
          position++;
        }

        const name = source.slice(start, position);
        skip();
        if (source[position] !== "(") {
          fail("bareWord", name, start);
        }

        position++;

        const relative = RELATIVE_FUNCTIONS.find(entry => entry.toLowerCase() === name.toLowerCase());
        if (relative) {
          sum();
          if (relative === "Slice") {
            expect(",");
            skip();
            if (source[position] !== "[") {
              fail("sliceField", name);
            }
            sliceFields.push(fieldName());
            expect(",");
            skip();
            const start = position;
            if (source[position] === "-" || source[position] === "+") {
              position++;
              skip();
            }
            const digits = position;
            while (position < source.length && /\d/.test(source[position])) {
              position++;
            }
            if (position === digits) {
              fail("sliceOffset", name, start);
            }
          }
          expect(")");
          return;
        }

        skip();
        if (source[position] !== "[") {
          fail("argument", name);
        }

        summaries.push({ function: name, field: fieldName() });
        expect(")");
        return;
      }

      fail("unexpected", current);
    };

    const unary = () => {
      if (consume("-", "+") !== null) {
        unary();
        return;
      }

      primary();
    };

    const product = () => {
      unary();
      while (consume("*", "/") !== null) {
        unary();
      }
    };

    function sum() {
      product();
      while (consume("+", "-") !== null) {
        product();
      }
    }

    if (source.trim() === "") {
      fail("empty", null, 0);
    }

    sum();
    skip();
    if (position < source.length) {
      fail("unexpected", source[position]);
    }

    const fields = [];
    summaries.forEach(({ field }) => {
      if (!fields.some(known => known.toLowerCase() === field.toLowerCase())) {
        fields.push(field);
      }
    });

    return { fields, summaries, sliceFields };
  }

  function normalizeField(field, index) {
    if (!field || typeof field !== "object") {
      throw new Error(`Field at index ${index} must be an object.`);
    }

    const dataField = field.dataField;
    if (typeof dataField !== "string" || dataField.trim() === "") {
      throw new Error(`Field at index ${index} requires a non-empty "dataField".`);
    }

    const area = field.area ?? "data";
    if (!AREAS.includes(area)) {
      throw new Error(
        `Unknown area "${area}" on field "${dataField}". Expected one of: ${AREAS.join(", ")}.`
      );
    }

    // A formula yields a number, so a calculated field can only ever be a measure:
    // in the field list its role follows without being declared.
    const expression = field.expression ?? null;
    if (expression !== null) {
      if (typeof expression !== "string" || expression.trim() === "") {
        throw new Error(`"expression" on field "${dataField}" must be a non-empty string.`);
      }

      if (area !== "data" && area !== "available") {
        throw new Error(
          `"expression" is only valid on a "data" field, but was set on "${dataField}" in area "${area}".`
        );
      }

      if (field.aggregation !== undefined && field.aggregation !== CALCULATED) {
        throw new Error(
          `Field "${dataField}" sets both "expression" and "aggregation"; a calculated field's formula is its aggregation.`
        );
      }

      try {
        parseExpression(expression);
      } catch (error) {
        throw new Error(`Formula of field "${dataField}" is not valid: ${error.message}`);
      }
    }

    const inferredRole = area === "data"
      ? "measure"
      : area === "available" ? (expression !== null ? "measure" : null) : "dimension";
    const role = field.role ?? inferredRole;

    if (role === null) {
      throw new Error(
        `Field "${dataField}" in area "available" requires an explicit "role" because there is no area to infer it from.`
      );
    }

    if (!ROLES.includes(role)) {
      throw new Error(
        `Unknown role "${role}" on field "${dataField}". Expected one of: ${ROLES.join(", ")}.`
      );
    }

    if (inferredRole !== null && role !== inferredRole) {
      throw new Error(
        `Field "${dataField}" is in area "${area}", so its role cannot be "${role}".`
      );
    }

    const isData = area === "data";
    if (!isData && field.aggregation !== undefined && expression === null) {
      throw new Error(
        `"aggregation" is only valid on a "data" field, but was set on "${dataField}" in area "${area}".`
      );
    }

    if (!isData && field.showAs !== undefined) {
      throw new Error(
        `"showAs" is only valid on a "data" field, but was set on "${dataField}" in area "${area}".`
      );
    }

    // Presentation, valid in every area like caption and format: a field keeps
    // them wherever it is dragged, and the grid reads each where it applies.
    for (const flag of ["allowSorting", "allowFiltering", "wordWrap"]) {
      if (field[flag] !== undefined && field[flag] !== null && typeof field[flag] !== "boolean") {
        throw new Error(`"${flag}" on field "${dataField}" must be true or false.`);
      }
    }

    if (field.width !== undefined && field.width !== null &&
      !(Number.isFinite(field.width) && field.width > 0)) {
      throw new Error(`"width" on field "${dataField}" must be a number of pixels greater than zero.`);
    }

    const aggregation = isData ? (expression !== null ? CALCULATED : field.aggregation ?? "sum") : null;
    if (isData && expression === null && !AGGREGATIONS.includes(aggregation)) {
      throw new Error(
        `Unknown aggregation "${aggregation}" on field "${dataField}". Expected one of: ${AGGREGATIONS.join(", ")}.`
      );
    }

    if (!isData && field.runningTotal !== undefined) {
      throw new Error(
        `"runningTotal" is only valid on a "data" field, but was set on "${dataField}" in area "${area}".`
      );
    }

    const runningTotal = isData ? field.runningTotal ?? null : null;
    if (runningTotal !== null && !RUNNING_TOTALS.includes(runningTotal)) {
      throw new Error(
        `Unknown runningTotal "${runningTotal}" on field "${dataField}". Expected one of: ${RUNNING_TOTALS.join(", ")}.`
      );
    }

    const showAs = isData ? field.showAs ?? "normal" : null;
    if (isData && !SHOW_AS.includes(showAs)) {
      throw new Error(
        `Unknown showAs "${showAs}" on field "${dataField}". Expected one of: ${SHOW_AS.join(", ")}.`
      );
    }

    // Both describe how a header axis is drawn: collapsible groups and
    // subtotals exist on the row and column axes, so declaring either anywhere
    // else is a mistake worth reporting rather than a setting that does nothing.
    const isRow = area === "row";
    const isColumn = area === "column";
    if (!isRow && !isColumn && field.expanded !== undefined) {
      throw new Error(
        `"expanded" is only valid on a "row" or "column" field, but was set on "${dataField}" in area "${area}".`
      );
    }
    if (!isRow && !isColumn && field.showTotals !== undefined) {
      throw new Error(
        `"showTotals" is only valid on a "row" or "column" field, but was set on "${dataField}" in area "${area}".`
      );
    }

    // A grand total belongs to a measure: it is that value summed over the whole
    // row or column axis. A dimension has no such total to switch off. A measure
    // still waiting in the field list may declare it, because the catalog is the
    // only place it can live until the user drags it into the data area.
    const holdsGrandTotals = isData || (area === "available" && role === "measure");
    if (!holdsGrandTotals && field.showGrandTotals !== undefined) {
      throw new Error(
        `"showGrandTotals" is only valid on a "data" field, but was set on "${dataField}" in area "${area}".`
      );
    }

    // Null is what normalizing a field leaves for a setting that does not apply
    // to it, so a normalized field fed back in is accepted anywhere.
    const declared = name => field[name] !== undefined && field[name] !== null;

    // A measure's own settings, which a measure still in the field list may carry
    // the way it carries showGrandTotals.
    if (!holdsGrandTotals && (declared("allowCrossGroupCalculation") || declared("customizeText"))) {
      const name = declared("customizeText") ? "customizeText" : "allowCrossGroupCalculation";
      throw new Error(
        `"${name}" is only valid on a "data" field, but was set on "${dataField}" in area "${area}".`
      );
    }

    if (declared("allowCrossGroupCalculation") && typeof field.allowCrossGroupCalculation !== "boolean") {
      throw new Error(`"allowCrossGroupCalculation" on field "${dataField}" must be true or false.`);
    }

    // A function, or the name of one on the page -- resolved when a cell is drawn,
    // like an event handler, so a script further down the page can define it.
    if (declared("customizeText") && typeof field.customizeText !== "function" &&
      (typeof field.customizeText !== "string" || field.customizeText.trim() === "")) {
      throw new Error(`"customizeText" on field "${dataField}" must be a function or the name of one.`);
    }

    if (declared("displayFolder") &&
      (typeof field.displayFolder !== "string" || field.displayFolder.trim() === "")) {
      throw new Error(`"displayFolder" on field "${dataField}" must be a non-empty string.`);
    }

    const areaIndex = field.areaIndex;
    if (areaIndex !== undefined &&
      (!Number.isInteger(areaIndex) || areaIndex < 0)) {
      throw new Error(
        `"areaIndex" on field "${dataField}" must be a non-negative integer, but was ${areaIndex}.`
      );
    }

    // Row and column fields are the only ones that produce a header axis to
    // order; a data field's order is its area order and a filter field has no
    // axis at all.
    const isDimensionAxis = area === "row" || area === "column";
    if (!isDimensionAxis && field.sortOrder !== undefined) {
      throw new Error(
        `"sortOrder" is only valid on a "row" or "column" field, but was set on "${dataField}" in area "${area}".`
      );
    }

    // A measure is aggregated, not grouped: collapsing it to a month would leave
    // nothing to sum. Everything else may group, including a field waiting in
    // the available list.
    if (isData && field.groupInterval !== undefined) {
      throw new Error(
        `"groupInterval" is only valid on a dimension field, but was set on "${dataField}" in area "${area}".`
      );
    }

    const dataType = field.dataType ?? null;
    if (dataType !== null && !DATA_TYPES.includes(dataType)) {
      throw new Error(
        `Unknown dataType "${dataType}" on field "${dataField}". Expected one of: ${DATA_TYPES.join(", ")}.`
      );
    }

    // A formula's result is computed, not read, so there is nothing to convert.
    if (dataType !== null && expression !== null) {
      throw new Error(`"dataType" on field "${dataField}" cannot be combined with "expression".`);
    }

    const groupInterval = isData ? null : field.groupInterval ?? null;
    if (groupInterval !== null && !GROUP_INTERVALS.includes(groupInterval)) {
      throw new Error(
        `Unknown groupInterval "${groupInterval}" on field "${dataField}". Expected one of: ${GROUP_INTERVALS.join(", ")}.`
      );
    }

    // A numeric range needs its width, and a width means nothing to a date
    // interval, so each without the other is a mistake worth reporting.
    const declaredSize = field.groupSize !== undefined && field.groupSize !== null;
    const groupSize = groupInterval === "range" ? Number(field.groupSize) : null;
    if (groupInterval === "range" && !(Number.isFinite(groupSize) && groupSize > 0)) {
      throw new Error(`groupInterval "range" on field "${dataField}" requires a "groupSize" greater than zero.`);
    }
    if (groupInterval !== "range" && declaredSize) {
      throw new Error(`"groupSize" on field "${dataField}" is only valid with groupInterval "range".`);
    }

    const sortOrder = isDimensionAxis ? field.sortOrder ?? null : null;
    if (sortOrder !== null && !SORT_ORDERS.includes(sortOrder)) {
      throw new Error(
        `Unknown sortOrder "${sortOrder}" on field "${dataField}". Expected one of: ${SORT_ORDERS.join(", ")}.`
      );
    }

    for (const option of ["sortBy", "sortingMethod"]) {
      if (!isDimensionAxis && field[option] !== undefined) {
        throw new Error(
          `"${option}" is only valid on a "row" or "column" field, but was set on "${dataField}" in area "${area}".`
        );
      }
    }

    const sortBy = isDimensionAxis ? field.sortBy ?? null : null;
    if (sortBy !== null && !SORT_BYS.includes(sortBy)) {
      throw new Error(
        `Unknown sortBy "${sortBy}" on field "${dataField}". Expected one of: ${SORT_BYS.join(", ")}.`
      );
    }

    // The name of a comparer registered on the server (PivotForgeOptions.CustomSorts):
    // DevExtreme's sortingMethod is a function, but the ordering runs on the server.
    const sortingMethod = isDimensionAxis ? field.sortingMethod ?? null : null;
    if (sortingMethod !== null && (typeof sortingMethod !== "string" || sortingMethod.trim() === "")) {
      throw new Error(
        `"sortingMethod" on field "${dataField}" must be the name of a comparer registered on the server.`
      );
    }

    // Ordering a level by a summary value works on both axes: a row level by
    // its row totals, a column level by its column totals.
    if (!isDimensionAxis && field.sortByValueKey !== undefined) {
      throw new Error(
        `"sortByValueKey" is only valid on a "row" or "column" field, but was set on "${dataField}" in area "${area}".`
      );
    }

    // The header path on the other axis whose summary the value sort reads:
    // a column path for a row field, a row path for a column field.
    const sortBySummaryPath = isDimensionAxis ? field.sortBySummaryPath ?? null : null;
    if (sortBySummaryPath !== null) {
      if (!Array.isArray(sortBySummaryPath)) {
        throw new Error(`"sortBySummaryPath" on field "${dataField}" must be an array of header values.`);
      }

      if (!field.sortByValueKey) {
        throw new Error(
          `"sortBySummaryPath" on field "${dataField}" requires "sortByValueKey": it only says which summary is compared.`);
      }
    }

    return {
      dataField,
      // What identifies this level everywhere except the source query: a date
      // column grouped by year and again by month is two levels, and dataField
      // alone cannot tell them apart. A plain field is its own key, so nothing
      // that existed before grouping changes shape.
      // A range carries its width, as the engine's key does: two widths of one
      // column are two levels.
      key: groupInterval === null
        ? dataField
        : `${dataField}:${groupInterval}${groupInterval === "range" ? String(groupSize) : ""}`,
      groupInterval,
      groupSize,
      dataType,
      area,
      role,
      areaIndex: areaIndex ?? null,
      sortOrder,
      sortBy,
      sortingMethod,
      sortByValueKey: isDimensionAxis && field.sortByValueKey ? String(field.sortByValueKey) : null,
      sortBySummaryPath: sortBySummaryPath === null || sortBySummaryPath.length === 0
        ? null
        : sortBySummaryPath.map(value => value === null || value === undefined ? null : String(value)),
      caption: field.caption ?? dataField,
      aggregation,
      showAs,
      runningTotal,
      expression,
      format: field.format ?? null,
      // Default true, so an undeclared field behaves exactly as it did before
      // these existed.
      expanded: isRow || isColumn ? field.expanded !== false : null,
      showTotals: isRow || isColumn ? field.showTotals !== false : null,
      showGrandTotals: holdsGrandTotals ? field.showGrandTotals !== false : null,
      // Default true: the grid-wide allowSorting / allowFiltering still decide
      // first, and a field can only take its own controls away.
      allowSorting: field.allowSorting !== false,
      allowFiltering: field.allowFiltering !== false,
      // Null leaves the grid's own sizing and its no-wrap default alone.
      width: field.width ?? null,
      wordWrap: typeof field.wordWrap === "boolean" ? field.wordWrap : null,
      // Default true: a running total or a comparison with the previous column
      // walks the whole row, as it always did.
      allowCrossGroupCalculation: holdsGrandTotals ? field.allowCrossGroupCalculation !== false : null,
      customizeText: holdsGrandTotals ? field.customizeText ?? null : null,
      // The field list's folder, in any area: a field keeps it wherever it goes.
      displayFolder: declared("displayFolder") ? field.displayFolder.trim() : null,
      visible: field.visible !== false
    };
  }

  // Reorders each area's fields by their declared areaIndex, leaving the areas
  // themselves where they are: only the fields sharing an area trade places, so
  // a list that declares no index at all comes back untouched. An undeclared
  // field sorts after every declared one and keeps its position relative to the
  // other undeclared ones.
  function applyAreaIndex(fields) {
    const rank = field => field.areaIndex ?? Number.MAX_SAFE_INTEGER;
    const areas = new Map();

    fields.forEach((field, position) => {
      const slots = areas.get(field.area) ?? { positions: [], fields: [] };
      slots.positions.push(position);
      slots.fields.push(field);
      areas.set(field.area, slots);
    });

    const ordered = fields.slice();

    areas.forEach(({ positions, fields: inArea }) => {
      // Array#sort is stable, so equal ranks -- which is every pair of
      // undeclared fields -- keep the order they were written in.
      const sorted = inArea.slice().sort((left, right) => rank(left) - rank(right));

      positions.forEach((position, at) => {
        ordered[position] = sorted[at];
      });
    });

    return ordered;
  }

  function normalizeFields(fields) {
    if (!Array.isArray(fields)) {
      throw new Error('"fields" must be an array.');
    }

    return applyAreaIndex(fields.map(normalizeField));
  }

  // The one place the filter vocabulary is spelled out, so the designer, the
  // widget's own setFilter, and a restored view all agree on what a filter is.
  function normalizeFilter(filter, index) {
    if (!filter || typeof filter !== "object") {
      throw new Error(`Filter at index ${index} must be an object.`);
    }

    const field = filter.field;
    if (typeof field !== "string" || field.trim() === "") {
      throw new Error(`Filter at index ${index} requires a non-empty "field".`);
    }

    if (!Array.isArray(filter.values)) {
      throw new Error(`Filter on field "${field}" requires a "values" array.`);
    }

    const mode = filter.mode ?? "Include";
    if (!FILTER_MODES.includes(mode)) {
      throw new Error(
        `Unknown filter mode "${mode}" on field "${field}". Expected one of: ${FILTER_MODES.join(", ")}.`
      );
    }

    const operator = filter.operator ?? "Equals";
    if (!FILTER_OPERATORS.includes(operator)) {
      throw new Error(
        `Unknown filter operator "${operator}" on field "${field}". Expected one of: ${FILTER_OPERATORS.join(", ")}.`
      );
    }

    return {
      field,
      // A null source value is compared as the empty string all the way down to
      // the engine, so that is what a blank is carried as.
      values: filter.values.map(value => (value == null ? "" : String(value))),
      mode,
      // Written only when it is not the default, so a payload from a page that
      // never touched an operator looks exactly as it always did -- and a view
      // saved before operators existed reads back unchanged.
      ...(operator === "Equals" ? {} : { operator })
    };
  }

  function valueKey(field) {
    return `${field.dataField}_${String(field.aggregation).toLowerCase()}`;
  }

  // The type of every source column the catalog types, keyed by column: the
  // type belongs to the column, so a year level and a month level of one date
  // column are one entry -- and two that disagree are a mistake caught here.
  function dataTypes(fields) {
    const types = {};

    for (const field of fields) {
      if (field.dataType === null) {
        continue;
      }

      const type = field.dataType[0].toUpperCase() + field.dataType.slice(1);
      if (types[field.dataField] && types[field.dataField] !== type) {
        throw new Error(
          `Field "${field.dataField}" is declared as both ${types[field.dataField]} and ${type}; a column has one data type.`);
      }

      types[field.dataField] = type;
    }

    return types;
  }

  function buildRequest(fields, extras = {}) {
    const declared = normalizeFields(fields);
    const types = dataTypes(declared);
    const normalized = declared.filter(field => field.visible);
    const inArea = area => normalized.filter(field => field.area === area);
    const values = inArea("data");

    if (values.length === 0) {
      throw new Error('A pivot configuration requires at least one field with area "data".');
    }

    // A plain level goes on the wire as the field name it always was; a grouped
    // one has to say which interval it is, because the same column can be there
    // twice.
    const level = field => field.groupInterval === null
      ? field.dataField
      : {
        field: field.dataField,
        interval: field.groupInterval,
        ...(field.groupSize !== null ? { binSize: field.groupSize } : {})
      };

    return {
      rows: inArea("row").map(level),
      columns: inArea("column").map(level),
      values: values.map(field => ({
        field: field.dataField,
        aggregation: field.aggregation,
        showAs: field.showAs,
        // Sent only when declared, so a request written before it existed is unchanged.
        ...(field.runningTotal ? { runningTotal: field.runningTotal === "row" ? "Row" : "Column" } : {}),
        ...(field.expression !== null ? { expression: field.expression } : {}),
        // Sent only when switched off, so every request written before it existed
        // is unchanged.
        ...(field.allowCrossGroupCalculation === false ? { allowCrossGroupCalculation: false } : {})
      })),
      // A filter names a level, so a grouped one has to be translated back into
      // the source field plus the interval its values are groups of -- the
      // engine compares month names against months, not against timestamps.
      filters: (extras.filters ?? []).map((filter, index) => {
        const normalizedFilter = normalizeFilter(filter, index);
        const grouped = normalized.find(
          field => field.key === normalizedFilter.field && field.groupInterval !== null);

        return grouped
          ? {
            ...normalizedFilter,
            field: grouped.dataField,
            interval: grouped.groupInterval,
            ...(grouped.groupSize !== null ? { binSize: grouped.groupSize } : {})
          }
          : normalizedFilter;
      }),
      rowSort: extras.rowSort ?? null,
      // Sent only when asked for, so a request from a page that never declared it
      // is byte-identical to one written before the option existed.
      ...(extras.hideEmptySummaryCells ? { hideEmptySummaryCells: true } : {}),
      // A ranking names a header level, so a grouped one travels as the level key
      // the engine matches against -- unlike a filter, it reads no source value of
      // its own and so needs no interval beside it.
      ...(normalizeRankings(extras.topN).length > 0
        ? { topN: normalizeRankings(extras.topN) }
        : {}),
      // Sent only when there are any, so every request written before they existed
      // is unchanged.
      ...(normalizeValueFilters(extras.valueFilters).length > 0
        ? { valueFilters: normalizeValueFilters(extras.valueFilters) }
        : {}),
      // Named rather than positional so the list survives a field moving to
      // another area. A value sort declared without a direction takes the row
      // axis default; valueKey is sent only when declared, so a page that never
      // uses it sends the request it always did.
      fieldSorts: fieldSorts(normalized, columnSort(extras.columnSort)),
      // Sent only when the catalog types a column, so every request written
      // before data types existed is unchanged.
      ...(Object.keys(types).length > 0 ? { dataTypes: types } : {})
    };
  }

  // A column value sort picked in the grid (sort columns by this row) orders
  // every column level by that row's value, the column half of what a row
  // value sort does. It travels as per-level sorts on the column fields,
  // standing in for whatever those fields declared.
  function columnSort(sort) {
    if (!sort || typeof sort.valueKey !== "string" || sort.valueKey === "") {
      return null;
    }

    return {
      valueKey: sort.valueKey,
      direction: SORT_ORDERS.includes(sort.direction) ? sort.direction : "Descending",
      rowPath: Array.isArray(sort.rowPath) && sort.rowPath.length > 0 ? [...sort.rowPath] : null
    };
  }

  function fieldSorts(normalized, columnValueSort) {
    return normalized
      .filter(field => field.area === "row" || field.area === "column")
      .map(field => {
        // A level's criterion: what its labels compare by, and what breaks a tie
        // between two equal summaries.
        const criterion = {
          ...(field.sortBy !== null && field.sortBy !== "value"
            ? { sortBy: field.sortBy === "displayText" ? "DisplayText" : "None" }
            : {}),
          ...(field.sortingMethod !== null ? { sortingMethod: field.sortingMethod } : {})
        };

        if (columnValueSort && field.area === "column") {
          return {
            field: field.key,
            direction: columnValueSort.direction,
            valueKey: columnValueSort.valueKey,
            ...(columnValueSort.rowPath ? { summaryPath: columnValueSort.rowPath } : {}),
            ...criterion
          };
        }

        if (field.sortOrder === null && field.sortByValueKey === null &&
          field.sortBy === null && field.sortingMethod === null) {
          return null;
        }

        return {
          field: field.key,
          direction: field.sortOrder ?? "Ascending",
          ...criterion,
          ...(field.sortByValueKey !== null ? { valueKey: field.sortByValueKey } : {}),
          ...(field.sortByValueKey !== null && field.sortBySummaryPath !== null
            ? { summaryPath: field.sortBySummaryPath }
            : {})
        };
      })
      .filter(sort => sort !== null);
  }

  // A ranking is validated here rather than on the server so a typo shows up where
  // it was written, the same way a bad aggregation does.
  function normalizeRankings(rankings) {
    return (rankings ?? []).map((ranking, index) => {
      const field = String(ranking?.field ?? "");
      const count = Number(ranking?.count);
      const mode = ranking?.mode ?? "Top";

      if (field === "") {
        throw new Error(`Ranking at index ${index} requires a "field".`);
      }

      if (!Number.isInteger(count) || count < 1) {
        throw new Error(`Ranking on "${field}" requires a whole "count" of at least 1.`);
      }

      if (!TOP_N_MODES.includes(mode)) {
        throw new Error(
          `Unknown ranking mode "${mode}" on "${field}". Expected one of: ${TOP_N_MODES.join(", ")}.`);
      }

      return {
        field,
        count,
        // Spelled by their absence: a ranking that took the defaults travels as the
        // two members it actually declared.
        ...(ranking?.valueKey ? { valueKey: String(ranking.valueKey) } : {}),
        ...(mode === "Top" ? {} : { mode })
      };
    });
  }

  // A value filter is checked here, like a ranking, so a typo shows up where it
  // was written. Bounds arrive as numbers or as the text an input holds.
  function normalizeValueFilters(filters) {
    return (filters ?? []).map((filter, index) => {
      const field = String(filter?.field ?? "");
      const operator = filter?.operator ?? "GreaterThan";
      const value = Number(filter?.value);
      const value2 = filter?.value2 === undefined || filter?.value2 === null || filter?.value2 === ""
        ? null
        : Number(filter.value2);

      if (field === "") {
        throw new Error(`Value filter at index ${index} requires a "field".`);
      }

      if (!VALUE_FILTER_OPERATORS.includes(operator)) {
        throw new Error(
          `Unknown value filter operator "${operator}" on "${field}". Expected one of: ${VALUE_FILTER_OPERATORS.join(", ")}.`);
      }

      if (filter?.value === "" || filter?.value === null || !Number.isFinite(value)) {
        throw new Error(`Value filter on "${field}" requires a number "value".`);
      }

      if (isRangeOperator(operator) ? !Number.isFinite(value2) : value2 !== null) {
        throw new Error(isRangeOperator(operator)
          ? `Value filter "${operator}" on "${field}" requires a number "value2", its upper bound.`
          : `Value filter "${operator}" on "${field}" compares one value; "value2" is only for Between and NotBetween.`);
      }

      return {
        field,
        operator,
        value,
        ...(value2 !== null ? { value2 } : {}),
        ...(filter?.valueKey ? { valueKey: String(filter.valueKey) } : {})
      };
    });
  }

  // Whether a filter entry actually restricts anything yet. The one rule the
  // renderer's funnel, the designer's chip and the request all consult, so a
  // blank-value condition is not mistaken for an empty filter.
  function restricts(filter) {
    return (filter?.values?.length ?? 0) >= (FILTER_ARGUMENTS[filter?.operator ?? "Equals"] ?? 1);
  }

  PivotForge.PivotRequestBuilder = {
    normalizeFields, normalizeFilter, buildRequest, valueKey, restricts, dataTypes,
    normalizeRankings, normalizeValueFilters, comparisonType, parseExpression,
    AGGREGATIONS, CALCULATED, DATA_TYPES, RUNNING_TOTALS, FORMULA_FUNCTIONS, RELATIVE_FUNCTIONS, SHOW_AS, FORMAT_TYPES, NEGATIVE_FORMATS, SORT_ORDERS, FILTER_MODES,
    FILTER_OPERATORS, FILTER_ARGUMENTS, TOP_N_MODES, COMPARISON_OPERATORS, VALUE_FILTER_OPERATORS
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PivotForge.PivotRequestBuilder;
  }
})(typeof window !== "undefined" ? window : globalThis);
