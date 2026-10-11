'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const win={addEventListener(){}};
vm.runInNewContext(fs.readFileSync('src/core/data_catalog/canonical_route_ledger.js','utf8'),{window:win,console});
assert.equal(typeof win.CANONICAL_ROUTE_LEDGER._internal.build,'function');
console.log('Canonical ledger loaded');
