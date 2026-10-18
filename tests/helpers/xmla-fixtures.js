// Hand-written XMLA answers for the XmlaStore tests: a provider that serves
// the schema rowsets and each level's members from tables, and answers any
// other Execute with the dataset a test registers for it. The SOAP is what
// Analysis Services writes, cut down to the elements the store reads.

const escape = text => String(text)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const envelope = body =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
  `<soap:Body>${body}</soap:Body></soap:Envelope>`;

function rowset(rows) {
  const row = entry => `<row>${Object.entries(entry).map(([name, value]) => `<${name}>${escape(value)}</${name}>`).join("")}</row>`;
  return envelope(`<DiscoverResponse xmlns="urn:schemas-microsoft-com:xml-analysis"><return>` +
    `<root xmlns="urn:schemas-microsoft-com:xml-analysis:rowset">${rows.map(row).join("")}</root></return></DiscoverResponse>`);
}

// A member: h hierarchy, u unique name, c caption, l level number, p parent.
const memberXml = member =>
  `<Member Hierarchy="${escape(member.h)}"><UName>${escape(member.u)}</UName><Caption>${escape(member.c)}</Caption>` +
  `<LNum>${member.l}</LNum><PARENT_UNIQUE_NAME>${escape(member.p ?? "")}</PARENT_UNIQUE_NAME></Member>`;

const axisXml = (name, tuples) =>
  `<Axis name="${name}"><Tuples>${tuples.map(tuple => `<Tuple>${tuple.map(memberXml).join("")}</Tuple>`).join("")}</Tuples></Axis>`;

// cells: { ordinal: number | { error: "..." } }
function dataset({ columns, rows = null, cells = {} }) {
  const axes = [axisXml("Axis0", columns), ...(rows ? [axisXml("Axis1", rows)] : []), axisXml("SlicerAxis", [[]])];
  const cellXml = Object.entries(cells).map(([ordinal, value]) => typeof value === "object"
    ? `<Cell CellOrdinal="${ordinal}"><Value><Error><ErrorCode>1</ErrorCode><Description>${escape(value.error)}</Description></Error></Value></Cell>`
    : `<Cell CellOrdinal="${ordinal}"><Value xsi:type="xsd:double">${value}</Value></Cell>`).join("");
  return envelope(`<ExecuteResponse xmlns="urn:schemas-microsoft-com:xml-analysis"><return>` +
    `<root xmlns="urn:schemas-microsoft-com:xml-analysis:mddataset" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<Axes>${axes.join("")}</Axes><CellData>${cellXml}</CellData></root></return></ExecuteResponse>`);
}

function executeRowset(rows) {
  return envelope(`<ExecuteResponse xmlns="urn:schemas-microsoft-com:xml-analysis"><return>` +
    `<root xmlns="urn:schemas-microsoft-com:xml-analysis:rowset">${rows.map(row =>
      `<row>${Object.entries(row).map(([name, value]) => `<${name}>${escape(value)}</${name}>`).join("")}</row>`).join("")}` +
    `</root></return></ExecuteResponse>`);
}

const fault = message => envelope(
  `<soap:Fault><faultcode>XMLAnalysisError</faultcode><faultstring>${escape(message)}</faultstring>` +
  `<detail><Error ErrorCode="1" Description="${escape(message)}" /></detail></soap:Fault>`);

// The cube the tests read: Region, and a Calendar of Year and Quarter whose
// quarters repeat their captions from year to year.
const region = "[Region].[Region]";
const calendar = "[Date].[Calendar]";
const M = {
  all: { h: region, u: "[Region].[Region].[All]", c: "All", l: 0 },
  ege: { h: region, u: "[Region].[Region].&[Ege]", c: "Ege", l: 1, p: "[Region].[Region].[All]" },
  marmara: { h: region, u: "[Region].[Region].&[Marmara]", c: "Marmara", l: 1, p: "[Region].[Region].[All]" },
  calendarAll: { h: calendar, u: "[Date].[Calendar].[All]", c: "All", l: 0 },
  y2024: { h: calendar, u: "[Date].[Calendar].[Year].&[2024]", c: "2024", l: 1, p: "[Date].[Calendar].[All]" },
  y2025: { h: calendar, u: "[Date].[Calendar].[Year].&[2025]", c: "2025", l: 1, p: "[Date].[Calendar].[All]" },
  q1of2024: { h: calendar, u: "[Date].[Calendar].[Quarter].&[2024]&[1]", c: "Q1", l: 2, p: "[Date].[Calendar].[Year].&[2024]" },
  q2of2024: { h: calendar, u: "[Date].[Calendar].[Quarter].&[2024]&[2]", c: "Q2", l: 2, p: "[Date].[Calendar].[Year].&[2024]" },
  q1of2025: { h: calendar, u: "[Date].[Calendar].[Quarter].&[2025]&[1]", c: "Q1", l: 2, p: "[Date].[Calendar].[Year].&[2025]" },
  amount: { h: "[Measures]", u: "[Measures].[Amount]", c: "Amount", l: 0 },
  count: { h: "[Measures]", u: "[Measures].[Order Count]", c: "Order Count", l: 0 }
};

const SCHEMA = {
  MDSCHEMA_HIERARCHIES: [
    { DIMENSION_UNIQUE_NAME: "[Measures]", HIERARCHY_UNIQUE_NAME: "[Measures]", HIERARCHY_CAPTION: "Measures", ALL_MEMBER: "" },
    { DIMENSION_UNIQUE_NAME: "[Region]", HIERARCHY_UNIQUE_NAME: region, HIERARCHY_CAPTION: "Region", ALL_MEMBER: M.all.u },
    { DIMENSION_UNIQUE_NAME: "[Date]", HIERARCHY_UNIQUE_NAME: calendar, HIERARCHY_CAPTION: "Calendar", ALL_MEMBER: M.calendarAll.u },
    { DIMENSION_UNIQUE_NAME: "[Date]", HIERARCHY_UNIQUE_NAME: "[Date].[Hidden]", HIERARCHY_CAPTION: "Hidden", ALL_MEMBER: "", HIERARCHY_IS_VISIBLE: "false" }
  ],
  MDSCHEMA_LEVELS: [
    { HIERARCHY_UNIQUE_NAME: "[Measures]", LEVEL_UNIQUE_NAME: "[Measures].[MeasuresLevel]", LEVEL_CAPTION: "MeasuresLevel", LEVEL_NUMBER: 0, LEVEL_TYPE: 0 },
    { HIERARCHY_UNIQUE_NAME: region, LEVEL_UNIQUE_NAME: "[Region].[Region].[(All)]", LEVEL_CAPTION: "(All)", LEVEL_NUMBER: 0, LEVEL_TYPE: 1 },
    { HIERARCHY_UNIQUE_NAME: region, LEVEL_UNIQUE_NAME: "[Region].[Region].[Region]", LEVEL_CAPTION: "Region", LEVEL_NUMBER: 1, LEVEL_TYPE: 0 },
    { HIERARCHY_UNIQUE_NAME: calendar, LEVEL_UNIQUE_NAME: "[Date].[Calendar].[(All)]", LEVEL_CAPTION: "(All)", LEVEL_NUMBER: 0, LEVEL_TYPE: 1 },
    { HIERARCHY_UNIQUE_NAME: calendar, LEVEL_UNIQUE_NAME: "[Date].[Calendar].[Year]", LEVEL_CAPTION: "Year", LEVEL_NUMBER: 1, LEVEL_TYPE: 0 },
    { HIERARCHY_UNIQUE_NAME: calendar, LEVEL_UNIQUE_NAME: "[Date].[Calendar].[Quarter]", LEVEL_CAPTION: "Quarter", LEVEL_NUMBER: 2, LEVEL_TYPE: 0 }
  ],
  MDSCHEMA_DIMENSIONS: [
    { DIMENSION_UNIQUE_NAME: "[Measures]", DIMENSION_CAPTION: "Measures", DIMENSION_TYPE: 2 },
    { DIMENSION_UNIQUE_NAME: "[Region]", DIMENSION_CAPTION: "Region", DIMENSION_TYPE: 3 },
    { DIMENSION_UNIQUE_NAME: "[Date]", DIMENSION_CAPTION: "Date", DIMENSION_TYPE: 1 }
  ],
  MDSCHEMA_MEASURES: [
    { MEASURE_UNIQUE_NAME: M.amount.u, MEASURE_CAPTION: "Amount", MEASUREGROUP_NAME: "Sales", MEASURE_DISPLAY_FOLDER: "" },
    { MEASURE_UNIQUE_NAME: M.count.u, MEASURE_CAPTION: "Order Count", MEASUREGROUP_NAME: "Sales", MEASURE_DISPLAY_FOLDER: "Counts" },
    { MEASURE_UNIQUE_NAME: "[Measures].[Secret]", MEASURE_CAPTION: "Secret", MEASUREGROUP_NAME: "Sales", MEASURE_IS_VISIBLE: "false" }
  ],
  MDSCHEMA_MEASUREGROUPS: [{ MEASUREGROUP_NAME: "Sales", MEASUREGROUP_CAPTION: "Internet Sales" }]
};

const LEVEL_MEMBERS = {
  "[Region].[Region].[Region]": [M.ege, M.marmara],
  "[Date].[Calendar].[Year]": [M.y2024, M.y2025],
  "[Date].[Calendar].[Quarter]": [M.q1of2024, M.q2of2024, M.q1of2025]
};

// answers: [{ match: RegExp, response: string | (statement) => string }]
function createProvider({ answers = [], schema = SCHEMA, levelMembers = LEVEL_MEMBERS } = {}) {
  const requests = [];
  const statements = [];
  const fetch = async (url, init) => {
    requests.push({ url, ...init });
    const body = init.body;
    const text = tag => (new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(body)?.[1] ?? null);
    const decode = value => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");
    let response;
    if (body.includes("<Discover ")) {
      response = rowset(schema[text("RequestType")] ?? []);
    } else {
      const statement = decode(text("Statement"));
      statements.push(statement);
      const members = /^SELECT \{\} ON 0, (.+)\.Members /.exec(statement);
      if (members) {
        response = dataset({ columns: [], rows: (levelMembers[members[1]] ?? []).map(member => [member]) });
      } else {
        const answer = answers.find(entry => entry.match.test(statement));
        response = answer
          ? (typeof answer.response === "function" ? answer.response(statement) : answer.response)
          : fault(`No answer registered for ${statement}`);
      }
    }

    const failed = response.includes("<soap:Fault>");
    return { ok: !failed, status: failed ? 500 : 200, text: async () => response };
  };

  return { fetch, requests, statements };
}

module.exports = { createProvider, dataset, executeRowset, fault, rowset, M, SCHEMA, LEVEL_MEMBERS };
