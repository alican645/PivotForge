(function (root) {
  const PivotForge = root.PivotForge ??= {};

  const AGGREGATIONS = ["sum", "count", "average", "min", "max"];
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
      const inArea = area => fields.filter(field => field.area === area);

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

      (layout.rows ?? []).forEach(assertKnown);
      (layout.columns ?? []).forEach(assertKnown);
      (layout.values ?? []).forEach(value => assertKnown(value.field));
      (layout.filters ?? []).forEach(filter => assertKnown(filter.field));

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

    canDrop(name, area) {
      if (!this.catalog.has(name) || !PLACED_AREAS.includes(area)) {
        return false;
      }

      if (this.areaOf(name) === area) {
        return false;
      }

      const isMeasure = this.field(name).role === "measure";
      return area === "data" ? isMeasure : !isMeasure;
    }

    detach(name) {
      this.layout.rows = this.layout.rows.filter(entry => entry !== name);
      this.layout.columns = this.layout.columns.filter(entry => entry !== name);
      this.layout.values = this.layout.values.filter(value => value.field !== name);
      this.layout.filters = this.layout.filters.filter(filter => filter.field !== name);
    }

    move(name, area, index) {
      if (!this.canDrop(name, area)) {
        throw new Error(`Field "${name}" cannot be placed in area "${area}".`);
      }

      this.detach(name);

      const key = AREA_TO_KEY[area];
      const entry = area === "data"
        ? { field: name, aggregation: "sum", showAs: "normal" }
        : area === "filter"
          ? { field: name, values: [] }
          : name;

      const target = this.layout[key];
      target.splice(index ?? target.length, 0, entry);
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
      const [entry] = target.splice(fromIndex, 1);
      if (entry === undefined) {
        throw new Error(`No field at index ${fromIndex} in area "${area}".`);
      }

      target.splice(toIndex, 0, entry);
      this.emitChange();
    }

    setAggregation(name, aggregation) {
      const value = this.layout.values.find(entry => entry.field === name);
      if (!value) {
        throw new Error(`Field "${name}" is not in the data area.`);
      }

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
      const state = this.getState();

      return [
        ...state.rows.map(name => ({ dataField: name, caption: captionOf(name), area: "row" })),
        ...state.columns.map(name => ({ dataField: name, caption: captionOf(name), area: "column" })),
        ...state.values.map(value => ({
          dataField: value.field,
          caption: captionOf(value.field),
          area: "data",
          aggregation: value.aggregation,
          showAs: value.showAs
        })),
        ...state.filters.map(filter => ({
          dataField: filter.field,
          caption: captionOf(filter.field),
          area: "filter"
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
