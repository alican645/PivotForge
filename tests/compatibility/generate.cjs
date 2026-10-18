// Usage: node tests/compatibility/generate.cjs /path/to/dx.all.js
// The proprietary bundle is supplied locally and is never stored in the repository.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const bundle = process.argv[2];
if (!bundle) throw new Error('Supply the DevExtreme 26.1.3 dx.all.js path.');
const hash = crypto.createHash('sha256').update(fs.readFileSync(bundle)).digest('hex');
const expectedHash = 'd29fe967ece49e81f8b473119ffecc9a903dda6bcf5dac1dc4bf6843633a41d9';
if (hash !== expectedHash) throw new Error(`Reference bundle changed: ${hash}`);
const modes = {
  Normal: undefined,
  PercentOfRowTotal: 'percentOfRowGrandTotal',
  PercentOfColumnTotal: 'percentOfColumnGrandTotal',
  PercentOfGrandTotal: 'percentOfGrandTotal',
  PercentOfParentRowTotal: 'percentOfColumnTotal',
  PercentOfParentColumnTotal: 'percentOfRowTotal',
  DifferenceFromPrevious: 'absoluteVariation',
  PercentDifferenceFromPrevious: 'percentVariation'
};
const cases = [];
function add(id, records, options = {}) {
  cases.push({ id, records, rows: ['R'], columns: ['C'], aggregation: 'Sum',
    showAs: 'Normal', runningTotal: 'None', crossGroup: false, descending: false,
    summarySort: false, ...options });
}
const simple = [
  {R:'B',C:'03',V:30}, {R:'A',C:'02',V:0}, {R:'A',C:'01',V:10},
  {R:'A',C:'03',V:40}, {R:'B',C:'01',V:-5}, {R:'B',C:'02',V:null},
  {R:'A',C:'01',V:20}
];
for (const aggregation of ['Sum','Count','Min','Max','Average']) {
  add(`aggregate-${aggregation}`, simple, {aggregation});
  add(`empty-${aggregation}`, [{R:'A',C:'01',V:null},{R:'A',C:'01'}], {aggregation});
  add(`numeric-strings-${aggregation}`, [{R:'A',C:'01',V:'12.5'},{R:'A',C:'01',V:'2.5'},{R:'A',C:'01',V:null}], {aggregation});
}
const nested = [];
for (const [ri,R] of ['B','A'].entries())
  for (const [si,S] of ['b','a'].entries())
    for (const [ci,C] of ['02','01'].entries())
      for (const [di,D] of ['y','x'].entries())
        nested.push({R,S,C,D,V: (ri+1)*10 + si*5 + ci*3 + di});
for (const showAs of Object.keys(modes)) {
  for (const descending of [false,true]) {
    add(`${showAs}-${descending?'desc':'asc'}`, simple, {showAs,descending});
    add(`nested-${showAs}-${descending?'desc':'asc'}`, nested, {rows:['R','S'],columns:['C','D'],showAs,descending});
  }
}
for (const runningTotal of ['Row','Column'])
  for (const crossGroup of [false,true])
    for (const descending of [false,true])
      for (const showAs of ['Normal','PercentOfGrandTotal'])
        add(`running-${runningTotal}-${crossGroup}-${descending}-${showAs}`,nested,
          {rows:['R','S'],columns:['C','D'],runningTotal,crossGroup,descending,showAs});
for (const showAs of ['DifferenceFromPrevious','PercentDifferenceFromPrevious']) {
  add(`cross-${showAs}`, nested, {rows:['R','S'],columns:['C','D'],showAs,crossGroup:true});
  add(`summary-sort-${showAs}`, simple, {showAs,summarySort:true});
}
// Null averages distinguish missing values from the zero returned by an empty sum.
for (const showAs of Object.keys(modes)) {
  add(`average-${showAs}`, simple, {aggregation:'Average',showAs});
  add(`zero-${showAs}`, [{R:'A',C:'01',V:0},{R:'A',C:'02',V:0}], {showAs});
}
for (const descending of [false,true])
  for (const aggregation of ['Sum','Average'])
    add(`summary-ties-${aggregation}-${descending}`, [
      {R:'Z',C:'Z',V:10},{R:'A',C:'A',V:10},{R:'M',C:'M',V:20},{R:'N',C:'N',V:null}
    ], {aggregation,summarySort:true,descending});
// Exercise both axes across insertion, run and merge boundaries. These cases
// compare header order only, avoiding a quadratic cell snapshot for large axes.
for (const size of [15,16,17,31,32,63,64,65,128,257,1024])
  for (const pattern of [0,1,2,3])
    for (const descending of [false,true])
      for (const axis of ['row','column']) {
        const records = Array.from({length:size}, (_,index) => {
          const label = String((index * 37) % size).padStart(4,'0');
          const value = index % 7 === 0 ? null : pattern === 0 ? (index*11)%23
            : pattern === 1 ? index : pattern === 2 ? size-index : Math.floor(index/5);
          return { R:axis==='row'?label:'all', C:axis==='column'?label:'all', V:value };
        });
        add(`nan-order-${axis}-${size}-${pattern}-${descending}`, records,
          {aggregation:'Average',summarySort:true,descending,headersOnly:true});
      }
for (const descending of [false,true]) {
  add(`nested-nan-${descending}`, nested.map((record,index)=>({...record,V:index%3===0?null:record.V})),
    {rows:['R','S'],columns:['C','D'],aggregation:'Average',summarySort:true,descending});
}
for (const descending of [false,true]) {
  add(`nested-nan-parent-${descending}`, nested.map(record=>({...record,V:record.R==='B'?null:record.V})),
    {rows:['R','S'],columns:['C','D'],aggregation:'Average',summarySort:true,descending});
  for (const axis of ['row','column'])
    for (const summaryPath of [['X'],['missing']]) {
      const records = [{R:'Z',C:'Y',V:15},{R:'N',C:'X',V:null},{R:'A',C:'X',V:10},{R:'M',C:'X',V:20}]
        .map(record=>axis==='row'?record:{R:record.C,C:record.R,V:record.V});
      add(`nan-summary-path-${axis}-${summaryPath[0]}-${descending}`, records,
        {aggregation:'Average',summarySort:true,summaryAxis:axis,summaryPath,descending});
    }
}
(async () => {
  const browser = await chromium.launch();
  try {
    const browserVersion = browser.version();
    if (browserVersion !== '151.0.7922.34') throw new Error(`Reference Chromium changed: ${browserVersion}`);
    const page = await browser.newPage({locale:'en-US'});
    await page.addScriptTag({path:path.resolve(bundle)});
    const version = await page.evaluate(() => DevExpress.VERSION);
    if (version !== '26.1.3') throw new Error(`Unexpected version ${version}`);
    for (const entry of cases) {
      entry.expected = await page.evaluate(async ({entry, mode}) => {
        const fields = ['row','column'].flatMap(area => entry[area === 'row'?'rows':'columns'].map((dataField,areaIndex) => ({
          dataField, area, areaIndex, expanded:true, dataType:'string',
          sortOrder: entry.descending?'desc':'asc',
          ...(entry.summarySort && (!entry.summaryAxis || entry.summaryAxis===area)
            ? {sortBySummaryField:'V',sortBySummaryPath:entry.summaryPath} : {})
        })));
        fields.push({dataField:'V',area:'data',dataType:'number',
          summaryType: entry.aggregation === 'Average'?'avg':entry.aggregation.toLowerCase(),
          summaryDisplayMode:mode, runningTotal:entry.runningTotal === 'None'?undefined:entry.runningTotal.toLowerCase(),
          allowCrossGroupCalculation:entry.crossGroup});
        const ds = new DevExpress.data.PivotGridDataSource({fields,store:entry.records,retrieveFields:false});
        try {
          await ds.load();
          const data = ds.getData();
          function flatten(nodes, parent=[]) {
            return nodes.flatMap(node => [{path:[...parent,String(node.value)],index:node.index},...flatten(node.children??[],[...parent,String(node.value)])]);
          }
          const rows = [{path:[],index:data.grandTotalRowIndex},...flatten(data.rows)];
          const columns = [{path:[],index:data.grandTotalColumnIndex},...flatten(data.columns)];
          return {
            rowHeaders: rows.filter(r=>r.path.length===entry.rows.length).map(r=>r.path),
            columnHeaders: columns.filter(c=>c.path.length===entry.columns.length).map(c=>c.path),
            cells: entry.headersOnly ? [] : rows.flatMap(r=>columns.map(c=>({row:r.path,column:c.path,value:data.values[r.index]?.[c.index]?.[0]??null,
              ...(Number.isNaN(data.values[r.index]?.[c.index]?.[0]) ? {nonFinite:"NaN"} : {})})))
          };
        } finally { ds.dispose(); }
      },{entry,mode:modes[entry.showAs]});
    }
    const output = { reference: {version,browser:'Chromium '+browserVersion,playwright:require('playwright/package.json').version,sha256:hash,url:'https://cdn3.devexpress.com/jslib/26.1.3/js/dx.all.js'}, cases };
    fs.writeFileSync(path.join(__dirname,'calculations.json'), '{\n  "reference": '+JSON.stringify(output.reference)+',\n  "cases": [\n'+cases.map(entry=>'    '+JSON.stringify(entry)).join(',\n')+'\n  ]\n}\n');
    console.log(`Recorded ${cases.length} cases from DevExtreme ${version}.`);
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
