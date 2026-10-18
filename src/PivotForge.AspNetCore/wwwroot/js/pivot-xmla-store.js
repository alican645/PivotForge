(function (root) {
  const PivotForge = root.PivotForge ??= {};

  // DevExtreme's XmlaStore: the grid reads an OLAP cube (SQL Server Analysis
  // Services through msmdpump.dll, or any XMLA provider) instead of the
  // PivotForge endpoints. One MDX query asks for every crossing of the row and
  // column members down to each depth, so totals and subtotals are the cube's
  // own; ResultAssembler then builds what the /pivot endpoint would have
  // returned, display modes and ordering by a summary included.

  const assembler = () => PivotForge.ResultAssembler ??
    (typeof require === "function" ? require("./pivot-result-assembler.js") : null);

  const DEFAULT_LIMIT = 1000;
  const FILTER_ARGUMENTS = { Equals: 1, Contains: 1, StartsWith: 1, EndsWith: 1, Between: 2, GreaterThan: 1, LessThan: 1, Blank: 0 };
  const XMLA_NAMESPACE = "urn:schemas-microsoft-com:xml-analysis";
  const MEASURES = "[Measures]";
  // The provider names captions in the language it is told; a culture missing
  // here leaves the cube's default.
  const LOCALE_IDENTIFIERS = {
    "ar-SA": 1025, "zh-CN": 2052, "cs-CZ": 1029, "da-DK": 1030, "nl-NL": 1043, "en-GB": 2057, "en-US": 1033,
    "fi-FI": 1035, "fr-FR": 1036, "de-DE": 1031, "el-GR": 1032, "he-IL": 1037, "hu-HU": 1038, "it-IT": 1040,
    "ja-JP": 1041, "ko-KR": 1042, "nb-NO": 1044, "pl-PL": 1045, "pt-BR": 1046, "pt-PT": 2070, "ro-RO": 1048,
    "ru-RU": 1049, "es-ES": 3082, "sv-SE": 1053, "tr-TR": 1055, "uk-UA": 1058
  };

  // A filter that keeps nothing: the query that would carry it is not sent.
  const NOTHING = Symbol("nothing");

  // ---- What an XMLA grid can declare ----

  function validateFields(fields) {
    for (const field of fields) {
      const name = field.caption ?? field.dataField;
      if (field.expression !== null && field.expression !== undefined) {
        throw new Error(
          `Field "${name}" is a calculated field; an OLAP cube computes its own, so declare it as a calculated member of the cube.`);
      }

      if (field.groupInterval !== null && field.groupInterval !== undefined) {
        throw new Error(
          `Field "${name}" is grouped by "${field.groupInterval}"; a cube's dates are grouped by its hierarchy levels, so declare the level instead.`);
      }

      if (field.selector !== null && field.selector !== undefined) {
        throw new Error(`Field "${name}" names a selector, which only the PivotForge endpoints can run.`);
      }

      if (field.sortingMethod !== null && field.sortingMethod !== undefined) {
        throw new Error(`Field "${name}" names a sorting method, which only the PivotForge endpoints can run.`);
      }
    }
  }

  function validateRequest(request) {
    if ((request.topN?.length ?? 0) > 0) {
      throw new Error("An XMLA store cannot rank groups (topN).");
    }

    if ((request.valueFilters?.length ?? 0) > 0) {
      throw new Error("An XMLA store cannot filter groups by their values (valueFilters).");
    }
  }

  // ---- XML ----

  const ENTITIES = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" };

  function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name) => {
      if (name[0] === "#") {
        const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }

      return ENTITIES[name] ?? whole;
    });
  }

  const escapeXml = text => String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const localName = name => name.slice(name.indexOf(":") + 1);

  // What the provider answers is plain: elements, attributes and text. A
  // reader of that much works the same in the browser and in node.
  function parseXml(text) {
    const document = { name: "#document", attributes: {}, children: [], text: "" };
    const stack = [document];
    const pattern = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const current = stack[stack.length - 1];
      if (match[1] !== undefined) {
        current.text += match[1];
      } else if (match[2] !== undefined) {
        if (stack.length === 1 || stack[stack.length - 1].qualifiedName !== match[2]) {
          throw new Error(`The XMLA response is not well-formed XML near </${match[2]}>.`);
        }

        stack.pop();
      } else if (match[3] !== undefined) {
        const attributes = {};
        const attributePattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        let attribute;
        while ((attribute = attributePattern.exec(match[4])) !== null) {
          attributes[localName(attribute[1])] = decodeEntities(attribute[2] ?? attribute[3]);
        }

        const element = { qualifiedName: match[3], name: localName(match[3]), attributes, children: [], text: "" };
        current.children.push(element);
        if (match[5] !== "/") {
          stack.push(element);
        }
      } else if (match[6] !== undefined) {
        current.text += decodeEntities(match[6]);
      }
    }

    if (stack.length !== 1 || document.children.length === 0) {
      throw new Error("The XMLA response is not well-formed XML.");
    }

    return document.children[0];
  }

  const childrenOf = (element, name) => (element?.children ?? []).filter(child => child.name === name);
  const childOf = (element, name) => (element?.children ?? []).find(child => child.name === name) ?? null;
  const textOf = (element, name) => {
    const child = childOf(element, name);
    return child ? child.text : null;
  };

  function descendantsOf(element, name, found = []) {
    for (const child of element?.children ?? []) {
      if (child.name === name) {
        found.push(child);
      }

      descendantsOf(child, name, found);
    }

    return found;
  }

  // A provider reports a failure as a SOAP Fault or as an Error in the
  // response's Messages; either carries a description worth showing.
  function failureOf(document) {
    const error = descendantsOf(document, "Error").find(entry => entry.attributes.Description);
    if (error) {
      return error.attributes.Description;
    }

    const fault = descendantsOf(document, "Fault")[0];
    return fault ? (textOf(fault, "faultstring") ?? "The XMLA provider reported a fault.") : null;
  }

  // An XML name the provider had to escape, such as _x0020_ for a space.
  const decodeName = name => name.replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));

  function rowsOf(document) {
    return descendantsOf(document, "row").map(row => Object.fromEntries(row.children.map(cell => [cell.name, cell.text])));
  }

  // ---- MDX ----

  const bracket = name => `[${String(name).replace(/]/g, "]]")}]`;
  const setOf = members => `{${members.join(", ")}}`;

  function crossJoin(sets) {
    return sets.length === 1 ? sets[0] : `CrossJoin(${sets.join(", ")})`;
  }

  function union(sets) {
    return sets.length === 1 ? sets[0] : `Union(${sets.join(", ")})`;
  }

  // The members of an axis down to each depth: a hierarchy whose levels are
  // not reached yet stands at its All member, so every shallower total is a
  // tuple of its own.
  function axisSet(levels) {
    const sameHierarchy = (left, right) => left.name.toLowerCase() === right.name.toLowerCase();
    const hierarchies = [];
    for (const level of levels) {
      if (!hierarchies.some(hierarchy => sameHierarchy(hierarchy, level.hierarchy))) {
        hierarchies.push(level.hierarchy);
      }
    }

    const depths = [];
    for (let depth = 0; depth <= levels.length; depth++) {
      depths.push(crossJoin(hierarchies.map(hierarchy => {
        const reached = levels.slice(0, depth).filter(level => sameHierarchy(level.hierarchy, hierarchy));
        return reached.length > 0
          ? `${reached[reached.length - 1].name}.Members`
          : setOf([hierarchy.allMember ?? `${hierarchy.name}.DefaultMember`]);
      })));
    }

    return union(depths);
  }

  function fromClause(cube, slices) {
    return slices.reduce((inner, members) => `(SELECT ${setOf(members)} ON 0 FROM ${inner})`, bracket(cube));
  }

  const PROPERTIES = "DIMENSION PROPERTIES PARENT_UNIQUE_NAME, HIERARCHY_UNIQUE_NAME";

  function pivotStatement({ cube, rows, columns, measures, slices }) {
    const measureSet = setOf(measures);
    const columnSet = columns.length > 0 ? crossJoin([axisSet(columns), measureSet]) : measureSet;
    const axes = [`NON EMPTY ${columnSet} ${PROPERTIES} ON COLUMNS`];
    if (rows.length > 0) {
      axes.push(`NON EMPTY ${axisSet(rows)} ${PROPERTIES} ON ROWS`);
    }

    return `SELECT ${axes.join(", ")} FROM ${fromClause(cube, slices)} CELL PROPERTIES VALUE`;
  }

  // ---- The store ----

  function createXmlaStore(options, { fetchImpl = null } = {}) {
    if (!options || typeof options !== "object" || typeof options.url !== "string" || options.url === "") {
      throw new Error('An XMLA store is declared as { type: "xmla", url, catalog, cube }.');
    }

    if (typeof options.catalog !== "string" || options.catalog === "" ||
      typeof options.cube !== "string" || options.cube === "") {
      throw new Error("An XMLA store needs the catalog and the cube it reads.");
    }

    const { catalog, cube } = options;
    const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : DEFAULT_LIMIT;
    let schemaPromise = null;
    const memberCaches = new Map();
    const labelers = new Map();
    let warnedAboutErrors = false;

    function localeOf(culture) {
      if (Number.isInteger(options.localeIdentifier)) {
        return options.localeIdentifier;
      }

      const name = assembler().createLabels(culture).culture.name;
      return LOCALE_IDENTIFIERS[name] ?? null;
    }

    function properties(locale, extra = "") {
      return `<Properties><PropertyList><Catalog>${escapeXml(catalog)}</Catalog>${extra}` +
        `${locale ? `<LocaleIdentifier>${locale}</LocaleIdentifier>` : ""}</PropertyList></Properties>`;
    }

    async function post(body, signal) {
      const settings = {
        url: options.url,
        method: "POST",
        headers: { "Content-Type": "text/xml", ...(options.headers ?? {}) },
        data: `<Envelope xmlns="http://schemas.xmlsoap.org/soap/envelope/"><Body>${body}</Body></Envelope>`
      };
      options.beforeSend?.(settings);

      const fetcher = fetchImpl ?? root.fetch?.bind(root);
      const response = await fetcher(settings.url, {
        method: settings.method,
        headers: settings.headers,
        body: settings.data,
        credentials: settings.withCredentials ? "include" : "same-origin",
        signal
      });
      const text = await response.text();
      let document = null;
      try {
        document = parseXml(text);
      } catch (error) {
        if (response.ok) {
          throw error;
        }
      }

      const failure = document ? failureOf(document) : null;
      if (failure) {
        throw new Error(failure);
      }

      if (!response.ok) {
        const error = new Error(`The XMLA request failed with status ${response.status}.`);
        error.status = response.status;
        throw error;
      }

      return document;
    }

    function discover(requestType, restrictions, { locale = null, signal = null } = {}) {
      const list = Object.entries(restrictions)
        .map(([name, value]) => `<${name}>${escapeXml(value)}</${name}>`)
        .join("");
      return post(
        `<Discover xmlns="${XMLA_NAMESPACE}"><RequestType>${requestType}</RequestType>` +
        `<Restrictions><RestrictionList>${list}</RestrictionList></Restrictions>${properties(locale)}</Discover>`,
        signal).then(rowsOf);
    }

    function execute(statement, { locale = null, signal = null } = {}) {
      return post(
        `<Execute xmlns="${XMLA_NAMESPACE}"><Command><Statement>${escapeXml(statement)}</Statement></Command>` +
        `${properties(locale, "<ShowHiddenCubes>True</ShowHiddenCubes><SspropInitAppName>PivotForge</SspropInitAppName><Timeout>3600</Timeout>")}</Execute>`,
        signal);
    }

    const cubeRestriction = { CATALOG_NAME: catalog, CUBE_NAME: cube };
    const isTrue = value => String(value ?? "").toLowerCase() === "true";

    // ---- Schema: what each declared name is a level of ----

    function schemaOf(signal) {
      schemaPromise ??= Promise.all([
        discover("MDSCHEMA_HIERARCHIES", cubeRestriction, { signal }),
        discover("MDSCHEMA_LEVELS", cubeRestriction, { signal })
      ]).then(([hierarchyRows, levelRows]) => {
        if (hierarchyRows.length === 0) {
          throw new Error(`The cube ${bracket(cube)} was not found in the catalog ${bracket(catalog)}.`);
        }

        const hierarchies = new Map();
        for (const row of hierarchyRows) {
          hierarchies.set(row.HIERARCHY_UNIQUE_NAME.toLowerCase(), {
            name: row.HIERARCHY_UNIQUE_NAME,
            caption: row.HIERARCHY_CAPTION ?? row.HIERARCHY_NAME,
            dimension: row.DIMENSION_UNIQUE_NAME,
            allMember: row.ALL_MEMBER || null,
            displayFolder: row.HIERARCHY_DISPLAY_FOLDER || null,
            visible: row.HIERARCHY_IS_VISIBLE === undefined || isTrue(row.HIERARCHY_IS_VISIBLE),
            levels: []
          });
        }

        const levels = new Map();
        for (const row of levelRows) {
          const hierarchy = hierarchies.get(String(row.HIERARCHY_UNIQUE_NAME).toLowerCase());
          if (!hierarchy) {
            continue;
          }

          const level = {
            name: row.LEVEL_UNIQUE_NAME,
            caption: row.LEVEL_CAPTION ?? row.LEVEL_NAME,
            number: Number(row.LEVEL_NUMBER),
            isAll: Number(row.LEVEL_TYPE) === 1,
            visible: row.LEVEL_IS_VISIBLE === undefined || isTrue(row.LEVEL_IS_VISIBLE),
            hierarchy
          };
          hierarchy.levels.push(level);
          levels.set(level.name.toLowerCase(), level);
        }

        for (const hierarchy of hierarchies.values()) {
          hierarchy.levels.sort((left, right) => left.number - right.number);
        }

        return { hierarchies, levels };
      });
      schemaPromise.catch(() => {
        schemaPromise = null;
      });
      return schemaPromise;
    }

    // A level by its unique name, or an attribute hierarchy by its own, as
    // DevExtreme declares the hierarchies that have a single level.
    function levelOf(schema, name) {
      const key = String(name).toLowerCase();
      const level = schema.levels.get(key);
      if (level) {
        return level;
      }

      const hierarchy = schema.hierarchies.get(key);
      const leaves = hierarchy?.levels.filter(entry => !entry.isAll) ?? [];
      if (leaves.length > 0) {
        return leaves[leaves.length - 1];
      }

      throw new Error(`"${name}" is neither a level nor a hierarchy of the cube ${bracket(cube)}.`);
    }

    // ---- Members, in the cube's order ----

    function membersOf(level, locale, signal) {
      const key = `${locale ?? ""}\u001f${level.name}`;
      if (!memberCaches.has(key)) {
        const promise = execute(
          `SELECT {} ON 0, ${level.name}.Members ${PROPERTIES} ON 1 FROM ${bracket(cube)}`,
          { locale, signal })
          .then(document => {
            const axis = descendantsOf(document, "Axis").find(entry => entry.attributes.name === "Axis1");
            return descendantsOf(axis, "Member").map(memberOf);
          });
        promise.catch(() => memberCaches.delete(key));
        memberCaches.set(key, promise);
      }

      return memberCaches.get(key);
    }

    function memberOf(element) {
      return {
        uniqueName: textOf(element, "UName"),
        caption: textOf(element, "Caption") ?? "",
        levelNumber: Number(textOf(element, "LNum")),
        parent: textOf(element, "PARENT_UNIQUE_NAME") || null,
        hierarchy: element.attributes.Hierarchy ?? textOf(element, "HIERARCHY_UNIQUE_NAME") ?? null
      };
    }

    // Every level of a hierarchy down to the deepest one used: a member's
    // ancestors are found at any level, whether the axis shows it or not.
    function levelsToLoad(levels) {
      const needed = new Map();
      for (const level of levels) {
        for (const entry of level.hierarchy.levels) {
          if (!entry.isAll && entry.number <= level.number) {
            needed.set(entry.name, entry);
          }
        }
      }

      return [...needed.values()];
    }

    async function memberIndex(levels, locale, signal) {
      const lists = await Promise.all(levels.map(level => membersOf(level, locale, signal)));
      const index = new Map();
      lists.flat().forEach(member => index.set(member.uniqueName, member));
      return index;
    }

    function ancestorIn(index, member, number) {
      let current = member;
      while (current && current.levelNumber > number) {
        current = index.get(current.parent) ?? null;
      }

      return current;
    }

    // How a level's members are named where the nearest level above them on
    // the axis is level number `context` (0 for none): by caption, and where
    // captions repeat under one context member -- every year's Q1 under no
    // year -- with the captions of as many ancestors as tell them apart, the
    // topmost first: "Q1 2024", "Ocak 2024". A grid header is its label, so
    // two members never share one.
    function labelerOf(level, context, locale, signal) {
      const key = `${locale ?? ""}\u001f${level.name}\u001f${context}`;
      if (!labelers.has(key)) {
        const promise = Promise.all([
          membersOf(level, locale, signal),
          memberIndex(levelsToLoad([level]), locale, signal)
        ]).then(([members, index]) => {
          const ancestors = member => {
            const found = [];
            let current = index.get(member.parent) ?? null;
            while (current && current.levelNumber > context && current.levelNumber > 0) {
              found.unshift(current);
              current = index.get(current.parent) ?? null;
            }

            return found;
          };
          const qualified = (member, depth) => [member, ...ancestors(member).slice(0, depth).reverse()]
            .map(entry => entry.caption)
            .join(" ");
          const groupOf = member => (context > 0 ? ancestorIn(index, member, context)?.uniqueName ?? "" : "");
          const repeats = depth => {
            const seen = new Set();
            return members.some(member => {
              const id = `${groupOf(member)}\u001f${qualified(member, depth)}`;
              return seen.has(id) || !seen.add(id);
            });
          };

          let depth = 0;
          const most = Math.max(0, level.number - 1 - context);
          while (depth < most && repeats(depth)) {
            depth++;
          }

          return { members, index, label: member => qualified(member, depth) };
        });
        promise.catch(() => labelers.delete(key));
        labelers.set(key, promise);
      }

      return labelers.get(key);
    }

    // The labeler of each axis position: its context is the nearest level of
    // the same hierarchy before it on the axis.
    function axisLabelers(levels, locale, signal) {
      return Promise.all(levels.map((level, position) => {
        const above = levels.slice(0, position).filter(entry => entry.hierarchy === level.hierarchy);
        const context = above.length > 0 ? Math.max(...above.map(entry => entry.number)) : 0;
        return labelerOf(level, context, locale, signal);
      }));
    }

    const ranksOf = labeler => {
      const ranks = new Map();
      labeler.members.forEach((member, rank) => {
        const label = labeler.label(member);
        if (!ranks.has(label)) {
          ranks.set(label, rank);
        }
      });
      return ranks;
    };

    // ---- Filters ----

    function context(culture, signal) {
      const labels = assembler().createLabels(culture);
      return { labels, matches: assembler().createPredicates(labels), locale: localeOf(culture), signal };
    }

    // The members a filter keeps, or null when it keeps them all.
    async function filterMembers(schema, filter, ctx) {
      const operator = filter.operator ?? "Equals";
      if (filter.values.length < (FILTER_ARGUMENTS[operator] ?? 1)) {
        return null;
      }

      const labeler = await labelerOf(levelOf(schema, filter.field), 0, ctx.locale, ctx.signal);
      const { members } = labeler;
      const excludes = filter.mode === "Exclude";
      const kept = members.filter(member => ctx.matches(labeler.label(member), operator, filter.values) !== excludes);
      return kept.length === members.length ? null : kept.map(member => member.uniqueName);
    }

    async function slicesOf(schema, filters, ctx) {
      const slices = [];
      for (const filter of filters ?? []) {
        const members = await filterMembers(schema, filter, ctx);
        if (members === null) {
          continue;
        }

        if (members.length === 0) {
          return NOTHING;
        }

        slices.push(members);
      }

      return slices;
    }

    // ---- The pivot ----

    const levelName = level => (typeof level === "string" ? level : level.field);

    function measuresOf(values) {
      const measures = [];
      for (const value of values) {
        if (!measures.includes(value.field)) {
          measures.push(value.field);
        }
      }

      return measures;
    }

    async function pivot(request, { culture = null, signal = null } = {}) {
      validateRequest(request);
      const ctx = context(culture, signal);
      const schema = await schemaOf(signal);
      const rows = request.rows.map(level => levelOf(schema, levelName(level)));
      const columns = request.columns.map(level => levelOf(schema, levelName(level)));
      const shared = rows.find(level => columns.some(column => column.hierarchy === level.hierarchy));
      if (shared) {
        throw new Error(
          `${shared.hierarchy.name} has levels on both the rows and the columns; an MDX query places a hierarchy on one axis.`);
      }

      const keys = request.values.map(value => assembler().valueKey(value));
      const slices = await slicesOf(schema, request.filters, ctx);
      if (slices === NOTHING) {
        return assembler().assemble(assembler().emptyScan(keys), request, { culture });
      }

      const measures = measuresOf(request.values);
      const [document, members, rowLabelers, columnLabelers] = await Promise.all([
        execute(pivotStatement({ cube, rows, columns, measures, slices }), { locale: ctx.locale, signal }),
        memberIndex(levelsToLoad([...rows, ...columns]), ctx.locale, signal),
        axisLabelers(rows, ctx.locale, signal),
        axisLabelers(columns, ctx.locale, signal)
      ]);

      const scan = scanOf(document, {
        rows, columns, measures, keys, values: request.values, members, rowLabelers, columnLabelers
      });
      scan.rowRanks = rowLabelers.map(ranksOf);
      scan.columnRanks = columnLabelers.map(ranksOf);
      return assembler().assemble(scan, request, { culture });
    }

    // A tuple as the header path it stands for: each axis level the tuple
    // reaches, named by the label of the member's ancestor at that level.
    function pathOf(tuple, levels, members, labelers) {
      const byHierarchy = new Map(tuple.map(member => [String(member.hierarchy).toLowerCase(), member]));
      const path = [];
      for (const [position, level] of levels.entries()) {
        let member = byHierarchy.get(level.hierarchy.name.toLowerCase());
        if (!member || member.levelNumber < level.number) {
          break;
        }

        while (member && member.levelNumber > level.number) {
          member = members.get(member.parent) ?? null;
        }

        if (!member) {
          throw new Error(`The cube returned a member whose ancestor at ${level.name} is not among its members.`);
        }

        path.push(labelers[position].label(member));
      }

      return path;
    }

    function tuplesOf(document, name) {
      const axis = descendantsOf(document, "Axis").find(entry => entry.attributes.name === name);
      return axis ? descendantsOf(axis, "Tuple").map(tuple => childrenOf(tuple, "Member").map(memberOf)) : null;
    }

    function cellsOf(document) {
      const cells = new Map();
      for (const cell of descendantsOf(document, "Cell")) {
        const value = childOf(cell, "Value");
        if (!value) {
          continue;
        }

        const ordinal = Number(cell.attributes.CellOrdinal);
        if (childOf(value, "Error")) {
          if (!warnedAboutErrors) {
            warnedAboutErrors = true;
            root.console?.warn?.("PivotForge: the cube returned an error for a cell; it is shown empty.");
          }

          continue;
        }

        const number = Number(value.text);
        cells.set(ordinal, value.text.trim() === "" || !Number.isFinite(number) ? null : number);
      }

      return cells;
    }

    function scanOf(document, { rows, columns, measures, keys, values, members, rowLabelers, columnLabelers }) {
      const builder = assembler().createScan(rows.length, columns.length, keys);
      const columnTuples = tuplesOf(document, "Axis0") ?? [];
      const rowTuples = rows.length > 0 ? (tuplesOf(document, "Axis1") ?? []) : [[]];
      const cells = cellsOf(document);
      const measureIndex = values.map(value => measures.indexOf(value.field));
      const isMeasure = member => String(member.hierarchy).toLowerCase() === MEASURES.toLowerCase();

      // Columns come as each crossing times every measure.
      const columnGroups = [];
      const groupIndex = new Map();
      columnTuples.forEach((tuple, ordinal) => {
        const crossing = tuple.filter(member => !isMeasure(member));
        const measure = tuple.find(isMeasure);
        const key = crossing.map(member => member.uniqueName).join("\u001f");
        if (!groupIndex.has(key)) {
          groupIndex.set(key, columnGroups.length);
          columnGroups.push({ path: pathOf(crossing, columns, members, columnLabelers), ordinals: new Map() });
        }

        const position = measure ? measures.findIndex(name => name.toLowerCase() === measure.uniqueName.toLowerCase()) : 0;
        columnGroups[groupIndex.get(key)].ordinals.set(position, ordinal);
      });

      // The cells first, in the order the cube returned them, so every row and
      // column is known before a total or subtotal of it is placed.
      const crossings = [];
      rowTuples.forEach((tuple, row) => {
        const rowPath = pathOf(tuple, rows, members, rowLabelers);
        for (const group of columnGroups) {
          crossings.push({ row, rowPath, group, full: rowPath.length === rows.length && group.path.length === columns.length });
        }
      });

      let found = 0;
      for (const crossing of [...crossings.filter(entry => entry.full), ...crossings.filter(entry => !entry.full)]) {
        const summary = Object.fromEntries(keys.map((key, index) => {
          const ordinal = crossing.group.ordinals.get(measureIndex[index]);
          const value = ordinal === undefined ? null : cells.get(crossing.row * columnTuples.length + ordinal) ?? null;
          return [key, value];
        }));
        // An empty crossing is no bucket, as no record reaches one in the engine.
        if (Object.values(summary).every(value => value === null)) {
          continue;
        }

        found++;
        builder.place(crossing.rowPath, crossing.group.path, summary);
      }

      // A cube has no record count; what reaches the grid is how many of its
      // crossings hold a value.
      builder.scan.sourceRowCount = found;
      if (builder.scan.grandTotals === null) {
        builder.place([], [], Object.fromEntries(keys.map(key => [key, null])));
      }

      return builder.finish();
    }

    // ---- Field values (the filter picker) ----

    async function fieldValues({ field, filters = [] } = {}, { culture = null, signal = null } = {}) {
      const ctx = context(culture, signal);
      const schema = await schemaOf(signal);
      const level = levelOf(schema, field);
      const labeler = await labelerOf(level, 0, ctx.locale, signal);
      const slices = await slicesOf(schema, filters, ctx);
      let members;
      if (slices === NOTHING) {
        members = [];
      } else if (slices.length === 0) {
        members = labeler.members;
      } else {
        const document = await execute(
          `SELECT NON EMPTY ${level.name}.Members ${PROPERTIES} ON 0 FROM ${fromClause(cube, slices)}`,
          { locale: ctx.locale, signal });
        members = (tuplesOf(document, "Axis0") ?? []).map(tuple => tuple[0]).filter(Boolean);
      }

      const captions = [];
      let hasBlank = false;
      for (const member of members) {
        const label = labeler.label(member);
        if (label === "") {
          hasBlank = true;
        } else if (!captions.includes(label)) {
          captions.push(label);
        }
      }

      const listed = hasBlank ? ["", ...captions] : captions;
      return {
        field,
        values: listed.slice(0, limit),
        totalCount: listed.length,
        truncated: listed.length > limit,
        limit
      };
    }

    // ---- Drill-down (DRILLTHROUGH) ----

    // The members a header path stands for at its deepest level of each
    // hierarchy: one where the path names its ancestors, several where it
    // leaves them open (a Q1 under no year is every year's Q1).
    async function pathMembers(levels, labels, ctx) {
      const used = levels.slice(0, labels.length);
      const [index, labelersOfPath] = await Promise.all([
        memberIndex(levelsToLoad(used), ctx.locale, ctx.signal),
        axisLabelers(used, ctx.locale, ctx.signal)
      ]);

      const chosen = new Map();
      for (let position = 0; position < used.length; position++) {
        const level = used[position];
        const label = labels[position] ?? "";
        const labeler = labelersOfPath[position];
        const above = chosen.get(level.hierarchy) ?? null;
        const candidates = labeler.members.filter(member =>
          labeler.label(member) === label &&
          (above === null || above.some(parent => ancestorIn(index, member, parent.levelNumber)?.uniqueName === parent.uniqueName)));
        chosen.set(level.hierarchy, candidates);
      }

      return [...chosen.values()];
    }

    async function drillDown({ request, rowPath = [], columnPath = [], valueKey = null } = {},
      { culture = null, signal = null } = {}) {
      const ctx = context(culture, signal);
      const schema = await schemaOf(signal);
      const slices = await slicesOf(schema, request.filters, ctx);
      const empty = { records: [], totalCount: 0, truncated: false, limit, valueKey };
      if (slices === NOTHING) {
        return empty;
      }

      const rows = request.rows.map(level => levelOf(schema, levelName(level)));
      const columns = request.columns.map(level => levelOf(schema, levelName(level)));
      const path = [...await pathMembers(rows, rowPath, ctx), ...await pathMembers(columns, columnPath, ctx)];
      if (path.some(members => members.length === 0)) {
        return empty;
      }

      // One member slices the cell; several narrow the cube the way a filter does.
      const where = path.filter(members => members.length === 1).map(members => members[0].uniqueName);
      const narrowed = [...slices, ...path.filter(members => members.length > 1).map(members => members.map(member => member.uniqueName))];
      const value = request.values.find(entry => assembler().valueKey(entry) === valueKey) ?? request.values[0];
      const statement = `DRILLTHROUGH MAXROWS ${limit + 1} SELECT ${setOf([value.field])} ON 0 FROM ${fromClause(cube, narrowed)}` +
        (where.length > 0 ? ` WHERE (${where.join(", ")})` : "");
      const document = await execute(statement, { locale: ctx.locale, signal });

      const records = rowsOf(document).map(row => Object.fromEntries(Object.entries(row).map(([name, text]) => {
        const decoded = decodeName(name);
        const field = /\[([^\]]*)\]$/.exec(decoded)?.[1] ?? decoded;
        const number = Number(text);
        return [field, text !== "" && Number.isFinite(number) && /^-?[\d.]+(e[+-]?\d+)?$/i.test(text.trim()) ? number : text];
      })));

      return {
        records: records.slice(0, limit),
        totalCount: Math.min(records.length, limit),
        truncated: records.length > limit,
        limit,
        valueKey
      };
    }

    // ---- Field discovery (retrieveFields) ----

    async function fields({ culture = null, signal = null } = {}) {
      const locale = localeOf(culture);
      const [schema, dimensionRows, measureRows, groupRows] = await Promise.all([
        schemaOf(signal),
        discover("MDSCHEMA_DIMENSIONS", cubeRestriction, { locale, signal }),
        discover("MDSCHEMA_MEASURES", cubeRestriction, { locale, signal }),
        discover("MDSCHEMA_MEASUREGROUPS", cubeRestriction, { locale, signal })
      ]);

      const groupCaptions = new Map(groupRows.map(row => [row.MEASUREGROUP_NAME, row.MEASUREGROUP_CAPTION ?? row.MEASUREGROUP_NAME]));
      const dimensions = new Map(dimensionRows.map(row => [row.DIMENSION_UNIQUE_NAME, row]));
      const discovered = [];

      for (const row of measureRows) {
        if (row.MEASURE_IS_VISIBLE !== undefined && !isTrue(row.MEASURE_IS_VISIBLE)) {
          continue;
        }

        const folder = row.MEASURE_DISPLAY_FOLDER || groupCaptions.get(row.MEASUREGROUP_NAME) || null;
        discovered.push({
          dataField: row.MEASURE_UNIQUE_NAME,
          caption: row.MEASURE_CAPTION ?? row.MEASURE_NAME,
          dataType: "number",
          role: "measure",
          ...(folder ? { displayFolder: folder } : {})
        });
      }

      for (const hierarchy of schema.hierarchies.values()) {
        const dimension = dimensions.get(hierarchy.dimension);
        if (!hierarchy.visible || Number(dimension?.DIMENSION_TYPE) === 2 || hierarchy.name.toLowerCase() === MEASURES.toLowerCase()) {
          continue;
        }

        const levels = hierarchy.levels.filter(level => !level.isAll && level.visible);
        if (levels.length === 0) {
          continue;
        }

        const dimensionCaption = dimension?.DIMENSION_CAPTION ?? null;
        const folder = [dimensionCaption, hierarchy.displayFolder].filter(Boolean).join("\\") || null;
        const common = { dataType: "string", role: "dimension", ...(folder ? { displayFolder: folder } : {}) };
        if (levels.length === 1) {
          discovered.push({ dataField: hierarchy.name, caption: hierarchy.caption, ...common });
          continue;
        }

        levels.forEach((level, groupIndex) => discovered.push({
          dataField: level.name,
          caption: level.caption,
          groupName: hierarchy.name,
          groupIndex,
          ...common
        }));
      }

      return { fields: discovered };
    }

    return { pivot, fieldValues, drillDown, fields, limit };
  }

  PivotForge.XmlaStore = {
    create: createXmlaStore,
    validateFields,
    validateRequest,
    parseXml,
    pivotStatement,
    LOCALE_IDENTIFIERS
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PivotForge.XmlaStore;
  }
})(typeof window !== "undefined" ? window : globalThis);
