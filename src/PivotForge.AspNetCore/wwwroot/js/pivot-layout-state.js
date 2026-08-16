(function (root) {
  const PivotForge = root.PivotForge ??= {};

  const PLACED_AREAS = ["row", "column", "data", "filter"];
  const AREA_TO_KEY = { row: "rows", column: "columns", data: "values", filter: "filters" };

  class PivotLayoutState {
    constructor(catalog, layout = null) {
      const normalized = PivotForge.PivotRequestBuilder.normalizeFields(catalog ?? []);

      this.catalog = new Map(normalized.map(field => [field.dataField, field]));
      this.handlers = new Map();
      this.layout = layout ? this.adoptLayout(layout) : this.layoutFromCatalog(normalized);

      if (this.layout.values.length === 0) {
        throw new Error("A pivot layout requires at least one field in the data area.");
      }
    }

    layoutFromCatalog(fields) {
      // An invisible field is configured but not placed: it starts out available
      // rather than occupying its declared area, so it never appears as a live
      // chip until something (a later mutation) actually seats it.
      const inArea = area => fields.filter(field => field.area === area && field.visible);

      return {
        rows: inArea("row").map(field => field.dataField),
        columns: inArea("column").map(field => field.dataField),
        values: inArea("data").map(field => ({
          field: field.dataField,
          aggregation: field.aggregation ?? "sum",
          showAs: field.showAs ?? "normal"
        })),
        filters: inArea("filter").map(field => ({ field: field.dataField, values: [] }))
      };
    }

    adoptLayout(layout) {
      const assertKnown = name => {
        if (!this.catalog.has(name)) {
          throw new Error(`Layout field "${name}" is not in the catalog.`);
        }
      };

      // Reuses canPlaceByRole — the same role rule move()/canDrop() enforce —
      // so an adopted layout cannot smuggle in a placement interactive
      // drag-and-drop would have refused.
      const assertPlaceable = (name, area) => {
        assertKnown(name);
        if (!this.canPlaceByRole(name, area)) {
          throw new Error(
            `Layout field "${name}" cannot be placed in area "${area}"; its role does not allow it.`
          );
        }
      };

      const { AGGREGATIONS, SHOW_AS } = PivotForge.PivotRequestBuilder;

      const assertAggregation = (name, aggregation) => {
        if (!AGGREGATIONS.includes(aggregation)) {
          throw new Error(
            `Layout field "${name}" has unknown aggregation "${aggregation}". Expected one of: ${AGGREGATIONS.join(", ")}.`
          );
        }
      };

      const assertShowAs = (name, showAs) => {
        if (!SHOW_AS.includes(showAs)) {
          throw new Error(
            `Layout field "${name}" has unknown showAs "${showAs}". Expected one of: ${SHOW_AS.join(", ")}.`
          );
        }
      };

      (layout.rows ?? []).forEach(name => assertPlaceable(name, "row"));
      (layout.columns ?? []).forEach(name => assertPlaceable(name, "column"));
      (layout.values ?? []).forEach(value => {
        assertPlaceable(value.field, "data");
        assertAggregation(value.field, value.aggregation ?? "sum");
        assertShowAs(value.field, value.showAs ?? "normal");
      });
      (layout.filters ?? []).forEach(filter => assertPlaceable(filter.field, "filter"));

      return {
        rows: [...(layout.rows ?? [])],
        columns: [...(layout.columns ?? [])],
        values: (layout.values ?? []).map(value => ({
          field: value.field,
          aggregation: value.aggregation ?? "sum",
          showAs: value.showAs ?? "normal"
        })),
        filters: (layout.filters ?? []).map(filter => ({
          field: filter.field,
          values: [...(filter.values ?? [])]
        }))
      };
    }

    field(name) {
      const found = this.catalog.get(name);
      if (!found) {
        throw new Error(`Field "${name}" is not in the catalog.`);
      }
      return found;
    }

    areaOf(name) {
      if (this.layout.rows.includes(name)) return "row";
      if (this.layout.columns.includes(name)) return "column";
      if (this.layout.values.some(value => value.field === name)) return "data";
      if (this.layout.filters.some(filter => filter.field === name)) return "filter";
      return "available";
    }

    // The single source of truth for which area a field's role allows. Used by
    // canDrop() for interactive drag-and-drop and by adoptLayout() for a
    // layout supplied programmatically, so there is exactly one copy of the rule.
    canPlaceByRole(name, area) {
      const isMeasure = this.field(name).role === "measure";
      return area === "data" ? isMeasure : !isMeasure;
    }

    canDrop(name, area) {
      if (!this.catalog.has(name) || !PLACED_AREAS.includes(area)) {
        return false;
      }

      // A drop into the field's current area is not a no-op: it is how the
      // designer expresses repositioning, and move() carries the index.
      return this.canPlaceByRole(name, area);
    }

    detach(name) {
      this.layout.rows = this.layout.rows.filter(entry => entry !== name);
      this.layout.columns = this.layout.columns.filter(entry => entry !== name);
      this.layout.values = this.layout.values.filter(value => value.field !== name);
      this.layout.filters = this.layout.filters.filter(filter => filter.field !== name);
    }

    // Which slot in `area` currently holds `name`, or -1. Rows and columns hold
    // plain names; data and filter hold entry objects keyed by `field`.
    indexIn(area, name) {
      return this.layout[AREA_TO_KEY[area]]
        .findIndex(entry => (typeof entry === "string" ? entry : entry.field) === name);
    }

    move(name, area, index) {
      if (!this.canDrop(name, area)) {
        throw new Error(`Field "${name}" cannot be placed in area "${area}".`);
      }

      const key = AREA_TO_KEY[area];
      const fromIndex = this.indexIn(area, name);
      // Repositioning within an area must carry the existing entry across, or a
      // reorder would silently reset a value's aggregation and showAs, or drop
      // a filter's selected values.
      const existing = fromIndex >= 0 ? this.layout[key][fromIndex] : null;

      this.detach(name);

      const entry = existing ?? (area === "data"
        ? { field: name, aggregation: "sum", showAs: "normal" }
        : area === "filter"
          ? { field: name, values: [] }
          : name);

      // detach() reassigns the area arrays, so the target has to be re-read.
      const target = this.layout[key];
      // Removing the field shifted every later slot down by one, so an index
      // past its old position refers to one slot earlier now.
      const insertAt = index === undefined || index === null
        ? target.length
        : fromIndex >= 0 && index > fromIndex ? index - 1 : index;

      target.splice(insertAt, 0, entry);
      this.emitChange();
    }

    remove(name) {
      const area = this.areaOf(name);
      if (area === "available") {
        return;
      }

      if (area === "data" && this.layout.values.length === 1) {
        throw new Error(
          `Field "${name}" is the last field in the data area and a pivot requires at least one.`
        );
      }

      this.detach(name);
      this.emitChange();
    }

    reorder(area, fromIndex, toIndex) {
      const key = AREA_TO_KEY[area];
      if (!key) {
        throw new Error(`Cannot reorder unknown area "${area}".`);
      }

      const target = this.layout[key];

      // Both indices are validated up front against the target array's own
      // bounds — negative indices are not "from the end" here (splice's
      // native meaning), they are simply invalid.
      if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= target.length) {
        throw new Error(`No field at index ${fromIndex} in area "${area}".`);
      }

      if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= target.length) {
        throw new Error(`Cannot reorder area "${area}" to index ${toIndex}: out of bounds.`);
      }

      const [entry] = target.splice(fromIndex, 1);
      target.splice(toIndex, 0, entry);
      this.emitChange();
    }

    setAggregation(name, aggregation) {
      const value = this.layout.values.find(entry => entry.field === name);
      if (!value) {
        throw new Error(`Field "${name}" is not in the data area.`);
      }

      const { AGGREGATIONS } = PivotForge.PivotRequestBuilder;
      if (!AGGREGATIONS.includes(aggregation)) {
        throw new Error(
          `Unknown aggregation "${aggregation}". Expected one of: ${AGGREGATIONS.join(", ")}.`
        );
      }

      value.aggregation = aggregation;
      this.emitChange();
    }

    getState() {
      const placed = new Set([
        ...this.layout.rows,
        ...this.layout.columns,
        ...this.layout.values.map(value => value.field),
        ...this.layout.filters.map(filter => filter.field)
      ]);

      return {
        rows: [...this.layout.rows],
        columns: [...this.layout.columns],
        values: this.layout.values.map(value => ({ ...value })),
        filters: this.layout.filters.map(filter => ({ ...filter, values: [...filter.values] })),
        available: [...this.catalog.keys()].filter(name => !placed.has(name))
      };
    }

    toFields() {
      const captionOf = name => this.field(name).caption;
      // visible and format are catalog-level attributes, not something a
      // drag-and-drop mutation changes, so every emitted field carries its
      // catalog value through untouched. Without this, a field declared
      // visible:false would come back visible:true (the normalizeField
      // default) the moment toFields() round-trips through buildRequest.
      const visibleOf = name => this.field(name).visible;
      const formatOf = name => this.field(name).format;

      const state = this.getState();

      return [
        ...state.rows.map(name => ({
          dataField: name,
          caption: captionOf(name),
          area: "row",
          format: formatOf(name),
          visible: visibleOf(name)
        })),
        ...state.columns.map(name => ({
          dataField: name,
          caption: captionOf(name),
          area: "column",
          format: formatOf(name),
          visible: visibleOf(name)
        })),
        ...state.values.map(value => ({
          dataField: value.field,
          caption: captionOf(value.field),
          area: "data",
          aggregation: value.aggregation,
          showAs: value.showAs,
          format: formatOf(value.field),
          visible: visibleOf(value.field)
        })),
        ...state.filters.map(filter => ({
          dataField: filter.field,
          caption: captionOf(filter.field),
          area: "filter",
          format: formatOf(filter.field),
          visible: visibleOf(filter.field)
        }))
      ];
    }

    toRequestState() {
      return {
        fields: this.toFields(),
        filters: this.getState().filters.filter(filter => filter.values.length > 0)
      };
    }

    on(eventName, handler) {
      if (typeof handler !== "function") {
        throw new Error(`Handler for "${eventName}" must be a function.`);
      }

      const handlers = this.handlers.get(eventName) ?? new Set();
      handlers.add(handler);
      this.handlers.set(eventName, handlers);
      return () => handlers.delete(handler);
    }

    emitChange() {
      this.handlers.get("change")?.forEach(handler => handler(this.getState()));
    }
  }

  PivotForge.PivotLayoutState = PivotLayoutState;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PivotLayoutState;
  }
})(typeof window !== "undefined" ? window : globalThis);
