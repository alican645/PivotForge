(function (root) {
  const PivotForge = root.PivotForge ??= {};

  const AREAS = ["row", "column", "data", "filter", "available"];
  const ROLES = ["dimension", "measure"];
  const AGGREGATIONS = ["sum", "count", "average", "min", "max"];
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

    return {
      dataField,
      area,
      role,
      caption: field.caption ?? dataField,
      aggregation,
      showAs,
      format: field.format ?? null,
      visible: field.visible !== false
    };
  }

  function normalizeFields(fields) {
    if (!Array.isArray(fields)) {
      throw new Error('"fields" must be an array.');
    }

    return fields.map(normalizeField);
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
      filters: extras.filters ?? [],
      rowSort: extras.rowSort ?? null
    };
  }

  PivotForge.PivotRequestBuilder = { normalizeFields, buildRequest, valueKey, AGGREGATIONS, SHOW_AS };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PivotForge.PivotRequestBuilder;
  }
})(typeof window !== "undefined" ? window : globalThis);
