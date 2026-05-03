/* jp_zip_loader.js : 全国郵便番号マスタ 分割読込ローダー
   使い方：
   <script src="jp_zip_loader.js"></script>
   <script src="field_area.js"></script>

   field_area.js側から window.JP_ZIP_LOADER.loadForZips([...]) を呼び、
   必要な先頭2桁分のマスタだけ読み込みます。
*/
(function(){
  'use strict';

  window.JP_ZIP_PARTS = window.JP_ZIP_PARTS || {};

  const loaded = new Set();
  const loading = new Map();

  function normalizeZip(v){
    const s = String(v ?? '').normalize('NFKC').replace(/[^0-9]/g,'');
    return s.length >= 7 ? s.slice(0,7) : '';
  }

  function scriptBase(){
    const scripts = Array.from(document.getElementsByTagName('script'));
    const me = scripts.find(s => (s.src || '').includes('jp_zip_loader.js'));
    if (!me || !me.src) return '';
    return me.src.replace(/jp_zip_loader\.js(?:\?.*)?$/, '');
  }

  function loadPart(prefix){
    if (!prefix) return Promise.resolve();
    if (loaded.has(prefix) || window.JP_ZIP_PARTS[prefix]) {
      loaded.add(prefix);
      return Promise.resolve();
    }
    if (loading.has(prefix)) return loading.get(prefix);

    const p = new Promise((resolve, reject)=>{
      const s = document.createElement('script');
      s.src = scriptBase() + 'zip_parts/jp_zip_' + prefix + '.js';
      s.async = true;
      s.onload = () => {
        loaded.add(prefix);
        resolve();
      };
      s.onerror = () => {
        reject(new Error('郵便番号マスタ分割ファイルを読み込めません: ' + s.src));
      };
      document.head.appendChild(s);
    });

    loading.set(prefix, p);
    return p;
  }

  async function loadForZips(zips){
    const prefixes = [...new Set((zips || [])
      .map(normalizeZip)
      .filter(Boolean)
      .map(z => z.slice(0,2)))];

    await Promise.all(prefixes.map(loadPart));
    return true;
  }

  function get(zipRaw){
    const zip = normalizeZip(zipRaw);
    if (!zip) return null;
    const part = window.JP_ZIP_PARTS[zip.slice(0,2)];
    return part ? part[zip] || null : null;
  }

  window.JP_ZIP_LOADER = {
    loadForZips,
    get,
    normalizeZip,
    loadedPrefixes: () => Array.from(loaded).sort()
  };
})();
