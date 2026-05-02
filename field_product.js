// ===============================
// 商品カテゴリ分析（完全版）
// ===============================

const FIELD_PRODUCT = {

  init(rows){
    if(!rows || rows.length === 0){
      this.renderEmpty();
      return;
    }

    const result = this.aggregate(rows);
    this.render(result);
  },

  // ===============================
  // 集計
  // ===============================
  aggregate(rows){

    const map = {};

    rows.forEach(row=>{

      // ▼ 商品名 or 作業内容 fallback
      let text = row.product_name || '';
      if(!text || text.trim() === ''){
        text = row.work_content || '';
      }

      // ▼ 【】分解
      const parts = this.extractBracket(text);

      parts.forEach(p=>{

        const cls = this.classify(p);

        const key = cls.big + '|' + cls.mid;

        if(!map[key]){
          map[key] = {
            big: cls.big,
            mid: cls.mid,
            count: 0,
            amount: 0
          };
        }

        map[key].count += 1;
        map[key].amount += Number(row.amount || 0);
      });

    });

    return Object.values(map);
  },

  // ===============================
  // 【】分解
  // ===============================
  extractBracket(text){
    const matches = text.match(/【.*?】/g);
    if(matches) return matches;
    return [text];
  },

  // ===============================
  // 正規化
  // ===============================
  normalize(text){
    return (text || '')
      .toLowerCase()
      .replace(/[ー－\-]/g,'-')
      .replace(/ｸﾚｰﾝ/g,'クレーン')
      .replace(/ﾕﾆｯｸ/g,'ユニック')
      .replace(/ﾘｻｲｸﾙ/g,'リサイクル')
      .replace(/ﾚｲｿﾞｳ/g,'冷蔵')
      .replace(/ｾﾝﾀｸ/g,'洗濯');
  },

  // ===============================
  // 分類（最重要）
  // ===============================
  classify(text){

    const t = this.normalize(text);

    // ===== ① クレーン最優先 =====
    if(
      t.includes('クレーン') ||
      t.includes('クーレン') ||
      t.includes('ユニック') ||
      t.includes('unic') ||
      t.includes('吊り')
    ){
      return {big:'クレーン', mid:'クレーン作業'};
    }

    // ===== ② リサイクル =====
    if(t.includes('リサイクル')){
      if(t.includes('冷蔵')) return {big:'リサイクル', mid:'冷蔵庫'};
      if(t.includes('洗濯')) return {big:'リサイクル', mid:'洗濯機'};
      if(t.includes('テレビ') || t.includes('液晶') || t.includes('有機')) return {big:'リサイクル', mid:'テレビ'};
      return {big:'リサイクル', mid:'その他'};
    }

    // ===== ③ 冷蔵庫 =====
    if(t.includes('冷蔵')){
      const vol = this.extractVolume(text);
      return {big:'冷蔵庫', mid: vol || '容量不明'};
    }

    // ===== ④ 洗濯機 =====
    if(t.includes('洗濯') || t.includes('ドラム')){
      return {big:'洗濯機', mid:''};
    }

    // ===== ⑤ テレビ =====
    if(t.includes('テレビ') || t.includes('液晶') || t.includes('有機') || t.includes('oled')){
      return {big:'テレビ', mid:''};
    }

    // ===== ⑥ 作業 =====
    if(t.includes('設置') || t.includes('搬入')){
      return {big:'作業', mid:'設置'};
    }

    if(t.includes('見積') || t.includes('下見')){
      return {big:'作業', mid:'見積'};
    }

    if(t.includes('階段')){
      return {big:'作業', mid:'階段上げ'};
    }

    return {big:'付帯作業・その他', mid:''};
  },

  // ===============================
  // 冷蔵庫容量抽出
  // ===============================
  extractVolume(text){

    const num = text.match(/\d+/);
    if(!num) return null;

    let v = Number(num[0]);

    if(v < 100) v = v * 10;

    const base = Math.floor(v / 100) * 100;

    return base + 'L台';
  },

  // ===============================
  // 表示
  // ===============================
  render(data){

    const tbody = document.getElementById('f-product-tbody');
    if(!tbody) return;

    tbody.innerHTML = '';

    data.sort((a,b)=>b.amount - a.amount);

    data.forEach(d=>{

      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td>${d.big}</td>
        <td>${d.mid || '-'}</td>
        <td class="r">${d.count}</td>
        <td class="r">${Math.round(d.amount)}</td>
        <td class="r">-</td>
      `;

      tbody.appendChild(tr);
    });
  },

  renderEmpty(){
    const tbody = document.getElementById('f-product-tbody');
    if(tbody){
      tbody.innerHTML = `<tr><td colspan="5">データなし</td></tr>`;
    }
  }

};
