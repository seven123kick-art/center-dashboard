/* ledger.js : 原票・便を中心にした共通統合レイヤー */
'use strict';
(function(){
  if (window.LEDGER) return;

  const arr = v => Array.isArray(v) ? v : [];
  const text = v => String(v ?? '').trim();
  const exact = v => String(v ?? '');
  const num = v => Number(v || 0) || 0;
  const digits = v => String(v ?? '').replace(/\D/g,'');
  const dateKey = v => digits(v).slice(0,8);
  const ymKey = v => digits(v).slice(0,6);

  function workerRecord(ym){
    return arr(STATE.workerCsvData).find(x => x && x.ym === ym) || null;
  }
  function productRecord(ym){
    return arr(STATE.productAddressData).find(x => x && x.ym === ym) || null;
  }
  function routeRecord(ym){
    return arr(STATE.routeData).find(x => x && x.ym === ym) || null;
  }
  function paymentRows(ym){
    const list = arr(STATE.datasets).filter(x => x && x.ym === ym && Array.isArray(x.routePayments));
    const confirmed = list.find(x => (x.type || 'confirmed') === 'confirmed');
    const daily = list.find(x => (x.type || 'confirmed') === 'daily');
    return arr((confirmed || daily || {}).routePayments);
  }

  function workerIndex(ym){
    const byName = new Map();
    const bySlip = new Map();
    const workers = workerRecord(ym)?.workers || {};
    Object.values(workers).forEach(worker => {
      const name = text(worker?.name);
      if (!name) return;
      byName.set(name, worker);
      Object.values(worker?.slips || {}).forEach(s => {
        const slip = text(s?.slip);
        if (!slip || slip.startsWith('__row_')) return;
        const item = { ...s, worker:name };
        if (!bySlip.has(slip)) bySlip.set(slip, []);
        bySlip.get(slip).push(item);
      });
    });
    return { byName, bySlip };
  }

  function productIndex(ym){
    const map = new Map();
    arr(productRecord(ym)?.tickets).forEach(t => {
      const slip = text(t?.slip);
      if (slip) map.set(slip, t);
    });
    return map;
  }

  function paymentsForRoute(payments, route){
    const head = digits(route.headNumber);
    const d = dateKey(route.date);
    const exact = payments.filter(p => digits(p?.headNumber) === head && (!d || !dateKey(p?.date) || dateKey(p?.date) === d));
    if (exact.length) return exact;
    return payments.filter(p => digits(p?.headNumber) === head);
  }

  function slipsForRoute(route, worker){
    const explicit = [...new Set(arr(route.slips).map(text).filter(Boolean))];
    if (explicit.length) return { slips:explicit, mode:'原票一致' };
    if (!worker) return { slips:[], mode:'作業者未一致' };
    const d = dateKey(route.date);
    const inferred = Object.values(worker.slips || {})
      .filter(s => !d || dateKey(s?.date) === d)
      .map(s => text(s?.slip))
      .filter(s => s && !s.startsWith('__row_'));
    return { slips:[...new Set(inferred)], mode:'作業者＋日付' };
  }

  function buildMonth(ym){
    const month = ymKey(ym);
    const routes = arr(routeRecord(month)?.routes);
    const workers = workerIndex(month);
    const products = productIndex(month);
    const payments = paymentRows(month);
    const routeRows = [];
    const ledgerRows = [];
    const usedWorkerSlips = new Set();
    const usedProductSlips = new Set();
    const usedPaymentKeys = new Set();

    routes.forEach((route, routeIndex) => {
      const workerName = exact(route.worker);
      const master = window.WORKERS?.find ? WORKERS.find(workerName, route.date) : null;
      // 作業者名は登録制の正式名称をそのままキーとして使用する。
      const worker = workers.byName.get(workerName) || null;
      const selected = slipsForRoute(route, worker);
      const payRows = paymentsForRoute(payments, route);
      payRows.forEach((p, i) => usedPaymentKeys.add(`${digits(p.headNumber)}|${dateKey(p.date)}|${p.accountCode || ''}|${p.amount}|${i}`));

      let sales = 0;
      let matchedCount = 0;
      const routeSlipRows = [];
      selected.slips.forEach(slip => {
        const candidates = workers.bySlip.get(slip) || [];
        const workerSlip = candidates.find(x => x.worker === workerName) || candidates[0] || null;
        const product = products.get(slip) || null;
        if (workerSlip) {
          usedWorkerSlips.add(`${workerSlip.worker}|${slip}`);
          sales += num(workerSlip.amount);
          matchedCount++;
        }
        if (product) usedProductSlips.add(slip);
        const rowDate = text(workerSlip?.date || product?.date || route.date);
        const ledgerRow = {
          ledgerId: `${CENTER.id}|${dateKey(rowDate) || month}|${slip}`,
          centerId: CENTER.id,
          ym: month,
          date: rowDate,
          routeId: `${dateKey(route.date)}|${digits(route.headNumber)}`,
          headNumber: digits(route.headNumber),
          workerName,
          companyName: exact(master?.companyName),
          operationType: exact(master?.operationType),
          workerRegistered: !!master,
          slip,
          sales: num(workerSlip?.amount),
          shipperCode: text(product?.shipperCode),
          shipperName: text(product?.shipperName),
          product: text(product?.product),
          category: text(product?.category),
          area: text(product?.area || product?.areaUnit),
          city: text(product?.city),
          works: product?.works || workerSlip?.works || {},
          workerMatched: !!workerSlip,
          productMatched: !!product,
          sourceMatchMode: selected.mode
        };
        ledgerRows.push(ledgerRow);
        routeSlipRows.push(ledgerRow);
      });

      const payment = payRows.reduce((s,p)=>s+num(p.amount),0);
      let status = selected.mode;
      if (!worker) status = '作業者未一致';
      else if (!selected.slips.length) status = '原票未取得';
      else if (!matchedCount) status = '売上未一致';
      else if (!payRows.length) status = '傭車費なし';
      else if (matchedCount < selected.slips.length) status = '一部原票未一致';

      routeRows.push({
        routeId: `${dateKey(route.date)}|${digits(route.headNumber)}`,
        ym: month,
        date: text(route.date),
        headNumber: digits(route.headNumber),
        worker: workerName,
        companyName: exact(master?.companyName),
        operationType: exact(master?.operationType),
        workerRegistered: !!master,
        slips: selected.slips,
        slipRows: routeSlipRows,
        count: matchedCount,
        listedCount: selected.slips.length,
        sales,
        payment,
        margin: sales-payment,
        avg: matchedCount ? sales/matchedCount : 0,
        status,
        matchMode: selected.mode,
        partner: text(payRows[0]?.partner),
        yoshaCode: text(payRows[0]?.yoshaCode),
        sourceRouteIndex: routeIndex
      });
    });

    const workerSlipTotal = [...workers.bySlip.values()].reduce((s,list)=>s+list.length,0);
    const matchedWorkerSlipCount = usedWorkerSlips.size;
    const routeSlipTotal = routeRows.reduce((s,r)=>s+r.listedCount,0);
    const matchedRouteSlipCount = routeRows.reduce((s,r)=>s+r.count,0);
    const sourceStatus = {
      routePdf: routes.length > 0,
      workerCsv: !!workerRecord(month),
      productCsv: !!productRecord(month),
      skdl0001: payments.length > 0
    };
    const diagnostics = {
      ym: month,
      sourceStatus,
      routeCount: routes.length,
      routeSlipTotal,
      matchedRouteSlipCount,
      unmatchedRouteSlipCount: Math.max(0, routeSlipTotal - matchedRouteSlipCount),
      workerSlipTotal,
      unmatchedWorkerSlipCount: Math.max(0, workerSlipTotal - matchedWorkerSlipCount),
      productSlipTotal: products.size,
      unmatchedProductSlipCount: Math.max(0, products.size - usedProductSlips.size),
      paymentRowTotal: payments.length,
      routesWithoutPayment: routeRows.filter(r=>r.status === '傭車費なし').length,
      routesWithoutWorker: routeRows.filter(r=>r.status === '作業者未一致').length,
      routesWithUnregisteredWorker: routeRows.filter(r=>r.worker && !r.workerRegistered).length,
      unregisteredWorkers: [...new Set(routeRows.filter(r=>r.worker && !r.workerRegistered).map(r=>r.worker))],
      routesWithoutSales: routeRows.filter(r=>r.status === '売上未一致' || r.status === '原票未取得').length,
      integrationRate: routeSlipTotal ? matchedRouteSlipCount / routeSlipTotal * 100 : 0
    };

    return { ym:month, rows:ledgerRows, routes:routeRows, diagnostics };
  }

  function availableMonths(){
    return [...new Set([
      ...arr(STATE.routeData).map(x=>x?.ym),
      ...arr(STATE.workerCsvData).map(x=>x?.ym),
      ...arr(STATE.productAddressData).map(x=>x?.ym),
      ...arr(STATE.datasets).map(x=>x?.ym)
    ].filter(Boolean))].sort();
  }

  function invalidate(){}
  window.LEDGER = { buildMonth, availableMonths, invalidate };
})();
