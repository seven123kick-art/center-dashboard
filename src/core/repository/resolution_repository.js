/* ============================================================================
   Version6 D3-5B: ResolutionRepository
   ----------------------------------------------------------------------------
   人が確定したResolution Decisionの永続化境界。

   正本 : Supabase DB center_realtime_state の独立state_key
   cache: IndexedDB IDB_CACHE（Repository.Storage経由）

   重要:
   - full_state / STATE へResolutionを混在させない。
   - Supabaseへの保存成功を確認してからIndexedDB cacheを更新する。
   - cache保存失敗は正本保存の失敗とは扱わない。
   - Decisionは削除・上書きではなく、RESOLUTION_LEDGERのACTIVE/REVOKED/
     supersedes履歴として配列全体を保存する。
   - D3-5Cでデータ確認UIの保存フローから正式に利用する。
============================================================================ */
'use strict';
(function(){
  if(window.__RESOLUTION_REPOSITORY_LOADED_20260817__) return;
  window.__RESOLUTION_REPOSITORY_LOADED_20260817__=true;

  const STATE_KEY='resolution_decisions_v1';
  const CACHE_KIND='resolution';
  const CACHE_ID='decisions_v1';
  const clone=v=>JSON.parse(JSON.stringify(v));
  const arr=v=>Array.isArray(v)?v:[];

  function requireLedger(){
    if(!window.RESOLUTION_LEDGER) throw new Error('[ResolutionRepository] RESOLUTION_LEDGER is required.');
    return window.RESOLUTION_LEDGER;
  }
  function requireCloud(){
    const x=window.Repository?.Cloud;
    if(!x?.fetchRealtimeState||!x?.pushRealtimeState) throw new Error('[ResolutionRepository] Repository.Cloud realtime-state API is required.');
    return x;
  }
  function storage(){ return window.Repository?.Storage || null; }

  function normalizeRows(rows){
    const ledger=requireLedger();
    return arr(rows).map(x=>ledger.normalizeDecision(x));
  }
  function validateRows(rows){
    const ledger=requireLedger(), normalized=normalizeRows(rows), errors=[];
    const ids=new Set();
    normalized.forEach((x,i)=>{
      const v=ledger.validateDecision(x);
      if(!v.ok) errors.push(...v.errors.map(e=>`[${i}] ${e}`));
      if(x.resolution_decision_id){
        if(ids.has(x.resolution_decision_id)) errors.push(`[${i}] resolution_decision_idが重複しています: ${x.resolution_decision_id}`);
        ids.add(x.resolution_decision_id);
      }
    });
    return {ok:errors.length===0,errors,rows:normalized};
  }
  function envelope(rows,meta={}){
    return {schema_version:1,kind:'RESOLUTION_DECISIONS',center_id:window.CENTER?.id||null,saved_at:meta.saved_at||new Date().toISOString(),decisions:normalizeRows(rows)};
  }
  function unpack(payload){
    if(!payload||typeof payload!=='object') return [];
    return normalizeRows(payload.decisions);
  }

  async function load(options={}){
    const preferCache=options.preferCache===true, st=storage();
    if(preferCache&&st?.getCached){
      const c=await st.getCached(CACHE_KIND,CACHE_ID);
      if(c) return {ok:true,source:'CACHE',decisions:unpack(c),envelope:clone(c)};
    }
    const row=await requireCloud().fetchRealtimeState(STATE_KEY);
    if(!row){
      if(st?.getCached){
        const c=await st.getCached(CACHE_KIND,CACHE_ID);
        if(c) return {ok:true,source:'CACHE_FALLBACK',decisions:unpack(c),envelope:clone(c)};
      }
      return {ok:true,source:'EMPTY',decisions:[],envelope:null};
    }
    const env=row.payload||null, decisions=unpack(env);
    if(st?.setCached){ try{ await st.setCached(CACHE_KIND,CACHE_ID,env); }catch(e){ console.warn('[ResolutionRepository] cache refresh failed',e); } }
    return {ok:true,source:'CLOUD',updated_at:row.updated_at||null,decisions,envelope:clone(env)};
  }

  async function save(rows,meta={}){
    const v=validateRows(rows);
    if(!v.ok) return {ok:false,error:'VALIDATION_ERROR',errors:v.errors};
    const env=envelope(v.rows,meta);
    const result=await requireCloud().pushRealtimeState(STATE_KEY,env);
    if(!result?.ok) return {ok:false,error:result?.error||'CLOUD_SAVE_FAILED'};
    let cache_ok=null;
    const st=storage();
    if(st?.setCached){ try{ cache_ok=await st.setCached(CACHE_KIND,CACHE_ID,env); }catch(e){ cache_ok=false; } }
    return {ok:true,source:'CLOUD',updated_at:result.updated_at||env.saved_at,cache_ok,envelope:clone(env)};
  }

  async function appendDecision(decision,meta={}){
    const current=await load();
    if(!current.ok) return current;
    const next=[...current.decisions,clone(decision)];
    return save(next,meta);
  }

  async function revokeDecision(id,revokeMeta={},saveMeta={}){
    const current=await load();
    if(!current.ok) return current;
    const r=requireLedger().revoke(current.decisions,id,revokeMeta);
    if(!r.ok) return r;
    const saved=await save(r.decisions,saveMeta);
    return saved.ok?Object.assign({},saved,{revoked:r.revoked}):saved;
  }

  window.RESOLUTION_REPOSITORY=Object.freeze({STATE_KEY,CACHE_KIND,CACHE_ID,validateRows,envelope,unpack,load,save,appendDecision,revokeDecision});
})();
