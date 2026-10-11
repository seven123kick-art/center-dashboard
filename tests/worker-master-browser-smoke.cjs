const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8765/center.html?c=kitasaitama',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.NAV&&window.WORKER_MASTER_UI&&window.ROUTE_ANALYSIS_UI),{timeout:30000});
  await page.evaluate(()=>window.DATA_MANAGEMENT_NAV.go('worker-master'));
  await page.locator('#worker-master-table tbody').waitFor({timeout:15000});
  if(!await page.locator('#view-worker-master.active').count())throw Error('Worker master view did not activate');
  if(!await page.locator('#worker-master-table tr[data-worker-row]').count())throw Error('Worker master rows not rendered');
  console.log('PASS: navigation to worker master and rows rendered');
  // Use an isolated fake route ledger and in-memory worker save.
  await page.evaluate(()=>{
    window.__smokeOriginal={
      canonical:window.CANONICAL_ROUTE_LEDGER,
      save:window.WORKERS.save,
      all:window.WORKERS.all,
      dataGo:window.DATA_MANAGEMENT_NAV.go,
      navGo:window.NAV.go
    };
    window.__smokeWorkers=[];
    window.WORKERS.all=()=>window.__smokeWorkers;
    window.WORKERS.save=(rows)=>{window.__smokeWorkers=rows;};
    window.CANONICAL_ROUTE_LEDGER={
      availableMonths:async()=>['202606'],
      buildMonth:async()=>({routes:[{
        routeId:'SMOKE-ROUTE',date:'2026-06-01',headNumber:'SMOKE-HEAD',
        worker:'SMOKE WORKER',workerRegistered:false,companyName:'',
        operationType:'',count:1,sales:12500,payment:7400,margin:5100,slipRows:[],linkLevel:'未照合'
      }]})
    };
    window.DATA_MANAGEMENT_NAV.go=(name)=>{
      window.__smokeWorkerDestination=name;
      window.WORKER_MASTER_UI.render();
    };
    window.NAV.go=(name)=>{window.__smokeReturnDestination=name;};
  });
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.render());
  await page.waitForFunction(()=>document.querySelector('#route-ym-select')?.value==='202606');
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.openDetail('SMOKE-ROUTE'));
  const unconfirmedKpis=await page.locator('#route-detail-modal .route-detail-kpis').innerText();
  if(!unconfirmedKpis.includes('― / ―'))
    throw Error('Unconfirmed route must not display calculated profit');
  const beforeMoney=await page.locator('#route-detail-modal').innerText();
  const beforeKpis=await page.locator('#route-detail-modal .route-detail-kpis').innerText();
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.closeDetail());
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.registerRouteWorker('SMOKE-ROUTE'));
  if(await page.locator('#worker-master-table tr[data-worker-row] .wm-name').last().inputValue()!=='SMOKE WORKER')
    throw Error('Route worker name was not prefilled');
  await page.locator('#worker-master-table tr[data-worker-row]').last().locator('.wm-code').fill('SMOKE001');
  await page.evaluate(()=>window.WORKER_MASTER_UI.save());
  if(!await page.getByText('配送分析に戻って再照合').count())
    throw Error('Return to route analysis action missing after save');
  await page.getByText('配送分析に戻って再照合').click();
  const result=await page.evaluate(()=>({
    destination:window.__smokeReturnDestination,
    month:window.STATE.selYM,
    pending:window.ROUTE_ANALYSIS_UI.hasPendingWorkerReturn(),
    saved:window.__smokeWorkers.some(x=>x.workerName==='SMOKE WORKER')
  }));
  if(result.destination!=='route-analysis'||result.month!=='202606'||result.pending||!result.saved)
    throw Error('Route return flow failed: '+JSON.stringify(result));
  console.log('PASS: route -> prefilled worker -> in-memory save -> return to selected month');
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.render());
  await page.waitForFunction(()=>document.querySelector('#route-ym-select')?.value==='202606');
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.openDetail('SMOKE-ROUTE'));
  const diagnostic=await page.locator('#route-detail-modal').innerText();
  const afterKpis=await page.locator('#route-detail-modal .route-detail-kpis').innerText();
  if(afterKpis!==beforeKpis) throw Error('Route financial KPIs changed after worker registration: '+JSON.stringify({beforeKpis,afterKpis}));
  for(const amount of ['12,500','7,400']){
    if(!beforeMoney.includes(amount)||!diagnostic.includes(amount))
      throw Error('Financial amount changed or disappeared after worker registration: '+amount);
  }
  if(!diagnostic.includes('作業者マスタ：登録済み') || diagnostic.includes('作業者マスタで登録・確認'))
    throw Error('Worker was not positively confirmed as registered after save');
  if(!diagnostic.includes('傭車支払') || !diagnostic.includes('売上'))
    throw Error('Route financial fields disappeared after worker registration');
  if(!diagnostic.includes('売上・利益：未確定・要照合'))
    throw Error('Worker registration must not falsely confirm revenue or profit');
  console.log('PASS: saved worker no longer appears as unregistered in route detail');
  // A registration starting after the delivery date must not count as registered.
  await page.evaluate(()=>{
    window.__smokeWorkers=window.__smokeWorkers.map(r=>r.workerName==='SMOKE WORKER'?{...r,validFrom:'2026-07-01'}:r);
    window.ROUTE_ANALYSIS_UI.closeDetail();
  });
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.render());
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.openDetail('SMOKE-ROUTE'));
  const expiredDiagnostic=await page.locator('#route-detail-modal').innerText();
  if(!expiredDiagnostic.includes('作業者マスタ：未登録・照合不可'))
    throw Error('Future-effective worker incorrectly matched to June route');
  console.log('PASS: worker validity period respected');

  const rowsBeforeDuplicate=await page.locator('#worker-master-table tr[data-worker-row]').count();
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.registerRouteWorker('SMOKE-ROUTE'));
  const rowsAfterDuplicate=await page.locator('#worker-master-table tr[data-worker-row]').count();
  if(rowsAfterDuplicate!==rowsBeforeDuplicate)
    throw Error('Existing worker outside validity period was duplicated');
  console.log('PASS: existing worker outside validity period is not duplicated');


  // A registration ending before the delivery date must also be rejected.
  await page.evaluate(()=>{
    window.__smokeWorkers=window.__smokeWorkers.map(r=>r.workerName==='SMOKE WORKER'?{...r,validFrom:'',validTo:'2026-05-31'}:r);
  });
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.render());
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.openDetail('SMOKE-ROUTE'));
  const endedDiagnostic=await page.locator('#route-detail-modal').innerText();
  if(!endedDiagnostic.includes('作業者マスタ：未登録・照合不可'))
    throw Error('Expired worker incorrectly matched to June route');
  console.log('PASS: expired worker registration rejected');

  // Boundary date: a worker whose registration starts on the delivery day is valid.
  await page.evaluate(()=>{
    window.__smokeWorkers=window.__smokeWorkers.map(r=>r.workerName==='SMOKE WORKER'?{...r,validFrom:'2026-06-01',validTo:'2026-06-01'}:r);
  });
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.render());
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.openDetail('SMOKE-ROUTE'));
  const boundaryDiagnostic=await page.locator('#route-detail-modal').innerText();
  if(!boundaryDiagnostic.includes('作業者マスタ：登録済み'))
    throw Error('Worker registration boundaries should be inclusive');
  console.log('PASS: worker validity boundary dates inclusive');
  // Confirmed profitability is shown only when the source explicitly marks it confirmed.
  await page.evaluate(()=>{
    window.CANONICAL_ROUTE_LEDGER.buildMonth=async()=>({routes:[{
      routeId:'SMOKE-CONFIRMED',date:'2026-06-01',headNumber:'SMOKE-CONFIRMED-HEAD',
      worker:'SMOKE WORKER',workerRegistered:false,companyName:'',
      operationType:'',count:1,sales:12500,payment:7400,margin:5100,
      profitabilityConfirmed:true,paymentStatus:'KNOWN',slipRows:[],linkLevel:'未照合'
    }]});
  });
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.render());
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.openDetail('SMOKE-CONFIRMED'));
  const confirmedDiagnostic=await page.locator('#route-detail-modal').innerText();
  if(!confirmedDiagnostic.includes('5,100円')||!confirmedDiagnostic.includes('40.8%')||
     !confirmedDiagnostic.includes('売上・利益：連動確定'))
    throw Error('Explicitly confirmed profit must remain visible with correct margin rate');
  console.log('PASS: confirmed profit and margin rate displayed only when confirmed');

  // A confirmed zero-sales route must open without a null margin-rate crash.
  await page.evaluate(()=>{
    window.CANONICAL_ROUTE_LEDGER.buildMonth=async()=>({routes:[{
      routeId:'SMOKE-ZERO-SALES',date:'2026-06-01',headNumber:'SMOKE-ZERO',
      worker:'SMOKE WORKER',workerRegistered:true,companyName:'',
      operationType:'',count:1,sales:0,payment:0,margin:0,
      profitabilityConfirmed:true,paymentStatus:'ZERO_PAYMENT',slipRows:[],linkLevel:'未照合'
    }]});
  });
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.render());
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.openDetail('SMOKE-ZERO-SALES'));
  const zeroSalesKpis=await page.locator('#route-detail-modal .route-detail-kpis').innerText();
  if(!zeroSalesKpis.includes('0円 / ―'))
    throw Error('Zero-sales route should show undefined margin rate, not crash');
  console.log('PASS: confirmed zero-sales route detail renders safely');

  // Missing subcontractor source must remain explicitly unconfirmed, not a numeric zero.
  await page.evaluate(()=>{
    window.CANONICAL_ROUTE_LEDGER.buildMonth=async()=>({routes:[{
      routeId:'SMOKE-NO-PAYMENT-SOURCE',date:'2026-06-01',headNumber:'SMOKE-NO-SOURCE',
      worker:'SMOKE WORKER',workerRegistered:true,companyName:'',
      operationType:'',count:1,sales:12500,payment:0,margin:12500,
      profitabilityConfirmed:false,paymentStatus:'SOURCE_NOT_REGISTERED',
      slipRows:[],linkLevel:'未照合'
    }]});
  });
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.render());
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.openDetail('SMOKE-NO-PAYMENT-SOURCE'));
  const noPaymentSource=await page.locator('#route-detail-modal').innerText();
  if(!noPaymentSource.includes('傭車料SOURCE未登録')||
     !noPaymentSource.includes('売上・利益：未確定・要照合')||
     !noPaymentSource.includes('― / ―'))
    throw Error('Missing payment source must not be treated as zero or confirmed profit');
  console.log('PASS: missing subcontractor payment source remains unconfirmed');

  // Contradictory flags must fail closed: profit cannot be confirmed without payment evidence.
  await page.evaluate(()=>{
    window.CANONICAL_ROUTE_LEDGER.buildMonth=async()=>({routes:[{
      routeId:'SMOKE-CONFLICT',date:'2026-06-01',headNumber:'SMOKE-CONFLICT',
      worker:'SMOKE WORKER',workerRegistered:true,companyName:'',
      operationType:'',count:1,sales:12500,payment:0,margin:12500,
      profitabilityConfirmed:true,paymentStatus:'SOURCE_NOT_REGISTERED',
      slipRows:[],linkLevel:'完全連動'
    }]});
  });
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.render());
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.openDetail('SMOKE-CONFLICT'));
  const conflict=await page.locator('#route-detail-modal').innerText();
  if(!conflict.includes('売上・利益：未確定・要照合')||!conflict.includes('― / ―'))
    throw Error('Conflicting profit flag must not override unresolved payment source');
  console.log('PASS: unresolved payment overrides contradictory profit confirmation');

  // Route identifiers containing apostrophes must open from the actual table click.
  await page.evaluate(()=>{
    window.CANONICAL_ROUTE_LEDGER.buildMonth=async()=>({routes:[{
      routeId:"SMOKE-'QUOTE",date:'2026-06-01',headNumber:'SMOKE-QUOTE',
      worker:'SMOKE WORKER',workerRegistered:true,companyName:'',
      operationType:'',count:1,sales:12500,payment:7400,margin:5100,
      profitabilityConfirmed:true,paymentStatus:'KNOWN',
      slipRows:[],linkLevel:'完全連動'
    }]});
  });
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.render());
  await page.locator('#route-tbody tr').first().evaluate(el=>el.click());
  const quoteDetail=await page.locator('#route-detail-modal').innerText();
  if(!quoteDetail.includes('SMOKE-QUOTE'))
    throw Error('Quoted route identifier failed to open from table');
  console.log('PASS: apostrophe in route identifier opens detail safely');

  await page.evaluate(()=>{
    window.ROUTE_ANALYSIS_UI.closeDetail();
    window.CANONICAL_ROUTE_LEDGER.buildMonth=async()=>({
      routes:[{
        routeId:'SMOKE-DIAG',date:'2026-06-06',headNumber:'3812456303',
        worker:'SMOKE WORKER',workerRegistered:true,companyName:'',
        operationType:'',count:1,sales:12500,payment:0,margin:12500,
        profitabilityConfirmed:false,paymentStatus:'NO_RECORD',
        slipRows:[],linkLevel:'未照合'
      }],
      diagnostics:{
        sourceStatus:{deliveryPdf:true,workerCsv:true,productCsv:true,headPayment:true},
        unmatchedSalesDetails:[{date:'2026-06-06',headNumber:'3812456303',status:'PARTIAL_MATCH',slipNos:['500026659650']}],
        unmatchedPaymentDetails:[{date:'2026-06-06',headNumber:'3812456303',status:'NO_RECORD'}],
        unregisteredWorkers:[],unmatchedRouteSlipCount:1,routesWithoutPayment:1
      }
    });
  });
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.render());
  const diagnosticButtons=page.locator('#route-diagnostic button');
  if(await diagnosticButtons.count()!==2)
    throw Error('Expected separate sales and payment diagnostic route buttons');
  await diagnosticButtons.first().evaluate(el=>el.click());
  const diagnosticDetail=await page.locator('#route-detail-modal').innerText();
  if(!diagnosticDetail.includes('3812456303'))
    throw Error('Sales diagnostic button failed to open matching route');
  await page.evaluate(()=>window.ROUTE_ANALYSIS_UI.closeDetail());
  await diagnosticButtons.last().evaluate(el=>el.click());
  const paymentDetail=await page.locator('#route-detail-modal').innerText();
  if(!paymentDetail.includes('傭車料資料に該当なし'))
    throw Error('Payment diagnostic button failed to open route details');
  console.log('PASS: sales and payment diagnostic entries open matching route details');










  await page.evaluate(()=>{
    const o=window.__smokeOriginal;
    window.CANONICAL_ROUTE_LEDGER=o.canonical;
    window.WORKERS.save=o.save;
    window.WORKERS.all=o.all;
    window.DATA_MANAGEMENT_NAV.go=o.dataGo;
    window.NAV.go=o.navGo;
  });
  if(errors.length)console.log('Non-blocking page errors:',errors.slice(0,5));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
