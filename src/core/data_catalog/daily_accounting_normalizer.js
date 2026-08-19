/* Version6 M2-2: SKDL0001 -> PL_DAILY_ACTUAL Normalizer */
'use strict';
(function(){
  if(window.__DAILY_ACCOUNTING_NORMALIZER_LOADED_20260819__) return;
  window.__DAILY_ACCOUNTING_NORMALIZER_LOADED_20260819__=true;
  const clean=v=>String(v??'').trim(), header=v=>clean(v).replace(/[\s　\u3000]/g,'');
  function dateValue(v){const raw=clean(v),d=raw.replace(/[^0-9]/g,'');if(d.length>=8)return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;const m=raw.match(/(20\d{2})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);return m?`${m[1]}-${String(+m[2]).padStart(2,'0')}-${String(+m[3]).padStart(2,'0')}`:null;}
  function amountValue(v){const raw=clean(v).replace(/,/g,'').replace(/[円千]/g,'').replace(/[^\d.\-]/g,'');if(!raw||raw==='-'||raw==='.')return null;const n=Number(raw);return Number.isFinite(n)?n:null;}
  function categoryFor(label){const s=header(label),cfg=(typeof CONFIG!=='undefined'&&CONFIG)||window.CONFIG||{};if((cfg.INCOME_KEYS||[]).includes(s)||(cfg.INCOME_SUB_KEYS||[]).includes(s))return'REVENUE';if((cfg.LABOR_KEYS||[]).includes(s)||s==='運行旅費')return'LABOR';if((cfg.YOSHA_KEYS||[]).includes(s))return'YOSHA';if((cfg.EXPENSE_KEYS||[]).includes(s))return'OTHER_EXPENSE';return null;}
  function normalizeRows(rows,meta={}){const src=Array.isArray(rows)?rows:[];if(!src.length)return[];const h=src[0].map(header),dc=h.indexOf('計上日'),lc=h.findIndex(v=>v==='収支科目名'||v==='経費計上先収支科目名'),ac=h.indexOf('金額');if(dc<0||lc<0||ac<0)throw new Error('PL_DAILY_ACTUAL_REQUIRED_COLUMNS_MISSING');const file=clean(meta.source_file_id||meta.file_name)||'UNSPECIFIED_FILE',out=[];for(let i=1;i<src.length;i++){const r=src[i],date=dateValue(r?.[dc]),account=header(r?.[lc]);if(!date||!account)continue;const category=categoryFor(account);if(!category)continue;const amount=amountValue(r?.[ac]);out.push({document_type:'PL_DAILY_ACTUAL',source_file_id:meta.source_file_id||meta.file_name||null,source_record_id:`PL_DAILY_ACTUAL:${file}:${i+1}`,source_row_index:i+1,accounting_date:date,year_month:date.slice(0,7).replace('-',''),account_name:account,category,amount,amount_known:amount!==null});}return out;}
  window.DAILY_ACCOUNTING_NORMALIZER=Object.freeze({normalizeRows,dateValue,amountValue,categoryFor});
})();
