(function (root) {
  const PivotForge = root.PivotForge ??= {};

  const PLACED_AREAS = ["row", "column", "data", "filter"];
  const AREA_TO_KEY = { row: "rows", column: "columns", data: "values", filter: "filters" };

  // Validates a value format against what the browser renderer and the Excel
  // export can both actually render. Returns the accepted format, or null to
  // mean "no formatting". Throws rather than coercing, so a bad stored layout
  // is reported instead of silently rendering as something else.
  function checkFormat(name, format) {
    if (format === null || format === undefined) {
      return null;
    }

    if (typeof format !== "object" || Array.isArray(format)) {
      throw new Error(`Format for "${name}" must be an object.`);
    }

    const { FORMAT_TYPES } = PivotForge.PivotRequestBuilder;

    if (format.type !== undefined && !FORMAT_TYPES.includes(format.type)) {
      throw new Error(
        `Unknown format type "${format.type}" for "${name}". Expected one of: ${FORMAT_TYPES.join(", ")}.`
      );
    }

    // 0-6 is what the Excel export's "#,##0.00" pattern can express; allowing
    // more here would make the two renderings disagree.
    if (format.decimals !== undefined &&
      (!Number.isInteger(format.decimals) || format.decimals < 0 || format.decimals > 6)) {
      throw new Error(
        `Format decimals for "${name}" must be an integer between 0 and 6, but was ${format.decimals}.`
      );
    }

    if (format.useGrouping !== undefined && typeof format.useGrouping !== "boolean") {
      throw new Error(`Format useGrouping for "${name}" must be a boolean.`);
    }

    if (format.currency !== undefined &&
      (typeof format.currency !== "string" || format.currency.trim() === "")) {
      throw new Error(`Format currency for "${name}" must be a non-empty string.`);
    }

    if (format.compact !== undefined && typeof format.compact !== "boolean") {
      throw new Error(`Format compact for "${name}" must be a boolean.`);
    }

    if (format.zeroText !== undefined && typeof format.zeroText !== "string") {
      throw new Error(`Format zeroText for "${name}" must be a string.`);
    }

    const { NEGATIVE_FORMATS } = PivotForge.PivotRequestBuilder;
    if (format.negative !== undefined && !NEGATIVE_FORMATS.includes(format.negative)) {
      throw new Error(
        `Unknown format negative "${format.negative}" for "${name}". Expected one of: ${NEGATIVE_FORMATS.join(", ")}.`
      );
    }

    return { ...format };
  }

  const VALUES_POSITIONS = ["columns", "rows"];

  class PivotLayoutState {
    constructor(catalog, layout = null) {
      const normalized = PivotForge.PivotRequestBuilder.normalizeFields(catalog ?? []);

      // Keyed by level rather than by column: one date column grouped by year and
      // again by month is two entries, and dataField alone cannot tell them apart.
      this.catalog = new Map(normalized.map(field => [field.key, field]));
      // A caption the user typed, overriding the catalog's. Kept apart from the
      // catalog so resetting is just forgetting the override, and so the
      // declared caption is always recoverable.
      this.captions = new Map();
      // A header sort the user picked, overriding the catalog's sortOrder. Kept
      // apart for the same reason the captions are: the declaration stays
      // recoverable and a saved view carries only what the user changed.
      this.sortOrders = new Map();
      // What a row or column field is ordered by, picked in the designer: a
      // value key, or null for its own labels. Absent means the declaration's.
      this.sortBys = new Map();
      // Calculated fields the reader defined in the designer, by name. They live
      // in the catalog like declared ones -- so every consumer handles them the
      // same way -- and are listed here because they are the reader's to edit,
      // to delete, and to carry in a saved view.
      this.userCalculated = new Set();
      // A range width the reader picked, by the level's declared name. Changing
      // it renames the level -- the width is part of its key, as it is of the
      // engine's -- so the declared name is what a saved view remembers it by.
      this.groupSizes = new Map();
      // The declared width, by the level's declared name, for a level renamed.
      this.declaredSizes = new Map();
      // The level's declared name, for a level a width change renamed.
      this.declaredNames = new Map();
      this.handlers = new Map();

      if (layout) {
        // Before the placements, which name the levels as they were renamed.
        this.adoptGroupSizes(layout.groupSizes);
        // Before the placements, which may seat them.
        this.adoptCalculatedFields(layout.calculatedFields);
        this.layout = this.adoptLayout(layout);
        this.adoptCaptions(layout.captions);
        this.adoptSortOrders(layout.sortOrders);
        this.adoptSortBys(layout.sortBys);
      } else {
        this.layout = this.layoutFromCatalog(normalized);
      }

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
        rows: inArea("row").map(field => field.key),
        columns: inArea("column").map(field => field.key),
        valuesPosition: "columns",
        values: inArea("data").map(field => ({
          field: field.key,
          aggregation: this.defaultAggregation(field.key),
          showAs: field.showAs ?? "normal",
          ...(field.runningTotal ? { runningTotal: field.runningTotal } : {}),
          ...(field.format ? { format: checkFormat(field.key, field.format) } : {})
        })),
        filters: inArea("filter").map(field =>
          ({ field: field.key, values: [], mode: "Include" }))
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
        // A calculated field has exactly one aggregation, and no other field has it.
        if (this.isCalculated(name)
          ? aggregation !== PivotForge.PivotRequestBuilder.CALCULATED
          : !AGGREGATIONS.includes(aggregation)) {
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
        assertAggregation(value.field, value.aggregation ?? this.defaultAggregation(value.field));
        assertShowAs(value.field, value.showAs ?? "normal");
      });
      (layout.filters ?? []).forEach(filter => assertPlaceable(filter.field, "filter"));

      return {
        rows: [...(layout.rows ?? [])],
        columns: [...(layout.columns ?? [])],
        // A position this build does not know reads as the default rather than
        // refusing the whole view: it changes how the grid is drawn, not what.
        valuesPosition: VALUES_POSITIONS.includes(layout.valuesPosition) ? layout.valuesPosition : "columns",
        values: (layout.values ?? []).map(value => {
          // A stored format wins; otherwise the catalog's declaration applies,
          // so adopting a layout saved before formats existed still formats.
          const format = checkFormat(value.field, value.format ?? this.field(value.field).format);

          return {
            field: value.field,
            aggregation: value.aggregation ?? this.defaultAggregation(value.field),
            showAs: value.showAs ?? "normal",
            // A direction this build does not know is dropped rather than refusing the view.
            ...(PivotForge.PivotRequestBuilder.RUNNING_TOTALS.includes(value.runningTotal)
              ? { runningTotal: value.runningTotal }
              : {}),
            ...(format ? { format } : {})
          };
        }),
        // Through the same normalizer buildRequest uses, so an adopted layout
        // cannot carry a filter mode the engine has never heard of.
        filters: (layout.filters ?? []).map((filter, index) =>
          PivotForge.PivotRequestBuilder.normalizeFilter(
            { ...filter, values: filter.values ?? [] }, index))
      };
    }

    // Whether a field is computed by a formula rather than read from the source.
    isCalculated(name) {
      return Boolean(this.catalog.get(name)?.expression);
    }

    // What a field brings into the data area when nothing says otherwise.
    defaultAggregation(name) {
      return this.isCalculated(name) ? PivotForge.PivotRequestBuilder.CALCULATED : "sum";
    }

    // Whether the reader defined this field, and so may change or delete it.
    // A declared calculated field belongs to the page, like any declared field.
    isUserCalculated(name) {
      return this.userCalculated.has(name);
    }

    // The source fields a formula typed in the designer may name: every field
    // the page declared, and no calculated one -- a formula reads summaries of
    // the source, not the results of other formulas.
    formulaFields() {
      const seen = new Map();
      this.catalog.forEach(field => {
        if (!field.expression && !seen.has(field.dataField.toLowerCase())) {
          seen.set(field.dataField.toLowerCase(), {
            dataField: field.dataField,
            caption: this.field(field.key).caption,
            role: field.role
          });
        }
      });

      return [...seen.values()];
    }

    // Parses a formula and checks every field it names against the catalog.
    // Throws the parser's error, or one with code "unknownField", so the editor
    // can say what is wrong before anything reaches the server.
    checkFormula(expression) {
      const parsed = PivotForge.PivotRequestBuilder.parseExpression(expression);
      const known = new Set(this.formulaFields().map(field => field.dataField.toLowerCase()));
      // A Slice moves along a header level, which any field of the catalog can be.
      const levels = new Set([...this.catalog.values()]
        .flatMap(field => [field.dataField.toLowerCase(), field.key.toLowerCase()]));
      const unknown = parsed.fields.find(field => !known.has(field.toLowerCase())) ??
        (parsed.sliceFields ?? []).find(field => !levels.has(field.toLowerCase()));

      if (unknown !== undefined) {
        const error = new Error(`Field "${unknown}" is not in the field list.`);
        error.code = "unknownField";
        error.detail = unknown;
        error.position = String(expression).indexOf(`[${unknown}`);
        throw error;
      }

      return parsed;
    }

    // Defines a calculated field and seats it in the data area, which is the
    // only place it can go and almost certainly where the reader wants it.
    // Returns the name it was given: the caption is the reader's, the name is
    // what keys its values, and it must never collide with a declared one.
    addCalculatedField({ caption, expression } = {}) {
      const trimmed = typeof caption === "string" ? caption.trim() : "";
      if (!trimmed) {
        const error = new Error("A calculated field requires a name.");
        error.code = "noName";
        throw error;
      }

      this.checkFormula(expression);

      let counter = this.userCalculated.size + 1;
      while (this.catalog.has(`calculated${counter}`)) {
        counter++;
      }

      const name = `calculated${counter}`;
      this.defineCalculated(name, trimmed, expression);
      this.layout.values.push({
        field: name,
        aggregation: PivotForge.PivotRequestBuilder.CALCULATED,
        showAs: "normal"
      });
      this.emitChange();
      return name;
    }

    // Replaces a reader-defined field's formula. The name, the caption and every
    // setting on its value entry stay as they were.
    setExpression(name, expression) {
      if (!this.isUserCalculated(name)) {
        throw new Error(`Field "${name}" is not a calculated field defined in the designer.`);
      }

      this.checkFormula(expression);
      this.defineCalculated(name, this.catalog.get(name).caption, expression);
      this.emitChange();
    }

    // Forgets a reader-defined field altogether, rather than returning it to the
    // field list the way remove() would.
    deleteCalculatedField(name) {
      if (!this.isUserCalculated(name)) {
        throw new Error(`Field "${name}" is not a calculated field defined in the designer.`);
      }

      if (this.areaOf(name) === "data" && this.layout.values.length === 1) {
        throw new Error(
          `Field "${name}" is the last field in the data area and a pivot requires at least one.`
        );
      }

      this.detach(name);
      this.catalog.delete(name);
      this.captions.delete(name);
      this.userCalculated.delete(name);
      this.emitChange();
    }

    defineCalculated(name, caption, expression) {
      const [normalized] = PivotForge.PivotRequestBuilder.normalizeFields([
        { dataField: name, caption, area: "available", expression }
      ]);
      this.catalog.set(name, normalized);
      this.userCalculated.add(name);
    }

    // Restores what getState() emitted. An entry that no longer makes sense --
    // a name the page has since declared, a formula naming a field the catalog
    // dropped -- is skipped rather than fatal, the bargain captions make: a
    // saved view should still open with what it can honour, and a placement of
    // a skipped field then falls back to the declared layout as a whole.
    adoptCalculatedFields(entries) {
      if (!Array.isArray(entries)) {
        return;
      }

      entries.forEach(entry => {
        const name = entry?.name;
        const caption = typeof entry?.caption === "string" ? entry.caption.trim() : "";

        if (typeof name !== "string" || !name || !caption || this.catalog.has(name)) {
          return;
        }

        try {
          this.checkFormula(entry.expression);
        } catch {
          return;
        }

        this.defineCalculated(name, caption, entry.expression);
      });
    }

    field(name) {
      const found = this.catalog.get(name);
      if (!found) {
        throw new Error(`Field "${name}" is not in the catalog.`);
      }

      const caption = this.captions.get(name);
      const sortOrder = this.sortOrders.get(name);
      const sortBy = this.sortBys.has(name) ? { value: this.sortBys.get(name) } : null;
      // Every caption consumer — the chips, toFields(), the renderer's value
      // labels, the detail modal's headers — reads through here, so an override
      // applied once shows up everywhere without any of them knowing about it.
      // The sort override travels the same way, into toFields().
      return {
        ...found,
        ...(caption === undefined ? {} : { caption }),
        ...(sortOrder === undefined ? {} : { sortOrder }),
        // A summary path belongs to the value it was declared with, so a value
        // picked here leaves it behind.
        ...(sortBy === null ? {} : { sortByValueKey: sortBy.value, sortBySummaryPath: null })
      };
    }

    // Orders a row or column field's own level, the way a header click asks
    // for. Null goes back to the declaration.
    setSortOrder(name, sortOrder) {
      this.field(name);
      const { SORT_ORDERS } = PivotForge.PivotRequestBuilder;

      if (sortOrder !== null && !SORT_ORDERS.includes(sortOrder)) {
        throw new Error(
          `Unknown sortOrder "${sortOrder}". Expected one of: ${SORT_ORDERS.join(", ")}.`);
      }

      if (sortOrder === null || sortOrder === this.catalog.get(name).sortOrder) {
        this.sortOrders.delete(name);
      } else {
        this.sortOrders.set(name, sortOrder);
      }

      this.emitChange();
    }

    // What the designer's sort panel sets in one go: the direction a row or
    // column field's level runs in, and whether it is ordered by its labels
    // (byValueKey null) or by one of the values on the grid. A choice equal to
    // the declaration is forgotten rather than stored, as setSortOrder does.
    setSort(name, { order, byValueKey = null }) {
      this.field(name);
      const area = this.areaOf(name);
      const { SORT_ORDERS } = PivotForge.PivotRequestBuilder;

      if (area !== "row" && area !== "column") {
        throw new Error(`Field "${name}" is in area "${area}"; only a row or column field is sorted.`);
      }

      if (!SORT_ORDERS.includes(order)) {
        throw new Error(`Unknown sortOrder "${order}". Expected one of: ${SORT_ORDERS.join(", ")}.`);
      }

      if (byValueKey !== null && !this.valueKeys().includes(byValueKey)) {
        throw new Error(`"${byValueKey}" is not a value on the grid, so "${name}" cannot be sorted by it.`);
      }

      const catalog = this.catalog.get(name);
      if (order === catalog.sortOrder) {
        this.sortOrders.delete(name);
      } else {
        this.sortOrders.set(name, order);
      }

      if (byValueKey === (catalog.sortByValueKey ?? null) && !catalog.sortBySummaryPath) {
        this.sortBys.delete(name);
      } else {
        this.sortBys.set(name, byValueKey);
      }

      this.emitChange();
    }

    // The keys of the values on the grid, as the renderer and the engine name
    // them: what a row or column field can be sorted by.
    valueKeys() {
      const { valueKey } = PivotForge.PivotRequestBuilder;
      return this.layout.values.map(value => valueKey({
        dataField: this.sourceOf(value.field).dataField,
        aggregation: value.aggregation
      }));
    }

    adoptSortBys(sortBys) {
      if (!sortBys || typeof sortBys !== "object") {
        return;
      }

      Object.entries(sortBys).forEach(([name, valueKey]) => {
        if (this.catalog.has(name) && (valueKey === null || typeof valueKey === "string")) {
          this.sortBys.set(name, valueKey);
        }
      });
    }

    // Restores the overrides getState() emitted, skipping what the catalog or
    // the vocabulary no longer knows, as adoptCaptions does.
    adoptSortOrders(sortOrders) {
      if (!sortOrders || typeof sortOrders !== "object") {
        return;
      }

      const { SORT_ORDERS } = PivotForge.PivotRequestBuilder;
      Object.entries(sortOrders).forEach(([name, sortOrder]) => {
        if (this.catalog.has(name) && SORT_ORDERS.includes(sortOrder)) {
          this.sortOrders.set(name, sortOrder);
        }
      });
    }

    // A numeric range level's width, as declared or as the reader changed it.
    isRange(name) {
      return this.catalog.get(name)?.groupInterval === "range";
    }

    declaredGroupSize(name) {
      this.field(name);
      const declared = this.declaredNames.get(name) ?? name;
      return this.declaredSizes.get(declared) ?? this.catalog.get(name).groupSize;
    }

    // Changes the width of a numeric range level and returns its new name. The
    // width is part of the level's key, so every reference to the level --
    // where it sits, its caption, its sort -- is carried over to the new name.
    // Its filter values are not: they were ranges of the old width, which the
    // new ranges no longer match, so the filter starts afresh.
    setGroupSize(name, size) {
      const field = this.field(name);
      if (field.groupInterval !== "range") {
        throw new Error(`Field "${name}" is not grouped into numeric ranges, so it has no range width.`);
      }

      const width = Number(size);
      if (!Number.isFinite(width) || width <= 0) {
        throw new Error(`The range width of "${name}" must be a number greater than zero.`);
      }

      const renamed = `${field.dataField}:range${String(width)}`;
      if (renamed === name) {
        return name;
      }

      if (this.catalog.has(renamed)) {
        throw new Error(`"${field.dataField}" already has a level of ranges ${width} wide.`);
      }

      const declared = this.declaredNames.get(name) ?? name;
      if (!this.declaredSizes.has(declared)) {
        this.declaredSizes.set(declared, this.catalog.get(name).groupSize);
      }

      this.rename(name, renamed, { ...this.catalog.get(name), key: renamed, groupSize: width });

      if (width === this.declaredSizes.get(declared)) {
        this.groupSizes.delete(declared);
        this.declaredNames.delete(renamed);
      } else {
        this.groupSizes.set(declared, width);
        this.declaredNames.set(renamed, declared);
      }

      const filter = this.layout?.filters.find(entry => entry.field === renamed);
      if (filter) {
        filter.values = [];
        delete filter.operator;
      }

      if (this.layout) {
        this.emitChange();
      }

      return renamed;
    }

    // Moves every reference from one level name to another, keeping the
    // catalog's order so the available list does not reshuffle.
    rename(from, to, entry) {
      this.catalog = new Map([...this.catalog].map(([key, field]) => (key === from ? [to, entry] : [key, field])));

      for (const overrides of [this.captions, this.sortOrders, this.sortBys]) {
        if (overrides.has(from)) {
          overrides.set(to, overrides.get(from));
          overrides.delete(from);
        }
      }

      if (this.declaredNames.has(from)) {
        this.declaredNames.delete(from);
      }

      if (!this.layout) {
        return;
      }

      const swap = name => (name === from ? to : name);
      this.layout.rows = this.layout.rows.map(swap);
      this.layout.columns = this.layout.columns.map(swap);
      this.layout.filters.forEach(filter => { filter.field = swap(filter.field); });
    }

    // Restores the widths getState() emitted, before the placements that name
    // the renamed levels. A width that no longer fits -- the level is gone or
    // no longer a range -- is skipped, as an unusable caption is.
    adoptGroupSizes(groupSizes) {
      if (!groupSizes || typeof groupSizes !== "object") {
        return;
      }

      Object.entries(groupSizes).forEach(([name, size]) => {
        if (!this.isRange(name)) {
          return;
        }

        try {
          this.setGroupSize(name, size);
        } catch {
          // Skipped, as above.
        }
      });
    }

    // The caption as declared, ignoring any override. What "reset" restores and
    // what the rename box shows as its placeholder.
    declaredCaption(name) {
      this.field(name);
      return this.catalog.get(name).caption;
    }

    // Sets or clears a display caption. A blank or catalog-matching value clears
    // the override rather than storing a duplicate of the declared caption.
    setCaption(name, caption) {
      this.field(name);
      const trimmed = typeof caption === "string" ? caption.trim() : "";

      if (!trimmed || trimmed === this.declaredCaption(name)) {
        this.captions.delete(name);
      } else {
        this.captions.set(name, trimmed);
      }

      this.emitChange();
    }

    // Restores the caption overrides getState() emitted. Unlike the layout
    // itself, an unusable entry here is skipped rather than fatal: a caption is
    // a display preference, and a saved view whose catalog has since changed
    // should still open with the placements it can honour.
    adoptCaptions(captions) {
      if (!captions || typeof captions !== "object") {
        return;
      }

      Object.entries(captions).forEach(([name, caption]) => {
        if (!this.catalog.has(name) || typeof caption !== "string") {
          return;
        }

        const trimmed = caption.trim();
        if (trimmed && trimmed !== this.declaredCaption(name)) {
          this.captions.set(name, trimmed);
        }
      });
    }

    // A filter belongs to the field, not to the Filters zone: the zone's chip
    // and a row header's funnel are two ways into the same entry. Which of them
    // a field is filtered through is therefore not stored -- it follows from
    // where the field is seated, which is what areaOf answers.
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
      // Moving a filtered field between areas carries its restriction along,
      // because the filter is the field's rather than the zone's. Only removing
      // the field outright drops it. A move into the filter zone needs nothing
      // here: the entry it would carry is the one it is being re-seated as.
      const carried = area === "filter"
        ? null
        : this.layout.filters.find(filter => filter.field === name) ?? null;

      this.detach(name);

      const catalogFormat = area === "data" ? this.field(name).format : null;
      const entry = existing ?? (area === "data"
        ? {
          field: name,
          aggregation: this.defaultAggregation(name),
          showAs: "normal",
          ...(catalogFormat ? { format: checkFormat(name, catalogFormat) } : {})
        }
        : area === "filter"
          ? { field: name, values: [], mode: "Include" }
          : name);

      // detach() reassigns the area arrays, so the target has to be re-read.
      const target = this.layout[key];
      // Removing the field shifted every later slot down by one, so an index
      // past its old position refers to one slot earlier now.
      const insertAt = index === undefined || index === null
        ? target.length
        : fromIndex >= 0 && index > fromIndex ? index - 1 : index;

      target.splice(insertAt, 0, entry);
      if (carried) {
        this.layout.filters.push(carried);
      }

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

    setFormat(name, format) {
      const value = this.layout.values.find(entry => entry.field === name);
      if (!value) {
        throw new Error(`Field "${name}" is not in the data area.`);
      }

      // Validate before mutating, so a rejected format leaves the entry as it was.
      const checked = checkFormat(name, format);

      if (checked === null) {
        delete value.format;
      } else {
        value.format = checked;
      }

      this.emitChange();
    }

    setAggregation(name, aggregation) {
      const value = this.layout.values.find(entry => entry.field === name);
      if (!value) {
        throw new Error(`Field "${name}" is not in the data area.`);
      }

      if (this.isCalculated(name)) {
        throw new Error(`Field "${name}" is calculated; its formula is its aggregation.`);
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

    setShowAs(name, showAs) {
      const value = this.layout.values.find(entry => entry.field === name);
      if (!value) {
        throw new Error(`Field "${name}" is not in the data area.`);
      }

      const { SHOW_AS } = PivotForge.PivotRequestBuilder;
      if (!SHOW_AS.includes(showAs)) {
        throw new Error(
          `Unknown showAs "${showAs}". Expected one of: ${SHOW_AS.join(", ")}.`
        );
      }

      value.showAs = showAs;
      this.emitChange();
    }

    // Null takes the running total away.
    setRunningTotal(name, runningTotal) {
      const value = this.layout.values.find(entry => entry.field === name);
      if (!value) {
        throw new Error(`Field "${name}" is not in the data area.`);
      }

      const { RUNNING_TOTALS } = PivotForge.PivotRequestBuilder;
      if (runningTotal !== null && !RUNNING_TOTALS.includes(runningTotal)) {
        throw new Error(
          `Unknown runningTotal "${runningTotal}". Expected one of: ${RUNNING_TOTALS.join(", ")}, or null.`
        );
      }

      if (runningTotal === null) {
        delete value.runningTotal;
      } else {
        value.runningTotal = runningTotal;
      }
      this.emitChange();
    }

    // The filter entry for a field, created on first use. A field filtered from
    // a row header keeps its seat there and gains an entry all the same; only a
    // measure has nothing to filter, which is the rule the filter area already
    // applies to what may be dropped into it.
    filterEntry(name) {
      const found = this.layout.filters.find(entry => entry.field === name);
      if (found) {
        return found;
      }

      if (!this.canPlaceByRole(name, "filter")) {
        throw new Error(`Field "${name}" cannot be filtered because it is a measure.`);
      }

      const created = { field: name, values: [], mode: "Include" };
      this.layout.filters.push(created);
      return created;
    }

    // The values a filter accepts. An empty list is how "no restriction" is
    // spelled all the way down to the engine, so clearing a filter and never
    // setting one are deliberately the same state.
    setFilterValues(name, values) {
      // Validated before the entry is asked for, so a refused call cannot leave
      // an empty filter behind -- which would seat an unplaced field in the
      // Filters zone for nothing.
      if (!Array.isArray(values)) {
        throw new Error(`Filter values for "${name}" must be an array.`);
      }

      const filter = this.filterEntry(name);

      // Values reach the engine as strings; a null source value is compared as
      // the empty string, so that is what blank is stored as.
      filter.values = values.map(value => (value == null ? "" : String(value)));
      this.emitChange();
    }

    // Whether the stored values are the ones kept or the ones dropped. It says
    // nothing about the values themselves: what it decides is where a value the
    // source gains later lands -- hidden under Include, visible under Exclude.
    setFilterMode(name, mode) {
      if (!PivotForge.PivotRequestBuilder.FILTER_MODES.includes(mode)) {
        throw new Error(`Unknown filter mode "${mode}" for field "${name}".`);
      }

      this.filterEntry(name).mode = mode;
      this.emitChange();
    }

    // How the entry's values are read: as the list of values to keep, or as the
    // arguments of a condition. Changing it does not clear the values, because
    // switching operator by mistake should be undoable by switching back.
    setFilterOperator(name, operator) {
      if (!PivotForge.PivotRequestBuilder.FILTER_OPERATORS.includes(operator)) {
        throw new Error(`Unknown filter operator "${operator}" for field "${name}".`);
      }

      const entry = this.filterEntry(name);

      // The default is spelled by its absence, so a view saved by a page that
      // never touched an operator is byte-identical to one saved before
      // operators existed.
      if (operator === "Equals") {
        delete entry.operator;
      } else {
        entry.operator = operator;
      }

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
        valuesPosition: this.layout.valuesPosition,
        values: this.layout.values.map(value => ({ ...value })),
        filters: this.layout.filters.map(filter => ({ ...filter, values: [...filter.values] })),
        available: [...this.catalog.keys()].filter(name => !placed.has(name)),
        // Exposed so a consumer can persist renamed captions alongside a saved
        // view. adoptLayout does not restore them yet.
        captions: Object.fromEntries(this.captions),
        sortOrders: Object.fromEntries(this.sortOrders),
        sortBys: Object.fromEntries(this.sortBys),
        groupSizes: Object.fromEntries(this.groupSizes),
        calculatedFields: [...this.userCalculated].map(name => ({
          name,
          caption: this.catalog.get(name).caption,
          expression: this.catalog.get(name).expression
        }))
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
      // The same reasoning, for the attributes that are only meaningful in some
      // areas: each is carried into the areas that accept it and dropped
      // elsewhere, because a row field dragged into the column zone must not
      // arrive still holding showTotals -- normalizeField refuses it there. The
      // same holds for sortByValueKey.
      // areaIndex is deliberately absent: it declares the opening order, and
      // re-emitting it would undo the drag that just changed the order.
      const declaredIn = (name, area) => {
        const field = this.field(name);
        const isRow = area === "row";

        return {
          ...((isRow || area === "column") && field.expanded === false ? { expanded: false } : {}),
          ...((isRow || area === "column") && field.showTotals === false ? { showTotals: false } : {}),
          ...((isRow || area === "column") && field.sortByValueKey
            ? {
              sortByValueKey: field.sortByValueKey,
              ...(field.sortBySummaryPath ? { sortBySummaryPath: field.sortBySummaryPath } : {})
            }
            : {}),
          ...((isRow || area === "column") && field.sortOrder
            ? { sortOrder: field.sortOrder }
            : {}),
          ...((isRow || area === "column") && field.sortBy ? { sortBy: field.sortBy } : {}),
          ...((isRow || area === "column") && field.sortingMethod ? { sortingMethod: field.sortingMethod } : {})
        };
      };

      const state = this.getState();

      return [
        ...state.rows.map(name => ({
          ...this.sourceOf(name),
          ...this.presentationOf(name),
          caption: captionOf(name),
          area: "row",
          format: formatOf(name),
          visible: visibleOf(name),
          ...declaredIn(name, "row")
        })),
        ...state.columns.map(name => ({
          ...this.sourceOf(name),
          ...this.presentationOf(name),
          caption: captionOf(name),
          area: "column",
          format: formatOf(name),
          visible: visibleOf(name),
          ...declaredIn(name, "column")
        })),
        ...state.values.map(value => ({
          ...this.sourceOf(value.field),
          ...this.presentationOf(value.field),
          caption: captionOf(value.field),
          area: "data",
          aggregation: value.aggregation,
          showAs: value.showAs,
          ...(value.runningTotal ? { runningTotal: value.runningTotal } : {}),
          format: value.format ?? null,
          visible: visibleOf(value.field),
          // Only a data field may hold it, so it rides along with this area
          // alone: the same measure dragged out to a row drops it.
          ...(this.field(value.field).showGrandTotals === false ? { showGrandTotals: false } : {}),
          ...(this.field(value.field).showTotals === false ? { showTotals: false } : {}),
          ...(typeof this.field(value.field).showValues === "boolean"
            ? { showValues: this.field(value.field).showValues }
            : {}),
          ...(this.field(value.field).allowCrossGroupCalculation === false
            ? { allowCrossGroupCalculation: false }
            : {}),
          ...(this.field(value.field).customizeText ? { customizeText: this.field(value.field).customizeText } : {})
        })),
        // Only the entries whose field is not seated elsewhere: a row field
        // filtered from its header has an entry too, and emitting that as a
        // filter-area field would place the same field twice.
        ...state.filters.filter(filter => this.areaOf(filter.field) === "filter").map(filter => ({
          ...this.sourceOf(filter.field),
          ...this.presentationOf(filter.field),
          caption: captionOf(filter.field),
          area: "filter",
          format: formatOf(filter.field),
          visible: visibleOf(filter.field)
        }))
      ];
    }

    // How the field is shown, which belongs to the field rather than to where
    // it sits: carried into every area, and only what was declared, so a field
    // that declared none of it emits exactly what it did before.
    presentationOf(name) {
      const field = this.catalog.get(name);

      return {
        ...(field?.allowSorting === false ? { allowSorting: false } : {}),
        ...(field?.allowFiltering === false ? { allowFiltering: false } : {}),
        ...(field?.width ? { width: field.width } : {}),
        ...(typeof field?.wordWrap === "boolean" ? { wordWrap: field.wordWrap } : {}),
        ...(field?.displayFolder ? { displayFolder: field.displayFolder } : {})
      };
    }

    // The layout names levels; a field declaration names a source column and the
    // interval it is grouped by. The catalog entry carries both, so this is where
    // one turns back into the other.
    sourceOf(name) {
      const field = this.catalog.get(name);

      return {
        dataField: field?.dataField ?? name,
        ...(field?.groupInterval ? { groupInterval: field.groupInterval } : {}),
        ...(field?.groupSize ? { groupSize: field.groupSize } : {}),
        ...(field?.expression ? { expression: field.expression } : {}),
        // The column's type travels with it wherever it is placed, and so does
        // the selector that works its value out.
        ...(field?.dataType ? { dataType: field.dataType } : {}),
        ...(field?.selector ? { selector: field.selector } : {})
      };
    }

    toRequestState() {
      return {
        fields: this.toFields(),
        filters: this.getState().filters.filter(PivotForge.PivotRequestBuilder.restricts),
        valuesPosition: this.layout.valuesPosition
      };
    }

    // Which axis several values are drawn along -- where the designer's
    // Σ Values chip sits. Part of the layout, as it is in Excel, so a saved view
    // and a report file carry it with the rest.
    get valuesPosition() {
      return this.layout.valuesPosition;
    }

    setValuesPosition(position) {
      if (!VALUES_POSITIONS.includes(position)) {
        throw new Error(`Unknown values position "${position}". Expected one of: ${VALUES_POSITIONS.join(", ")}.`);
      }

      if (this.layout.valuesPosition === position) {
        return;
      }

      this.layout.valuesPosition = position;
      this.emitChange();
    }

    // The page's declaration, for a layout that did not bring one of its own:
    // no change event, since nothing the reader did changed.
    adoptValuesPosition(position) {
      if (VALUES_POSITIONS.includes(position)) {
        this.layout.valuesPosition = position;
      }
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
