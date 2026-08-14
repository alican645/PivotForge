(function (root) {
  const PivotForge = root.PivotForge ??= {};

  class PivotViewStore {
    constructor(storage, options = {}) {
      this.storage = storage;
      this.version = 1;
      this.lastStateKey = options.lastStateKey ?? "pivot-table:last-state:v1";
      this.savedViewsKey = options.savedViewsKey ?? "pivot-table:saved-views:v1";
      this.fields = new Set(options.fields ?? []);
      this.aggregations = new Set(options.aggregations ?? ["sum", "count", "average", "min", "max"]);
      this.formatTypes = new Set(options.formatTypes ?? ["number", "currency", "percent"]);
      this.showAsModes = new Set(options.showAsModes ?? [
        "normal",
        "percentOfRowTotal",
        "percentOfColumnTotal",
        "percentOfGrandTotal",
        "differenceFromPrevious",
        "percentDifferenceFromPrevious",
        "runningTotal"
      ]);
      this.conditionalOperators = new Set(["greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual", "equal", "between"]);
      this.conditionalColors = new Set(["green", "amber", "red", "blue"]);
    }

    loadLastState() {
      return this.normalizeState(this.readJson(this.lastStateKey));
    }

    saveLastState(state) {
      const normalized = this.normalizeState(state);
      return normalized ? this.writeJson(this.lastStateKey, normalized) : false;
    }

    listViews() {
      const payload = this.readJson(this.savedViewsKey);

      if (payload?.version !== this.version || !Array.isArray(payload.views)) {
        return [];
      }

      return payload.views
        .map(view => this.normalizeView(view))
        .filter(Boolean)
        .sort((left, right) => left.name.localeCompare(right.name, "tr"));
    }

    saveView(name, state, id = null) {
      const normalizedName = String(name ?? "").trim();
      const normalizedState = this.normalizeState(state);

      if (!normalizedName || !normalizedState) {
        return null;
      }

      const views = this.listViews();
      const existingById = views.find(view => view.id === id) ?? null;
      const existingByName = views.find(view => view.name.localeCompare(normalizedName, "tr", { sensitivity: "base" }) === 0) ?? null;

      if (existingById && existingByName && existingById.id !== existingByName.id) {
        return null;
      }

      const existing = existingById ?? existingByName;
      const timestamp = new Date().toISOString();
      const savedView = {
        id: existing?.id ?? this.createId(),
        name: normalizedName,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        state: normalizedState
      };
      const nextViews = existing
        ? views.map(view => view.id === existing.id ? savedView : view)
        : [...views, savedView];

      return this.writeViews(nextViews) ? this.clone(savedView) : null;
    }

    deleteView(id) {
      const views = this.listViews();
      const nextViews = views.filter(view => view.id !== id);

      if (nextViews.length === views.length) {
        return false;
      }

      return this.writeViews(nextViews);
    }

    getView(id) {
      const view = this.listViews().find(item => item.id === id);
      return view ? this.clone(view) : null;
    }

    normalizeState(state) {
      if (!state || state.version !== this.version || !state.layout) {
        return null;
      }

      const layout = {
        rows: this.normalizeFieldList(state.layout.rows),
        columns: this.normalizeFieldList(state.layout.columns),
        values: this.normalizeValues(state.layout.values),
        filters: this.normalizeFilters(state.layout.filters)
      };

      if (layout.values.length === 0) {
        return null;
      }

      const aliases = {};

      for (const [field, alias] of Object.entries(state.fieldAliases ?? {})) {
        const normalizedAlias = String(alias ?? "").trim();

        if (this.isKnownField(field) && normalizedAlias) {
          aliases[field] = normalizedAlias;
        }
      }

      return {
        version: this.version,
        layout,
        viewSettings: {
          layoutMode: state.viewSettings?.layoutMode === "compact" ? "compact" : "tabular",
          repeatRowLabels: state.viewSettings?.repeatRowLabels === true,
          subtotals: state.viewSettings?.subtotals !== false,
          largeData: state.viewSettings?.largeData === true
        },
        sort: this.normalizeSort(state.sort),
        fieldAliases: aliases,
        conditionalRules: this.normalizeConditionalRules(state.conditionalRules),
        columnWidths: this.normalizeColumnWidths(state.columnWidths),
        collapsedGroups: Array.isArray(state.collapsedGroups)
          ? [...new Set(state.collapsedGroups.filter(key => typeof key === "string"))]
          : []
      };
    }

    normalizeView(view) {
      const state = this.normalizeState(view?.state);
      const name = String(view?.name ?? "").trim();

      if (!state || !name || typeof view?.id !== "string") {
        return null;
      }

      return {
        id: view.id,
        name,
        createdAt: typeof view.createdAt === "string" ? view.createdAt : "",
        updatedAt: typeof view.updatedAt === "string" ? view.updatedAt : "",
        state
      };
    }

    normalizeFieldList(values) {
      return Array.isArray(values)
        ? [...new Set(values.filter(field => typeof field === "string" && this.isKnownField(field)))]
        : [];
    }

    normalizeValues(values) {
      if (!Array.isArray(values)) {
        return [];
      }

      return values.flatMap(value => {
        if (!value || !this.isKnownField(value.field) || !this.aggregations.has(value.aggregation)) {
          return [];
        }

        const format = value.format ?? {};
        return [{
          field: value.field,
          aggregation: value.aggregation,
          showAs: this.showAsModes.has(value.showAs) ? value.showAs : "normal",
          format: {
            type: this.formatTypes.has(format.type) ? format.type : "number",
            decimals: Number.isInteger(format.decimals) ? Math.max(0, Math.min(6, format.decimals)) : 2,
            useGrouping: format.useGrouping !== false,
            ...(typeof format.currency === "string" && format.currency ? { currency: format.currency } : {})
          }
        }];
      });
    }

    normalizeFilters(filters) {
      if (!Array.isArray(filters)) {
        return [];
      }

      return filters.flatMap(filter => {
        if (!filter || !this.isKnownField(filter.field) || !Array.isArray(filter.values)) {
          return [];
        }

        return [{ field: filter.field, values: [...new Set(filter.values.map(value => String(value)))] }];
      });
    }

    normalizeSort(sort) {
      if (!sort || !["Ascending", "Descending"].includes(sort.direction)) {
        return null;
      }

      if (sort.mode === "RowLabel" && this.isKnownField(sort.field)) {
        return { mode: sort.mode, direction: sort.direction, field: sort.field };
      }

      if (sort.mode === "RowTotalValue" && typeof sort.valueKey === "string") {
        return {
          mode: sort.mode,
          direction: sort.direction,
          valueKey: sort.valueKey,
          ...(Array.isArray(sort.columnPath) ? { columnPath: sort.columnPath.map(value => value ?? null) } : {})
        };
      }

      return null;
    }

    normalizeConditionalRules(rules) {
      if (!Array.isArray(rules)) {
        return [];
      }

      return rules.flatMap(rule => {
        if (!rule || typeof rule.valueKey !== "string" ||
          !this.conditionalOperators.has(rule.operator) ||
          !this.conditionalColors.has(rule.color) ||
          !Number.isFinite(rule.threshold) ||
          (rule.operator === "between" && !Number.isFinite(rule.threshold2))) {
          return [];
        }

        return [{
          id: typeof rule.id === "string" && rule.id ? rule.id : this.createId(),
          valueKey: rule.valueKey,
          operator: rule.operator,
          threshold: rule.threshold,
          ...(rule.operator === "between" ? { threshold2: rule.threshold2 } : {}),
          color: rule.color
        }];
      });
    }

    normalizeColumnWidths(widths) {
      if (!Array.isArray(widths)) {
        return [];
      }

      const normalized = new Map();

      widths.forEach(entry => {
        if (Array.isArray(entry) && Number.isInteger(entry[0]) && entry[0] >= 0 && Number.isFinite(entry[1])) {
          normalized.set(entry[0], Math.max(72, Math.min(420, Math.round(entry[1]))));
        }
      });

      return [...normalized.entries()];
    }

    isKnownField(field) {
      return this.fields.size === 0 || this.fields.has(field);
    }

    readJson(key) {
      try {
        const value = this.storage?.getItem(key);
        return value ? JSON.parse(value) : null;
      } catch {
        return null;
      }
    }

    writeJson(key, value) {
      try {
        this.storage?.setItem(key, JSON.stringify(value));
        return Boolean(this.storage);
      } catch {
        return false;
      }
    }

    writeViews(views) {
      return this.writeJson(this.savedViewsKey, { version: this.version, views });
    }

    createId() {
      if (root.crypto?.randomUUID) {
        return root.crypto.randomUUID();
      }

      return `view-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    clone(value) {
      return JSON.parse(JSON.stringify(value));
    }
  }

  PivotForge.PivotViewStore = PivotViewStore;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PivotViewStore;
  }
})(typeof window !== "undefined" ? window : globalThis);
