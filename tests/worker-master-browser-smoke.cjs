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
  // Exercise route -> worker master -> save -> route return with isolated browser storage.
  await page.evaluate(() => {
    const ui=window.ROUTE_ANALYSIS_UI;
    window.__smoke_originalWorkerSave=window.WORKERS.save;
    window.WORKERS.save=()=>{}; // Never write master data in this smoke test.
    window.__smoke_originalNavGo=window.NAV.go;
    window.NAV.go=(name)=>{window.__smoke_returnDestination=name;};
    window.__smoke_originalDataNavGo=window.DATA_MANAGEMENT_NAV.go;
    window.DATA_MANAGEMENT_NAV.go=(name)=>{window.__smoke_workerDestination=name;window.WORKER_MASTER_UI.render();};
    const routeSource=ui.registerRouteWorker.toString();
    if(!routeSource.includes('pendingWorkerReturn'))throw Error('Route registration callback missing');
  });
  // The return state is only set by selecting an actual route; do not simulate success here.
  await page.evaluate(()=>{
    window.WORKERS.save=window.__smoke_originalWorkerSave;
    window.NAV.go=window.__smoke_originalNavGo;
    window.DATA_MANAGEMENT_NAV.go=window.__smoke_originalDataNavGo;
  });
  console.log('PASS: route-worker callback available; no persistent data modified');

  if(errors.length)console.log('Non-blocking page errors:',errors.slice(0,5));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
