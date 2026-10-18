// An in-memory stand-in for DevExtreme.AspNet.Data's DataSourceLoader.Load:
// filter, nested group with date parts and numeric intervals, group and total
// summaries, skip/take and the total count, answered the way the library does
// (string comparisons ignore case, groups come back in key order, a numeric
// interval keys a group by value - value % interval).

function member(record, selector) {
  const [name, part] = selector.split(".");
  const key = Object.keys(record).find(candidate => candidate.toLowerCase() === name.toLowerCase());
  const value = key === undefined ? undefined : record[key];
  if (!part) {
    return value ?? null;
  }

  if (value === null || value === undefined) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(`${value}`.replace(/Z?$/, "Z"));
  switch (part) {
    case "Year": return date.getUTCFullYear();
    case "Month": return date.getUTCMonth() + 1;
    case "Day": return date.getUTCDate();
    case "DayOfWeek": return date.getUTCDay();
    default: throw new Error(`Unknown member ${part}`);
  }
}

const fold = value => (typeof value === "string" ? value.toLowerCase() : value);

function compare(left, right) {
  if (left === right) {
    return 0;
  }

  if (left === null) {
    return -1;
  }

  if (right === null) {
    return 1;
  }

  return fold(left) < fold(right) ? -1 : fold(left) > fold(right) ? 1 : 0;
}

function matches(record, filter) {
  if (!filter) {
    return true;
  }

  if (filter[0] === "!") {
    return !matches(record, filter[1]);
  }

  if (Array.isArray(filter[0])) {
    let result = matches(record, filter[0]);
    for (let index = 1; index < filter.length; index += 2) {
      const next = matches(record, filter[index + 1]);
      result = filter[index] === "or" ? result || next : result && next;
    }

    return result;
  }

  const [selector, operator, operand] = filter;
  const value = member(record, selector);
  const text = String(fold(value) ?? "");
  switch (operator) {
    case "=": return compare(value, operand) === 0;
    case "<>": return compare(value, operand) !== 0;
    case ">": return value !== null && compare(value, operand) > 0;
    case ">=": return value !== null && compare(value, operand) >= 0;
    case "<": return value !== null && compare(value, operand) < 0;
    case "<=": return value !== null && compare(value, operand) <= 0;
    case "contains": return value !== null && text.includes(fold(operand));
    case "startswith": return value !== null && text.startsWith(fold(operand));
    case "endswith": return value !== null && text.endsWith(fold(operand));
    default: throw new Error(`Unknown operator ${operator}`);
  }
}

function groupKey(record, group) {
  const interval = group.groupInterval;
  if (typeof interval === "number") {
    const value = member(record, group.selector);
    return value === null ? null : value - (value % interval);
  }

  switch (interval) {
    case "year": return member(record, `${group.selector}.Year`);
    case "quarter": {
      const month = member(record, `${group.selector}.Month`);
      return month === null ? null : Math.floor((month - 1) / 3) + 1;
    }
    case "month": return member(record, `${group.selector}.Month`);
    case "day": return member(record, `${group.selector}.Day`);
    case "dayOfWeek": return member(record, `${group.selector}.DayOfWeek`);
    default: return member(record, group.selector);
  }
}

function summarize(records, summaries) {
  return summaries.map(({ selector, summaryType }) => {
    const values = records.map(record => member(record, selector)).filter(value => value !== null);
    switch (summaryType) {
      case "count": return records.length;
      case "sum": return values.reduce((sum, value) => sum + value, 0);
      case "avg": return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
      case "min": return values.length === 0 ? null : Math.min(...values);
      case "max": return values.length === 0 ? null : Math.max(...values);
      default: throw new Error(`Unknown summary ${summaryType}`);
    }
  });
}

function groupBy(records, groups, summaries) {
  const [group, ...rest] = groups;
  const buckets = new Map();
  for (const record of records) {
    const key = groupKey(record, group);
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }

    buckets.get(key).push(record);
  }

  return [...buckets]
    .sort(([left], [right]) => compare(left, right))
    .map(([key, items]) => ({
      key,
      items: group.isExpanded === false ? null : rest.length > 0 ? groupBy(items, rest, summaries) : items,
      count: items.length,
      ...(summaries ? { summary: summarize(items, summaries) } : {})
    }));
}

function createLoader(records) {
  const calls = [];
  const load = async loadOptions => {
    calls.push(loadOptions);
    const filtered = records.filter(record => matches(record, loadOptions.filter));
    const totalCount = loadOptions.requireTotalCount ? filtered.length : -1;
    const summary = loadOptions.totalSummary ? summarize(filtered, loadOptions.totalSummary) : undefined;

    if (loadOptions.group?.length) {
      return { data: groupBy(filtered, loadOptions.group, loadOptions.groupSummary), totalCount, summary, groupCount: -1 };
    }

    const skip = loadOptions.skip ?? 0;
    const page = filtered.slice(skip, loadOptions.take === undefined ? undefined : skip + loadOptions.take);
    return { data: page, totalCount, summary, groupCount: -1 };
  };

  return { load, calls };
}

module.exports = { createLoader, matches };
