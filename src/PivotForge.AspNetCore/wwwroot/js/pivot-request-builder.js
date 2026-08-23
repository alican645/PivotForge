(function (root) {
  const PivotForge = root.PivotForge ??= {};

  const AREAS = ["row", "column", "data", "filter", "available"];
  const ROLES = ["dimension", "measure"];
  const AGGREGATIONS = ["sum", "count", "average", "min", "max"];
  const FORMAT_TYPES = ["number", "currency", "percent"];
  const SORT_ORDERS = ["Ascending", "Descending"];
  const FILTER_MODES = ["Include", "Exclude"];
  const SHOW_AS = [
    "normal",
    "percentOfRowTotal",
    "percentOfColumnTotal",
    "percentOfGrandTotal",
    "differenceFromPrevious",
    "percentDifferenceFromPrevious",
    "runningTotal"
  ];

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

    const inferredRole = area === "data" ? "measure" : area === "available" ? null : "dimension";
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
    if (!isData && field.aggregation !== undefined) {
      throw new Error(
        `"aggregation" is only valid on a "data" field, but was set on "${dataField}" in area "${area}".`
      );
    }

    if (!isData && field.showAs !== undefined) {
      throw new Error(
        `"showAs" is only valid on a "data" field, but was set on "${dataField}" in area "${area}".`
      );
    }

    const aggregation = isData ? field.aggregation ?? "sum" : null;
    if (isData && !AGGREGATIONS.includes(aggregation)) {
      throw new Error(
        `Unknown aggregation "${aggregation}" on field "${dataField}". Expected one of: ${AGGREGATIONS.join(", ")}.`
      );
    }

    const showAs = isData ? field.showAs ?? "normal" : null;
    if (isData && !SHOW_AS.includes(showAs)) {
      throw new Error(
        `Unknown showAs "${showAs}" on field "${dataField}". Expected one of: ${SHOW_AS.join(", ")}.`
      );
    }

    // Both describe how the row axis is drawn, and the grid draws subtotals and
    // collapsible groups on the row axis only -- so declaring either elsewhere
    // is a mistake worth reporting rather than a setting that does nothing.
    const isRow = area === "row";
    ["expanded", "showTotals"].forEach(member => {
      if (!isRow && field[member] !== undefined) {
        throw new Error(
          `"${member}" is only valid on a "row" field, but was set on "${dataField}" in area "${area}".`
        );
      }
    });

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

    const sortOrder = isDimensionAxis ? field.sortOrder ?? null : null;
    if (sortOrder !== null && !SORT_ORDERS.includes(sortOrder)) {
      throw new Error(
        `Unknown sortOrder "${sortOrder}" on field "${dataField}". Expected one of: ${SORT_ORDERS.join(", ")}.`
      );
    }

    return {
      dataField,
      area,
      role,
      areaIndex: areaIndex ?? null,
      sortOrder,
      caption: field.caption ?? dataField,
      aggregation,
      showAs,
      format: field.format ?? null,
      // Default true, so an undeclared field behaves exactly as it did before
      // these existed.
      expanded: isRow ? field.expanded !== false : null,
      showTotals: isRow ? field.showTotals !== false : null,
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

    return {
      field,
      // A null source value is compared as the empty string all the way down to
      // the engine, so that is what a blank is carried as.
      values: filter.values.map(value => (value == null ? "" : String(value))),
      mode
    };
  }

  function valueKey(field) {
    return `${field.dataField}_${String(field.aggregation).toLowerCase()}`;
  }

  function buildRequest(fields, extras = {}) {
    const normalized = normalizeFields(fields).filter(field => field.visible);
    const inArea = area => normalized.filter(field => field.area === area);
    const values = inArea("data");

    if (values.length === 0) {
      throw new Error('A pivot configuration requires at least one field with area "data".');
    }

    return {
      rows: inArea("row").map(field => field.dataField),
      columns: inArea("column").map(field => field.dataField),
      values: values.map(field => ({
        field: field.dataField,
        aggregation: field.aggregation,
        showAs: field.showAs
      })),
      filters: (extras.filters ?? []).map(normalizeFilter),
      rowSort: extras.rowSort ?? null,
      // Named rather than positional so the list survives a field moving to
      // another area, and so a later per-field sortBy has somewhere to live.
      fieldSorts: normalized
        .filter(field => field.sortOrder !== null)
        .map(field => ({ field: field.dataField, direction: field.sortOrder }))
    };
  }

  PivotForge.PivotRequestBuilder = {
    normalizeFields, normalizeFilter, buildRequest, valueKey,
    AGGREGATIONS, SHOW_AS, FORMAT_TYPES, SORT_ORDERS, FILTER_MODES
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PivotForge.PivotRequestBuilder;
  }
})(typeof window !== "undefined" ? window : globalThis);
