/* ════════ §19 RENDER — Capacity（完全安定版） ═══════════════════ */
const CAPACITY_UI = {
  _tab:'monthly',
  _lastRows:[],
  _lastDailyRows:[],

  ensureState() {
    STATE.capacity = STATE.capacity || {};
    STATE.capacity.areas = {}; // 旧Excelキャパは使用しない
    STATE.capacity.mapping = []; // 旧地区マッピングは使用しない
    STATE.capacity.calendar = STATE.capacity.calendar || {};
    STATE.capacity.shipperGroups = Array.isArray(STATE.capacity.shipperGroups) && STATE.capacity.shipperGroups.length ? STATE.capacity.shipperGroups : this.defaultShipperGroups();
    STATE.capacity.shipperAreaCaps = {}; // 旧地区別荷主キャパは使用しない
    STATE.capacity.capacityGroups = Array.isArray(STATE.capacity.capacityGroups) ? STATE.capacity.capacityGroups : [];
    this._capRegionFilter = this._capRegionFilter || 'saitama_all';
  },

  defaultShipperGroups() {
    return [
      { key:'kojima_bic', label:'コジマ＋ビック', patterns:'コジマ|ビック|ビックカメラ|BIC|KOJIMA', codePrefixes:'', active:true, sort:10 },
      { key:'denkichi', label:'でんきち', patterns:'でんきち|デンキチ', codePrefixes:'', active:true, sort:20 },
      { key:'edion', label:'エディオン', patterns:'エディオン|EDION', codePrefixes:'', active:true, sort:30 },
      { key:'other', label:'その他', patterns:'', codePrefixes:'', active:false, sort:99 }
    ];
  },

  migrateShipperCaps() {
    const cap = STATE.capacity || {};
    cap.shipperAreaCaps = cap.shipperAreaCaps || {};
    // 旧「荷主別1本キャパ」は、地区別キャパへは自動展開しない。二重計上防止のため参照だけ残す。
    (cap.shipperGroups || this.defaultShipperGroups()).forEach(g=>{
      cap.shipperAreaCaps[g.key] = cap.shipperAreaCaps[g.key] || {};
    });
  },

  normArea(v) {
    return String(v || '')
      .normalize('NFKC')
      .replace(/\s+/g,'')
      .replace(/_n/g,'_')
      .replace(/＿n/g,'_')
      .replace(/北\/板橋/g,'北/板')
      .trim();
  },

  n(v) {
    const x = Number(String(v ?? '').normalize('NFKC').replace(/,/g,'').replace(/[^\d.-]/g,''));
    return Number.isFinite(x) ? x : 0;
  },

  getYM() {
    return document.getElementById('capacity-ym')?.value ||
      (STATE.selYM || '') ||
      ((STATE.productAddressData || []).at(-1)?.ym) ||
      ((STATE.fieldData || []).at(-1)?.ym) ||
      (latestDS()?.ym) || '';
  },

  getDays() {
    // 週7稼働前提：月キャパは日別カレンダーを1日ずつ積み上げるため、手入力の稼働日数は使わない
    const ym = this.getYM();
    return this.daysInYM(ym) || 0;
  },

  getBaseMode() {
    return 'calendar';
  },

  ymDate(ym, d) {
    return `${String(ym).slice(0,4)}-${String(ym).slice(4,6)}-${String(d).padStart(2,'0')}`;
  },

  daysInYM(ym) {
    const y = Number(String(ym).slice(0,4));
    const m = Number(String(ym).slice(4,6));
    return new Date(y, m, 0).getDate();
  },

  dow(dateStr) {
    return new Date(dateStr + 'T00:00:00').getDay();
  },

  isWeekend(dateStr) {
    const d = this.dow(dateStr);
    return d === 0 || d === 6;
  },

  dateLabel(dateStr) {
    const d = this.dow(dateStr);
    return `${Number(dateStr.slice(5,7))}/${Number(dateStr.slice(8,10))}（${['日','月','火','水','木','金','土'][d]}）`;
  },

  parseDate(v, ym) {
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
      return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`;
    }
    const raw = String(v ?? '').normalize('NFKC').trim();
    if (!raw) return '';

    const serial = Number(raw);
    if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
      const dt = new Date(Math.round((serial - 25569) * 86400 * 1000));
      if (!Number.isNaN(dt.getTime())) {
        return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`;
      }
    }

    const nums = raw.replace(/[^0-9]/g,'');
    if (nums.length >= 8) return `${nums.slice(0,4)}-${nums.slice(4,6)}-${nums.slice(6,8)}`;
    if (nums.length >= 1 && nums.length <= 2 && ym) {
      const d = Number(nums);
      if (d >= 1 && d <= 31) return this.ymDate(ym, d);
    }
    return '';
  },

  ticketDate(t, ym) {
    const d = this.parseDate(t.date || t.deliveryDate || t.workDate || t['日付'] || t['作業日'] || t['配達完了日'], ym);
    if (d) return d;
    const row = t.representativeRow || t.firstRow || t.row || t.raw;
    if (Array.isArray(row)) {
      const d2 = this.parseDate(row[0], ym);
      if (d2) return d2;
    }
    return '';
  },

  normalizeZip(v) {
    if (window.JP_ZIP_LOADER?.normalizeZip) return JP_ZIP_LOADER.normalizeZip(v);
    const s = String(v ?? '').replace(/[^0-9]/g,'');
    return s.length >= 7 ? s.slice(0,7) : '';
  },

  cityFromAddress(address) {
    const t = String(address || '').normalize('NFKC').replace(/\s+/g,'').trim();
    if (!t) return '未設定';

    const prefMatch = t.match(/^(北海道|東京都|(?:京都|大阪)府|.{2,3}県)/);
    const pref = prefMatch ? prefMatch[1] : '';
    const rest = pref ? t.slice(pref.length) : t;

    // さいたま市は同じ市内でも区ごとにキャパが違うため、区が住所に含まれる場合は最優先で区まで保持する。
    // 例：埼玉県さいたま市大宮区、さいたま大宮区、さいたま市桜区 など。
    const saitamaWardMatch = rest.match(/さいたま(?:市)?(西区|北区|大宮区|見沼区|中央区|桜区|浦和区|南区|緑区|岩槻区)/);
    if (saitamaWardMatch) return '埼玉県さいたま市' + saitamaWardMatch[1];

    // エリア分析側と同じ考え方：郵便番号が取れない場合でも、町域・番地ではなく行政区・市で止める。
    const known = [
      'さいたま市西区','さいたま市北区','さいたま市大宮区','さいたま市見沼区','さいたま市中央区',
      'さいたま市桜区','さいたま市浦和区','さいたま市南区','さいたま市緑区','さいたま市岩槻区',
      '蕨市','戸田市','川口市','朝霞市','和光市','志木市','新座市','富士見市','ふじみ野市',
      '川越市','所沢市','狭山市','上尾市','桶川市','北本市','鴻巣市','入間市','草加市','越谷市',
      '熊谷市','本庄市','深谷市','秩父市','行田市','加須市','羽生市','久喜市','蓮田市','幸手市','白岡市',
      '板橋区','北区','豊島区','練馬区','文京区','足立区','荒川区','台東区','江東区','大田区',
      '世田谷区','新宿区','港区','墨田区','品川区','目黒区','中野区','杉並区','渋谷区','中央区','千代田区'
    ];
    for (const name of known) {
      if (rest.startsWith(name)) return pref + name;
    }

    // 「蕨中央5-」「戸田美女木」など、市名の「市」が落ちた住所を補正する。
    const saitamaFallbacks = [
      ['蕨','蕨市'],['戸田','戸田市'],['川口','川口市'],['朝霞','朝霞市'],['和光','和光市'],['志木','志木市'],['新座','新座市'],
      ['富士見','富士見市'],['ふじみ野','ふじみ野市'],['上尾','上尾市'],['桶川','桶川市'],['北本','北本市'],['鴻巣','鴻巣市'],
      ['熊谷','熊谷市'],['深谷','深谷市'],['本庄','本庄市'],['秩父','秩父市']
    ];
    if (!pref || pref === '埼玉県') {
      for (const [head, city] of saitamaFallbacks) {
        if (rest.startsWith(head)) return '埼玉県' + city;
      }
    }

    const tokyoFallbacks = [
      ['板橋','板橋区'],['北','北区'],['豊島','豊島区'],['練馬','練馬区'],['文京','文京区'],['足立','足立区'],['荒川','荒川区'],
      ['台東','台東区'],['江東','江東区'],['大田','大田区'],['世田谷','世田谷区'],['新宿','新宿区'],['港','港区'],['墨田','墨田区'],
      ['品川','品川区'],['目黒','目黒区'],['中野','中野区'],['杉並','杉並区'],['渋谷','渋谷区'],['中央','中央区'],['千代田','千代田区']
    ];
    if (pref === '東京都') {
      for (const [head, ward] of tokyoFallbacks) {
        if (rest.startsWith(head)) return '東京都' + ward;
      }
    }

    const wardCity = rest.match(/^(.+?市.+?区)/);
    if (wardCity) return pref + wardCity[1];
    const muni = rest.match(/^(.+?[市区町村])/);
    if (muni) return pref + muni[1];
    return '未設定';
  },

  cityFromZip(zip) {
    const z = this.normalizeZip(zip);
    if (!z) return '';
    let hit = null;
    if (window.JP_ZIP_LOADER?.get) hit = JP_ZIP_LOADER.get(z);
    else if (window.JP_ZIP_MASTER) hit = JP_ZIP_MASTER[z];
    if (!hit) return '';
    if (Array.isArray(hit)) return String(hit[0]||'') + String(hit[1]||'');
    if (typeof hit === 'object') return String(hit.pref || hit.prefecture || hit[0] || '') + String(hit.city || hit.municipality || hit.addr1 || hit[1] || '');
    return this.cityFromAddress(String(hit));
  },

  ticketCity(t) {
    // エリア分析と同じく、過去に生成された t.area / t.city は粗い値が残ることがあるため最優先しない。
    // ただし、さいたま市は郵便番号マスタが未ロード／粗い値の場合に「さいたま市」止まりになるため、
    // 住所に区が入っている場合は住所側を優先し、区単位を維持する。
    const row = t.representativeRow || t.firstRow || t.row || t.raw;
    const isCoarseSaitama = (v) => /^埼玉県さいたま市?$/.test(String(v || '').normalize('NFKC').replace(/\s+/g,''));

    const addr = t.address || t.addr || t.destinationAddress ||
      t['住所'] || t['届け先住所'] || t['配送先住所'] || t['お届け先住所'] ||
      (Array.isArray(row) ? row[13] : '');
    const addrCity = this.normalizeCapacityUnit(this.cityFromAddress(addr));
    if (addrCity && addrCity !== '未設定' && !isCoarseSaitama(addrCity)) return addrCity;

    const zip = this.normalizeZip(
      t.zip || t.zipcode || t.postCode || t.postalCode ||
      t['お届け先郵便番号'] || t['届け先郵便番号'] || t['郵便番号'] ||
      (Array.isArray(row) ? row[11] : '')
    );
    const zipCity = this.normalizeCapacityUnit(this.cityFromZip(zip));
    if (zipCity && zipCity !== '未設定' && !isCoarseSaitama(zipCity)) return zipCity;

    if (t.pref && t.city && t.ward) {
      const prefCityWard = this.normalizeCapacityUnit(String(t.pref) + String(t.city) + String(t.ward));
      if (prefCityWard && prefCityWard !== '未設定' && !isCoarseSaitama(prefCityWard)) return prefCityWard;
    }
    if (t.pref && t.city) {
      const prefCity = this.normalizeCapacityUnit(String(t.pref) + String(t.city));
      if (prefCity && prefCity !== '未設定' && !isCoarseSaitama(prefCity)) return prefCity;
    }

    const oldCity = this.normalizeCapacityUnit(t.city || t.area || '');
    if (oldCity && oldCity !== '未設定' && !isCoarseSaitama(oldCity)) return oldCity;

    // どうしても区が取れない場合だけ粗いさいたま市を返す。
    // 荷主キャパ設定側では区単位を優先するため、通常は郵便番号マスタ読込後に区へ分解される。
    if (addrCity && addrCity !== '未設定') return addrCity;
    if (zipCity && zipCity !== '未設定') return zipCity;
    if (oldCity && oldCity !== '未設定') return oldCity;

    return '未設定';
  },

  ticketSlip(t, idx) {
    return String(t.slip || t.slipNo || t.ticketNo || t.invoiceNo || t['原票番号'] || t['エスライン原票番号'] || '').trim() || `no_${idx}`;
  },

  confirmedShipperInfoBySlip(slip, ym) {
    const key = String(slip || '').trim();
    if (!key) return null;
    const list = (STATE.datasets || []).filter(d=>!ym || d.ym === ym);
    for (const ds of list) {
      const map = ds && ds.confirmedSlipSales;
      if (!map || typeof map !== 'object') continue;
      const hit = map[key] || map[key.replace(/^0+/, '')];
      if (!hit) continue;
      const name = String(hit.shipperName || hit.clientName || hit.name || '').trim();
      const code = String(hit.shipperCode || hit.clientCode || hit.code || '').trim();
      if (name || code) return { name, code };
    }
    return null;
  },

  confirmedShipperBySlip(slip, ym) {
    const info = this.confirmedShipperInfoBySlip(slip, ym);
    return info?.name || '';
  },

  ticketShipperCode(t, slip='', ym='') {
    const direct = String(t.shipperCode || t.clientCode || t.customerCode || t['荷主コード'] || t['荷主基本コード'] || t['荷主ＣＤ'] || t['荷主CD'] || '').trim();
    if (direct) return direct;
    const row = t.representativeRow || t.firstRow || t.row || t.raw;
    if (Array.isArray(row)) {
      // 確定CSV標準：Y列=荷主基本コード。商品・住所CSV側に同等列がある場合も拾う。
      const candidates = [row[24], row[25], row[23]];
      for (const v of candidates) {
        const code = String(v || '').normalize('NFKC').replace(/[^0-9A-Za-z]/g,'').trim();
        if (code && /^\d{2,}/.test(code)) return code;
      }
    }
    return this.confirmedShipperInfoBySlip(slip || this.ticketSlip(t,0), ym)?.code || '';
  },

  ticketShipperName(t, slip='', ym='') {
    const direct = String(t.shipperName || t.shipper || t.clientName || t.customerName || t['荷主名'] || t['荷主名称'] || t['契約名'] || t['契約名称'] || '').trim();
    if (direct) return direct;

    const row = t.representativeRow || t.firstRow || t.row || t.raw;
    if (Array.isArray(row)) {
      // 確定CSVの標準位置：AA列=荷主名、AB列=契約名。商品・住所CSV側に同等列がある場合も拾う。
      const candidates = [row[26], row[27], row[25]];
      for (const v of candidates) {
        const name = String(v || '').normalize('NFKC').trim();
        if (name && !/^0+$/.test(name) && !/^\d{4,}$/.test(name)) return name;
      }
    }

    return this.confirmedShipperInfoBySlip(slip || this.ticketSlip(t, 0), ym)?.name || '未設定';
  },

  normalizeShipperGroup(name='', code='') {
    this.ensureState();
    const n = String(name || '').normalize('NFKC').toUpperCase();
    const c = String(code || '').normalize('NFKC').replace(/[^0-9A-Z]/g,'').toUpperCase();
    const groups = (STATE.capacity.shipperGroups || this.defaultShipperGroups()).slice().sort((a,b)=>this.n(a.sort)-this.n(b.sort));
    for (const g of groups) {
      if (g.key === 'other') continue;
      const codes = String(g.codePrefixes || '').split('|').map(x=>x.trim().toUpperCase()).filter(Boolean);
      if (c && codes.some(prefix=>c.startsWith(prefix))) return g.label || g.key;
      const pats = String(g.patterns || '').normalize('NFKC').toUpperCase().split('|').map(x=>x.trim()).filter(Boolean);
      if (pats.some(p=>n.includes(p))) return g.label || g.key;
    }
    return 'その他';
  },

  shipperGroupKeyByLabel(label) {
    this.ensureState();
    const g = (STATE.capacity.shipperGroups || []).find(x=>String(x.label) === String(label) || String(x.key) === String(label));
    return g?.key || 'other';
  },

  shipperGroupByKey(key) {
    this.ensureState();
    return (STATE.capacity.shipperGroups || []).find(x=>x.key === key) || { key:'other', label:'その他', active:false };
  },

  ticketShipper(t, slip='', ym='') {
    const name = this.ticketShipperName(t, slip, ym);
    const code = this.ticketShipperCode(t, slip, ym);
    return this.normalizeShipperGroup(name, code);
  },

  mappedArea(city) {
    const c = this.normalizeCapacityUnit(city);
    if (!c) return '未割当';
    const group = this.capacityGroupForUnit(c);
    return group ? (group.name || '未設定区分') : '未割当';
  },

  selectedProductRecord() {
    const ym = this.getYM();
    const list = STATE.productAddressData || [];
    return list.find(r=>r.ym === ym) || list.at(-1) || null;
  },

  buildActual() {
    const rec = this.selectedProductRecord();
    if (!rec || !Array.isArray(rec.tickets) || !rec.tickets.length) {
      return { ym:this.getYM(), source:'未取得', rawCount:0, tickets:[], byArea:new Map(), byDateArea:new Map(), unmatched:new Map(), hasDate:false };
    }
    const ym = rec.ym || this.getYM();
    const uniq = new Map();
    let hasDate = false;

    rec.tickets.forEach((t, idx)=>{
      const slip = this.ticketSlip(t, idx);
      const dt = this.ticketDate(t, ym);
      if (dt) hasDate = true;
      const date = dt || '';
      const city = this.ticketCity(t);
      const capGroup = this.capacityGroupForUnit(city);
      const area = capGroup ? (capGroup.name || '未設定区分') : '未区分';
      const shipperName = this.ticketShipperName(t, slip, ym);
      const shipperCode = this.ticketShipperCode(t, slip, ym);
      const shipper = this.normalizeShipperGroup(shipperName, shipperCode);
      const key = `${date || 'monthly'}__${slip}`;
      if (!uniq.has(key)) uniq.set(key, { slip, date, city, area, shipper, shipperName, shipperCode });
    });

    const tickets = [...uniq.values()];
    const byArea = new Map();
    const byDateArea = new Map();
    const unmatched = new Map();

    tickets.forEach(t=>{
      if (!byArea.has(t.area)) byArea.set(t.area,{ area:t.area, count:0, shippers:{}, cities:{} });
      const a = byArea.get(t.area);
      a.count++;
      a.shippers[t.shipper] = (a.shippers[t.shipper] || 0) + 1;
      a.cities[t.city] = (a.cities[t.city] || 0) + 1;

      if (t.area === '未分類') {
        const key = t.city || '未設定';
        unmatched.set(key, (unmatched.get(key) || 0) + 1);
      }

      if (hasDate && t.date) {
        const dk = `${t.date}__${t.area}`;
        if (!byDateArea.has(dk)) byDateArea.set(dk,{ date:t.date, area:t.area, count:0, cities:{}, shippers:{} });
        const d = byDateArea.get(dk);
        d.count++;
        d.cities[t.city] = (d.cities[t.city] || 0) + 1;
        d.shippers[t.shipper] = (d.shippers[t.shipper] || 0) + 1;
      }
    });

    // 日付がない月次CSVの場合は、月件数÷カレンダー日数で日別推定として展開する。
    if (!hasDate) {
      const days = this.daysInYM(ym);
      byArea.forEach(a=>{
        const avg = a.count / days;
        for (let d=1; d<=days; d++) {
          const date = this.ymDate(ym,d);
          byDateArea.set(`${date}__${a.area}`, { date, area:a.area, count:avg, cities:a.cities, shippers:a.shippers || {}, estimated:true });
        }
      });
    }

    return { ym, source:rec.files?.join(', ') || rec.source || 'productAddressData', rawCount:rec.rawRows || rec.detailRows || rec.tickets.length, tickets, byArea, byDateArea, unmatched, hasDate };
  },

  dayType(dateStr) {
    return STATE.capacity?.calendar?.[dateStr]?.type || 'normal';
  },

  dayAdj(dateStr) {
    return this.n(STATE.capacity?.calendar?.[dateStr]?.adjust || 0);
  },

  activeShipperGroups() {
    this.ensureState();
    return (STATE.capacity.shipperGroups || this.defaultShipperGroups())
      .filter(g=>g.active !== false && g.key !== 'other')
      .sort((a,b)=>this.n(a.sort)-this.n(b.sort));
  },

  hasValidCapacityGroups() {
    this.ensureState();
    return (STATE.capacity?.capacityGroups || []).some(g => {
      if (!Array.isArray(g.units) || !g.units.length) return false;
      return this.activeShipperGroups().some(sg =>
        this.n(g.capacity?.[sg.key]?.weekday) > 0 || this.n(g.capacity?.[sg.key]?.weekend) > 0
      );
    });
  },

  capacityGroupForUnit(unit) {
    this.ensureState();
    const normalized = this.normalizeCapacityUnit(unit);
    if (!normalized) return null;
    return (STATE.capacity.capacityGroups || []).find(g =>
      Array.isArray(g.units) && g.units.some(u => this.normalizeCapacityUnit(u) === normalized)
    ) || null;
  },

  getShipperAreaCap(groupKey, area, field) {
    const row = STATE.capacity?.shipperAreaCaps?.[groupKey]?.[area] || {};
    return this.n(row[field] ?? 0);
  },

  hasAnyShipperAreaCap(area='') {
    this.ensureState();
    const groups = STATE.capacity?.capacityGroups || [];
    if (!groups.length) return false;
    return groups.some(g => {
      if (!Array.isArray(g.units) || !g.units.length) return false;
      if (area && String(g.name || '') !== String(area)) return false;
      return this.capacityGroupDailyCap(g, this.ymDate(this.getYM() || '202601', 1)) > 0;
    });
  },

  baseDailyCap(dateStr, area) {
    // 新方式：通常キャパは、荷主キャパ区分の合算のみ。
    // 旧Excelキャパ・旧地区キャパ・旧shipperAreaCapsは参照しない。
    return this.areaGroupCapSum(dateStr, area);
  },

  dailyCap(dateStr, area) {
    return Math.max(0, this.baseDailyCap(dateStr, area) + this.dayAdj(dateStr));
  },

  shipperDailyCap(dateStr, area, groupLabelOrKey) {
    const key = this.shipperGroupKeyByLabel(groupLabelOrKey);
    return this.areaGroupCapSum(dateStr, area, key);
  },

  monthlyCap(ym, area) {
    let total = 0;
    const last = this.daysInYM(ym);
    for (let d=1; d<=last; d++) {
      total += this.dailyCap(this.ymDate(ym,d), area);
    }
    return total;
  },

  shipperMonthlyCap(ym, area, groupLabelOrKey) {
    let total = 0;
    const last = this.daysInYM(ym);
    for (let d=1; d<=last; d++) total += this.shipperDailyCap(this.ymDate(ym,d), area, groupLabelOrKey);
    return total;
  },

  capTargetCount(shippers) {
    if (!shippers || !this.hasValidCapacityGroups()) return null;
    const activeLabels = new Set(this.activeShipperGroups().map(g=>g.label));
    return Object.entries(shippers).reduce((sum,[name,count])=>activeLabels.has(name) ? sum + this.n(count) : sum, 0);
  },

  judge(used, cap) {
    const rate = cap > 0 ? used / cap * 100 : 0;
    if (cap <= 0) return { rate:0, status:'未設定', cls:'unset' };
    if (rate >= 150) return { rate, status:'崩壊', cls:'collapse' };
    if (rate >= 120) return { rate, status:'逼迫', cls:'over' };
    if (rate >= 100) return { rate, status:'注意', cls:'full' };
    if (rate >= 80) return { rate, status:'適正', cls:'good' };
    return { rate, status:'余裕あり', cls:'ok' };
  },

  areaRows() {
    const actual = this.buildActual();
    if (!this.hasValidCapacityGroups()) return [];
    const groupNames = (STATE.capacity?.capacityGroups || [])
      .filter(g => Array.isArray(g.units) && g.units.length)
      .map(g => g.name)
      .filter(Boolean);
    const all = [...new Set(groupNames)];
    return all.map(area=>{
      const a = actual.byArea.get(area) || { area, count:0, shippers:{}, cities:{} };
      const cap = this.monthlyCap(actual.ym, area);
      const one = this.baseDailyCap(this.ymDate(actual.ym,1), area);
      const targetCount = this.capTargetCount(a.shippers);
      const used = targetCount === null ? a.count : targetCount;
      const j = this.judge(used, cap);
      return { ...a, used, cap, oneDay:one, rate:j.rate, status:j.status, cls:j.cls };
    }).sort((a,b)=> b.rate-a.rate || b.count-a.count || String(a.area).localeCompare(String(b.area),'ja'));
  },

  dailyRows() {
    const actual = this.buildActual();
    const risk = { collapse:5, over:4, full:3, good:2, ok:1, unset:0 };
    return [...actual.byDateArea.values()].map(r=>{
      const cap = this.dailyCap(r.date, r.area);
      const targetCount = this.capTargetCount(r.shippers);
      const used = targetCount === null ? r.count : targetCount;
      const j = this.judge(used, cap);
      const diff = this.n(used) - this.n(cap);
      return { ...r, used, cap, diff, rate:j.rate, status:j.status, cls:j.cls };
    }).sort((a,b)=>(risk[b.cls]||0)-(risk[a.cls]||0) || this.n(b.diff)-this.n(a.diff) || b.rate-a.rate || String(a.date).localeCompare(String(b.date)));
  },

  ensureZipMasterForCapacity() {
    const rec = this.selectedProductRecord();
    if (!rec || !Array.isArray(rec.tickets) || !rec.tickets.length) return true;
    if (!window.JP_ZIP_LOADER || typeof JP_ZIP_LOADER.loadForZips !== 'function') return true;

    const zips = rec.tickets.map((t) => {
      const row = t.representativeRow || t.firstRow || t.row || t.raw;
      return this.normalizeZip(
        t.zip || t.zipcode || t.postCode || t.postalCode ||
        t['お届け先郵便番号'] || t['届け先郵便番号'] || t['郵便番号'] ||
        (Array.isArray(row) ? row[11] : '')
      );
    }).filter(Boolean);

    if (!zips.length) return true;
    const prefixes = [...new Set(zips.map(z => String(z).slice(0, 2)))];
    const loaded = new Set(typeof JP_ZIP_LOADER.loadedPrefixes === 'function' ? JP_ZIP_LOADER.loadedPrefixes() : []);
    const missing = prefixes.filter(p => !(window.JP_ZIP_PARTS && window.JP_ZIP_PARTS[p]) && !loaded.has(p));
    if (!missing.length) return true;

    const key = missing.sort().join('|');
    if (this._zipLoadingKey === key) return false;
    this._zipLoadingKey = key;

    JP_ZIP_LOADER.loadForZips(zips).then(() => {
      this._zipLoadingKey = '';
      this.render();
    }).catch((e) => {
      console.warn('郵便番号マスタ読込失敗', e);
      this._zipLoadingKey = '';
      // 読み込めない場合でも、住所文字列の補正で表示できる範囲を描画する。
      this._zipLoadFailedKey = key;
      this.render();
    });

    return false;
  },

  render() {
    const view = document.getElementById('view-capacity');
    if (!view || !view.classList.contains('active')) return;
    this.ensureState();
    this.ensureStyle();

    if (!this.ensureZipMasterForCapacity()) {
      view.innerHTML = `<div class="capx"><div class="capx-card capx-empty">郵便番号マスタを読み込み中です。完了後に自動で再表示します。</div></div>`;
      return;
    }

    const actual = this.buildActual();
    const rows = this.areaRows();
    const daily = this.dailyRows(); window.__CAPACITY_LAST_DAILY_ROWS = daily;
    this._lastRows = rows;
    this._lastDailyRows = daily;

    if (!['monthly','daily','integrated','shipperCap','weekday','calendar'].includes(this._tab)) this._tab = 'monthly';
    view.innerHTML = this.layout(actual, rows, daily);
    this.bind();
  },

  layout(actual, rows, daily) {
    const hasCap = this.hasValidCapacityGroups();
    const totalActual = actual.tickets?.length || 0;
    const totalUsed = hasCap ? rows.reduce((s,r)=>s+this.n(r.used ?? r.count),0) : 0;
    const totalCap = hasCap ? rows.reduce((s,r)=>s+this.n(r.cap),0) : 0;
    const j = hasCap ? this.judge(totalUsed,totalCap) : { rate:0, status:'未設定', cls:'unset' };

    const dailyRows = Array.isArray(daily) ? daily : [];
    const overList = hasCap ? dailyRows.filter(r => r && this.n(r.cap) > 0 && this.n(r.rate) >= 100) : [];
    const overDays = overList.length;
    const weekendOver = overList.filter(r => [0,6].includes(this.dow(r.date))).length;
    const weekendShare = overDays ? Math.round(weekendOver / overDays * 100) : 0;
    const weekdayShare = overDays ? 100 - weekendShare : 0;
    const worstOver = overList.slice().sort((a,b)=>this.n(b.diff)-this.n(a.diff) || this.n(b.rate)-this.n(a.rate))[0] || null;

    const yms = [...new Set((STATE.productAddressData || []).map(r=>r.ym).filter(Boolean))].sort().reverse();
    const curYM = actual.ym || this.getYM();

    return `
      <div class="capx">
        <div class="capx-card capx-control">
          <div class="capx-headline">
            <div>
              <h2>キャパ分析</h2>
              <p>商品・住所CSVをもとに、区分作成と荷主別キャパ手入力で使用率・日別超過を確認します。</p>
            </div>
            <div class="capx-cond">
              <label>対象月
                <select id="capacity-ym">
                  ${(yms.length?yms:[curYM]).map(ym=>`<option value="${esc(ym)}" ${ym===curYM?'selected':''}>${esc(ymLabel(ym))}</option>`).join('')}
                </select>
              </label>
              <label>表示基準
                <select id="capacity-base" disabled>
                  <option value="calendar" selected>区分キャパ日別積み上げ</option>
                </select>
              </label>
            </div>
          </div>
          <div class="capx-actions">
            <button class="btn" onclick="CAPACITY_UI.render()">再集計</button>
            <button class="btn btn-danger" onclick="CAPACITY_UI.clearMaster()">キャパ区分を初期化</button>
            <span id="capacity-msg">${hasCap ? `キャパ区分登録済：${STATE.capacity.capacityGroups.length}区分` : '荷主キャパ区分が未作成です'}</span>
          </div>
        </div>

        <div class="capx-kpis">
          <div class="capx-kpi blue"><span>実績件数</span><b>${fmt(totalActual)}</b><em>原票</em></div>
          <div class="capx-kpi green"><span>月キャパ</span><b>${hasCap ? fmt(totalCap) : '—'}</b><em>${hasCap?'区分合算':'未設定'}</em></div>
          <div class="capx-kpi ${j.cls}"><span>月使用率</span><b>${hasCap ? pct(j.rate) : '—'}</b><em>${esc(j.status)}</em></div>
          <div class="capx-kpi amber"><span>日別超過（区分×日）</span><b>${hasCap ? fmt(overDays) : '—'}</b><em>${hasCap ? `土日 ${fmt(weekendShare)}% / 平日 ${fmt(weekdayShare)}% / 最大 ${worstOver ? esc(worstOver.area) + ' +' + fmt(this.n(worstOver.diff)) + '件（' + pct(worstOver.rate) + '）' : '—'}` : '区分作成後に表示'}</em></div>
        </div>

        <div class="capx-tabs">
          ${[
            ['monthly','月別使用状況'],['daily','日別超過'],['integrated','連動分析'],['shipperCap','荷主キャパ'],['weekday','曜日分析'],['calendar','カレンダー'],['unmatched','未分類']
          ].map(([k,l])=>`<button type="button" class="${this._tab===k?'active':''}" data-capx-tab="${k}">${l}</button>`).join('')}
        </div>

        ${this._tab==='monthly'?this.monthlyHtml(rows):''}
        ${this._tab==='daily'?this.dailyHtml(daily, actual):''}
        ${this._tab==='integrated'?this.integratedHtml(daily, actual):''}
        ${this._tab==='shipperCap'?this.shipperCapacityHtml(actual):''}
        ${this._tab==='weekday'?this.weekdayHtml(daily, actual):''}
        ${this._tab==='calendar'?this.calendarHtml(daily, actual):''}
        ${this._tab==='unmatched'?this.unmatchedHtml(actual):''}
      </div>`;
  },

  monthlyHtml(rows) {
    if (!this.hasValidCapacityGroups()) {
      return `<div class="capx-card capx-empty">
        <h3>荷主キャパ区分を作成してください</h3>
        <p class="capx-note2">「荷主キャパ」タブで区／市を選択し、区分名と荷主別キャパを入力してください。</p>
        <button class="btn btn-primary" type="button" data-capx-tab="shipperCap">荷主キャパを作成する</button>
      </div>`;
    }
    return `<div class="capx-grid">
      <div class="capx-card">
        <h3>区分別 月キャパ使用状況</h3>
        <div class="scroll-x"><table class="tbl"><thead><tr><th>区分</th><th class="r">実績</th><th class="r">判定対象</th><th class="r">日キャパ</th><th class="r">月キャパ</th><th class="r">使用率</th><th>状態</th></tr></thead><tbody>
          ${rows.map((r,i)=>`<tr><td><button class="capx-link" data-capx-detail="${i}">${esc(r.area)}</button></td><td class="r"><b>${fmt(r.count)}</b></td><td class="r">${fmt(r.used ?? r.count)}</td><td class="r">${fmt(r.oneDay)}</td><td class="r"><b>${fmt(r.cap)}</b></td><td class="r">${r.cap > 0 ? pct(r.rate) : "-"}</td><td><span class="capacity-status ${esc(r.cls)}">${esc(r.status)}</span></td></tr>`).join('')}
        </tbody></table></div>
      </div>
      <div class="capx-card"><h3>区分内訳</h3><div id="capacity-detail-box" class="capx-empty">区分をクリックしてください</div></div>
    </div>`;
  },

  needCapacityGroupHtml() {
    return `<div class="capx-card capx-empty">
      <h3>荷主キャパ区分が未作成です</h3>
      <p class="capx-note2">「荷主キャパ」タブで区／市を選び、区分名と荷主別キャパを入力してください。</p>
      <button class="btn btn-primary" type="button" data-capx-tab="shipperCap">荷主キャパを作成する</button>
    </div>`;
  },

  dailyHtml(rows, actual) {
    if (!this.hasValidCapacityGroups()) return this.needCapacityGroupHtml();
    if (!actual.tickets.length) return `<div class="capx-card capx-empty">商品・住所CSVを読み込んでください。</div>`;

    this._lastDailyRows = rows;
    const over = rows.filter(r=>r.cap > 0 && r.rate >= 100);
    const weekendOver = over.filter(r=>[0,6].includes(this.dow(r.date))).length;
    const weekendShare = over.length ? Math.round(weekendOver / over.length * 100) : 0;
    const weekdayShare = over.length ? 100 - weekendShare : 0;
    const worst = over.slice().sort((a,b)=>this.n(b.diff)-this.n(a.diff) || b.rate-a.rate)[0] || null;

    setTimeout(()=>this.showDailyCause(0), 0);

    return `<div class="capx-grid">
      <div class="capx-card">
        <div class="capx-section-head">
          <div>
            <h3>日別超過（原因確認）</h3>
            <p class="capx-note2">行をクリックすると、右側に原因内訳を表示します。</p>
          </div>
          <div class="capx-cal-summary">
            <span class="danger">超過 ${fmt(over.length)}件</span>
            <span class="full">土日 ${fmt(weekendShare)}%</span>
            <span class="good">平日 ${fmt(weekdayShare)}%</span>
            <span>${worst ? `最大 ${esc(worst.area)} ${worst.diff > 0 ? '+' : ''}${fmt(worst.diff)}件 / ${pct(worst.rate)}` : '最大 —'}</span>
          </div>
        </div>
        <div class="scroll-x"><table class="tbl"><thead><tr><th>日付</th><th>地区</th><th class="r">実績</th><th class="r">日キャパ</th><th class="r">差分</th><th class="r">使用率</th><th>状態</th><th>主な市区町村</th></tr></thead><tbody>
          ${rows.map((r,i)=>`<tr class="capx-risk-${esc(r.cls)} capx-click-row ${i===0?'selected':''}" data-capx-daily-row="${i}"><td>${esc(this.dateLabel(r.date))}${r.estimated?' ※推定':''}</td><td>${esc(r.area)}</td><td class="r"><b>${fmt(r.count)}</b></td><td class="r">${fmt(r.cap)}</td><td class="r"><b class="capx-diff ${this.n(r.count)-this.n(r.cap)>0?'plus':'minus'}">${this.n(r.count)-this.n(r.cap)>0?'+':''}${fmt(this.n(r.count)-this.n(r.cap))}</b></td><td class="r">${r.cap > 0 ? pct(r.rate) : "-"}</td><td><span class="capacity-status ${esc(r.cls)}">${esc(r.status)}</span></td><td>${esc(Object.entries(r.cities||{}).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([c,n])=>`${c} ${fmt(n)}件`).join(' / ') || '—')}</td></tr>`).join('')}
        </tbody></table></div>
      </div>
      <div class="capx-card">
        <h3>原因ドリルダウン</h3>
        <div id="capacity-daily-cause-box" class="capx-empty">左の行をクリックしてください</div>
      </div>
    </div>`;
  },


  concentrationLabel(name, count, total) {
    if (!name || !total) return '';
    const share = count / total * 100;
    if (share >= 50) return `${name}に${pct(share)}が集中しています`;
    if (share >= 30) return `${name}が${pct(share)}を占めています`;
    return `${name}が最多です（${pct(share)}）`;
  },

  integratedHtml(rows, actual) {
    if (!this.hasValidCapacityGroups()) return this.needCapacityGroupHtml();
    if (!actual.tickets.length) return `<div class="capx-card capx-empty">商品・住所CSVを読み込んでください。</div>`;

    const over = rows.filter(r=>r.cap > 0 && this.n(r.diff) > 0);
    const overCount = over.reduce((s,r)=>s+this.n(r.count),0);
    const overDiff = over.reduce((s,r)=>s+Math.max(0,this.n(r.diff)),0);
    const overCap = over.reduce((s,r)=>s+this.n(r.cap),0);

    const areaMap = new Map();
    const shipperMap = new Map();
    const cityMap = new Map();
    over.forEach(r=>{
      const area = r.area || '未設定';
      const areaObj = areaMap.get(area) || { name:area, count:0, diff:0, days:0, maxRate:0 };
      areaObj.count += this.n(r.count);
      areaObj.diff += Math.max(0,this.n(r.diff));
      areaObj.days += 1;
      areaObj.maxRate = Math.max(areaObj.maxRate, this.n(r.rate));
      areaMap.set(area, areaObj);

      Object.entries(r.shippers || {}).forEach(([name,n])=>{
        const x = shipperMap.get(name) || { name, count:0 };
        x.count += this.n(n);
        shipperMap.set(name, x);
      });
      Object.entries(r.cities || {}).forEach(([name,n])=>{
        const x = cityMap.get(name) || { name, count:0 };
        x.count += this.n(n);
        cityMap.set(name, x);
      });
    });

    const topAreas = [...areaMap.values()].sort((a,b)=>b.diff-a.diff || b.count-a.count).slice(0,8);
    const topShippers = [...shipperMap.values()].sort((a,b)=>b.count-a.count).slice(0,8);
    const topCities = [...cityMap.values()].sort((a,b)=>b.count-a.count).slice(0,8);
    const worst = over.slice().sort((a,b)=>this.n(b.diff)-this.n(a.diff) || b.rate-a.rate)[0] || null;
    const topArea = topAreas[0];
    const topShipper = topShippers[0];
    const topCity = topCities[0];

    const comments = [];
    if (worst) comments.push(`${this.dateLabel(worst.date)}の${worst.area}が最大超過（${worst.diff>0?'+':''}${fmt(worst.diff)}件 / ${pct(worst.rate)}）です。`);
    if (topArea) comments.push(`超過差分は${topArea.name}が最も大きく、合計${fmt(topArea.diff)}件分を押し上げています。`);
    if (topCity) comments.push(`市区町村では${this.concentrationLabel(topCity.name, topCity.count, overCount)}。`);
    if (topShipper) comments.push(`荷主では${this.concentrationLabel(topShipper.name, topShipper.count, overCount)}。`);
    if (!comments.length) comments.push('対象月に日別キャパ超過はありません。現状は大きな偏りを確認する段階です。');

    const bar = (value, total)=>{
      const w = total > 0 ? Math.max(4, Math.min(100, value/total*100)) : 0;
      return `<div class="capx-mini-bar"><span style="width:${w}%"></span></div>`;
    };

    return `<div class="capx-grid">
      <div class="capx-card">
        <div class="capx-section-head">
          <div>
            <h3>連動分析（キャパ × エリア × 荷主）</h3>
            <p class="capx-note2">超過している日だけを対象に、場所と荷主の偏りをまとめて確認します。</p>
          </div>
          <div class="capx-cal-summary">
            <span class="danger">超過差分 ${fmt(overDiff)}件</span>
            <span>超過件数 ${fmt(overCount)}件</span>
            <span>超過対象 ${fmt(over.length)}行</span>
          </div>
        </div>
        <div class="capx-kpis" style="grid-template-columns:repeat(3,minmax(160px,1fr));margin-bottom:14px">
          <div class="capx-kpi over"><span>最大超過</span><b>${worst ? `${worst.diff>0?'+':''}${fmt(worst.diff)}件` : '—'}</b><em>${worst ? `${this.dateLabel(worst.date)} / ${esc(worst.area)}` : '超過なし'}</em></div>
          <div class="capx-kpi amber"><span>エリア最大要因</span><b>${topCity ? esc(topCity.name) : '—'}</b><em>${topCity ? `${fmt(topCity.count)}件 / ${pct(topCity.count / (overCount||1) * 100)}` : '内訳なし'}</em></div>
          <div class="capx-kpi good"><span>荷主最大要因</span><b>${topShipper ? esc(topShipper.name) : '—'}</b><em>${topShipper ? `${fmt(topShipper.count)}件 / ${pct(topShipper.count / (overCount||1) * 100)}` : '内訳なし'}</em></div>
        </div>
        <div class="capx-action-box">
          <h5>読み取りコメント</h5>
          ${comments.map(c=>`<div class="capx-action-item">・${esc(c)}</div>`).join('')}
        </div>
      </div>
      <div class="capx-card">
        <h3>超過日の上位要因</h3>
        ${topAreas.length ? `<h5 class="capx-mini-title">地区別 超過差分</h5>${topAreas.map((x,i)=>`<div class="capx-rank-row"><b>${i+1}</b><span>${esc(x.name)}</span><em>+${fmt(x.diff)}件</em>${bar(x.diff, topAreas[0].diff)}</div>`).join('')}` : `<div class="capx-empty">超過地区なし</div>`}
        ${topCities.length ? `<h5 class="capx-mini-title">市区町村別 件数</h5>${topCities.map((x,i)=>`<div class="capx-rank-row"><b>${i+1}</b><span>${esc(x.name)}</span><em>${fmt(x.count)}件</em>${bar(x.count, topCities[0].count)}</div>`).join('')}` : ''}
        ${topShippers.length ? `<h5 class="capx-mini-title">荷主別 件数</h5>${topShippers.map((x,i)=>`<div class="capx-rank-row"><b>${i+1}</b><span>${esc(x.name)}</span><em>${fmt(x.count)}件</em>${bar(x.count, topShippers[0].count)}</div>`).join('')}` : ''}
      </div>
    </div>`;
  },

  weekdayHtml(rows, actual) {
    if (!this.hasValidCapacityGroups()) return this.needCapacityGroupHtml();
    if (!actual.tickets.length) return `<div class="capx-card capx-empty">商品・住所CSVを読み込んでください。</div>`;

    const names = ['日','月','火','水','木','金','土'];
    const map = new Map();

    rows.forEach(r=>{
      const w = this.dow(r.date);
      if (!map.has(w)) map.set(w, { w, count:0, cap:0, over:0, items:[] });
      const x = map.get(w);
      x.count += this.n(r.count);
      x.cap += this.n(r.cap);
      if (r.cap > 0 && r.rate >= 100) x.over += 1;
      x.items.push(r);
    });

    const list = Array.from({length:7},(_,w)=>{
      const x = map.get(w) || { w, count:0, cap:0, over:0, items:[] };
      const j = this.judge(x.count, x.cap);
      const worst = x.items.slice().sort((a,b)=>b.rate-a.rate)[0];
      return { ...x, rate:j.rate, status:j.status, cls:j.cls, worst };
    });

    return `<div class="capx-card">
      <div class="capx-section-head">
        <div>
          <h3>曜日分析</h3>
          <p class="capx-note2">曜日ごとの偏りを見ます。土日だけ逼迫しているか、平日に寄っているかを確認します。</p>
        </div>
      </div>
      <div class="capx-weekday-grid">
        ${list.map(x=>`
          <div class="capx-weekday-card ${esc(x.cls)}">
            <div class="capx-weekday-top">
              <b>${names[x.w]}曜日</b>
              <span class="capacity-status ${esc(x.cls)}">${esc(x.status)}</span>
            </div>
            <div class="capx-weekday-main">
              <strong>${x.cap > 0 ? pct(x.rate) : '-'}</strong>
              <span>${fmt(x.count)}件 / ${fmt(x.cap)}件</span>
            </div>
            <div class="capx-weekday-sub">
              <span>超過 ${fmt(x.over)}件</span>
              <span>${x.worst ? `最大 ${esc(x.worst.area)} ${x.worst.cap > 0 ? pct(x.worst.rate) : '-'}` : '最大 —'}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
  },



  saitamaRegionMap() {
    return {
      saitama_saitama: ['さいたま市'],
      saitama_nanbu: ['川口市','蕨市','戸田市'],
      saitama_nanseibu: ['朝霞市','志木市','和光市','新座市','富士見市','ふじみ野市','三芳町'],
      saitama_tobu: ['春日部市','草加市','越谷市','八潮市','三郷市','吉川市','松伏町'],
      saitama_kenou: ['鴻巣市','上尾市','桶川市','北本市','伊奈町'],
      saitama_kawagoe_hiki: ['川越市','東松山市','坂戸市','鶴ヶ島市','日高市','毛呂山町','越生町','滑川町','嵐山町','小川町','川島町','吉見町','鳩山町','ときがわ町','東秩父村'],
      saitama_seibu: ['所沢市','飯能市','狭山市','入間市'],
      saitama_tone: ['行田市','加須市','羽生市','久喜市','蓮田市','幸手市','白岡市','宮代町','杉戸町'],
      saitama_hokubu: ['熊谷市','本庄市','深谷市','美里町','神川町','上里町','寄居町'],
      saitama_chichibu: ['秩父市','横瀬町','皆野町','長瀞町','小鹿野町']
    };
  },

  tokyoRegionMap() {
    return {
      tokyo_toshin: ['千代田区','中央区','港区'],
      tokyo_fukutoshin: ['新宿区','文京区','渋谷区','豊島区'],
      tokyo_joto: ['台東区','墨田区','江東区','荒川区','足立区','葛飾区','江戸川区'],
      tokyo_jonan: ['品川区','目黒区','大田区','世田谷区'],
      tokyo_josai: ['中野区','杉並区','練馬区'],
      tokyo_johoku: ['北区','板橋区']
    };
  },

  saitamaWardNames() {
    return ['西区','北区','大宮区','見沼区','中央区','桜区','浦和区','南区','緑区','岩槻区'];
  },

  tokyoWardNames() {
    return ['千代田区','中央区','港区','新宿区','文京区','台東区','墨田区','江東区','品川区','目黒区','大田区','世田谷区','渋谷区','中野区','杉並区','豊島区','北区','荒川区','板橋区','練馬区','足立区','葛飾区','江戸川区'];
  },

  saitamaMunicipalityNames() {
    const names = new Set();
    Object.values(this.saitamaRegionMap()).flat().forEach(x=>names.add(x));
    this.saitamaWardNames().forEach(w=>names.add('さいたま市' + w));
    return [...names];
  },

  tokyoMunicipalityNames() {
    return [
      ...this.tokyoWardNames(),
      '八王子市','立川市','武蔵野市','三鷹市','青梅市','府中市','昭島市','調布市','町田市','小金井市','小平市','日野市','東村山市','国分寺市','国立市','福生市','狛江市','東大和市','清瀬市','東久留米市','武蔵村山市','多摩市','稲城市','羽村市','あきる野市','西東京市','瑞穂町','日の出町','檜原村','奥多摩町'
    ];
  },

  normalizeCapacityUnit(value) {
    const raw = String(value ?? '').normalize('NFKC').replace(/\s+/g,'').trim();
    if (!raw || raw === '未設定') return '';

    const stripPref = (x) => String(x || '').replace(/^埼玉県/, '').replace(/^東京都/, '');
    const withPref = (pref, name) => pref + String(name || '').replace(new RegExp('^' + pref), '');

    // 郵便番号だけの場合は、郵便番号マスタから取得した行政単位を1回だけ正規化する。
    // ※自分自身を無条件に呼ばない。Maximum call stack size exceeded 防止。
    const zip = this.normalizeZip(raw);
    if (/^\d{7}$/.test(zip) && raw.replace(/[^0-9]/g,'').length === 7) {
      const byZip = this.cityFromZip(zip);
      if (byZip && byZip !== raw) {
        const z = String(byZip).normalize('NFKC').replace(/\s+/g,'').trim();
        if (z.includes('埼玉県') || z.includes('東京都')) {
          const c = this.cityFromAddress(z);
          return c && c !== '未設定' ? c : z;
        }
        value = z;
      }
    }

    let v = String(value ?? raw).normalize('NFKC').replace(/\s+/g,'').trim();
    if (!v || v === '未設定') return '';

    // 県名つきは行政単位まで切る。cityFromAddress が同じ値を返しても再帰しない。
    if (v.includes('東京都') || v.includes('埼玉県')) {
      const c = this.cityFromAddress(v);
      return c && c !== '未設定' ? c : v;
    }

    // さいたま市の区は、東京都の「北区」などと衝突しやすいため最優先で補完する。
    if (v.includes('さいたま市')) {
      const ward = this.saitamaWardNames().find(w => v.includes(w));
      return '埼玉県さいたま市' + (ward || '');
    }
    const saitamaWard = this.saitamaWardNames().find(w => v === w || v.endsWith(w));
    if (saitamaWard && !v.includes('東京都')) return '埼玉県さいたま市' + saitamaWard;

    // 東京都23区。
    const tokyoWard = this.tokyoWardNames().find(w => v === w || v.includes(w));
    if (tokyoWard) return '東京都' + tokyoWard;

    // 埼玉県内市町村。
    const saitamaMuni = this.saitamaMunicipalityNames().find(m => v === m || v.includes(m));
    if (saitamaMuni) return withPref('埼玉県', saitamaMuni);

    // 東京都多摩等。
    const tokyoMuni = this.tokyoMunicipalityNames().find(m => v === m || v.includes(m));
    if (tokyoMuni) return withPref('東京都', tokyoMuni);

    // エリア分析で対応済みだった住所崩れへの補正。
    // 例：蕨中央5-、戸田美女木、さいたま大宮区 などを町域ではなく市・区へ丸める。
    const cleaned = v.replace(/^[0-9〒-]+/, '');
    const repaired = this.cityFromAddress(cleaned);
    if (repaired && repaired !== '未設定' && repaired !== cleaned && repaired !== v) {
      // ここも再帰しない。戻り値を行政単位としてそのまま返す。
      return repaired;
    }

    if (/^さいたま/.test(cleaned)) {
      const ward = this.saitamaWardNames().find(w => cleaned.includes(w));
      return '埼玉県さいたま市' + (ward || '');
    }
    if (/^蕨/.test(cleaned)) return '埼玉県蕨市';
    if (/^戸田/.test(cleaned)) return '埼玉県戸田市';
    if (/^川口/.test(cleaned)) return '埼玉県川口市';
    if (/^朝霞/.test(cleaned)) return '埼玉県朝霞市';
    if (/^和光/.test(cleaned)) return '埼玉県和光市';
    if (/^志木/.test(cleaned)) return '埼玉県志木市';
    if (/^新座/.test(cleaned)) return '埼玉県新座市';

    return v;
  },

  regionFilterOptions() {
    return [
      { key:'saitama_all', label:'埼玉県 全域' },
      { key:'saitama_saitama', label:'埼玉県 さいたま地域' },
      { key:'saitama_nanbu', label:'埼玉県 南部地域' },
      { key:'saitama_nanseibu', label:'埼玉県 南西部地域' },
      { key:'saitama_tobu', label:'埼玉県 東部地域' },
      { key:'saitama_kenou', label:'埼玉県 県央地域' },
      { key:'saitama_kawagoe_hiki', label:'埼玉県 川越比企地域' },
      { key:'saitama_seibu', label:'埼玉県 西部地域' },
      { key:'saitama_tone', label:'埼玉県 利根地域' },
      { key:'saitama_hokubu', label:'埼玉県 北部地域' },
      { key:'saitama_chichibu', label:'埼玉県 秩父地域' },
      { key:'tokyo_all', label:'東京都 全域' },
      { key:'tokyo_23', label:'東京都 23区 全域' },
      { key:'tokyo_toshin', label:'東京都 都心部' },
      { key:'tokyo_fukutoshin', label:'東京都 副都心部' },
      { key:'tokyo_joto', label:'東京都 城東' },
      { key:'tokyo_jonan', label:'東京都 城南' },
      { key:'tokyo_josai', label:'東京都 城西' },
      { key:'tokyo_johoku', label:'東京都 城北' },
      { key:'tokyo_tama', label:'東京都 多摩' },
      { key:'all_tokyo_saitama', label:'東京・埼玉 すべて' }
    ];
  },

  unitShortName(unit) {
    const u = this.normalizeCapacityUnit(unit) || String(unit || '');
    return String(u || '')
      .replace(/^東京都/, '')
      .replace(/^埼玉県/, '')
      .trim() || '未設定';
  },

  isTokyo23Unit(unit) {
    const u = this.normalizeCapacityUnit(unit);
    return /^東京都.+区$/.test(u);
  },

  unitMatchesRegion(unit, regionKey) {
    const u = this.normalizeCapacityUnit(unit);
    if (!u || u === '未設定') return false;
    if (regionKey === 'all_tokyo_saitama') return u.includes('埼玉県') || u.includes('東京都');
    if (regionKey === 'saitama_all') return u.includes('埼玉県');
    if (regionKey === 'tokyo_all') return u.includes('東京都');
    if (regionKey === 'tokyo_23') return this.isTokyo23Unit(u);
    if (regionKey === 'tokyo_tama') return u.includes('東京都') && !this.isTokyo23Unit(u);

    const saitamaMap = this.saitamaRegionMap();
    if (saitamaMap[regionKey]) return u.includes('埼玉県') && saitamaMap[regionKey].some(name => u.includes(name));

    const tokyoMap = this.tokyoRegionMap();
    if (tokyoMap[regionKey]) return u.includes('東京都') && tokyoMap[regionKey].some(name => u.includes(name));

    return true;
  },

  availableCapacityUnits(actual) {
    const map = new Map();
    (actual?.tickets || []).forEach(t => {
      const unit = this.normalizeCapacityUnit(this.ticketCity(t));
      if (!unit || unit === '未設定') return;
      if (!(unit.includes('埼玉県') || unit.includes('東京都'))) return;
      const area = this.mappedArea(unit);
      const old = map.get(unit) || { unit, label:this.unitShortName(unit), area, count:0, shippers:{} };
      old.count += 1;
      old.shippers[t.shipper || 'その他'] = (old.shippers[t.shipper || 'その他'] || 0) + 1;
      map.set(unit, old);
    });
    const values = [...map.values()];
    const hasSaitamaWard = values.some(x => /^埼玉県さいたま市(西区|北区|大宮区|見沼区|中央区|桜区|浦和区|南区|緑区|岩槻区)$/.test(x.unit));
    return values
      .filter(x => !(hasSaitamaWard && /^埼玉県さいたま市?$/.test(x.unit)))
      .sort((a,b)=>{
        const pa = a.unit.includes('埼玉県') ? 0 : 1;
        const pb = b.unit.includes('埼玉県') ? 0 : 1;
        return pa - pb || String(a.unit).localeCompare(String(b.unit), 'ja');
      });
  },

  capacityGroupDailyCap(group, dateStr, shipperKey='') {
    const holidayLike = this.isWeekend(dateStr) || this.dayType(dateStr) === 'holiday';
    const field = holidayLike ? 'weekend' : 'weekday';
    const caps = group?.capacity || {};
    if (shipperKey) return this.n(caps?.[shipperKey]?.[field] ?? 0);
    return this.activeShipperGroups().reduce((s,g)=>s + this.n(caps?.[g.key]?.[field] ?? 0), 0);
  },

  capacityGroupsForArea(area) {
    this.ensureState();
    return (STATE.capacity.capacityGroups || []).filter(g => String(g.name || '') === String(area || ''));
  },

  areaGroupCapSum(dateStr, area, shipperKey='') {
    const groups = this.capacityGroupsForArea(area);
    if (!groups.length) return 0;
    return groups.reduce((s,g)=>s + this.capacityGroupDailyCap(g, dateStr, shipperKey), 0);
  },

  areaUnitBreakdownForRow(row) {
    const result = new Map();
    const area = row?.area || '';
    (this.buildActual().tickets || []).forEach(t => {
      if (t.area !== area) return;
      if (row?.date && t.date && t.date !== row.date) return;
      const unit = this.normalizeCapacityUnit(this.ticketCity(t));
      const key = unit || '未設定';
      const x = result.get(key) || { unit:key, label:this.unitShortName(key), count:0, shippers:{} };
      x.count += 1;
      x.shippers[t.shipper || 'その他'] = (x.shippers[t.shipper || 'その他'] || 0) + 1;
      result.set(key, x);
    });
    return [...result.values()].sort((a,b)=>b.count-a.count);
  },

  shipperCapacityHtml(actual) {
    this.ensureState();

    const tickets = actual.tickets || [];
    const groups = this.activeShipperGroups();
    const allUnits = this.availableCapacityUnits(actual);
    const regionOptions = this.regionFilterOptions();
    const regionKey = this._capRegionFilter || 'saitama_all';
    const filteredUnits = allUnits.filter(u => this.unitMatchesRegion(u.unit, regionKey));
    const savedGroups = STATE.capacity.capacityGroups || [];
    const ym = actual.ym || this.getYM();

    const groupSummary = groups.map(g=>{
      const count = tickets.filter(t=>t.shipper === g.label).length;
      let weekday = 0, weekend = 0;
      savedGroups.forEach(cg=>{
        weekday += this.n(cg.capacity?.[g.key]?.weekday);
        weekend += this.n(cg.capacity?.[g.key]?.weekend);
      });
      return { ...g, count, weekday, weekend };
    });

    const unitCards = filteredUnits.length ? filteredUnits.map(u=>`
      <label class="capx-unit-card">
        <input type="checkbox" value="${esc(u.unit)}" data-capx-new-group-unit>
        <span>
          <b>${esc(u.label)}</b>
          <em>${esc(u.area)} / ${fmt(u.count)}件</em>
        </span>
      </label>
    `).join('') : `<div class="capx-empty small">対象エリアの区・市がありません。商品・住所CSVまたは郵便番号データを確認してください。</div>`;

    return `<div class="capx-card">
      <div class="capx-section-head">
        <div>
          <h3>荷主キャパ設定（区分作成）</h3>
          <p class="capx-note2">埼玉・東京の区／市を複数選択して、現場の配車単位に合わせたキャパ区分を作成します。通常キャパは作成した区分の荷主キャパ合算です。</p>
        </div>
        <div class="capx-cal-summary">
          <span>対象 ${esc(ymLabel(ym))}</span>
          <span>区・市 ${fmt(allUnits.length)}</span>
          <span>区分 ${fmt(savedGroups.length)}</span>
        </div>
      </div>

      <div class="capx-shipper-summary">
        ${groupSummary.map(g=>`<div class="capx-mini-card"><span>${esc(g.label)}</span><b>${fmt(g.count)}件</b><em>平日合計 ${fmt(g.weekday)} / 土日合計 ${fmt(g.weekend)}</em></div>`).join('')}
      </div>

      <div class="capx-capgroup-layout">
        <div class="capx-capgroup-form">
          <h4>区分を追加</h4>
          <label class="capx-form-label">対象エリア
            <select id="capx-region-filter">
              ${regionOptions.map(o=>`<option value="${esc(o.key)}" ${o.key===regionKey?'selected':''}>${esc(o.label)}</option>`).join('')}
            </select>
          </label>
          <label class="capx-form-label">区分名
            <input id="capx-new-group-name" placeholder="例：さいたまA / 大宮・桜">
          </label>
          <div class="capx-unit-list">
            ${unitCards}
          </div>
          <div class="capx-group-cap-inputs">
            ${groups.map(g=>`
              <div class="capx-group-cap-row">
                <b>${esc(g.label)}</b>
                <label>平日<input type="number" min="0" step="1" value="0" data-capx-new-cap="${esc(g.key)}" data-capx-new-cap-field="weekday"></label>
                <label>土日<input type="number" min="0" step="1" value="0" data-capx-new-cap="${esc(g.key)}" data-capx-new-cap-field="weekend"></label>
              </div>
            `).join('')}
          </div>
          <button class="btn btn-primary" id="capx-add-cap-group" type="button">選択した区・市で区分を追加</button>
          <div class="capx-note">例：さいたまA＝大宮区・桜区、さいたまB＝西区・北区。秩父方面や東京23区も同じ画面で作成できます。</div>
        </div>

        <div class="capx-capgroup-list">
          <h4>作成済み区分</h4>
          ${savedGroups.length ? savedGroups.map((cg,idx)=>{
            const unitText = (cg.units || []).map(u=>this.unitShortName(u)).join('・') || '対象なし';
            const areaText = [...new Set((cg.units || []).map(u=>this.mappedArea(this.normalizeCapacityUnit(u))))].join(' / ') || '未分類';
            return `<div class="capx-capgroup-card" data-capx-capgroup-id="${esc(cg.id)}">
              <div class="capx-capgroup-title">
                <div>
                  <input value="${esc(cg.name || '')}" data-capx-capgroup-field="name">
                  <em>${esc(areaText)}</em>
                </div>
                <button class="btn btn-danger" type="button" data-capx-capgroup-delete="${esc(cg.id)}">削除</button>
              </div>
              <div class="capx-capgroup-units">${esc(unitText)}</div>
              <div class="capx-group-cap-inputs compact">
                ${groups.map(g=>`
                  <div class="capx-group-cap-row">
                    <b>${esc(g.label)}</b>
                    <label>平日<input type="number" min="0" step="1" value="${esc(this.n(cg.capacity?.[g.key]?.weekday))}" data-capx-capgroup-cap="${esc(g.key)}" data-capx-cap-field="weekday"></label>
                    <label>土日<input type="number" min="0" step="1" value="${esc(this.n(cg.capacity?.[g.key]?.weekend))}" data-capx-capgroup-cap="${esc(g.key)}" data-capx-cap-field="weekend"></label>
                  </div>
                `).join('')}
              </div>
            </div>`;
          }).join('') : `<div class="capx-empty small">まだ区分がありません。左側で区・市を選んで作成してください。</div>`}
        </div>
      </div>

      <details class="capx-details"><summary>荷主判定ルールを確認・修正する</summary>
        <p class="capx-note2">荷主名または荷主コードの前方一致で区分します。コードが分かる場合は「コード接頭辞」に入力すると名称ブレより強く判定できます。</p>
        <div class="scroll-x"><table class="tbl"><thead><tr><th>区分名</th><th>名称キーワード（|区切り）</th><th>コード接頭辞（|区切り）</th><th class="r">判定</th></tr></thead><tbody>
          ${(STATE.capacity.shipperGroups || this.defaultShipperGroups()).map(g=>`<tr data-capx-group-key="${esc(g.key)}">
            <td><input value="${esc(g.label)}" data-capx-group-field="label" style="width:150px"></td>
            <td><input value="${esc(g.patterns || '')}" data-capx-group-field="patterns" style="width:320px"></td>
            <td><input value="${esc(g.codePrefixes || '')}" data-capx-group-field="codePrefixes" style="width:220px"></td>
            <td class="r"><label class="capx-check"><input type="checkbox" ${g.active !== false ? 'checked' : ''} data-capx-group-field="active">対象</label></td>
          </tr>`).join('')}
        </tbody></table></div>
      </details>
    </div>`;
  },

  calendarHtml(rows, actual) {
    if (!this.hasValidCapacityGroups()) return this.needCapacityGroupHtml();
    const ym = actual.ym || this.getYM();
    const days = this.daysInYM(ym);
    if (!ym || !days) return `<div class="capx-card capx-empty">対象月を選択してください。</div>`;
    const byDate = new Map();
    rows.forEach(r=>{
      const x = byDate.get(r.date) || { date:r.date, count:0, cap:0, diff:0, rows:[], cls:'unset' };
      x.count += this.n(r.count); x.cap += this.n(r.cap); x.diff += Math.max(0,this.n(r.diff)); x.rows.push(r);
      const j = this.judge(x.count, x.cap); x.rate = j.rate; x.status = j.status; x.cls = j.cls;
      byDate.set(r.date, x);
    });
    const firstDow = this.dow(this.ymDate(ym,1));
    const cells = [];
    for (let i=0;i<firstDow;i++) cells.push(`<div class="capx-day-simple blank"></div>`);
    for (let d=1; d<=days; d++) {
      const date = this.ymDate(ym,d);
      const x = byDate.get(date) || { date, count:0, cap:0, diff:0, cls:'empty', rows:[] };
      cells.push(`<button type="button" class="capx-day-simple ${this.isWeekend(date)?'weekend':''} ${x.cls}" data-capx-cal-detail="${esc(date)}">
        <span class="day-no">${d}</span>
        <strong>${x.count ? fmt(x.count) : '—'}</strong>
        <em>${x.cap ? `${fmt(x.cap)}件 / ${pct(x.rate||0)}` : 'キャパ未設定'}</em>
        ${x.diff>0 ? `<i>+${fmt(x.diff)}</i>` : ''}
      </button>`);
    }
    const over = [...byDate.values()].filter(x=>x.diff>0).length;
    return `<div class="capx-card capx-calendar-card">
      <div class="capx-cal-head"><div><h3>カレンダー</h3><p class="capx-note2">日別の実績・キャパ・超過をカレンダー形式で確認します。</p></div><div class="capx-cal-summary"><span class="danger">超過日 ${fmt(over)}日</span><span>${esc(ymLabel(ym))}</span></div></div>
      <div class="capx-calendar-layout"><div class="capx-calendar-simple">${['日','月','火','水','木','金','土'].map(w=>`<div class="capx-week">${w}</div>`).join('')}${cells.join('')}</div><div id="capx-calendar-detail" class="capx-cal-detail"><div class="capx-empty small">日付をクリックしてください</div></div></div>
    </div>`;
  },

  calendarDetailHtml(date, rows) {
    const list = rows.filter(r=>r.date === date);
    const total = list.reduce((s,r)=>s+this.n(r.count),0);
    const cap = list.reduce((s,r)=>s+this.n(r.cap),0);
    const diff = total - cap;
    return `<div class="capx-cal-detail-inner">
      <div class="capx-cal-detail-title"><div><b>${esc(this.dateLabel(date))}</b><span>実績 ${fmt(total)}件 / キャパ ${fmt(cap)}件 / 差分 ${diff>0?'+':''}${fmt(diff)}件</span></div></div>
      <div class="capx-cal-edit">
        <label>日別補正種別<select data-capx-cal-date="${esc(date)}" data-capx-cal-field="type"><option value="normal" ${this.dayType(date)==='normal'?'selected':''}>通常</option><option value="holiday" ${this.dayType(date)==='holiday'?'selected':''}>休日扱い</option><option value="special" ${this.dayType(date)==='special'?'selected':''}>特殊日</option></select></label>
        <label>日別補正件数<input type="number" value="${esc(this.dayAdj(date))}" data-capx-cal-date="${esc(date)}" data-capx-cal-field="adjust"></label>
      </div>
      <div class="capx-cal-area-list">${list.length ? list.map(r=>`<div class="capx-cal-area-row ${esc(r.cls)}"><span>${esc(r.area)}</span><b>${fmt(r.count)}</b><em>${fmt(r.cap)}</em><strong>${this.n(r.diff)>0?'+':''}${fmt(r.diff)}</strong></div>`).join('') : '<div class="capx-empty small">実績なし</div>'}</div>
    </div>`;
  },

  masterHtml() {
    this.ensureState();
    const ym = this.getYM();
    const groups = this.activeShipperGroups();
    const savedGroups = STATE.capacity.capacityGroups || [];
    const areaMap = new Map();

    savedGroups.forEach(cg=>{
      const areas = [...new Set((cg.units || []).map(u=>this.mappedArea(this.normalizeCapacityUnit(u))))];
      areas.forEach(area=>{
        const row = areaMap.get(area) || { area, groups:[], weekday:0, weekend:0, shipper:{} };
        row.groups.push(cg);
        groups.forEach(g=>{
          row.shipper[g.key] = row.shipper[g.key] || { weekday:0, weekend:0 };
          row.shipper[g.key].weekday += this.n(cg.capacity?.[g.key]?.weekday);
          row.shipper[g.key].weekend += this.n(cg.capacity?.[g.key]?.weekend);
          row.weekday += this.n(cg.capacity?.[g.key]?.weekday);
          row.weekend += this.n(cg.capacity?.[g.key]?.weekend);
        });
        areaMap.set(area,row);
      });
    });

    const rows = [...areaMap.values()].sort((a,b)=>String(a.area).localeCompare(String(b.area),'ja'));

    return `<div class="capx-card"><div class="capx-section-head"><div><h3>通常キャパ</h3><p class="capx-note2">通常キャパは、荷主キャパ区分の合算で自動計算します。この画面は確認用です。修正は「荷主キャパ」タブで行ってください。</p></div><button class="btn" data-capx-tab="shipperCap">荷主キャパを修正</button></div>
      ${rows.length ? `<div class="scroll-x"><table class="tbl"><thead><tr><th>地区</th><th>構成区分</th>${groups.map(g=>`<th class="r">${esc(g.label)}</th>`).join('')}<th class="r">平日合計</th><th class="r">土日合計</th><th class="r">月キャパ</th></tr></thead><tbody>${rows.map(r=>{
        const monthCap = this.monthlyCap(ym, r.area);
        return `<tr><td><b>${esc(r.area)}</b></td><td>${esc(r.groups.map(g=>g.name).join(' / '))}</td>${groups.map(g=>`<td class="r">${fmt(r.shipper[g.key]?.weekday || 0)} / ${fmt(r.shipper[g.key]?.weekend || 0)}</td>`).join('')}<td class="r"><b>${fmt(r.weekday)}</b></td><td class="r"><b>${fmt(r.weekend)}</b></td><td class="r"><b>${fmt(monthCap)}</b></td></tr>`;
      }).join('')}</tbody></table></div>` : `<div class="capx-empty">荷主キャパ区分が未作成です。「荷主キャパ」タブで区分を作成してください。</div>`}
    </div>`;
  },

  unmatchedHtml(actual) {
    const rows = [...(actual.unmatched || new Map()).entries()].sort((a,b)=>b[1]-a[1]);
    return `<div class="capx-card"><h3>未分類</h3><p class="capx-note2">商品・住所CSVには存在するが、どの荷主キャパ区分にも含まれていない市区町村です。キャパ判定に入れる場合は「荷主キャパ」で区分へ追加してください。</p>
      ${rows.length ? `<div class="capx-cause-list">${rows.map(([c,n],i)=>`<div class="capx-cause-row"><b>${i+1}</b><span>${esc(c)}</span><em>${fmt(n)}件</em></div>`).join('')}</div>` : '<div class="capx-empty">未分類はありません。</div>'}
    </div>`;
  },

  dailyCauseHtml(row) {
    if (!row) return `<div class="capx-empty">対象データがありません</div>`;
    const diff = this.n(row.count) - this.n(row.cap);
    const cities = Object.entries(row.cities || {}).sort((a,b)=>b[1]-a[1]);
    const shippers = Object.entries(row.shippers || {}).sort((a,b)=>b[1]-a[1]);
    const topCity = cities[0];
    const topShipper = shippers[0];
    const cityShare = topCity ? topCity[1] / (this.n(row.count) || 1) * 100 : 0;
    const shipperShare = topShipper ? topShipper[1] / (this.n(row.count) || 1) * 100 : 0;
    const shipperCapRows = shippers.map(([name,n])=>{
      const cap = this.shipperDailyCap(row.date, row.area, name);
      const diff = this.n(n) - cap;
      const j = this.judge(this.n(n), cap);
      return { name, count:this.n(n), cap, diff, ...j };
    });
    const insight = diff > 0
      ? `${esc(row.area)}で日キャパを${diff > 0 ? '+' : ''}${fmt(diff)}件超過しています。${topCity ? `市区町村は${esc(topCity[0])}が最多（${pct(cityShare)}）です。` : ''}${topShipper ? ` 荷主は${esc(topShipper[0])}が最多（${pct(shipperShare)}）です。` : ''}`
      : `日キャパ内に収まっています。内訳確認用の表示です。`;

    return `<div class="capx-cause-inner">
      <div class="capx-cause-title">
        <h4>${esc(this.dateLabel(row.date))} / ${esc(row.area)}</h4>
        <p>${row.estimated ? '※月間件数をカレンダー日数で割った推定値です。' : '実日付データをもとにした集計です。'}</p>
      </div>
      <div class="capx-city-hint">${insight}</div>
      <div class="capx-cause-kpis">
        <div><span>実績</span><b>${fmt(row.count)}件</b></div>
        <div><span>日キャパ</span><b>${fmt(row.cap)}件</b></div>
        <div class="${diff > 0 ? 'danger' : 'ok'}"><span>差分</span><b>${diff > 0 ? '+' : ''}${fmt(diff)}件</b></div>
        <div><span>超過倍率</span><b>${row.cap > 0 ? (this.n(row.count)/this.n(row.cap)).toFixed(1) + '倍' : '-'}</b></div>
      </div>
      <h5>市区町村別 原因内訳</h5>
      <div class="capx-cause-list">
        ${cities.length ? cities.map(([c,n],i)=>`
          <div class="capx-cause-row">
            <b>${i+1}</b>
            <span>${esc(c)}</span>
            <em>${fmt(n)}件</em>
          </div>
        `).join('') : '<div class="capx-empty">市区町村内訳なし</div>'}
      </div>
      <h5>荷主別 原因内訳</h5>
      <div class="capx-cause-list">
        ${shipperCapRows.length ? shipperCapRows.map((x,i)=>`
          <div class="capx-cause-row">
            <b>${i+1}</b>
            <span>${esc(x.name)}</span>
            <em>${fmt(x.count)}件${x.cap>0 ? ` / 枠${fmt(x.cap)}件 / ${x.diff>0?'+':''}${fmt(x.diff)}件` : ' / 判定なし'}</em>
          </div>
        `).join('') : '<div class="capx-empty">荷主内訳なし</div>'}
      </div>
    </div>`;
  },

  showDailyCause(idx) {
    const row = this._lastDailyRows[Number(idx)];
    const box = document.getElementById('capacity-daily-cause-box');
    if (!box || !row) return;
    document.querySelectorAll('[data-capx-daily-row]').forEach(tr=>tr.classList.remove('selected'));
    const tr = document.querySelector(`[data-capx-daily-row="${Number(idx)}"]`);
    if (tr) tr.classList.add('selected');
    box.innerHTML = this.dailyCauseHtml(row);
  },

  bindCalendarDetailInputs() {
    document.querySelectorAll('#capx-calendar-detail [data-capx-cal-date]').forEach(inp=>inp.addEventListener('change',()=>{
      const date = inp.dataset.capxCalDate, field = inp.dataset.capxCalField;
      STATE.capacity.calendar = STATE.capacity.calendar || {};
      STATE.capacity.calendar[date] = STATE.capacity.calendar[date] || {};
      STATE.capacity.calendar[date][field] = inp.type === 'number' ? this.n(inp.value) : inp.value;
      STORE.save();
      this.render();
    }));
  },

  bind() {
    const ym = document.getElementById('capacity-ym');
    if (ym) ym.addEventListener('change', ()=>this.render());
    const days = document.getElementById('capacity-days');
    if (days) days.addEventListener('change', ()=>this.render());
    const base = document.getElementById('capacity-base');
    if (base) base.addEventListener('change', ()=>this.render());

    document.querySelectorAll('[data-capx-tab]').forEach(btn=>btn.addEventListener('click',()=>{ this._tab=btn.dataset.capxTab; this.render(); }));
    document.querySelectorAll('[data-capx-detail]').forEach(btn=>btn.addEventListener('click',()=>this.showCities(Number(btn.dataset.capxDetail))));
    document.querySelectorAll('[data-capx-daily-row]').forEach(row=>row.addEventListener('click',()=>this.showDailyCause(Number(row.dataset.capxDailyRow))));
    document.querySelectorAll('[data-capx-cal-detail]').forEach(btn=>btn.addEventListener('click',()=>{
      const box = document.getElementById('capx-calendar-detail');
      if (!box) return;
      box.innerHTML = this.calendarDetailHtml(btn.dataset.capxCalDetail, this._lastDailyRows || []);
      this.bindCalendarDetailInputs();
    }));
    document.querySelectorAll('[data-capx-cal-date]').forEach(inp=>inp.addEventListener('change',()=>{
      const date = inp.dataset.capxCalDate, field = inp.dataset.capxCalField;
      STATE.capacity.calendar = STATE.capacity.calendar || {};
      STATE.capacity.calendar[date] = STATE.capacity.calendar[date] || {};
      STATE.capacity.calendar[date][field] = inp.type === 'number' ? this.n(inp.value) : inp.value;
      STORE.save();
      this.render();
    }));
    document.querySelectorAll('[data-capx-group-field]').forEach(inp=>inp.addEventListener('change',()=>{
      const tr = inp.closest('[data-capx-group-key]');
      const key = tr?.dataset.capxGroupKey;
      const g = (STATE.capacity.shipperGroups || []).find(x=>x.key === key);
      if (!g) return;
      const field = inp.dataset.capxGroupField;
      g[field] = inp.type === 'checkbox' ? inp.checked : inp.value;
      STORE.save();
      this.render();
    }));
    const regionFilter = document.getElementById('capx-region-filter');
    if (regionFilter) regionFilter.addEventListener('change',()=>{
      this._capRegionFilter = regionFilter.value || 'saitama_all';
      this.render();
    });

    const addCapGroup = document.getElementById('capx-add-cap-group');
    if (addCapGroup) addCapGroup.addEventListener('click',()=>{
      const name = String(document.getElementById('capx-new-group-name')?.value || '').trim();
      const units = [...document.querySelectorAll('[data-capx-new-group-unit]:checked')].map(x=>x.value).filter(Boolean);
      if (!name) { UI.toast('区分名を入力してください','warn'); return; }
      if (!units.length) { UI.toast('対象の区・市を選択してください','warn'); return; }

      const capacity = {};
      this.activeShipperGroups().forEach(g=>{
        capacity[g.key] = { weekday:0, weekend:0 };
      });
      document.querySelectorAll('[data-capx-new-cap]').forEach(inp=>{
        const key = inp.dataset.capxNewCap;
        const field = inp.dataset.capxNewCapField;
        capacity[key] = capacity[key] || { weekday:0, weekend:0 };
        capacity[key][field] = this.n(inp.value);
      });

      STATE.capacity.capacityGroups = STATE.capacity.capacityGroups || [];
      STATE.capacity.capacityGroups.push({
        id: 'cg_' + Date.now() + '_' + Math.random().toString(16).slice(2),
        name,
        units,
        capacity,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      STORE.save();
      CLOUD.pushCapacity().catch(()=>{});
      UI.toast('キャパ区分を追加しました');
      this.render();
    });

    document.querySelectorAll('[data-capx-capgroup-delete]').forEach(btn=>btn.addEventListener('click',()=>{
      const id = btn.dataset.capxCapgroupDelete;
      if (!confirm('このキャパ区分を削除しますか？')) return;
      STATE.capacity.capacityGroups = (STATE.capacity.capacityGroups || []).filter(g=>g.id !== id);
      STORE.save();
      CLOUD.pushCapacity().catch(()=>{});
      this.render();
    }));

    document.querySelectorAll('[data-capx-capgroup-field]').forEach(inp=>inp.addEventListener('change',()=>{
      const card = inp.closest('[data-capx-capgroup-id]');
      const id = card?.dataset.capxCapgroupId;
      const cg = (STATE.capacity.capacityGroups || []).find(g=>g.id === id);
      if (!cg) return;
      cg[inp.dataset.capxCapgroupField] = inp.value;
      cg.updatedAt = new Date().toISOString();
      STORE.save();
      CLOUD.pushCapacity().catch(()=>{});
      this.render();
    }));

    document.querySelectorAll('[data-capx-capgroup-cap]').forEach(inp=>inp.addEventListener('change',()=>{
      const card = inp.closest('[data-capx-capgroup-id]');
      const id = card?.dataset.capxCapgroupId;
      const cg = (STATE.capacity.capacityGroups || []).find(g=>g.id === id);
      if (!cg) return;
      const key = inp.dataset.capxCapgroupCap;
      const field = inp.dataset.capxCapField;
      cg.capacity = cg.capacity || {};
      cg.capacity[key] = cg.capacity[key] || { weekday:0, weekend:0 };
      cg.capacity[key][field] = this.n(inp.value);
      cg.updatedAt = new Date().toISOString();
      STORE.save();
      CLOUD.pushCapacity().catch(()=>{});
      this.render();
    }));

  },

  updateMaster(inp) {
    const tr = inp.closest('[data-area]');
    const old = tr.dataset.area;
    const field = inp.dataset.capxMasterField;
    const row = STATE.capacity.areas[old] || {weekday:0,weekend:0,rows:[]};
    if (field === 'area') {
      const name = this.normArea(inp.value);
      if (name && name !== old) {
        delete STATE.capacity.areas[old];
        STATE.capacity.areas[name] = row;
      }
    } else {
      row[field] = this.n(inp.value);
      STATE.capacity.areas[old] = row;
    }
    STORE.save();
    this.render();
  },

  showCities(idx) {
    const row = this._lastRows[idx];
    const box = document.getElementById('capacity-detail-box');
    if (!box || !row) return;
    const cities = Object.entries(row.cities || {}).sort((a,b)=>b[1]-a[1]);
    box.innerHTML = cities.length ? cities.map(([c,n],i)=>`<div class="capx-city"><b>${i+1}</b><span>${esc(c)}</span><em>${fmt(n)}件</em></div>`).join('') : '<div class="capx-empty">該当なし</div>';
  },

  saveSettings() {},


  clearMaster() {
    if (!confirm('作成済みの荷主キャパ区分を初期化しますか？\n※商品・住所CSV、荷主判定ルール、カレンダー補正は残します。')) return;
    this.ensureState();
    STATE.capacity.capacityGroups = [];
    STATE.capacity.areas = {};
    STATE.capacity.sourceFile = '';
    STATE.capacity.rowCount = 0;
    STORE.save();
    this.render();
  },

  populateYMSel() {},

  ensureStyle() {
    if (document.getElementById('capacity-ui-fixed-style')) return;
    const st = document.createElement('style');
    st.id = 'capacity-ui-fixed-style';
    st.textContent = `
      .capx{display:grid;gap:14px}.capx-card{background:#fff;border:1px solid var(--border);border-radius:16px;box-shadow:0 10px 24px rgba(15,23,42,.05);padding:18px}.capx-control{border-top:3px solid var(--navy)}.capx-headline{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.capx h2{margin:0;font-size:22px;font-weight:900}.capx h3{margin:0 0 12px;font-size:16px;font-weight:900}.capx p{margin:4px 0 0;color:var(--text2);font-size:12px;font-weight:700}.capx-cond{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.capx-cond label{font-size:11px;color:var(--text2);font-weight:800}.capx-cond select,.capx-cond input{display:block;margin-top:4px;min-width:160px}.capx-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:14px}.capx-note,.capx-note2{font-size:11px;color:var(--text3);line-height:1.7;margin-top:8px}.capx-kpis{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:12px}.capx-kpi{position:relative;background:#fff;border:1px solid var(--border);border-radius:16px;padding:16px 18px;box-shadow:0 10px 22px rgba(15,23,42,.05);overflow:hidden}.capx-kpi:before{content:'';position:absolute;left:0;top:0;bottom:0;width:5px;background:#2563eb}.capx-kpi.green:before{background:#059669}.capx-kpi.over:before{background:#dc2626}.capx-kpi.full:before{background:#f97316}.capx-kpi.good:before{background:#2563eb}.capx-kpi.unset:before{background:#94a3b8}.capx-kpi.amber:before{background:#f97316}.capx-kpi span{display:block;color:var(--text2);font-size:12px;font-weight:900;margin-bottom:6px}.capx-kpi b{font-size:28px;font-weight:900;color:var(--text)}.capx-kpi em{display:block;font-style:normal;color:var(--text2);font-size:12px;font-weight:800;margin-top:4px}.capx-tabs{display:flex;gap:10px;flex-wrap:wrap;background:#fff;border:1px solid var(--border);border-radius:16px;padding:12px}.capx-tabs button{border:1px solid var(--border2);background:#fff;border-radius:999px;padding:10px 16px;font-weight:900;cursor:pointer}.capx-tabs button.active{background:#2563eb;color:#fff;border-color:#2563eb}.capx-grid{display:grid;grid-template-columns:minmax(620px,1.4fr) minmax(320px,.8fr);gap:14px}.capx-link{border:0;background:transparent;color:#1d4ed8;font-weight:900;cursor:pointer}.capx-risk-over td{background:#fff7f7}.capx-risk-full td{background:#fffaf0}.capx-risk-good td{background:#eff6ff}.capx-risk-unset td{background:#f8fafc}.capx-empty{text-align:center;color:var(--text3);font-weight:800;padding:22px}.capx-calendar{display:grid;grid-template-columns:repeat(7,minmax(120px,1fr));gap:8px;background:#f8fafc;padding:10px;border-radius:14px}.capx-week{text-align:center;font-size:12px;font-weight:900;background:#fff;border:1px solid var(--border);border-radius:10px;padding:8px}.capx-week.sun{color:#b91c1c}.capx-week.sat{color:#1d4ed8}.capx-day{min-height:140px;background:#fff;border:1px solid var(--border);border-radius:14px;padding:9px;display:grid;gap:7px}.capx-day.weekend{background:#eff6ff}.capx-day.ok{background:#ecfdf5}.capx-day.good{background:#eff6ff}.capx-day.full{background:#fff7ed}.capx-day.over{background:#fef2f2}.capx-day.unset{background:#f8fafc}.capx-day.blank{background:transparent;border:0}.capx-daytop{display:flex;justify-content:space-between;gap:8px}.capx-daytop b{font-size:18px}.capx-daytop span{font-size:11px;font-weight:800;color:var(--text2)}.capx-city{display:grid;grid-template-columns:32px 1fr 80px;gap:8px;align-items:center;border:1px solid var(--border);border-radius:12px;padding:8px 10px;margin-bottom:7px}.capx-city b{color:#1d4ed8}.capx-city span{font-weight:900}.capx-city em{font-style:normal;text-align:right;font-weight:900}.capacity-status{display:inline-flex;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:900}.capacity-status.ok{background:#dcfce7;color:#166534}.capacity-status.good{background:#dbeafe;color:#1e40af}.capacity-status.full{background:#ffedd5;color:#9a3412}.capacity-status.over{background:#fee2e2;color:#991b1b}.capacity-status.unset{background:#f1f5f9;color:#64748b;border:1px solid #cbd5e1}
      .capx-calendar-card{padding:18px!important}
      .capx-cal-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:14px}
      .capx-cal-summary{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .capx-cal-summary span{display:inline-flex;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:900;border:1px solid var(--border)}
      .capx-cal-summary .danger{background:#fee2e2;color:#991b1b;border-color:#fecaca}.capx-cal-summary .full{background:#fff7ed;color:#9a3412;border-color:#fed7aa}
      .capx-calendar-layout{display:grid;grid-template-columns:minmax(620px,1.3fr) minmax(320px,.7fr);gap:14px;align-items:start}
      .capx-calendar-simple{display:grid;grid-template-columns:repeat(7,minmax(88px,1fr));gap:8px;background:#f8fafc;padding:10px;border-radius:16px;border:1px solid var(--border)}
      .capx-day-simple{min-height:92px;border:1px solid var(--border);border-radius:14px;background:#fff;display:grid;grid-template-rows:auto 1fr auto;gap:3px;padding:10px;text-align:left;cursor:pointer;position:relative;box-shadow:0 8px 18px rgba(15,23,42,.04)}
      .capx-day-simple:hover{transform:translateY(-1px);box-shadow:0 12px 24px rgba(15,23,42,.08)}
      .capx-day-simple .day-no{font-size:18px;font-weight:900;color:#0f172a}.capx-day-simple strong{font-size:18px;font-weight:900;align-self:center}.capx-day-simple em{font-size:11px;font-style:normal;font-weight:900;color:#64748b}.capx-day-simple i{position:absolute;right:8px;top:8px;border-radius:999px;background:#fff7ed;color:#9a3412;border:1px solid #fed7aa;font-size:10px;font-style:normal;font-weight:900;padding:2px 6px}
      .capx-day-simple.empty{background:#fff;color:#94a3b8}.capx-day-simple.weekend{background:#f8fafc}.capx-day-simple.ok{background:#eff6ff;border-color:#bfdbfe}.capx-day-simple.full{background:#fff7ed;border-color:#fed7aa}.capx-day-simple.over{background:#fef2f2;border-color:#fecaca}.capx-day-simple.blank{visibility:hidden;box-shadow:none;border:0;background:transparent;cursor:default}
      .capx-cal-detail{background:#fff;border:1px solid var(--border);border-radius:16px;box-shadow:0 10px 24px rgba(15,23,42,.05);min-height:260px;overflow:hidden}
      .capx-empty.small{padding:28px 18px;font-size:13px}.capx-cal-detail-inner{display:grid;gap:14px;padding:16px}.capx-cal-detail-title{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);padding-bottom:10px}.capx-cal-detail-title b{display:block;font-size:18px;font-weight:900}.capx-cal-detail-title span{display:block;font-size:12px;color:var(--text2);font-weight:800;margin-top:3px}
      .capx-cal-edit{display:grid;gap:10px}.capx-cal-edit label{display:grid;gap:5px;font-size:12px;font-weight:900;color:var(--text2)}.capx-cal-edit select,.capx-cal-edit input{width:100%;min-width:0}
      .capx-cal-area-list{display:grid;gap:8px}.capx-cal-area-row{display:grid;grid-template-columns:1fr 70px 70px 70px;gap:8px;align-items:center;border:1px solid var(--border);border-radius:12px;padding:9px 10px;background:#fff}.capx-cal-area-row span{font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.capx-cal-area-row b,.capx-cal-area-row em,.capx-cal-area-row strong{text-align:right;font-style:normal;font-weight:900}.capx-cal-area-row.over{background:#fff7f7}.capx-cal-area-row.full{background:#fffaf0}
      @media(max-width:900px){.capx-cal-head{flex-direction:column}.capx-calendar-layout{grid-template-columns:1fr}.capx-calendar-simple{grid-template-columns:repeat(2,minmax(120px,1fr))}.capx-week{display:none}.capx-cal-area-row{grid-template-columns:1fr 60px}.capx-cal-area-row em,.capx-cal-area-row strong{text-align:left}}

      .capx-shipper-summary{display:grid;grid-template-columns:repeat(3,minmax(160px,1fr));gap:12px;margin:14px 0}.capx-mini-card{border:1px solid var(--border);border-radius:14px;padding:14px;background:#f8fafc}.capx-mini-card span{display:block;font-size:12px;font-weight:900;color:var(--text2);margin-bottom:5px}.capx-mini-card b{display:block;font-size:24px;font-weight:900;color:var(--text)}.capx-mini-card em{display:block;font-size:11px;font-style:normal;color:var(--text3);font-weight:800;margin-top:4px}.capx-capgroup-layout{display:grid;grid-template-columns:minmax(420px,.85fr) minmax(480px,1.15fr);gap:14px;align-items:start}.capx-capgroup-form,.capx-capgroup-list{border:1px solid var(--border);border-radius:16px;background:#fff;padding:16px}.capx-capgroup-form h4,.capx-capgroup-list h4{margin:0 0 12px;font-size:15px;font-weight:900}.capx-form-label{display:grid;gap:6px;font-size:12px;font-weight:900;color:var(--text2);margin-bottom:10px}.capx-form-label input,.capx-form-label select{width:100%;min-width:0}.capx-unit-list{display:grid;grid-template-columns:repeat(2,minmax(180px,1fr));gap:10px;background:#f8fafc;border:1px solid var(--border);border-radius:14px;padding:12px;max-height:360px;overflow:auto;margin:10px 0 14px}.capx-unit-card{display:flex;gap:8px;align-items:flex-start;border:1px solid var(--border);border-radius:12px;background:#fff;padding:10px;cursor:pointer}.capx-unit-card:hover{border-color:#93c5fd;background:#eff6ff}.capx-unit-card input{margin-top:3px}.capx-unit-card b{display:block;font-weight:900;color:var(--text);font-size:13px}.capx-unit-card em{display:block;font-style:normal;color:var(--text3);font-size:11px;font-weight:800;margin-top:3px}.capx-group-cap-inputs{display:grid;gap:8px;margin:10px 0 14px}.capx-group-cap-inputs.compact{margin:8px 0 0}.capx-group-cap-row{display:grid;grid-template-columns:120px 1fr 1fr;gap:8px;align-items:center}.capx-group-cap-row b{font-size:12px;font-weight:900}.capx-group-cap-row label{display:grid;gap:3px;font-size:11px;font-weight:900;color:var(--text2)}.capx-group-cap-row input{width:100%;min-width:0}.capx-capgroup-card{border:1px solid var(--border);border-radius:14px;padding:12px;margin-bottom:10px;background:#f8fafc}.capx-capgroup-title{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.capx-capgroup-title input{font-weight:900;font-size:14px;min-width:220px}.capx-capgroup-title em{display:block;font-style:normal;font-size:11px;color:var(--text3);font-weight:800;margin-top:4px}.capx-capgroup-units{margin-top:8px;border-radius:10px;background:#fff;border:1px solid var(--border);padding:8px 10px;font-size:12px;font-weight:900;color:var(--text2);line-height:1.7}

      @media(max-width:900px){.capx-headline{flex-direction:column}.capx-kpis{grid-template-columns:repeat(2,1fr)}.capx-grid{grid-template-columns:1fr}.capx-calendar{grid-template-columns:repeat(2,1fr)}.capx-week{display:none}}
    `;
    document.head.appendChild(st);
  }
};


/* ════════ §20A データ保管場所対応表ヘルパー ═══════════════════ */

/* =====================================================================
   現場明細 CSV完全再構築版（field.jsへ分割）
===================================================================== */


  function capacityDailyCauseHtml(row){
    if (!row) return '<div class="capx-empty">対象データがありません</div>';

    const over = Number(row.count || 0) - Number(row.cap || 0);
    const cities = Array.isArray(row.cities) ? row.cities : [];
    const cityHtml = cities.length
      ? cities.map((c,i)=>`
          <div class="capx-cause-row">
            <b>${i+1}</b>
            <span>${esc(c.city || '')}</span>
            <em>${fmt(c.count || 0)}件</em>
          </div>
        `).join('')
      : '<div class="capx-empty">市区町村内訳なし</div>';

    return `
      <div class="capx-cause-box">
        <div class="capx-cause-head">
          <div>
            <h3>${esc(row.date || '')} / ${esc(row.area || '')}</h3>
            <p>日別超過の原因を、市区町村別の件数で確認します。</p>
          </div>
          <button type="button" class="capx-cause-close" id="capx-cause-close">閉じる</button>
        </div>
        <div class="capx-cause-kpis">
          <div><span>実績</span><b>${fmt(row.count || 0)}件</b></div>
          <div><span>日キャパ</span><b>${fmt(row.cap || 0)}件</b></div>
          <div class="${over > 0 ? 'danger' : 'ok'}"><span>差分</span><b>${over > 0 ? '+' : ''}${fmt(over)}件</b></div>
          <div><span>使用率</span><b>${row.cap > 0 ? pct(row.rate || 0) : '-'}</b></div>
        </div>
        <div class="capx-cause-list">
          ${cityHtml}
        </div>
      </div>
    `;
  }

  function openCapacityDailyCause(key){
    const parts = String(key || '').split('__');
    const date = parts[0] || '';
    const area = parts.slice(1).join('__') || '';

    let rows = [];
    try {
      if (window.CAPACITY_UI && typeof CAPACITY_UI.dailyRows === 'function') {
        rows = CAPACITY_UI.dailyRows();
      }
    } catch(e) {}

    if (!Array.isArray(rows) || !rows.length) {
      rows = window.__CAPACITY_LAST_DAILY_ROWS || [];
    }

    const row = rows.find(r => String(r.date) === date && String(r.area) === area);
    let panel = document.getElementById('capx-cause-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'capx-cause-panel';
      document.body.appendChild(panel);
    }
    panel.innerHTML = capacityDailyCauseHtml(row);
    panel.classList.add('open');

    const close = document.getElementById('capx-cause-close');
    if (close) close.addEventListener('click', ()=>panel.classList.remove('open'));
  }


(function(){
  if (window.__CAPACITY_DAILY_CAUSE_BIND__) return;
  window.__CAPACITY_DAILY_CAUSE_BIND__ = true;
  document.addEventListener('click', function(e){
    const btn = e.target && e.target.closest ? e.target.closest('[data-capx-daily-detail]') : null;
    if (!btn) return;
    e.preventDefault();
    if (typeof openCapacityDailyCause === 'function') {
      openCapacityDailyCause(btn.getAttribute('data-capx-daily-detail'));
    }
  });
})();


(function(){
  if (document.getElementById('capacity-cause-drill-style')) return;
  const st = document.createElement('style');
  st.id = 'capacity-cause-drill-style';
  st.textContent = `
    .capx-mini-detail{
      margin-left:8px;
      border:1px solid #cbd5e1;
      background:#fff;
      color:#1d4ed8;
      border-radius:999px;
      padding:4px 9px;
      font-size:11px;
      font-weight:900;
      cursor:pointer;
    }
    #capx-cause-panel{
      position:fixed;
      right:24px;
      top:84px;
      width:min(460px, calc(100vw - 48px));
      max-height:calc(100vh - 120px);
      overflow:auto;
      z-index:9999;
      display:none;
    }
    #capx-cause-panel.open{display:block;}
    .capx-cause-box{
      background:#fff;
      border:1px solid #dbe3ee;
      border-radius:20px;
      box-shadow:0 24px 60px rgba(15,23,42,.22);
      overflow:hidden;
      color:#0f172a;
      font-family:'Meiryo','Yu Gothic',sans-serif;
    }
    .capx-cause-head{
      display:flex;
      justify-content:space-between;
      gap:12px;
      align-items:flex-start;
      padding:18px 20px;
      background:#f8fafc;
      border-bottom:1px solid #e5e7eb;
    }
    .capx-cause-head h3{margin:0;font-size:17px;font-weight:950;}
    .capx-cause-head p{margin:5px 0 0;color:#64748b;font-size:12px;font-weight:850;}
    .capx-cause-close{
      border:1px solid #cbd5e1;
      background:#fff;
      border-radius:999px;
      padding:7px 12px;
      font-weight:900;
      cursor:pointer;
      white-space:nowrap;
    }
    .capx-cause-kpis{
      display:grid;
      grid-template-columns:repeat(4,1fr);
      gap:8px;
      padding:14px;
      background:#fff;
    }
    .capx-cause-kpis>div{
      border:1px solid #e5e7eb;
      border-radius:14px;
      padding:10px;
      background:#f8fafc;
    }
    .capx-cause-kpis>div.danger{background:#fef2f2;border-color:#fecaca;}
    .capx-cause-kpis>div.ok{background:#ecfdf5;border-color:#bbf7d0;}
    .capx-cause-kpis span{display:block;color:#64748b;font-size:11px;font-weight:900;margin-bottom:5px;}
    .capx-cause-kpis b{font-size:17px;font-weight:950;}
    .capx-cause-list{display:grid;gap:8px;padding:14px;}
    .capx-cause-row{
      display:grid;
      grid-template-columns:32px 1fr 72px;
      gap:8px;
      align-items:center;
      border:1px solid #eef2f7;
      border-radius:12px;
      padding:9px 10px;
      background:#fff;
    }
    .capx-cause-row b{
      width:24px;height:24px;border-radius:999px;
      background:#eaf3ff;color:#1d4ed8;
      display:flex;align-items:center;justify-content:center;
      font-size:12px;
    }
    .capx-cause-row span{font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .capx-cause-row em{text-align:right;font-style:normal;font-weight:950;}
  `;
  document.head.appendChild(st);
})();


(function(){
  if (document.getElementById('capacity-decision-ui-style')) return;
  const st = document.createElement('style');
  st.id = 'capacity-decision-ui-style';
  st.textContent = `
    .capx-section-head{
      display:flex;
      justify-content:space-between;
      gap:16px;
      align-items:flex-start;
      margin-bottom:12px;
    }
    .capx-mini-detail{
      border:1px solid #cbd5e1;
      background:#fff;
      color:#1d4ed8;
      border-radius:999px;
      padding:5px 10px;
      font-size:12px;
      font-weight:900;
      cursor:pointer;
      white-space:nowrap;
    }
    .capx-weekday-grid{
      display:grid;
      grid-template-columns:repeat(7,minmax(150px,1fr));
      gap:10px;
    }
    .capx-weekday-card{
      border:1px solid #dbe3ee;
      border-radius:18px;
      padding:14px;
      background:#fff;
      box-shadow:0 8px 18px rgba(15,23,42,.045);
      display:grid;
      gap:10px;
    }
    .capx-weekday-card.over{background:#fef2f2;border-color:#fecaca;}
    .capx-weekday-card.full{background:#fff7ed;border-color:#fed7aa;}
    .capx-weekday-card.good{background:#eff6ff;border-color:#bfdbfe;}
    .capx-weekday-card.ok{background:#ecfdf5;border-color:#bbf7d0;}
    .capx-weekday-card.unset{background:#f8fafc;border-color:#cbd5e1;}
    .capx-weekday-top{
      display:flex;
      justify-content:space-between;
      gap:8px;
      align-items:center;
    }
    .capx-weekday-top b{font-size:15px;font-weight:950;}
    .capx-weekday-main strong{display:block;font-size:26px;font-weight:950;line-height:1.1;}
    .capx-weekday-main span{display:block;margin-top:5px;color:#64748b;font-size:12px;font-weight:900;}
    .capx-weekday-sub{display:grid;gap:4px;color:#475569;font-size:12px;font-weight:850;}
    .capx-cause-inner{display:grid;gap:14px;}
    .capx-cause-title h4{margin:0;font-size:17px;font-weight:950;}
    .capx-cause-title p{margin:5px 0 0;color:#64748b;font-size:12px;font-weight:850;}
    .capx-cause-kpis{
      display:grid;
      grid-template-columns:repeat(4,1fr);
      gap:8px;
    }
    .capx-cause-kpis>div{
      border:1px solid #e5e7eb;
      border-radius:14px;
      padding:10px;
      background:#f8fafc;
    }
    .capx-cause-kpis>div.danger{background:#fef2f2;border-color:#fecaca;}
    .capx-cause-kpis>div.ok{background:#ecfdf5;border-color:#bbf7d0;}
    .capx-cause-kpis span{display:block;color:#64748b;font-size:11px;font-weight:900;margin-bottom:5px;}
    .capx-cause-kpis b{font-size:17px;font-weight:950;}
    .capx-cause-inner h5{margin:0;font-size:14px;font-weight:950;}
    .capx-cause-list{display:grid;gap:8px;}
    .capx-cause-row{
      display:grid;
      grid-template-columns:32px 1fr 72px;
      gap:8px;
      align-items:center;
      border:1px solid #eef2f7;
      border-radius:12px;
      padding:9px 10px;
      background:#fff;
    }
    .capx-cause-row b{
      width:24px;height:24px;border-radius:999px;
      background:#eaf3ff;color:#1d4ed8;
      display:flex;align-items:center;justify-content:center;
      font-size:12px;
    }
    .capx-cause-row span{font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .capx-cause-row em{text-align:right;font-style:normal;font-weight:950;}
    @media(max-width:1200px){
      .capx-weekday-grid{grid-template-columns:repeat(2,minmax(150px,1fr));}
      .capx-section-head{flex-direction:column;}
    }
  `;
  document.head.appendChild(st);
})();


(function(){
  if (document.getElementById('capacity-final-decision-style')) return;
  const st = document.createElement('style');
  st.id = 'capacity-final-decision-style';
  st.textContent = `
    .capacity-status.alert{
      background:#fed7aa!important;
      color:#9a3412!important;
      border:1px solid #fdba74!important;
    }
    .capx-risk-alert td{background:#fff7ed!important;}
    .capx-kpi.alert:before{background:#f97316!important;}
    .capx-day.alert{background:#fff7ed!important;}
    .capx-weekday-card.alert{background:#fff7ed!important;border-color:#fdba74!important;}
    .capx-action-box{
      border:1px solid #fed7aa;
      background:#fff7ed;
      border-radius:16px;
      padding:12px 14px;
      display:grid;
      gap:7px;
    }
    .capx-action-box h5{
      margin:0;
      font-size:14px;
      font-weight:950;
      color:#9a3412;
    }
    .capx-action-item{
      font-size:13px;
      font-weight:850;
      color:#7c2d12;
      line-height:1.5;
    }
    .capx-city-hint{
      border:1px solid #bfdbfe;
      background:#eff6ff;
      color:#1e3a8a;
      border-radius:14px;
      padding:12px 14px;
      font-size:13px;
      font-weight:900;
      line-height:1.5;
      margin-bottom:10px;
    }
  `;
  document.head.appendChild(st);
})();


(function(){
  if (document.getElementById('capacity-final-color-row-style')) return;
  const st = document.createElement('style');
  st.id = 'capacity-final-color-row-style';
  st.textContent = `
    .capacity-status.collapse{
      background:#7f1d1d!important;
      color:#fff!important;
      border:1px solid #7f1d1d!important;
    }
    .capacity-status.over{
      background:#fee2e2!important;
      color:#991b1b!important;
      border:1px solid #fecaca!important;
    }
    .capacity-status.full{
      background:#ffedd5!important;
      color:#9a3412!important;
      border:1px solid #fed7aa!important;
    }
    .capacity-status.good{
      background:#dbeafe!important;
      color:#1e40af!important;
      border:1px solid #bfdbfe!important;
    }
    .capacity-status.ok{
      background:#dcfce7!important;
      color:#166534!important;
      border:1px solid #bbf7d0!important;
    }
    .capacity-status.unset{
      background:#f1f5f9!important;
      color:#64748b!important;
      border:1px solid #cbd5e1!important;
    }
    .capx-risk-collapse td{background:#fff1f2!important;}
    .capx-risk-over td{background:#fff7f7!important;}
    .capx-risk-full td{background:#fffaf0!important;}
    .capx-risk-good td{background:#eff6ff!important;}
    .capx-risk-ok td{background:#f0fdf4!important;}
    .capx-risk-unset td{background:#f8fafc!important;}
    .capx-click-row{cursor:pointer;}
    .capx-click-row:hover td{outline:1px solid #bfdbfe;background:#eff6ff!important;}
    .capx-click-row.selected td{
      background:#eaf3ff!important;
      box-shadow:inset 4px 0 0 #2563eb;
    }
    .capx-cal-summary{
      display:flex;
      gap:8px;
      align-items:center;
      flex-wrap:wrap;
      justify-content:flex-end;
    }
    .capx-cal-summary span{
      display:inline-flex;
      border-radius:999px;
      border:1px solid #cbd5e1;
      background:#fff;
      padding:7px 10px;
      font-size:12px;
      font-weight:950;
      color:#334155;
    }
    .capx-cal-summary span.danger{background:#fee2e2;color:#991b1b;border-color:#fecaca;}
    .capx-cal-summary span.full{background:#fff7ed;color:#9a3412;border-color:#fed7aa;}
    .capx-cal-summary span.good{background:#eff6ff;color:#1e40af;border-color:#bfdbfe;}
    .capx-cause-kpis>div.danger{background:#fef2f2!important;border-color:#fecaca!important;}
    .capx-cause-kpis>div.ok{background:#ecfdf5!important;border-color:#bbf7d0!important;}
  `;
  document.head.appendChild(st);
})();


(function(){
  if (document.getElementById('capacity-diff-focus-style')) return;
  const st = document.createElement('style');
  st.id = 'capacity-diff-focus-style';
  st.textContent = `
    .capx-diff{
      display:inline-flex;
      justify-content:flex-end;
      min-width:54px;
      font-weight:950;
      font-size:14px;
    }
    .capx-diff.plus{
      color:#991b1b;
    }
    .capx-diff.minus{
      color:#166534;
    }
    .capx-cause-kpis div:nth-child(3){
      background:#fef2f2;
      border-color:#fecaca;
    }
    .capx-kpi.amber em{
      line-height:1.35;
    }
  `;
  document.head.appendChild(st);
})();
