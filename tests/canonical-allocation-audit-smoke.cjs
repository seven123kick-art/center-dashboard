'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const win={addEventListener(){}};
vm.runInNewContext(fs.readFileSync('src/core/data_catalog/canonical_route_ledger.js','utf8'),{window:win,console});
assert.equal(typeof win.CANONICAL_ROUTE_LEDGER._internal.build,'function');
const route=(id,date,head)=>({route_id:id,delivery_date:date,head_no:head});
const attempt=(id,no)=>({route_id:id,slip_id:'S'+no});
const snapshot={materialization:{current_batches:{DELIVERY_LIST:true}},entities:{
 DELIVERY_ROUTE:[route('center','2026-06-06','H1'),route('driver','2026-06-06','H2'),route('otherday','2026-06-07','H3')],
 ROUTE_WORKER:[{route_id:'center',source_worker_name:'北埼玉センター'},{route_id:'driver',source_worker_name:'作業者A'},{route_id:'otherday',source_worker_name:'作業者B'}],
 DELIVERY_ATTEMPT:[attempt('center','100'),attempt('center','200'),attempt('driver','100'),attempt('otherday','200')],
 BUSINESS_SLIP:[{slip_id:'S100',slip_no:'100',shipper_source_code:'D'},{slip_id:'S200',slip_no:'200',shipper_source_code:'OTHER'}],
 SALES_DETAIL:[],ROUTE_PAYMENT:[]
}};
const result=win.CANONICAL_ROUTE_LEDGER._internal.build(snapshot,'202606');
const audit=result.diagnostics.allocationAudit[0];
assert.equal(audit.assignedCount,1);
assert.equal(audit.unassignedCount,1);
assert.equal(audit.slipAudit.find(x=>x.slipNo==='100').shipperCode,'D');
assert.equal(result.routes.find(x=>x.routeId==='center').count,2);
console.log('Canonical allocation audit passed');
