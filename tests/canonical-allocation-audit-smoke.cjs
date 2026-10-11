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
 DELIVERY_ROUTE:[route('center','2026-06-06','H1'),route('driver','2026-06-06','H2'),route('otherday','2026-06-07','H3'),route('unknown','2026-06-06','H4'),route('center2','2026-06-06','H5'),route('driver2','2026-06-06','H6'),route('differentId','2026-06-06','H7')],
 ROUTE_WORKER:[{route_id:'center',source_worker_name:'北埼玉センター'},{route_id:'driver',source_worker_name:'作業者A'},{route_id:'otherday',source_worker_name:'作業者B'},{route_id:'center2',source_worker_name:'北さいたまセンター'},{route_id:'driver2',source_worker_name:'作業者C'},{route_id:'differentId',source_worker_name:'作業者D'}],
 DELIVERY_ATTEMPT:[attempt('center','100'),attempt('center','200'),attempt('driver','100'),attempt('otherday','200'),attempt('unknown','200'),attempt('center2','200'),attempt('driver2','100'),{route_id:'differentId',slip_id:'S300'}],
 BUSINESS_SLIP:[{slip_id:'S100',slip_no:'100',shipper_source_code:'D'},{slip_id:'S200',slip_no:'200',shipper_source_code:'OTHER'},{slip_id:'S200',slip_no:'200',shipper_source_code:'CONFLICT'}],
 SALES_DETAIL:[],ROUTE_PAYMENT:[]
}};
const result=win.CANONICAL_ROUTE_LEDGER._internal.build(snapshot,'202606');
const audit=result.diagnostics.allocationAudit[0];
assert.equal(audit.assignedCount,1);
assert.equal(audit.slipAudit.find(x=>x.slipNo==='100').otherHeadNumbers.length,2);
assert.equal(audit.unassignedCount,1);
assert.equal(result.diagnostics.allocationAudit.length,2);
assert.equal(result.diagnostics.allocationAudit.find(x=>x.headNumber==='H5').assignedCount,0);
assert.equal(audit.slipAudit.find(x=>x.slipNo==='100').shipperCode,'D');
assert.equal(audit.slipAudit.find(x=>x.slipNo==='200').shipperCode,'');
assert.equal(audit.unknownShipperCount,1);
assert.equal(result.routes.find(x=>x.routeId==='center').count,2);
assert.equal(result.routes.find(x=>x.routeId==='center').sales,null);
assert.equal(result.routes.find(x=>x.routeId==='center').payment,null);
assert.equal(audit.slipAudit.find(x=>x.slipNo==='200').allocationStatus,'NOT_FOUND_ON_OTHER_HEAD');
console.log('Canonical allocation audit passed');
