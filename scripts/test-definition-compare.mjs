import assert from 'node:assert/strict';
import {
  compareDefinitions,
  definitionDiffCount,
  firmwareBuildDate,
  previousRegisteredDefinitions,
} from '../src/definitionCompare.ts';

function definition({
  constants = [],
  tables = [],
  curves = [],
  dialogs = [],
  menus = [],
} = {}) {
  return {
    signature: 'test',
    constants,
    tables,
    curves,
    dialogs,
    menus,
    labelSets: {},
  };
}

function scalar(name, extra = {}) {
  return {
    name,
    kind: 'scalar',
    dataType: 'U08',
    page: 1,
    offset: 0,
    units: '',
    rows: null,
    cols: null,
    scale: '1',
    translate: '0',
    digits: '0',
    min: '0',
    max: '255',
    options: [],
    ...extra,
  };
}

function table(id, title, extra = {}) {
  return {
    id,
    mapId: '',
    title,
    page: 1,
    help: '',
    xBins: 'x',
    yBins: 'y',
    zBins: 'z',
    xLabel: '',
    yLabel: '',
    ...extra,
  };
}

const left = definition({
  constants: [scalar('keep'), scalar('changed'), scalar('removed')],
  tables: [table('ve', 'VE table')],
  dialogs: [{
    id: 'fuel',
    title: 'Fuel',
    layout: '',
    help: '',
    fields: [
      { title: 'Keep setting', name: 'keep', condition: '' },
      { title: 'Changed setting', name: 'changed', condition: '' },
      { title: 'Removed setting', name: 'removed', condition: '' },
    ],
    panels: [],
  }],
});

const right = definition({
  constants: [
    scalar('keep'),
    scalar('changed', { max: '200' }),
    scalar('added'),
  ],
  tables: [
    table('ve', 'VE table', { help: 'updated' }),
    table('spark', 'Spark table'),
  ],
  dialogs: [{
    id: 'fuel',
    title: 'Fuel',
    layout: '',
    help: '',
    fields: [
      { title: 'Keep setting', name: 'keep', condition: '' },
      { title: 'Changed setting', name: 'changed', condition: '' },
      { title: 'Added setting', name: 'added', condition: '' },
    ],
    panels: [],
  }],
});

const diff = compareDefinitions(left, right);
assert.deepEqual(diff.addedSettings, [{ id: 'added', label: 'Added setting' }]);
assert.deepEqual(diff.changedSettings, [{ id: 'changed', label: 'Changed setting' }]);
assert.deepEqual(diff.removedSettings, [{ id: 'removed', label: 'Removed setting' }]);
assert.deepEqual(diff.addedTables, [{ id: 'spark', label: 'Spark table' }]);
assert.deepEqual(diff.changedTables, [{ id: 've', label: 'VE table' }]);
assert.equal(definitionDiffCount(diff), 5);

// Equivalent object content must not become "changed" merely because property order differs.
const reordered = {
  options: [],
  max: '255',
  min: '0',
  digits: '0',
  translate: '0',
  scale: '1',
  cols: null,
  rows: null,
  units: '',
  offset: 0,
  page: 1,
  dataType: 'U08',
  kind: 'scalar',
  name: 'keep',
};
const stable = compareDefinitions(
  definition({ constants: [scalar('keep')] }),
  definition({ constants: [reordered] }),
);
assert.equal(definitionDiffCount(stable), 0);

const entries = [
  {
    signature: 'epicEFI master.2026.08.26.MEGA144H7.1',
    ecuTarget: 'MEGA144H7',
    label: 'Aug',
    path: '',
    sha256: '',
    definitionCount: 0,
    tableCount: 0,
    source: 'test',
    release: '2099-01-01',
  },
  {
    signature: 'epicEFI master.2026.09.11.MEGA144H7.2',
    ecuTarget: 'MEGA144H7',
    label: 'Sep',
    path: '',
    sha256: '',
    definitionCount: 0,
    tableCount: 0,
    source: 'test',
    release: '2026-09-15',
  },
  {
    signature: 'epicEFI master.2026.09.11.MEGA100F4.3',
    ecuTarget: 'MEGA100F4',
    label: 'Other target',
    path: '',
    sha256: '',
    definitionCount: 0,
    tableCount: 0,
    source: 'test',
  },
];

assert.equal(firmwareBuildDate(entries[0]), '2026-08-26');
assert.equal(firmwareBuildDate(entries[1]), '2026-09-11');

const previous = previousRegisteredDefinitions(entries);
assert.equal(
  previous.get(entries[1].signature)?.signature,
  entries[0].signature,
);
assert.equal(previous.has(entries[2].signature), false);

console.log('Definition comparison policy tests: PASS');
