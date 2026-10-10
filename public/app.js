/* ============================================================
 * PULSE DIET · 核心逻辑
 * ============================================================ */

/* ---------- 小工具 ---------- */
function ymd(d) {
  const x = new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}
function todayStr() { return ymd(new Date()); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function r1(v) { return Math.round(v * 10) / 10; }
function r0(v) { return Math.round(v); }
function uid(p) { return (p || 'i') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

/* ---------- 内置庆祝动效（不依赖任何 CDN） ---------- */
function confetti(colors, count) {
  try {
    const cs = colors || ['#10B981', '#06B6D4', '#FBBF24', '#FB7185', '#A78BFA'];
    const n = count || 70;
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden';
    for (let i = 0; i < n; i++) {
      const el = document.createElement('i');
      const size = 5 + Math.random() * 6;
      const left = Math.random() * 100;
      const delay = Math.random() * 0.6;
      const dur = 1.6 + Math.random() * 1.4;
      const rot = Math.random() * 720 - 360;
      el.style.cssText =
        'position:absolute;top:-14px;left:' + left + '%;width:' + size + 'px;height:' + (size * 1.6) + 'px;' +
        'background:' + cs[i % cs.length] + ';opacity:.95;border-radius:2px;' +
        'animation:pdFall ' + dur + 's ' + delay + 's linear forwards;transform:rotate(' + rot + 'deg)';
      root.appendChild(el);
    }
    document.body.appendChild(root);
    setTimeout(() => { if (root.parentNode) root.parentNode.removeChild(root); }, 3600);
  } catch (e) {}
}

/* ---------- 食物查询：内置 + 自定义 + 覆盖 ---------- */
function makeFoodIndex(customFoods, overrides) {
  const base = (window.FOOD_DB || []).concat(window.OTHER_FOODS || []);
  const all = base.concat(customFoods || []).map(f => {
    const ov = (overrides || {})[f.id];
    const n = ov && ov.n ? Object.assign({}, f.n, ov.n) : f.n;
    return Object.assign({}, f, { n: n, custom: false, overridden: !!ov });
  });
  (customFoods || []).forEach(c => { const t = all.find(x => x.id === c.id); if (t) t.custom = true; });
  const map = {};
  all.forEach(f => { map[f.id] = f; });
  return { all, map };
}

/* ---------- 每 100g 营养（按状态推导） ---------- */
function per100(food, state) {
  if (!food) return { p: 0, f: 0, c: 0, fiber: 0, kcal: 0 };
  const source = food.n && typeof food.n === 'object' ? food.n : {};
  const n = {};
  ['p', 'f', 'c', 'fiber', 'kcal'].forEach(k => {
    const value = Number(source[k]);
    n[k] = Number.isFinite(value) && value >= 0 ? value : 0;
  });
  const base = food.base === 'raw' ? 'raw' : 'cooked';
  const requestedState = state === 'raw' || state === 'cooked' ? state : base;
  const ratio = Number(food.yield);
  const y = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  if (requestedState === base || y === 1) return n;
  const factor = base === 'raw' ? (1 / y) : y;
  return { p: n.p * factor, f: n.f * factor, c: n.c * factor, fiber: n.fiber * factor, kcal: n.kcal * factor };
}

/* ---------- 目标引擎 ----------
 * 数字锚定以 78kg 为基准，按体重线性缩放。
 * 热量调整（±%）优先由碳水承担，其次脂肪；蛋白质受保护不被动削减。
 */
function buildTargets(weight, dayType, adjustPct, override) {
  const W = clamp(Number(weight) || 78, 30, 200);
  const S = W / 78;
  const isRest = dayType === 'rest';
  const heavy = dayType === 'lower';

  let coef, refs, nutT, fruitT;
  if (isRest) {
    coef = { c: 1.7, p: 1.8, f: 0.90 };
    refs = { carb: [100, 130], protein: [130, 140], fat: [60, 70], net: [60, 90], kcal: [1700, 1850] };
    nutT = 30; fruitT = 150;
  } else {
    coef = heavy ? { c: 4.5, p: 2.3, f: 0.65 } : { c: 4.0, p: 2.0, f: 0.50 };
    refs = { carb: [310, 350], protein: [160, 180], fat: [40, 50], net: [280, 320], kcal: [2500, 2700] };
    nutT = 0; fruitT = 200;
  }

  let carb = coef.c * W, protein = coef.p * W, fat = coef.f * W;
  const baseKcal = carb * 4 + protein * 4 + fat * 9;
  const targetKcal = baseKcal * (1 + (Number(adjustPct) || 0) / 100);

  const carbFloor = isRest ? 40 : 150;
  const carbCeil = isRest ? 2.5 * W : 6.0 * W;
  const fatFloor = 0.5 * W, fatCeil = 1.2 * W;

  let delta = targetKcal - baseKcal;
  let unmet = 0;
  if (delta < -0.5) {
    const cut = Math.min(Math.max(0, carb - carbFloor), (-delta) / 4); carb -= cut; delta += cut * 4;
    if (delta < -0.5) { const cf = Math.min(fat - fatFloor, (-delta) / 9); fat -= cf; delta += cf * 9; }
    unmet = -delta;
  } else if (delta > 0.5) {
    const add = Math.min(Math.max(0, carbCeil - carb), delta / 4); carb += add; delta -= add * 4;
    if (delta > 0.5) { const af = Math.min(fatCeil - fat, delta / 9); fat += af; delta -= af * 9; }
    unmet = delta;
  }
  if (carb < carbFloor) carb = carbFloor;
  if (fat < fatFloor) fat = fatFloor;

  let kcal = carb * 4 + protein * 4 + fat * 9;

  const t = {
    protein: r0(protein), carb: r0(carb), fat: r0(fat), kcal: r0(kcal),
    vege: 500, fruit: fruitT, nut: nutT,
    net: [r0(refs.net[0] * S), r0(refs.net[1] * S)]
  };
  if (override && typeof override === 'object') {
    ['protein', 'carb', 'fat', 'kcal', 'vege', 'fruit', 'nut'].forEach(k => {
      if (override[k] !== undefined && override[k] !== null && override[k] !== '') t[k] = Number(override[k]);
    });
  }

  const refScaled = {
    carb: [r0(refs.carb[0] * S), r0(refs.carb[1] * S)],
    protein: [r0(refs.protein[0] * S), r0(refs.protein[1] * S)],
    fat: [r0(refs.fat[0] * S), r0(refs.fat[1] * S)],
    kcal: [r0(refs.kcal[0] * S), r0(refs.kcal[1] * S)]
  };

  const kcalLo = refScaled.kcal[0], kcalHi = refScaled.kcal[1];
  const off = kcal < kcalLo - 20 || kcal > kcalHi + 20;
  const diff = kcal < kcalLo ? kcalLo - kcal : (kcal > kcalHi ? kcal - kcalHi : 0);

  return {
    t, refScaled, baseKcal: r0(baseKcal), unmet: r0(unmet), W, isRest, heavy,
    recon: { off, diff: r0(diff), dir: kcal < kcalLo ? 'low' : (kcal > kcalHi ? 'high' : 'ok') }
  };
}

/* ---------- 汇总 ---------- */
/* 单条克数硬上限：录入端已拦，但历史上曾混进 50000 g 这类脏数据
 * （表现为「新的一天上来就超」）。汇总端按同一口径再拦一次：
 * 越界的条目不计入统计，同时界面弹红色横幅提示清理——不静默删用户数据，
 * 也不让一条脏数据污染全天的判断。 */
const MAX_ITEM_GRAMS = 5000;
function isBadItem(it, foodMap) {
  if (!it || typeof it !== 'object') return true;
  const g = Number(it.grams);
  if (!Number.isFinite(g) || g <= 0 || g > MAX_ITEM_GRAMS) return true;
  return !foodMap || !foodMap[it.foodId];
}
function countedItems(items) {
  return (items || []).filter(it => it && !it.pendingConfirmation);
}
function sumItems(items, foodMap) {
  const s = { p: 0, f: 0, c: 0, fiber: 0, kcal: 0, vege: 0, fruit: 0, nut: 0, grams: 0 };
  countedItems(items).forEach(it => {
    if (typeof it !== 'object') return;
    const food = (foodMap || {})[it.foodId];
    const n = per100(food, it.state);
    const grams = Number(it.grams);
    const g = Number.isFinite(grams) && grams > 0 && grams <= MAX_ITEM_GRAMS ? grams : 0;
    const k = g / 100;
    s.p += n.p * k; s.f += n.f * k; s.c += n.c * k; s.fiber += n.fiber * k; s.kcal += n.kcal * k;
    s.grams += g;
    if (food) {
      const cat = food.cat || it.cat;
      if (cat === 'vege') s.vege += g;
      else if (cat === 'fruit') s.fruit += g;
      else if (cat === 'nut') s.nut += g;
    }
  });
  s.netC = Math.max(0, s.c - s.fiber);
  return s;
}

/* ---------- 按餐次汇总（每餐 30-45g 蛋白检查） ---------- */
function mealBreakdown(items, foodMap, dayType) {
  const meals = window.MEALS || [];
  const isRest = dayType === 'rest';
  const list = meals.filter(m => !(isRest && m.trainOnly));
  const out = list.map(m => {
    const its = (items || []).filter(i => i.meal === m.k && !i.pendingConfirmation);
    const s = sumItems(its, foodMap);
    return {
      k: m.k, name: m.name, icon: m.icon,
      items: its, p: s.p, kcal: s.kcal, c: s.c, f: s.f,
      count: its.length
    };
  });
  // 未分配餐次的归入「未归类」
  const loose = (items || []).filter(i => !list.some(m => m.k === i.meal));
  if (loose.length) {
    const s = sumItems(loose, foodMap);
    out.push({ k: '__none', name: '未归类', icon: 'fa-circle-question', items: loose, p: s.p, kcal: s.kcal, c: s.c, f: s.f, count: loose.length });
  }
  return out;
}

/* ---------- 禁区预警 ---------- */
function buildWarnings(totals, t, dayType, items, foodMap, unmet, periMeals) {
  const w = [];
  const isRest = dayType === 'rest';
  // 未传则退回保守口径（锁练前/练后）
  const PERI = Array.isArray(periMeals) ? periMeals : ['pre', 'post'];

  if (!isRest) {
    /* 训练日的脂肪管理是「时间窗口」问题，不是「全天封杀」问题。
     * 围训练期（练前 → 练后）严格控脂完全正确：脂肪减慢胃排空，且高胰岛素环境下
     * LPL 活性在脂肪组织飙升，会把脂肪直接锁进脂肪细胞。
     * 但全天禁脂会凑不齐配额（下肢日约 51 g），长期不足会压低睾酮。
     * 所以：只有落在 pre / post 餐次才报红；其余餐次给正向引导。 */
    // 可见脂肪 = 显式标签，或归入「脂肪」「坚果」分类的食物
    // （坚果虽在独立分类，但同样是可直接看见、会显著减慢胃排空的脂肪来源）
    const isVisFat = (it) => {
      const f = foodMap[it.foodId] || {};
      if ((f.tags || []).indexOf('visibleFat') >= 0) return true;
      return f.cat === 'fat' || f.cat === 'nut';
    };
    const peri = (items || []).filter(it => PERI.indexOf(it.meal) >= 0 && isVisFat(it));
    if (peri.length) {
      w.push({
        lv: 'red', t: '围训练期禁区：可见脂肪',
        d: '「' + peri.map(x => x.name).join('、') + '」落在围训练期餐次（' + PERI.join('/') + '）。脂肪会减慢胃排空，且高胰岛素环境下易被直接锁入脂肪细胞。请把它们移到远离训练的餐次。'
      });
    }
    const oilG = (items || []).filter(it => it.foodId === 'oil').reduce((a, b) => a + (Number(b.grams) || 0), 0);
    const oilPeri = (items || []).filter(it => it.foodId === 'oil' && PERI.indexOf(it.meal) >= 0)
      .reduce((a, b) => a + (Number(b.grams) || 0), 0);
    if (oilPeri > 5) {
      w.push({ lv: 'red', t: '围训练期：控脂餐次用油', d: '围训练期餐次（' + PERI.join('/') + '）已用油 ' + r0(oilPeri) + ' g（' + r0(oilPeri * 9) + ' kcal）。这几餐请改为无油烹调。' });
    } else if (oilG > 10) {
      w.push({ lv: 'amber', t: '炒菜用油偏高', d: '当前食用油 ' + r0(oilG) + ' g（' + r0(oilG * 9) + ' kcal）。训练日建议控制在 10 g 内，其余餐次改用无油蔬菜。' });
    }
    /* 正向引导：脂肪是配额，不是敌人 */
    const fatLeft = t.fat - totals.f;
    if (fatLeft > 8 && totals.kcal > 0) {
      w.push({
        lv: 'info', t: '脂肪配额还剩 ' + r0(fatLeft) + ' g',
        d: '瘦肉与碳水的「隐形脂肪」通常只有 20-30 g，全天零可见脂肪会凑不齐 ' + t.fat + ' g。把可见脂肪安排在远离训练的餐次（如晨练则放晚餐），既填满配额也维持激素水平。'
      });
    }
    if (totals.f > t.fat * 1.1) w.push({ lv: 'red', t: '脂肪超上限', d: '已达 ' + r0(totals.f) + ' g / 目标 ' + t.fat + ' g。高胰岛素环境下多余脂肪会被直接储存。' });
  } else {
    const fast = (items || []).filter(it => { const f = foodMap[it.foodId]; return f && (f.tags || []).indexOf('fastcarb') >= 0; });
    if (fast.length) w.push({ lv: 'red', t: '休息日禁区：快碳', d: '检测到 ' + fast.map(x => x.name).join('、') + '。低胰岛素环境是恢复敏感度的前提，请改红薯/南瓜/蓝莓。' });
    const pw = (items || []).find(it => it.foodId === 'protein_powder');
    if (pw) w.push({
      lv: 'amber', t: '休息日建议停用乳清',
      // mTORC1 在休息日同样需要被激活来维持 MPS——问题不在「刺不刺激 mTOR」，
      // 而在乳清吸收过快：血浆亮氨酸骤升骤降，且饱腹感差。
      d: '已记 ' + r0(pw.grams) + ' g。休息日仍需维持肌肉合成（MPS），但建议停用快吸收的乳清，改用天然肉类提供缓慢、持续的氨基酸流（4-6 小时），同时增加饱腹感。'
    });
    // 130 g 是 78 kg 锚点下的红线（1.67 g/kg）。换到 58 kg 的琳达应同比缩放，
    // 否则小体重用户天天假报红、大体重用户永远不报。蛋白目标 1.8 g/kg → 红线 0.92 倍。
    const pFloor = Math.max(90, Math.round((Number(t.protein) || 140) * 0.92));
    if (totals.p < pFloor) w.push({ lv: 'red', t: '蛋白质不足', d: '仅 ' + r0(totals.p) + ' g。低于 ' + pFloor + ' g 会触发肌肉分解，这是休息日的红线。' });
    if (totals.nut > 30) w.push({ lv: 'amber', t: '坚果过量', d: '已 ' + r0(totals.nut) + ' g，超过 20-30 g 上限，会挤占蛋白质空间。' });
    const gap = t.kcal - totals.kcal;
    if (totals.kcal > 0 && gap > 600) w.push({ lv: 'red', t: '热量缺口过大', d: '缺口 ' + r0(gap) + ' kcal，超过 600 kcal 会触发皮质醇升高。' });
  }

  if (totals.vege < 300 && totals.kcal > 0) w.push({ lv: 'amber', t: '深色蔬菜不足', d: '仅 ' + r0(totals.vege) + ' g / 目标 500 g。纤维、钾、镁、叶酸的主要来源。' });
  if (totals.p > 0 && totals.p < t.protein * 0.5) w.push({ lv: 'amber', t: '蛋白质推进过半不足', d: '已 ' + r0(totals.p) + ' g / 目标 ' + t.protein + ' g。建议每餐 30-45 g 均匀分布。' });
  if (unmet > 60) w.push({ lv: 'amber', t: '热量调整未完全落地', d: '受蛋白质与脂肪下限保护，还有 ' + r0(unmet) + ' kcal 无法由碳水/脂肪吸收。可放宽调整幅度。' });

  return w;
}

/* ---------- 补缺口建议：把「还差 X g」换算成具体食物 ---------- */
function fixSuggestions(totals, t, dayType, foodMap, mealKey) {
  const isRest = dayType === 'rest';
  const out = [];
  const FX = window.FIX_SUGGEST || {};
  const push = (key, value, target, unit) => {
    const gap = target - value;
    if (gap <= 1) return;
    const cands = (FX[key] || []).filter(s => {
      const f = foodMap[s.id]; if (!f) return false;
      if (s.restOnly && !isRest) return false;   // 仅休息日适用
      if (s.trainOnly && isRest) return false;   // 仅训练日适用（围训练期补剂）
      if (mealKey && s.fit && s.fit.indexOf(mealKey) < 0) return false;
      // awayOnly（可见脂肪）：训练日仍可推荐，由 addItem 自动避开练前/练后餐次
      return true;
    });
    if (!cands.length) return;
    const capOf = (s) => s.cap || (key === 'vege' ? 800 : 500);
    const nk = key === 'protein' ? 'p' : (key === 'carb' ? 'c' : (key === 'fat' ? 'f' : 'p'));
    const mk = (s) => {
      const f = foodMap[s.id];
      const n = per100(f, f.base);
      const per = key === 'vege' ? 100 : n[nk];
      if (!(per > 0)) return null;
      const need = Math.round(gap / per * 100 / 10) * 10;
      // 一顿吃不完就按上限给，并标明这一份实际能补多少
      const grams = Math.min(need, Math.round(capOf(s) / 10) * 10);
      const covers = r1(grams * per / 100);
      return {
        id: s.id, label: s.label, grams, state: f.base || 'cooked',
        kcal: r0(n.kcal * grams / 100),
        partial: grams < need, covers
      };
    };
    // 排序：先看这一份实际能补多少（多者优先）；补得一样多时，取吃得更少的那个
    const ranked = cands.map(mk).filter(Boolean)
      .sort((a, b) => (b.covers - a.covers) || (a.grams - b.grams));
    const options = ranked.slice(0, 4);
    if (!options.length) return;
    out.push({
      key, label: key === 'protein' ? '蛋白质' : (key === 'carb' ? '碳水' : (key === 'fat' ? '脂肪' : '深色蔬菜')),
      gap: r0(gap), unit, options
    });
  };
  push('protein', totals.p, t.protein, 'g');
  push('carb', totals.c, t.carb, 'g');
  push('fat', totals.f, t.fat, 'g');
  push('vege', totals.vege, t.vege, 'g');
  return out;
}

/* ---------- SOP 清单 ----------
 * 2026-10-08 改造：原来「半根香蕉 + 15-20g 乳清蛋白」挤在同一条里 —— 既不能分开确认、
 * 也不能单独调量、更无法单独换食物。现拆成独立条目：
 *   带 def 的条目 = 食物条目（可换食物 / 调克数 / 确认后按 slot 计入已摄入，并标注练前·练后）
 *   只有 d 的条目 = 纯提示条目（保留原来的勾选打卡）
 */
const SOP_TRAIN = [
  { k: 'pre_carb',  t: '练前 30 分钟 · 快碳',    slot: 'pre',  def: { id: 'banana', grams: 60 } },
  { k: 'pre_pro',   t: '练前 30 分钟 · 蛋白',    slot: 'pre',  def: { id: 'protein_powder', grams: 20 } },
  { k: 'mid',       t: '练中',                   d: '纯水 + 少量海盐' },
  { k: 'post_carb', t: '练后 30 分钟内 · 快碳',  slot: 'post', def: { id: 'banana', grams: 60 } },
  { k: 'post_pro',  t: '练后 30 分钟内 · 蛋白',  slot: 'post', def: { id: 'protein_powder', grams: 35 } },
  { k: 'meal',      t: '练后 1-2 小时正餐',      d: '白米饭/红薯 + 去皮瘦肉 + 无油蔬菜' }
];
const SOP_REST = [
  { k: 'fish',  t: '抗炎组合',         d: '三文鱼 + 纳豆（Omega-3 + 纳豆激酶）', def: { id: 'salmon', grams: 120 } },
  { k: 'vege',  t: '深色蔬菜 500 g',   d: '纤维喂养益生菌，提供钾镁叶酸',        def: { id: 'broccoli', grams: 300 } },
  { k: 'nosup', t: '不用蛋白粉',       d: '蛋白全部来自天然食物' },
  { k: 'nut',   t: '坚果限量 20-30 g', d: '避免过量 Omega-6',                    def: { id: 'walnut', grams: 25 } }
];

/* ---------- 达标档位判定 ---------- */
function cheerLevel(totals, t) {
  const hit = (v, tg) => tg > 0 && v >= tg * 0.95;
  const near = (v, tg) => tg > 0 && v >= tg * 0.85;
  const all = ['protein', 'carb', 'fat', 'vege'].map(k => ({ k, v: totals[k === 'protein' ? 'p' : (k === 'carb' ? 'c' : (k === 'fat' ? 'f' : 'vege'))], tg: t[k] }));
  const doneCount = all.filter(x => hit(x.v, x.tg)).length;
  if (totals.kcal <= 0) return { lv: 'start', done: 0, total: all.length };
  if (doneCount === all.length) return { lv: 'perfect', done: doneCount, total: all.length };
  if (doneCount >= 2) return { lv: 'good', done: doneCount, total: all.length };
  if (hit(totals.p, t.protein) || near(totals.p, t.protein)) return { lv: 'protein', done: doneCount, total: all.length };
  const frac = t.protein > 0 ? totals.p / t.protein : 0;
  if (frac >= 0.5) return { lv: 'halfway', done: doneCount, total: all.length };
  return { lv: 'start', done: doneCount, total: all.length };
}

/* ============================================================
 * Vue 应用
 * ============================================================ */
const { createApp, ref, reactive, computed, watch, onMounted } = Vue;

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null || v === undefined ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

/* 内联默认头像：不依赖任何外网 CDN（外链在国内极易加载失败导致破图） */
const DEFAULT_AVATARS = {
  Leo: 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2296%22%20height%3D%2296%22%20viewBox%3D%220%200%2096%2096%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22g%22%20x1%3D%220%22%20y1%3D%220%22%20x2%3D%221%22%20y2%3D%221%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%2310B981%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%2306B6D4%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Ccircle%20cx%3D%2248%22%20cy%3D%2248%22%20r%3D%2248%22%20fill%3D%22url(%23g)%22%2F%3E%3Ccircle%20cx%3D%2248%22%20cy%3D%2237%22%20r%3D%2214%22%20fill%3D%22%23FFFFFF%22%20opacity%3D%220.95%22%2F%3E%3Cpath%20d%3D%22M16%2086c0-17.7%2014.3-32%2032-32s32%2014.3%2032%2032z%22%20fill%3D%22%23FFFFFF%22%20opacity%3D%220.95%22%2F%3E%3C%2Fsvg%3E',
  琳达: 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2296%22%20height%3D%2296%22%20viewBox%3D%220%200%2096%2096%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22g%22%20x1%3D%220%22%20y1%3D%220%22%20x2%3D%221%22%20y2%3D%221%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%23F43F5E%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23F59E0B%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Ccircle%20cx%3D%2248%22%20cy%3D%2248%22%20r%3D%2248%22%20fill%3D%22url(%23g)%22%2F%3E%3Ccircle%20cx%3D%2248%22%20cy%3D%2237%22%20r%3D%2214%22%20fill%3D%22%23FFFFFF%22%20opacity%3D%220.95%22%2F%3E%3Cpath%20d%3D%22M16%2086c0-17.7%2014.3-32%2032-32s32%2014.3%2032%2032z%22%20fill%3D%22%23FFFFFF%22%20opacity%3D%220.95%22%2F%3E%3C%2Fsvg%3E'
};

createApp({
  setup() {
    /* ---------- 基础状态 ---------- */
    const user = ref(LS.get('diet_user', 'Leo') || 'Leo');
    const users = ['Leo', '琳达'];
    const dateStr = ref(todayStr());
    const tab = ref('add');
    const activeCat = ref('protein');
    const searchQ = ref('');
    const copyFromDate = ref('');
    const cloudOk = ref(true);
    const cloudMsg = ref('');
    const toastMsg = ref('');
    const toastTimer = ref(null);
    const undoStack = ref([]);

    const logs = ref([]);
    const customFoods = ref([]);
    const overrides = ref({});
    const prefs = ref(null);
    const media = ref({ avatars: {}, cheer: null });

    const dayTypes = [
      { k: 'lower', label: '下肢训练', sub: '大重量·取上限' },
      { k: 'upper', label: '上肢训练', sub: '中等强度·取下限' },
      { k: 'rest',  label: '休息日',   sub: '低碳·恢复敏感度' }
    ];
    const adjustOptions = [-20, -15, -10, -5, 0, 5, 10, 15, 20];

    /* ---------- 偏好 ---------- */
    function defaultPrefs() {
      return {
        activeUser: 'Leo',
        users: {
          Leo:  { weight: 78, lastDayType: 'lower', lastAdjust: 0, itemPrefs: {}, favs: [], favMeta: {}, favSeeded: false, targetOverride: null, weights: [] },
          琳达: { weight: 58, lastDayType: 'upper', lastAdjust: 0, itemPrefs: {}, favs: [], favMeta: {}, favSeeded: false, targetOverride: null, weights: [] }
        },
        /* 训练时段：用于判定哪些餐次落在「围训练期」
         * Leo 常态：凌晨 03:00-05:00 训练，06:30 后早餐。
         * postHours=1 时窗口为 01:00-06:00，早餐 6:30 已出窗口 → 正常吃脂肪没问题。 */
        train: { enabled: true, start: '03:00', end: '05:00', preHours: 2, postHours: 1, breakfast: '06:30', lunch: '12:00', dinner: '18:30', snack: '15:00' }
      };
    }
    /* 档案归一化：本机档案、云端拉回的档案都要过一遍。
     * 尤其是云端档案可能是旧版本写的（缺 favMeta / favSeeded），
     * 不同步补齐的话「常见食物」展区会整片空白。 */
    function normalizePrefs(p) {
      if (!p || !p.users) return p;
      Object.keys(p.users).forEach(u => {
        const o = p.users[u];
        if (!o) return;
        if (!o.favs) o.favs = [];
        if (!o.weights) o.weights = [];
        if (!o.itemPrefs) o.itemPrefs = {};
        if (!o.favMeta) o.favMeta = {};
        // 首次使用：播一份「常见食物」起点。已有常用列表的用户一律不动。
        if (!o.favSeeded) {
          if (o.favs.length) { o.favSeeded = true; }
          else {
            const valid = (window.COMMON_PRESETS || []).filter(id => (window.FOOD_DB || []).some(f => f.id === id));
            o.favs = valid.slice();
            valid.forEach(id => { o.favMeta[id] = { uses: 0, manual: false, hidden: false, preset: true }; });
            o.favSeeded = true;
          }
        }
      });
      return p;
    }
    if (!prefs.value) {
      let p = null;
      try { p = JSON.parse(LS.get('diet_prefs', 'null') || 'null'); } catch (e) {}
      prefs.value = (p && p.users) ? p : defaultPrefs();
      if (!prefs.value.train) prefs.value.train = defaultPrefs().train;
      normalizePrefs(prefs.value);
    }
    const up = computed(() => prefs.value.users[user.value] || prefs.value.users.Leo);

    /* ---------- 当日档案 ---------- */
    function blankDay() {
      return {
        date: dateStr.value, user: user.value,
        weight: up.value.weight, dayType: up.value.lastDayType, adjust: up.value.lastAdjust,
        items: [], sop: {}, notes: '', targetOverride: null, cheered: false
      };
    }
    const day = computed(() => {
      const f = logs.value.find(l => l.date === dateStr.value && l.user === user.value);
      return f || blankDay();
    });
    const ensureDay = () => {
      let d = logs.value.find(l => l.date === dateStr.value && l.user === user.value);
      if (!d) { d = blankDay(); logs.value.push(d); }
      return d;
    };

    const weight = computed({
      get: () => day.value.weight || up.value.weight,
      set: v => {
        const n = Number(v) || 78;
        ensureDay().weight = n; up.value.weight = n;
        // 体重历史：同日覆盖
        const w = up.value.weights || (up.value.weights = []);
        const idx = w.findIndex(x => x.date === dateStr.value);
        if (idx >= 0) w[idx].v = n; else w.push({ date: dateStr.value, v: n });
        save();
      }
    });
    const dayType = computed({ get: () => day.value.dayType || 'lower', set: v => { ensureDay().dayType = v; up.value.lastDayType = v; save(); } });
    const adjust = computed({ get: () => day.value.adjust || 0, set: v => { ensureDay().adjust = Number(v) || 0; up.value.lastAdjust = Number(v) || 0; save(); } });

    /* ---------- 目标 ---------- */
    const built = computed(() => buildTargets(weight.value, dayType.value, adjust.value, day.value.targetOverride));
    const targets = computed(() => built.value.t);
    const refScaled = computed(() => built.value.refScaled);

    /* ---------- 食物索引 ---------- */
    const foodIndex = computed(() => makeFoodIndex(customFoods.value, overrides.value));
    const foodMap = computed(() => foodIndex.value.map);
    const allFoods = computed(() => foodIndex.value.all);

    const totals = computed(() => sumItems(day.value.items, foodMap.value));

    /* ---------- 环形卡片 ---------- */
    function ringOf(key, label, value, target, unit, color, zeroHint) {
      let pct = target > 0 ? (value / target) * 100 : (value > 0 ? 999 : 0);
      let status = 'ok';
      if (target === 0) status = value > 0 ? 'over' : 'ok';
      else if (pct < 60) status = 'low';
      else if (pct <= 105) status = 'ok';
      else status = 'over';
      let delta = '';
      if (target === 0) {
        // 目标为 0 不等于「全天禁区」：训练日坚果的 0 是「建议不主动吃」，
        // 真要吃请放远离训练的餐次。文案由 zeroHint 决定。
        delta = value > 0
          ? (zeroHint || '建议零摄入') + ' · 已吃 ' + r0(value) + ' ' + unit
          : (zeroHint || '保持零摄入');
      }
      else if (value < target) delta = '还差 ' + r0(target - value) + ' ' + unit;
      else if (value > target) delta = '已超 ' + r0(value - target) + ' ' + unit;
      else delta = '刚好达标';
      const CIRC = 251.3;
      const arc = clamp(pct, 0, 100);
      return {
        key, label, value, target, unit, color, status, delta,
        pct: Math.round(pct),
        showPct: target > 0 ? Math.round(pct) : (value > 0 ? 999 : 0),
        dash: CIRC, offset: CIRC * (1 - arc / 100)
      };
    }
    const rings = computed(() => {
      const t = targets.value, s = totals.value;
      const periHint = dayType.value === 'rest' ? '建议零摄入' : '围训练期避免';
      return [
        ringOf('protein', '蛋白质', s.p, t.protein, 'g', '#10B981'),
        ringOf('carb', '碳水', s.c, t.carb, 'g', '#38BDF8'),
        ringOf('fat', '脂肪', s.f, t.fat, 'g', '#F59E0B'),
        ringOf('kcal', '热量', s.kcal, t.kcal, 'kcal', '#A78BFA'),
        ringOf('vege', '深色蔬菜', s.vege, t.vege, 'g', '#22C55E'),
        ringOf('fruit', '水果', s.fruit, t.fruit, 'g', '#FB7185'),
        ringOf('nut', '坚果', s.nut, t.nut, 'g', '#F97316',
          t.nut === 0 ? periHint + '（可放早餐/晚餐）' : '')
      ];
    });
    const netCarb = computed(() => {
      const s = totals.value, t = targets.value;
      const hi = t.net[1] || 1;
      return {
        v: s.netC, lo: t.net[0], hi: t.net[1],
        status: s.netC > t.net[1] ? 'over' : (s.netC < t.net[0] ? 'low' : 'ok'),
        w: clamp(s.netC / hi * 100, 0, 100)
      };
    });
    /* 供能占比：同时给出「目前占比」与由当日目标反推的「最佳占比」 */
    const macroSplit = computed(() => {
      const s = totals.value, t = targets.value;
      const pk = s.p * 4, ck = s.c * 4, fk = s.f * 9;
      const tot = pk + ck + fk || 1;
      const tp = (t.protein || 0) * 4, tc = (t.carb || 0) * 4, tf = (t.fat || 0) * 9;
      const tt = tp + tc + tf || 1;
      return [
        { k: '蛋白', v: pk, pct: Math.round(pk / tot * 100), best: Math.round(tp / tt * 100), c: '#10B981' },
        { k: '碳水', v: ck, pct: Math.round(ck / tot * 100), best: Math.round(tc / tt * 100), c: '#38BDF8' },
        { k: '脂肪', v: fk, pct: Math.round(fk / tot * 100), best: Math.round(tf / tt * 100), c: '#F59E0B' }
      ];
    });

    const warnings = computed(() => buildWarnings(totals.value, targets.value, dayType.value, countedItems(day.value.items), foodMap.value, built.value.unmet, periMeals.value));
    const fixList = computed(() => fixSuggestions(totals.value, targets.value, dayType.value, foodMap.value, meal.value));

    /* ---------- 餐次 ---------- */
    function inferMeal() {
      const h = new Date().getHours();
      if (h < 9) return 'breakfast';
      if (h < 11) return 'pre';
      if (h < 14) return 'lunch';
      if (h < 17) return 'post';
      if (h < 21) return 'dinner';
      return 'snack';
    }
    const meal = ref(LS.get('diet_meal', '') || inferMeal());
    const mealList = computed(() => (window.MEALS || []).filter(m => !(dayType.value === 'rest' && m.trainOnly)));

    /* ---------- 围训练期判定（训练时段开关） ----------
     * 原理：围训练期 = [训练开始 - preHours, 训练结束 + postHours]。
     * 落在这个区间内的餐次才被视为围训练期，才对可见脂肪报红。
     *
     * 为什么需要它：原实现硬编码 ['pre','post']，但只要训练时段特殊（如 Leo 凌晨练、
     * 早餐早已在练后 1.5 小时），早餐其实已出窗口，不该被禁脂。
     *
     * postHours 可选 1 或 2：
     *   2 = 严格（练后 2 小时窗口，覆盖完整的糖原再合成期）
     *   1 = 宽松（只锁最关键的 GLUT4 高峰段，之后即可正常摄入脂肪）
     * Leo 默认 1：05:00 结束 → 06:00 出窗口 → 6:30 早餐解冻，与「围训关系不大」的判断一致。
     */
    const trainCfg = computed(() => {
      const t = (prefs.value && prefs.value.train) || {};
      return {
        enabled: t.enabled !== false,
        start: t.start || '03:00', end: t.end || '05:00',
        preHours: Number(t.preHours) || 2,
        postHours: Number(t.postHours) || 1,
        times: { breakfast: t.breakfast || '06:30', lunch: t.lunch || '12:00', dinner: t.dinner || '18:30', snack: t.snack || '15:00' }
      };
    });
    const toMin = (hhmm) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
      if (!m) return null;
      return (Number(m[1]) % 24) * 60 + Number(m[2]);
    };
    const fmtMin = (v) => {
      if (v === null || isNaN(v)) return '—';
      let m = Math.round(v) % 1440; if (m < 0) m += 1440;
      return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    };
    /* 每餐的参考时刻：pre/post 由训练时段推导，其余取设置值 */
    function mealTimeOf(k) {
      const c = trainCfg.value;
      const s = toMin(c.start), e = toMin(c.end);
      if (k === 'pre') return s === null ? null : s - 30;
      if (k === 'post') return e === null ? null : e + 30;
      return toMin(c.times[k]);
    }
    /* 当前哪些餐次算围训练期 */
    const periMeals = computed(() => {
      if (dayType.value === 'rest') return [];
      const c = trainCfg.value;
      if (!c.enabled) return ['pre', 'post'];   // 关闭时段判断 → 退回保守口径
      const s = toMin(c.start), e = toMin(c.end);
      if (s === null || e === null) return ['pre', 'post'];
      const lo = s - c.preHours * 60;
      const hi = e + c.postHours * 60;
      const inWin = (t) => t !== null && (t >= lo || t - 1440 >= lo) && (t <= hi || t - 1440 <= hi);
      // 跨零点：把时间统一到以训练开始为基准的相对轴
      const rel = (t) => { let v = t; if (v - s > 720) v -= 1440; if (s - v > 720) v += 1440; return v; };
      const out = [];
      (window.MEALS || []).forEach(m => {
        const t = mealTimeOf(m.k);
        if (t === null) { if (m.k === 'pre' || m.k === 'post') out.push(m.k); return; }
        const rt = rel(t);
        if (rt >= rel(lo) && rt <= rel(hi)) out.push(m.k);
      });
      void inWin;
      return out;
    });
    /* 给 UI 用的窗口说明 */
    const periWindow = computed(() => {
      const c = trainCfg.value;
      const s = toMin(c.start), e = toMin(c.end);
      if (!c.enabled || s === null || e === null) return { text: '未启用时段判定（默认锁练前/练后）', lo: '', hi: '' };
      const lo = fmtMin(s - c.preHours * 60), hi = fmtMin(e + c.postHours * 60);
      return { text: lo + ' — ' + hi, lo, hi, hours: c.preHours + c.postHours };
    });
    const periMealNames = computed(() => periMeals.value.map(k => mealName(k)).join('、') || '无');
    const setMeal = (k) => { meal.value = k; LS.set('diet_meal', k); };
    watch(dayType, (v) => {
      if (v === 'rest' && (meal.value === 'pre' || meal.value === 'post')) setMeal('lunch');
    });
    const mealRows = computed(() => mealBreakdown(day.value.items, foodMap.value, dayType.value));

    /* ---------- SOP ---------- */
    const sopItems = computed(() => dayType.value === 'rest' ? SOP_REST : SOP_TRAIN);
    const toggleSop = (k) => { const d = ensureDay(); d.sop = d.sop || {}; d.sop[k] = !d.sop[k]; save(); };

    /* 每条 SOP 选的食物与克数记在用户偏好里，下次打开仍是上次的选择 */
    function sopCfgOf(k) {
      const c = up.value.sopCfg || (up.value.sopCfg = {});
      if (!c[k]) {
        const it = sopItems.value.find(x => x.k === k);
        c[k] = { foodId: (it && it.def && it.def.id) || '', grams: (it && it.def && it.def.grams) || 100 };
      }
      return c[k];
    }
    const sopFoodOf = (k) => foodMap.value[sopCfgOf(k).foodId] || null;
    const sopFoodName = (k) => { const f = sopFoodOf(k); return f ? f.name : '未选食物'; };
    const sopGramsOf = (k) => Number(sopCfgOf(k).grams) || 0;
    function bumpSop(k, d) {
      const c = sopCfgOf(k);
      c.grams = Math.max(5, Math.round((Number(c.grams) || 0) + d));
      save();
    }
    function setSopGrams(k, v) {
      const c = sopCfgOf(k);
      c.grams = Math.max(5, Number(v) || 5);
      save();
    }
    const sopPick = ref({ visible: false, k: '', q: '' });
    function openSopPick(k) { sopPick.value = { visible: true, k: k, q: '' }; }
    function closeSopPick() { sopPick.value.visible = false; }
    function chooseSopFood(f) {
      const c = sopCfgOf(sopPick.value.k);
      c.foodId = f.id;
      sopPick.value.visible = false;
      save();
      showToast('已换成 ' + f.name);
    }
    /* 确认计入：按 slot 落到「练前/练后」餐次，并在已摄入栏可按该餐次查看 */
    function confirmSop(k) {
      const it = sopItems.value.find(x => x.k === k);
      if (!it || !it.def) return;
      const c = sopCfgOf(k);
      const f = foodMap.value[c.foodId];
      if (!f) { showToast('请先选一种食物'); return; }
      const g = guardGrams(c.grams);
      if (!g) return;
      const mk = it.slot || safeMealFor(f.id);
      ensureDay().items.push({
        id: uid(), foodId: f.id, name: f.name, cat: f.cat,
        grams: r1(g), state: f.base || 'cooked',
        unitKey: 'g', unitLabel: '克', count: g,
        meal: mk, ts: Date.now()
      });
      const d = ensureDay(); d.sop = d.sop || {}; d.sop[k] = true;
      markFav(f.id);
      save();
      maybeCheer();
      const slotName = it.slot === 'pre' ? '训练前' : (it.slot === 'post' ? '训练后' : mealName(mk));
      showToast('已计入已摄入：' + f.name + ' ' + g + ' g（' + slotName + '）');
    }

    /* ---------- 已摄入食物栏：按五大类分区 ---------- */
    /* 分类以食物库当前分类为准（用户改过自定义食物分类后不会串区） */
    const catKeyOf = (it) => { const f = foodMap.value[it.foodId]; return (f && f.cat) || it.cat || ''; };
    const intakeSections = computed(() => {
      const out = [];
      (window.CATEGORIES || []).forEach(c => {
        const items = countedItems(day.value.items).filter(it => catKeyOf(it) === c.key);
        if (!items.length) return;
        let grams = 0, kcal = 0, p = 0;
        items.forEach(it => {
          const g = Number(it.grams) || 0;
          const n = per100(foodMap.value[it.foodId], it.state);
          grams += g; kcal += n.kcal * g / 100; p += n.p * g / 100;
        });
        out.push({ key: c.key, name: c.name, icon: c.icon, items: items, grams: r0(grams), kcal: r0(kcal), p: r1(p) });
      });
      return out;
    });
    /* 待确认条目（复制昨日 / 拉入昨天）单独成块：它们不计入统计，
     * 藏在录入页里极容易被忘掉，放到已摄入展板顶部逐条处理。 */
    const pendingItems = computed(() => (day.value.items || []).filter(it => it && it.pendingConfirmation));
    /* 脏数据体检：历史上混入的 50000 g 之类（也含已被删除的自定义食物残留）。
     * 汇总端已把它们拦下不计入统计，这里显式列出并给一键清理——
     * 不静默删用户数据，也不让一条脏数据污染全天判断。 */
    const badItems = computed(() => (day.value.items || []).filter(it => isBadItem(it, foodMap.value)));
    function repairBadItems() {
      const bad = badItems.value;
      if (!bad.length) { showToast('没有异常记录'); return; }
      const ids = {};
      bad.forEach(it => { if (it && it.id) ids[it.id] = true; });
      const d = ensureDay();
      d.items = (d.items || []).filter(it => !it || !ids[it.id]);
      save();
      showToast('已清理 ' + bad.length + ' 条异常记录（可用撤销删除恢复最近一条）');
    }
    /* 点分项小结 → 直接进入已摄入食物栏的对应分区（不再弹窗） */
    function gotoIntakeCat(cat) {
      const key = (cat === 'kcal' || cat === '') ? '' : cat;
      tab.value = 'intake';
      if (!key) return;
      activeCat.value = key;
      setTimeout(() => {
        try {
          const el = document.getElementById('intake-cat-' + key);
          if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) {}
      }, 160);
    }

    /* ---------- 录入草稿（默认取上次记录） ---------- */
    const draft = ref({});
    function initDraft() {
      const d = {};
      const old = draft.value || {};
      allFoods.value.forEach(f => {
        if (old[f.id] && old[f.id].confirmed && f.units.some(u => u.k === old[f.id].unitKey)) { d[f.id] = old[f.id]; return; }
        const p = (up.value.itemPrefs || {})[f.id];
        const u0 = (f.units && f.units[0]) || { k: 'g', label: '克', g: 1 };
        const unitKey = p && p.unitKey && f.units.some(u => u.k === p.unitKey) ? p.unitKey : u0.k;
        const unit = f.units.find(u => u.k === unitKey) || u0;
        d[f.id] = {
          unitKey: unitKey,
          count: p && p.count !== undefined ? p.count : (unit.k === 'g' ? 100 : 1),
          state: (p && p.state) ? p.state : (unit.state || f.base || 'cooked'),
          confirmed: false
        };
      });
      draft.value = d;
    }
    initDraft();
    watch([user, customFoods, overrides], () => { draft.value = {}; initDraft(); }, { deep: true });
    /* 默认数量仅作预填；用户修改数量/单位/生熟才算确认，未确认不计入摄入 */
    function confirmDraft(foodId) { if (draft.value[foodId]) draft.value[foodId].confirmed = true; }

    function unitOf(food, unitKey) {
      return (food.units || []).find(u => u.k === unitKey) || (food.units || [])[0] || { k: 'g', label: '克', g: 1 };
    }
    function gramsOf(foodId) {
      const f = foodMap.value[foodId]; if (!f) return 0;
      const d = draft.value[foodId]; if (!d) return 0;
      if (!d.confirmed) return 0;
      return (unitOf(f, d.unitKey).g || 1) * (Number(d.count) || 0);
    }
    function unitLabelOf(foodId) { const f = foodMap.value[foodId]; const d = draft.value[foodId]; return f && d ? unitOf(f, d.unitKey).label : ''; }
    /* 常用卡上直接显示「2 块 = 240 g」：与已确认与否无关，只做预览 */
    function gramsPreview(foodId) {
      const f = foodMap.value[foodId]; if (!f) return 0;
      const d = draft.value[foodId]; if (!d) return 0;
      return r1((unitOf(f, d.unitKey).g || 1) * (Number(d.count) || 0));
    }
    function setUnit(foodId, k) {
      const f = foodMap.value[foodId]; const d = draft.value[foodId];
      if (!f || !d) return;
      d.unitKey = k; d.confirmed = true;
      const u = unitOf(f, k);
      if (u.state) d.state = u.state;
      if (d.count === undefined || d.count === 0) d.count = u.k === 'g' ? 100 : 1;
    }
    function setState(foodId, s) { if (draft.value[foodId]) { draft.value[foodId].state = s; draft.value[foodId].confirmed = true; } }

    /* 单条克数防线：数量框误填成 50000 这类荒谬值会让碳水/脂肪瞬间爆表，
     * 而且极难发现（表现为「新的一天上来就超」）。超过上限直接拦下不让入库。
     * （常量 MAX_ITEM_GRAMS 定义在文件顶部，汇总端与录入端共用同一口径） */
    function guardGrams(g) {
      const n = Number(g) || 0;
      if (!(n > 0)) { showToast('请输入有效数量'); return 0; }
      if (n > MAX_ITEM_GRAMS) { showToast('单条不能超过 ' + MAX_ITEM_GRAMS + ' g（当前 ' + r0(n) + ' g），请检查数量'); return 0; }
      return r1(n);
    }

    function addItem(foodId, optMeal) {
      const f = foodMap.value[foodId]; if (!f) return;
      const d = draft.value[foodId]; if (!d) return;
      const u = unitOf(f, d.unitKey);
      const grams = guardGrams((u.g || 1) * (Number(d.count) || 0));
      if (!grams) return;
      const dd = ensureDay();
      const mk = optMeal || safeMealFor(foodId);
      const moved = !optMeal && mk !== meal.value;
      dd.items.push({
        id: uid(), foodId, name: f.name, cat: f.cat,
        grams: r1(grams), state: d.state,
        unitKey: d.unitKey, unitLabel: u.label, count: Number(d.count) || 0,
        meal: mk,
        ts: Date.now()
      });
      up.value.itemPrefs = up.value.itemPrefs || {};
      up.value.itemPrefs[foodId] = { unitKey: d.unitKey, count: Number(d.count) || 0, state: d.state };
      markFav(foodId);              // 选过即进入「常用食物」
      d.confirmed = false;
      save();
      maybeCheer();
      showToast(moved
        ? '可见脂肪已避开围训练期 · 加入「' + mealName(mk) + '」· ' + f.name + ' ' + r0(grams) + ' g'
        : '已加入「' + mealName(mk) + '」· ' + f.name + ' ' + r0(grams) + ' g');
    }
    /* 可见脂肪的餐次保护：训练日若当前是练前/练后，自动改派到远离训练的餐次。
     * 这样用户点了「补脂肪」也不会把脂肪塞进围训练期窗口。 */
    /* 训练时段设置：改完立即重算围训练期 */
    function setTrainCfg(patch) {
      const t = prefs.value.train || (prefs.value.train = {});
      Object.keys(patch || {}).forEach(k => { t[k] = patch[k]; });
      save();
    }

    function safeMealFor(foodId) {
      const f = foodMap.value[foodId];
      const isVis = f && ((f.tags || []).indexOf('visibleFat') >= 0 || f.cat === 'fat' || f.cat === 'nut');
      if (!isVis || dayType.value === 'rest') return meal.value;
      const PERI_MEALS = periMeals.value;
      if (PERI_MEALS.indexOf(meal.value) < 0) return meal.value;
      const avail = mealList.value.filter(m => PERI_MEALS.indexOf(m.k) < 0);
      // 优先晚餐（离训练最远），其次早餐
      const pick = avail.find(m => m.k === 'dinner') || avail.find(m => m.k === 'breakfast') || avail[0];
      return pick ? pick.k : meal.value;
    }

    /* 一键补缺口：直接按推荐克数加入当前餐次 */
    function quickAdd(foodId, grams, state) {
      const f = foodMap.value[foodId]; if (!f) return;
      const g = guardGrams(grams);
      if (!g) return;
      const st = state || f.base || 'cooked';
      const mk = safeMealFor(foodId);
      const moved = mk !== meal.value;
      ensureDay().items.push({
        id: uid(), foodId, name: f.name, cat: f.cat,
        grams: r1(g), state: st,
        unitKey: 'g', unitLabel: '克', count: g,
        meal: mk, ts: Date.now()
      });
      // 同步为默认值，下次打开这个食物就是刚用过的克数
      up.value.itemPrefs = up.value.itemPrefs || {};
      up.value.itemPrefs[foodId] = { unitKey: 'g', count: g, state: st };
      markFav(foodId);              // 选过即进入「常用食物」
      initDraft();
      save(); maybeCheer();
      showToast(moved
        ? '可见脂肪已避开围训练期 · 加入「' + mealName(mk) + '」· ' + f.name + ' ' + r0(g) + ' g'
        : '已加入「' + mealName(mk) + '」· ' + f.name + ' ' + r0(g) + ' g');
    }

    function mealName(k) {
      const m = (window.MEALS || []).find(x => x.k === k);
      return m ? m.name : '未归类';
    }
    function removeItem(id) {
      const d = ensureDay();
      const idx = d.items.findIndex(x => x.id === id);
      if (idx < 0) return;
      const removed = d.items[idx];
      undoStack.value.push({ item: removed, idx, date: dateStr.value, user: user.value, t: Date.now() });
      if (undoStack.value.length > 10) undoStack.value.shift();
      d.items.splice(idx, 1);
      unmarkFav(removed.foodId);    // 删掉就不再出现在「常用食物」
      save();
      showToast('已删除 ' + removed.name + ' · 可撤销');
    }
    function undoDelete() {
      const last = undoStack.value.pop();
      if (!last) { showToast('没有可撤销的删除'); return; }
      const d = logs.value.find(l => l.date === last.date && l.user === last.user);
      if (!d) { showToast('该日记录已不存在'); return; }
      d.items.splice(Math.min(last.idx, d.items.length), 0, last.item);
      save();
      showToast('已恢复 ' + last.item.name);
    }
    const isManual = (it) => {
      const f = foodMap.value[it.foodId];
      const u = f ? (f.units || []).find(x => x.k === it.unitKey) : null;
      const unitG = u ? (u.g || 1) : null;
      if (unitG === null) return false;
      return Math.abs((Number(it.grams) || 0) - unitG * (Number(it.count) || 0)) > 0.05;
    };
    const confirmedFoodIds = computed(() => {
      const s = {}; countedItems(day.value.items).forEach(i => { s[i.foodId] = true; }); return s;
    });
    function editItem(it) {
      const d = ensureDay();
      const idx = d.items.findIndex(x => x.id === it.id);
      if (idx < 0) return;
      const removed = d.items.splice(idx, 1)[0];
      const f = foodMap.value[removed.foodId];
      if (f) {
        draft.value[removed.foodId] = {
          unitKey: removed.unitKey, state: removed.state,
          count: isManual(removed) ? r1(removed.grams / (unitOf(f, removed.unitKey).g || 1)) : removed.count,
          confirmed: true
        };
      }
      meal.value = removed.meal || meal.value;
      tab.value = 'add';
      // 注意：这里绝不能把食物名写进 searchQ —— 那会把食物列表永久过滤成 1 项
      // （表现为「只剩这一条、下面划不动」）。改为滚动定位到该食物。
      if (f) setTimeout(() => scrollToFood(removed.foodId), 80);
      save();
      showToast('已退回待确认：' + removed.name);
    }
    function pullYesterday() {
      const d0 = new Date(dateStr.value + 'T00:00:00'); d0.setDate(d0.getDate() - 1);
      const ys = ymd(d0);
      const y = logs.value.find(l => l.date === ys && l.user === user.value);
      if (!y || !(y.items || []).length) { showToast('昨天没有记录'); return; }
      const n = importFrom(y);
      showToast('已拉入昨天的 ' + n + ' 项，请逐项确认是否计入');
    }
    /* 通用导入：把某一天的记录拉进今天，全部标为待确认（不计入摄入） */
    function importFrom(y) {
      const dd = ensureDay();
      const itemPrefs = up.value.itemPrefs || (up.value.itemPrefs = {});
      y.items.forEach(i => {
        const copied = Object.assign({}, i, { id: uid(), ts: Date.now(), pendingConfirmation: true });
        dd.items.push(copied);
        const manual = isManual(i);
        itemPrefs[i.foodId] = {
          unitKey: manual ? 'g' : (i.unitKey || 'g'),
          count: manual ? i.grams : i.count,
          state: i.state
        };
      });
      initDraft();
      save();
      return y.items.length;
    }
    function confirmImportedItem(id) {
      const it = (day.value.items || []).find(i => i.id === id && i.pendingConfirmation);
      if (!it) return;
      delete it.pendingConfirmation;
      save();
      maybeCheer();
      showToast('已确认计入：' + it.name);
    }
    function bumpGrams(it, delta) {
      const f = foodMap.value[it.foodId];
      const ug = f ? (unitOf(f, it.unitKey).g || 1) : 1;
      const g = clamp(r1((Number(it.grams) || 0) + delta), 0, MAX_ITEM_GRAMS);
      it.grams = g;
      it.count = r1(g / (ug || 1));    // 单位保持：2 块 = 240 g，+10 后是 2.1 块 = 250 g
      save(); maybeCheer();
    }
    /* 已摄入栏里直接改克数（切回「克」单位，避免单位与克数对不上） */
    function setItemGrams(it, v) {
      const n = Number(v) || 0;
      if (n <= 0) { showToast('克数需大于 0'); return; }
      if (n > MAX_ITEM_GRAMS) { showToast('单条不能超过 ' + MAX_ITEM_GRAMS + ' g'); return; }
      it.grams = r1(n);
      it.unitKey = 'g'; it.unitLabel = '克'; it.count = r1(n);
      save(); maybeCheer();
    }
    /* 已摄入栏里按「单位 + 份数」改量，克数由后台折算 */
    function unitsOf(foodId) {
      const f = foodMap.value[foodId];
      return (f && f.units) ? f.units : [{ k: 'g', label: '克', g: 1 }];
    }
    function setItemUnit(it, unitKey) {
      const f = foodMap.value[it.foodId]; if (!f) return;
      const u = unitOf(f, unitKey); if (!u) return;
      const g = Number(it.grams) || 0;
      const ug = u.g || 1;
      it.unitKey = unitKey; it.unitLabel = u.label;
      it.count = r1(g / ug);
      if (u.state) it.state = u.state;   // 例：燕麦切「碗(粥)」自动按熟重计
      save(); maybeCheer();
      showToast('已按「' + u.label + '」折算：' + r0(g) + ' g = ' + r1(g / ug) + ' ' + u.label);
    }
    function setItemCount(it, v) {
      const f = foodMap.value[it.foodId]; if (!f) return;
      const u = unitOf(f, it.unitKey);
      const ug = (u && u.g) || 1;
      const n = Number(v) || 0;
      const g = ug * n;
      if (!(g > 0)) { showToast('份数需大于 0'); return; }
      if (g > MAX_ITEM_GRAMS) { showToast('单条不能超过 ' + MAX_ITEM_GRAMS + ' g'); return; }
      it.count = r1(n); it.grams = r1(g);
      save(); maybeCheer();
    }
    /* 行内读数：这条记录实际贡献了多少 */
    function kcalOf(it) {
      const g = Number(it.grams) || 0;
      return (per100(foodMap.value[it.foodId], it.state).kcal || 0) * g / 100;
    }
    function pOf(it) {
      const g = Number(it.grams) || 0;
      return (per100(foodMap.value[it.foodId], it.state).p || 0) * g / 100;
    }
    function moveMeal(it, k) { it.meal = k; save(); showToast('已移到「' + mealName(k) + '」'); }

    /* ---------- 常见食物（待选区的常用展区） ----------
     * v5 规则：
     *   1. 首次进入播一份常见食物作为起点（用户可随时增删，删了不再自动塞回）。
     *   2. 同一食物累计选用 3 次 → 自动补进常用展区。
     *   3. 常用展区里的默认数量 = 上次实际使用的量（itemPrefs 记忆，含单位与生熟）。
     *   4. 删掉今日最后一条该食物 → 自动移出常用（手动置顶的保留）。
     */
    const COMMON_MAX = 18;
    const COMMON_MIN_USES = 3;
    const favs = computed(() => (up.value.favs || []).filter(id => !!foodMap.value[id]));
    const isFav = (id) => favs.value.indexOf(id) >= 0;
    function metaOf(id) {
      const m = up.value.favMeta || (up.value.favMeta = {});
      return m[id] || (m[id] = { uses: 0, manual: false, hidden: false });
    }
    function foodNameOf(id) { const f = foodMap.value[id]; return f ? f.name : id; }
    /* 每次真正入库都记一次；够 3 次自动进常用（用户显式移除过的不再自动回来） */
    function markFav(id) {
      if (!id) return;
      const m = metaOf(id);
      m.uses = (Number(m.uses) || 0) + 1;
      if (isFav(id) || m.hidden) return;
      if (m.uses >= COMMON_MIN_USES) {
        up.value.favs = [id].concat(up.value.favs || []).slice(0, COMMON_MAX);
        showToast('「' + foodNameOf(id) + '」用过 ' + m.uses + ' 次 → 已加入常用');
      }
    }
    /* 删除后：今日已无该食物、且非手动置顶 → 移出常用并清零计数 */
    function unmarkFav(id) {
      if (!id) return;
      const m = metaOf(id);
      const still = countedItems(day.value.items).some(it => it.foodId === id);
      if (still || m.manual) return;
      up.value.favs = (up.value.favs || []).filter(x => x !== id);
      m.uses = 0;
    }
    const toggleFav = (id) => {
      const m = metaOf(id);
      if (isFav(id)) {
        up.value.favs = (up.value.favs || []).filter(x => x !== id);
        m.manual = false; m.hidden = true;   // 显式移除：不再被自动加回
        showToast('已从常用移除');
      } else {
        up.value.favs = [id].concat(up.value.favs || []).slice(0, COMMON_MAX);
        m.manual = true; m.hidden = false;
        showToast('已加入常用');
      }
      save();
    };
    /* 常用展区：一排即点即加的卡片，数量取上次用量 */
    const commonFoods = computed(() => favs.value.map(id => foodMap.value[id]).filter(Boolean));
    const commonEdit = ref(false);
    function toggleCommonEdit() { commonEdit.value = !commonEdit.value; }
    /* 一键按「上次用量」加入当前餐次：草稿里已经是记忆的单位/数量/生熟，
     * 直接走 addItem 即可，单位不会退化成克（例如「2 块」仍是 2 块）。 */
    function addCommon(id) {
      const f = foodMap.value[id]; if (!f) return;
      if (!draft.value[id]) initDraft();
      addItem(id);
    }

    /* ---------- 复制昨日 ---------- */
    const yesterday = computed(() => {
      const d = new Date(dateStr.value + 'T00:00:00'); d.setDate(d.getDate() - 1);
      return logs.value.find(l => l.date === ymd(d) && l.user === user.value);
    });
    const canCopy = computed(() => !!(yesterday.value && yesterday.value.items && yesterday.value.items.length));
    const copyMsg = computed(() => {
      const y = yesterday.value;
      if (!y || !y.items || !y.items.length) return '前一天没有记录';
      return '复制 ' + y.items.length + ' 项（' + (y.dayType === 'rest' ? '休息日' : '训练日') + '）';
    });
    function copyYesterday() {
      const y = yesterday.value;
      if (!y || !y.items || !y.items.length) { showToast('前一天没有记录可复制'); return; }
      const d = ensureDay();
      const exist = (d.items || []).length;
      // 防护：某些嵌入环境没有 window.confirm，此时直接追加而不中断
      const ask = (typeof window !== 'undefined' && typeof window.confirm === 'function') ? window.confirm : null;
      if (exist > 0 && ask && !ask('今天已有 ' + exist + ' 项记录。\n复制昨日将在其后追加 ' + y.items.length + ' 项，继续？')) return;
      const n = importFrom(y);
      showToast('已复制昨日 ' + n + ' 项，请逐项确认是否计入');
    }

    /* ---------- 列表筛选 ---------- */
    const foodsInCat = computed(() => {
      const q = (searchQ.value || '').trim().toLowerCase();
      const favSet = favs.value;
      const list = allFoods.value.filter(f => {
        if (activeCat.value && f.cat !== activeCat.value) return false;
        if (q && f.name.toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
      if (q) return list;
      // 常用置顶
      const top = [], rest = [];
      list.forEach(f => { (favSet.indexOf(f.id) >= 0 ? top : rest).push(f); });
      top.sort((a, b) => favSet.indexOf(a.id) - favSet.indexOf(b.id));
      return top.concat(rest);
    });
    /* 五大类分区展示 + 「默认只看常见食物」
     * 79 条全量列表一屏塞不下，翻找成本高。默认每类只列出该类里的常见食物，
     * 点「展开全部」再看全量；搜索时自动全量展开（否则搜到也看不见）。 */
    const expandedCats = ref({});
    function toggleCatExpand(k) {
      const o = Object.assign({}, expandedCats.value);
      o[k] = !o[k];
      expandedCats.value = o;
      saveSession();
    }
    const foodSections = computed(() => {
      const q = (searchQ.value || '').trim().toLowerCase();
      const favSet = favs.value;
      const out = [];
      (window.CATEGORIES || []).forEach(c => {
        let list = allFoods.value.filter(f => f.cat === c.key);
        if (q) list = list.filter(f => f.name.toLowerCase().indexOf(q) >= 0);
        const top = [], rest = [];
        list.forEach(f => { (favSet.indexOf(f.id) >= 0 ? top : rest).push(f); });
        top.sort((a, b) => favSet.indexOf(a.id) - favSet.indexOf(b.id));
        const all = top.concat(rest);
        if (!all.length) return;
        const open = !!q || !!expandedCats.value[c.key];
        const shown = open ? all : (top.length ? top : all.slice(0, 4));
        out.push({
          key: c.key, name: c.name, icon: c.icon, items: shown,
          total: all.length, shown: shown.length, open: open,
          hidden: all.length - shown.length, commonCount: top.length
        });
      });
      return out;
    });
    function scrollToCat(k) {
      activeCat.value = k;
      try {
        const el = document.getElementById('cat-' + k);
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) {}
    }
    function scrollToFood(id) {
      try {
        const el = document.getElementById('food-' + id);
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e) {}
    }

    /* ---------- 分项小结卡：点环形卡进入该类今日已摄入，可逐条删除 ---------- */
    const intakeModal = ref({ visible: false, cat: '' });
    /* 用 computed 而非打开时的快照：删掉一条后小结卡里要立刻消失 */
    const intakeItems = computed(() => {
      const key = intakeModal.value.cat;
      return countedItems(day.value.items).filter(it => !key || it.cat === key);
    });
    const intakeTitle = computed(() => catName(intakeModal.value.cat));
    function catName(k) {
      const c = (window.CATEGORIES || []).find(x => x.key === k);
      return c ? c.name : (k || '全部');
    }
    function openIntakeSummary(cat) {
      const key = (cat === 'kcal' || cat === '') ? '' : cat;
      intakeModal.value = { visible: true, cat: key };
    }
    function closeIntakeSummary() { intakeModal.value.visible = false; }
    function gotoMealList(cat) {
      if (cat) activeCat.value = cat;
      closeIntakeSummary();
      tab.value = 'list';
    }

    /* ---------- 补缺口推荐：份量可调 + 可从食物库换一种 ---------- */
    const fixAdj = ref({});
    function fixGrams(fx, o) {
      const k = fx.key + '|' + o.id;
      const a = fixAdj.value[k];
      return a === undefined ? o.grams : Math.max(5, a);
    }
    function bumpFix(fx, o, d) {
      const k = fx.key + '|' + o.id;
      fixAdj.value[k] = Math.max(5, (fixGrams(fx, o) || 0) + d);
    }
    function addFix(fx, o) { quickAdd(o.id, fixGrams(fx, o), o.state); }
    const fixPick = ref({ visible: false, label: '', grams: 100, state: 'cooked', q: '' });
    function openFixPick(fx) {
      const o = (fx.options && fx.options[0]) || null;
      fixPick.value = { visible: true, label: fx.label, grams: o ? o.grams : 100, state: o ? o.state : 'cooked', q: '' };
    }
    function closeFixPick() { fixPick.value.visible = false; }
    function pickFood(f) { quickAdd(f.id, fixPick.value.grams, fixPick.value.state); closeFixPick(); }

    const itemsByCat = computed(() => {
      const g = {};
      (window.CATEGORIES || []).forEach(c => { g[c.key] = []; });
      (day.value.items || []).forEach(it => { if (g[it.cat]) g[it.cat].push(it); });
      return g;
    });

    /* ---------- 趋势 ---------- */
    const trendDays = computed(() => {
      const out = [];
      for (let i = 6; i >= 0; i--) {
        const dt = new Date(dateStr.value + 'T00:00:00'); dt.setDate(dt.getDate() - i);
        const ds = ymd(dt);
        const rec = logs.value.find(l => l.date === ds && l.user === user.value);
        let pPct = 0, kPct = 0, has = false;
        const items = countedItems(rec && rec.items);
        if (items.length) {
          const b = buildTargets(rec.weight || up.value.weight, rec.dayType || 'lower', rec.adjust || 0, rec.targetOverride);
          const s = sumItems(items, foodMap.value);
          pPct = Math.round(s.p / b.t.protein * 100);
          kPct = Math.round(s.kcal / b.t.kcal * 100);
          has = true;
        }
        out.push({
          date: ds, label: (dt.getMonth() + 1) + '/' + dt.getDate(),
          pPct, kPct, has, dayType: rec ? rec.dayType : '',
          pH: clamp(pPct / 150 * 100, 0, 100),
          kH: clamp(kPct / 150 * 100, 0, 100)
        });
      }
      return out;
    });
    const weightTrend = computed(() => {
      const w = (up.value.weights || []).slice().sort((a, b) => a.date < b.date ? -1 : 1).slice(-14);
      if (!w.length) return [];
      const vs = w.map(x => x.v);
      const lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
      const span = (hi - lo) || 1;
      return w.map(x => ({ date: x.date, v: x.v, h: clamp((x.v - lo) / span * 80 + 10, 8, 90) }));
    });

    /* ---------- 食物库编辑 ---------- */
    const foodEdit = ref({ open: false, id: '', name: '', cat: 'protein', p: 0, f: 0, c: 0, fiber: 0, kcal: 0, isNew: false });
    function openNewFood() {
      foodEdit.value = { open: true, id: '', name: '', cat: activeCat.value || 'protein', p: 0, f: 0, c: 0, fiber: 0, kcal: 0, isNew: true };
    }
    function openEditFood(f) {
      foodEdit.value = { open: true, id: f.id, name: f.name, cat: f.cat, p: f.n.p, f: f.n.f, c: f.n.c, fiber: f.n.fiber, kcal: f.n.kcal, isNew: false };
    }
    function saveFoodEdit() {
      const e = foodEdit.value;
      const name = (e.name || '').trim();
      if (!name) { showToast('请填写食物名称'); return; }
      const n = { p: Number(e.p) || 0, f: Number(e.f) || 0, c: Number(e.c) || 0, fiber: Number(e.fiber) || 0, kcal: Number(e.kcal) || 0 };
      if (e.isNew) {
        customFoods.value.push({ id: 'cu_' + Date.now().toString(36), name, cat: e.cat, base: 'cooked', yield: 1, n, units: [{ k: 'g', label: '克', g: 1 }], tags: [], note: '自定义' });
      } else if (e.id.indexOf('cu_') === 0) {
        const t = customFoods.value.find(x => x.id === e.id);
        if (t) { t.name = name; t.cat = e.cat; t.n = n; }
      } else {
        overrides.value = Object.assign({}, overrides.value, { [e.id]: { n } });
      }
      foodEdit.value.open = false;
      initDraft(); save(); showToast('已保存');
    }
    function removeCustomFood(id) { customFoods.value = customFoods.value.filter(x => x.id !== id); initDraft(); save(); showToast('已删除'); }

    /* ============================================================
     * AI 导入食物
     * ------------------------------------------------------------
     * 流程：填食物名 → 一键复制固定 Prompt → 粘给任意 AI →
     *      把 AI 返回的 JSON 粘回来 → 预览校验 → 入库并自动进常用。
     *
     * 解析必须"抗脏"：AI 的输出常常带 markdown 围栏、前后寒暄、
     * 单引号、尾随逗号、中英文标点，甚至把 JSON 拆在几段话里。
     * 这里逐层降级剥离，都失败了才报错，而不是让用户去手工修 JSON。
     * ============================================================ */
    const aiImport = ref({ open: false, name: '', json: '', preview: null, error: '', done: false });

    function openAiImport() {
      aiImport.value = { open: true, name: '', json: '', preview: null, error: '', done: false };
    }
    function closeAiImport() { aiImport.value.open = false; }

    /* 生成 Prompt：把占位符换成用户填的食物名；没填就保留占位符并在开头提示 */
    const aiPromptText = computed(() => {
      const tpl = window.ADD_FOOD_PROMPT || '';
      const n = (aiImport.value.name || '').trim();
      return n ? tpl.split('__FOOD__').join(n) : tpl;
    });
    function copyPrompt() {
      const text = aiPromptText.value;
      const fallback = () => {
        /* 剪贴板 API 在非 HTTPS / 旧 WebView 上不可用，退回到「选中并提示手动复制」 */
        try {
          const ta = document.createElement('textarea');
          ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          const okr = document.execCommand('copy');
          document.body.removeChild(ta);
          if (okr) { showToast('Prompt 已复制，去问 AI 吧'); return; }
        } catch (e) {}
        aiImport.value.json = text;      // 塞进下框，用户可手动全选复制
        showToast('已填入下方输入框，请手动全选复制');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => showToast('Prompt 已复制，去问 AI 吧')).catch(fallback);
      } else fallback();
    }

    /* ---- 从一段任意文本里抠出 JSON ---- */
    function extractJsonObject(text) {
      if (!text) return null;
      let s = String(text).trim();
      // 1) 去掉 markdown 围栏（```json ... ```），保留内部
      const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(s);
      if (fence) s = fence[1].trim();
      // 2) 截取第一个 { 到最后一个 }
      const a = s.indexOf('{'), b = s.lastIndexOf('}');
      if (a < 0 || b <= a) return null;
      s = s.slice(a, b + 1);
      // 3) 直接解析
      try { return JSON.parse(s); } catch (e) {}
      // 4) 常见瑕疵修复后再试：尾随逗号、单引号换双引号、中文引号
      let t = s
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"');
      try { return JSON.parse(t); } catch (e) {}
      if (t.indexOf("'") >= 0) {
        try { return JSON.parse(t.replace(/'/g, '"')); } catch (e) {}
      }
      return null;
    }

    /* ---- 归一化成一个合法食物对象；返回 { ok, food, warns, err } ---- */
    function normalizeAiFood(raw) {
      const warns = [];
      if (!raw || typeof raw !== 'object') return { ok: false, err: '没解析出 JSON 对象' };
      // 有些 AI 会把结果包一层 { food: {...} } 或 { result: {...} }
      let o = raw;
      if (!raw.n && !raw.name) {
        const inner = raw.food || raw.result || raw.data || raw.item;
        if (inner && typeof inner === 'object') o = inner;
      }
      const name = String(o.name || o.foodName || o.名称 || '').trim();
      if (!name) return { ok: false, err: '缺少 name（食物名称）' };

      /* 分类：AI 给的白名单外的值 → 按名称关键词兜底推断 */
      const CATS = (window.CATEGORIES || []).map(c => c.key);
      let cat = String(o.cat || o.category || '').trim().toLowerCase();
      if (CATS.indexOf(cat) < 0) {
        cat = guessCat(name);
        warns.push('AI 给的分类不在六类之内，已按名称推断为「' + catName(cat) + '」');
      }

      const base = (o.base === 'raw') ? 'raw' : 'cooked';

      /* yield：非法值（0 / 负数 / 非数字 / 极端值）一律归 1，避免除零把营养算成 Infinity */
      let y = Number(o.yield);
      if (!Number.isFinite(y) || y <= 0) y = 1;
      if (y > 20) { y = 1; warns.push('yield 数值异常（>20），已按 1 处理'); }

      const num = (v) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0; };
      const nRaw = o.n && typeof o.n === 'object' ? o.n : {};
      const n = {
        p: num(nRaw.p), f: num(nRaw.f), c: num(nRaw.c),
        fiber: num(nRaw.fiber), kcal: num(nRaw.kcal)
      };
      if (n.c < n.fiber) n.fiber = n.c;          // 纤维不可能多于总碳水
      if (n.kcal <= 0) {
        n.kcal = Math.round(n.p * 4 + n.f * 9 + Math.max(0, n.c - n.fiber) * 4 + n.fiber * 2);
        warns.push('缺少 kcal，已按 4/9/4 + 纤维 2kcal 折算补算');
      }

      /* units：必须含克；每个单位都要有正的克重；state 只认 raw/cooked */
      let units = Array.isArray(o.units) ? o.units.slice() : [];
      units = units.map((u, i) => {
        const g = num(u && u.g);
        const k = String((u && u.k) || ('u' + i)).trim();
        const label = String((u && u.label) || k).trim();
        const st = (u && (u.state === 'raw' || u.state === 'cooked')) ? u.state : null;
        const r = { k: k, label: label, g: g };
        if (st) r.state = st;
        return r;
      }).filter(u => u.g > 0);
      if (!units.some(u => u.k === 'g')) units.push({ k: 'g', label: '克', g: 1 });
      if (units.length < 2) warns.push('只有「克」一个单位，建议让 AI 补上「个 / 碗 / 勺」这类自然单位');

      /* tags：过滤掉 AI 自造的标签，只保留白名单 */
      const TAGS = window.FOOD_TAGS || [];
      let tags = Array.isArray(o.tags) ? o.tags.map(String).filter(t => TAGS.indexOf(t) >= 0) : [];
      if (Array.isArray(o.tags) && o.tags.length !== tags.length) warns.push('已滤掉无法识别的标签');
      // 兜底：坚果与油必须能被围训练期禁区识别
      if (cat === 'nut' && tags.indexOf('visibleFat') < 0 && (cat === 'nut' || cat === 'fat')) {
        /* 坚果/脂肪类靠 cat 判定即可，不强制打标 */
      }

      const id = 'ai_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const food = {
        id, name, cat, base, yield: y, n, units, tags,
        note: String(o.note || 'AI 导入').trim().slice(0, 120) || 'AI 导入'
      };

      /* 热量自洽体检：不拒绝入库，只提示 */
      const tol = (window.KCAL_TOLERANCE || {})[cat] || (window.KCAL_TOLERANCE || {}).default || 40;
      const calc = n.p * 4 + n.f * 9 + Math.max(0, n.c - n.fiber) * 4 + n.fiber * 2;
      const dev = Math.round(n.kcal - calc);
      if (Math.abs(dev) > tol) warns.push('热量与宏量折算相差 ' + dev + ' kcal（超出常规范围，请核对）');

      return { ok: true, food, warns, dev, kcalCalc: Math.round(calc) };
    }

    /* 分类兜底推断：AI 偶尔返回中文或自造值，这里按中文名关键词归类 */
    function guessCat(name) {
      const s = String(name);
      const hit = (arr) => arr.some(w => s.indexOf(w) >= 0);
      if (hit(['核桃', '杏仁', '巴旦木', '腰果', '夏威夷果', '碧根果', '榛子', '松子', '开心果', '花生', '瓜子', '南瓜子', '芝麻', '坚果'])) return 'nut';
      if (hit(['油'])) return 'fat';
      if (hit(['鸡', '牛', '猪', '羊', '鱼', '虾', '蛋', '奶', '酸奶', '乳', '豆腐', '蛋白粉', '肉', '肠', '贝', '蟹', '鸭'])) return 'protein';
      if (hit(['菜', '菠菜', '西兰花', '生菜', '番茄', '黄瓜', '萝卜', '芦笋', '青椒', '茄子', '菇', '菌', '藻', '笋', '瓜'])) return 'vege';
      if (hit(['苹果', '香蕉', '橘', '橙', '莓', '葡萄', '梨', '桃', '西瓜', '芒果', '猕猴桃', '果'])) return 'fruit';
      if (hit(['米', '面', '面包', '麦', '燕麦', '薯', '玉米', '豆', '粥', '粉', '南瓜', '土豆', '山药', '芋'])) return 'carb';
      return 'protein';
    }

    function parseAiJson() {
      const a = aiImport.value;
      a.error = ''; a.preview = null; a.done = false;
      const raw = extractJsonObject(a.json);
      if (!raw) { a.error = '没找到 JSON。请确认粘贴的是 AI 返回的完整内容（以 { 开头、以 } 结尾）。'; return; }
      const r = normalizeAiFood(raw);
      if (!r.ok) { a.error = r.err; return; }
      a.preview = { food: r.food, warns: r.warns, dev: r.dev, kcalCalc: r.kcalCalc };
    }

    function confirmAiImport() {
      const a = aiImport.value;
      if (!a.preview) return;
      const food = a.preview.food;
      /* 重名保护：同名食物不重复入库，改为提示已存在 */
      const dup = customFoods.value.find(f => f.name === food.name);
      if (dup) { a.error = '食物库里已经有「' + food.name + '」了，可直接编辑它的营养值。'; return; }
      customFoods.value.push(food);
      /* 自动进常用：标 manual=true，避免之后删记录时被 unmarkFav 顺手移除 */
      const meta = metaOf(food.id);
      meta.uses = 0; meta.manual = true; meta.hidden = false;
      up.value.favs = [food.id].concat(up.value.favs || []).slice(0, COMMON_MAX);
      initDraft();
      save();
      a.done = true;
      showToast('已加入「' + food.name + '」并放进常用');
    }

    function resetOverride(id) { const o = Object.assign({}, overrides.value); delete o[id]; overrides.value = o; initDraft(); save(); showToast('已恢复默认营养值'); }

    /* ---------- 目标覆盖 ---------- */
    const showOverride = ref(false);
    const ovForm = reactive({ protein: '', carb: '', fat: '', kcal: '', vege: '', fruit: '', nut: '' });
    function openOverride() {
      const o = day.value.targetOverride || {};
      ['protein', 'carb', 'fat', 'kcal', 'vege', 'fruit', 'nut'].forEach(k => { ovForm[k] = (o[k] !== undefined && o[k] !== null) ? o[k] : ''; });
      showOverride.value = true;
    }
    function saveOverride() {
      const o = {};
      ['protein', 'carb', 'fat', 'kcal', 'vege', 'fruit', 'nut'].forEach(k => {
        if (ovForm[k] !== '' && ovForm[k] !== null && ovForm[k] !== undefined) o[k] = Number(ovForm[k]);
      });
      ensureDay().targetOverride = Object.keys(o).length ? o : null;
      showOverride.value = false; save(); showToast('目标已更新');
    }
    function clearOverride() { ensureDay().targetOverride = null; showOverride.value = false; save(); showToast('已恢复自动计算'); }

    /* ---------- 日期 ---------- */
    /* 日期一律按「本地零点」解析：new Date('YYYY-MM-DD') 是 UTC 语义，
     * 在负偏移时区（如 PDT）会让『下一天』原地不动、『上一天』退两天。 */
    function shiftDay(n) {
      const d = new Date(dateStr.value + 'T00:00:00');
      d.setDate(d.getDate() + n);
      dateStr.value = ymd(d);
    }
    function goToday() { dateStr.value = todayStr(); }
    /* 新的一天 = 干净起点：切日期时清掉搜索词，避免上一天的筛选残留 */
    function goTodayClean() {
      dateStr.value = todayStr();
      searchQ.value = '';
    }

    /* ---------- 清空今日 ---------- */
    function clearToday() {
      const d = ensureDay();
      const n = (d.items || []).length;
      if (!n) { showToast('今日本来就是空的'); return; }
      const ask = (typeof window !== 'undefined' && typeof window.confirm === 'function') ? window.confirm : null;
      if (ask && !ask('确认清空今日已摄入的 ' + n + ' 项？可用「撤销删除」恢复最近一条。')) return;
      const removed = d.items.slice();
      undoStack.value.push({ item: removed[removed.length - 1], idx: d.items.length - 1, date: dateStr.value, user: user.value, t: Date.now() });
      d.items = [];
      save();
      showToast('已清空今日 ' + n + ' 项');
    }

    /* ---------- 从任意一天复制 ---------- */
    /* 可选日期：近 30 天里有记录的、且不是今天 */
    const pastDays = computed(() => {
      const out = [];
      const base = new Date(dateStr.value + 'T00:00:00');
      for (let i = 1; i <= 30; i++) {
        const d = new Date(base.getTime());
        d.setDate(d.getDate() - i);
        const ds = ymd(d);
        const rec = logs.value.find(l => l.date === ds && l.user === user.value);
        if (rec && (rec.items || []).length) {
          out.push({ date: ds, label: ds + '（' + (rec.items || []).length + ' 项）', n: (rec.items || []).length });
        }
      }
      return out;
    });
    function copyFrom(ds) {
      if (!ds) return;
      const rec = logs.value.find(l => l.date === ds && l.user === user.value);
      if (!rec || !(rec.items || []).length) { showToast('该日没有记录'); return; }
      const d = ensureDay();
      const exist = (d.items || []).length;
      const ask = (typeof window !== 'undefined' && typeof window.confirm === 'function') ? window.confirm : null;
      if (exist > 0 && ask && !ask('今天已有 ' + exist + ' 项记录。将追加 ' + rec.items.length + ' 项待确认，继续？')) return;
      const n = importFrom(rec);
      showToast('已从 ' + ds + ' 拉入 ' + n + ' 项，请逐项确认是否计入');
    }

    /* ---------- toast ---------- */
    function showToast(m) {
      toastMsg.value = m;
      clearTimeout(toastTimer.value);
      toastTimer.value = setTimeout(() => { toastMsg.value = ''; }, 2600);
    }

    /* ---------- 头像 ---------- */
    const avatarModal = ref({ visible: false, targetUser: 'Leo', tempUrl: '', changed: false, saving: false });
    const avatars = computed(() => media.value.avatars || {});
    const avatarOf = (u) => (media.value.avatars && media.value.avatars[u]) || DEFAULT_AVATARS[u] || DEFAULT_AVATARS.Leo;
    const currentAvatar = computed(() => avatarOf(user.value));

    function compressImage(dataUrl, maxSide, quality) {
      return new Promise((resolve) => {
        try {
          const img = new Image();
          img.onload = () => {
            try {
              const side = Math.min(maxSide, Math.max(img.width, img.height) || maxSide);
              const scale = side / (Math.max(img.width, img.height) || 1);
              const w = Math.max(1, Math.round(img.width * scale));
              const h = Math.max(1, Math.round(img.height * scale));
              const c = document.createElement('canvas');
              c.width = w; c.height = h;
              const ctx = c.getContext('2d');
              ctx.fillStyle = '#0B1220'; ctx.fillRect(0, 0, w, h);
              ctx.drawImage(img, 0, 0, w, h);
              const out = c.toDataURL('image/jpeg', quality || 0.85);
              resolve({ ok: true, url: out, bytes: Math.round(out.length * 0.75) });
            } catch (err) { resolve({ ok: false, reason: '压缩失败', fallback: dataUrl }); }
          };
          img.onerror = () => resolve({ ok: false, reason: '无法解析该图片格式', fallback: dataUrl });
          img.src = dataUrl;
        } catch (e) { resolve({ ok: false, reason: '不支持图片处理', fallback: dataUrl }); }
      });
    }
    function readFile(file) {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
      });
    }
    function openAvatarModal(u) {
      avatarModal.value = { visible: true, targetUser: u, tempUrl: avatarOf(u), changed: false, saving: false };
    }
    async function handleAvatarFile(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) { showToast('原图超过 20 MB，请换一张'); e.target.value = ''; return; }
      const raw = await readFile(file);
      if (!raw) { showToast('读取失败，请重选一张'); e.target.value = ''; return; }
      const m = avatarModal.value;
      m.tempUrl = raw; m.changed = true;
      const r = await compressImage(raw, 256, 0.85);
      if (r.ok && r.url) { m.tempUrl = r.url; showToast(/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name) ? 'HEIC 已转为通用格式' : '已压缩至 256px'); }
      else showToast((r.reason || '压缩失败') + '，已使用原图');
    }
    async function saveAvatar() {
      const m = avatarModal.value;
      if (m.saving) return;
      if (!m.tempUrl) { showToast('请先选择一张照片'); return; }
      if (!m.changed) { m.visible = false; showToast('未选择新照片，保持原头像'); return; }
      m.saving = true;
      media.value.avatars = Object.assign({}, media.value.avatars, { [m.targetUser]: m.tempUrl });
      const okLocal = LS.set('diet_media', JSON.stringify(media.value));
      const r = await persist();
      m.saving = false; m.visible = false; m.changed = false;
      if (!r.ok) showToast('云端保存失败（' + (r.reason || '未知') + '），已存本机');
      else if (r.cloud) showToast(okLocal ? '头像已保存（云端 + 本机）' : '头像已存云端；本机空间不足已跳过');
      else showToast('头像已存本机；云端未写入（' + (r.reason || '') + '）');
    }
    function resetAvatar(u) {
      media.value.avatars = Object.assign({}, media.value.avatars, { [u]: '' });
      LS.set('diet_media', JSON.stringify(media.value));
      persist(); showToast('已恢复默认头像');
    }

    /* ---------- 鼓励卡 ---------- */
    const cheer = computed(() => cheerLevel(totals.value, targets.value));
    const cheerModal = ref({ visible: false, title: '', desc: '', lv: '', done: 0, total: 0 });
    const cheerMediaModal = ref({ visible: false, tempUrl: '', isVideo: false, mp4Warn: false, bytes: 0 });
    const cheerMedia = computed(() => media.value.cheer);
    const cheerCrop = ref(LS.get('diet_cheer_crop', '1') !== '0');
    const cheerTransparent = ref(LS.get('diet_cheer_bg', '0') === '1');

    function pickCheerText(lv) {
      const T = window.CHEER_TEXTS || {};
      const arr = T[lv] || T.start || [{ t: '记录中', d: '继续。' }];
      const i = Math.floor(Math.random() * arr.length);
      return arr[i];
    }
    function maybeCheer(force) {
      const lv = cheer.value.lv;
      const d = day.value;
      if (!force && d.cheered) return;
      if (!force && lv !== 'perfect' && lv !== 'good' && lv !== 'protein') return;
      const txt = pickCheerText(lv);
      cheerModal.value = {
        visible: true, title: txt.t, desc: txt.d || txt.q || '',
        lv, done: cheer.value.done, total: cheer.value.total
      };
      if (lv === 'perfect' || lv === 'good') confetti();
      if (!force) { ensureDay().cheered = true; save(); }
    }
    function openCheerCard() { maybeCheer(true); }

    function openCheerMediaModal() {
      cheerMediaModal.value = { visible: false, tempUrl: '', isVideo: false, mp4Warn: false, bytes: 0 };
      cheerMediaModal.value.visible = true;
    }
    async function handleCheerFile(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const isVid = /^video\//.test(file.type) || /\.(mp4|webm|mov|m4v)$/i.test(file.name);
      const isMp4 = /^video\/mp4$/i.test(file.type) || /\.(mp4|m4v|mov)$/i.test(file.name);
      if (file.size > 3 * 1024 * 1024) { showToast('超过 3 MB，请换小一点'); e.target.value = ''; return; }
      const raw = await readFile(file);
      if (!raw) { showToast('读取失败'); e.target.value = ''; return; }
      cheerMediaModal.value.tempUrl = raw;
      cheerMediaModal.value.isVideo = isVid;
      cheerMediaModal.value.mp4Warn = isMp4;
      cheerMediaModal.value.bytes = file.size || 0;
      if (isMp4) cheerTransparent.value = false;
    }
    async function saveCheerMedia() {
      const m = cheerMediaModal.value;
      if (!m.tempUrl) { showToast('请先选择图片或视频'); return; }
      media.value.cheer = { url: m.tempUrl, isVideo: m.isVideo, crop: cheerCrop.value, transparent: cheerTransparent.value };
      const okLocal = LS.set('diet_media', JSON.stringify(media.value));
      LS.set('diet_cheer_crop', cheerCrop.value ? '1' : '0');
      LS.set('diet_cheer_bg', cheerTransparent.value ? '1' : '0');
      m.visible = false;
      const r = await persist();
      if (!r.ok) showToast('云端保存失败（' + (r.reason || '') + '），已存本机');
      else if (r.cloud) showToast(okLocal ? '鼓励形象已保存（云端 + 本机）' : '已存云端；本机空间不足已跳过');
      else showToast('已存本机；云端未写入（' + (r.reason || '') + '）');
    }
    async function resetCheerMedia() {
      media.value.cheer = null;
      LS.set('diet_media', JSON.stringify(media.value));
      cheerMediaModal.value.visible = false;
      await persist();
      showToast('已恢复默认鼓励形象');
    }

    /* ---------- 存储：本机即时 + 云端防抖 + 关页面强制落盘 ----------
     * 「随时存储，关掉浏览器下次接着干」拆成三件事：
     *   1. 任何改动立刻同步写 localStorage（同步 API，杀进程也不丢）
     *   2. 600 ms 防抖推云端 KV；另有 30 s 兜底重推；关页面 / 切后台立即 flush
     *   3. 连「进行到一半的工作」也存：当前页签、餐次、分类、搜索词、滚动位置，
     *      以及每个食物已填好但还没点的单位 / 份数 / 生熟草稿
     */
    let saveTimer = null;
    let dirty = false;
    const SESSION_KEY = 'diet_session_v1';
    let sessionTimer = null;
    const savedAt = ref(0);
    const savedLabel = computed(() => {
      if (!savedAt.value) return '自动保存已开启';
      const d = new Date(savedAt.value);
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' 已存';
    });
    const resumed = ref(false);      // 本次打开是否恢复了上次进度
    const resumedInfo = ref('');

    function sessionPayload() {
      const d = {};
      Object.keys(draft.value || {}).forEach(k => {
        const v = draft.value[k];
        if (v && v.confirmed) d[k] = { unitKey: v.unitKey, count: v.count, state: v.state, confirmed: true };
      });
      let scroll = 0;
      try { scroll = (typeof window !== 'undefined' && typeof window.scrollY === 'number') ? window.scrollY : 0; } catch (e) { scroll = 0; }
      return {
        user: user.value, date: dateStr.value, tab: tab.value, meal: meal.value,
        activeCat: activeCat.value, q: searchQ.value, scroll: scroll,
        draft: d, expanded: expandedCats.value, ts: Date.now()
      };
    }
    function saveSession() {
      try { LS.set(SESSION_KEY, JSON.stringify(sessionPayload())); } catch (e) {}
    }
    function scheduleSession() {
      clearTimeout(sessionTimer);
      sessionTimer = setTimeout(saveSession, 400);
    }
    /* 恢复上次进行到一半的工作（含未确认的草稿） */
    function restoreSession() {
      let s = null;
      try { s = JSON.parse(LS.get(SESSION_KEY, 'null') || 'null'); } catch (e) {}
      if (!s || typeof s !== 'object') return null;
      if (s.user && users.indexOf(s.user) >= 0) user.value = s.user;
      if (s.date) dateStr.value = s.date;
      if (s.tab) tab.value = s.tab;
      if (s.meal) meal.value = s.meal;
      if (s.activeCat) activeCat.value = s.activeCat;
      if (typeof s.q === 'string') searchQ.value = s.q;
      if (s.expanded && typeof s.expanded === 'object') expandedCats.value = s.expanded;
      let n = 0;
      if (s.draft && typeof s.draft === 'object') {
        Object.keys(s.draft).forEach(id => {
          const v = s.draft[id];
          const f = foodMap.value[id];
          if (!f || !v) return;
          const u0 = (f.units && f.units[0]) || { k: 'g' };
          const unitKey = (f.units && f.units.some(u => u.k === v.unitKey)) ? v.unitKey : u0.k;
          draft.value[id] = {
            unitKey: unitKey,
            count: Number(v.count) || 0,
            state: v.state || f.base || 'cooked',
            confirmed: !!v.confirmed
          };
          if (v.confirmed) n++;
        });
      }
      resumed.value = true;
      const bits = [];
      if (s.date && s.date !== todayStr()) bits.push('日期 ' + s.date);
      if (s.meal) bits.push('餐次 ' + mealName(s.meal));
      if (n) bits.push(n + ' 项未提交的输入');
      resumedInfo.value = bits.join(' · ');
      return s;
    }

    function save() {
      LS.set('diet_prefs', JSON.stringify(prefs.value));
      LS.set('diet_logs', JSON.stringify(logs.value));
      LS.set('diet_foods', JSON.stringify({ custom: customFoods.value, overrides: overrides.value }));
      savedAt.value = Date.now();
      dirty = true;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, 600);
      scheduleSession();
    }
    /* 关页面 / 切后台：立刻落盘，不等 600 ms 防抖 */
    async function flush() {
      saveSession();
      clearTimeout(saveTimer);
      clearTimeout(sessionTimer);
      if (dirty) await persist();
    }
    async function persist() {
      try {
        const res = await fetch('/api/data', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            logs: logs.value,
            foods: { custom: customFoods.value, overrides: overrides.value },
            prefs: prefs.value,
            media: media.value
          })
        });
        const d = await res.json().catch(() => ({}));
        dirty = false;
        if (d.failed && d.failed.indexOf('KV_UNAVAILABLE') >= 0) {
          cloudOk.value = false; cloudMsg.value = '云端 KV 未绑定：数据只保存在本机，换设备或清缓存会丢失';
        } else if (d.persisted) {
          cloudOk.value = true; cloudMsg.value = '';
        } else {
          cloudOk.value = false; cloudMsg.value = '云端写入失败：' + ((d.failed && d.failed[0]) || '未知原因') + '（本机已保存）';
        }
        return { ok: true, cloud: !!d.persisted, reason: d.failed && d.failed[0] };
      } catch (e) {
        dirty = false;
        cloudOk.value = false; cloudMsg.value = '无法连接云端，数据仅存本机';
        return { ok: false, cloud: false, reason: '网络异常' };
      }
    }

    onMounted(async () => {
      let localLogs = null, localFoods = null, localMedia = null;
      try { localLogs = JSON.parse(LS.get('diet_logs', 'null') || 'null'); } catch (e) {}
      try { localFoods = JSON.parse(LS.get('diet_foods', 'null') || 'null'); } catch (e) {}
      try { localMedia = JSON.parse(LS.get('diet_media', 'null') || 'null'); } catch (e) {}
      if (localLogs) logs.value = localLogs;
      if (localFoods) { customFoods.value = localFoods.custom || []; overrides.value = localFoods.overrides || {}; }
      if (localMedia) media.value = Object.assign({ avatars: {}, cheer: null }, localMedia);
      initDraft();
      const sess = restoreSession();
      try {
        const res = await fetch('/api/data');
        if (res.ok) {
          const d = await res.json();
          if (typeof d.kvReady === 'boolean' && !d.kvReady) {
            cloudOk.value = false; cloudMsg.value = '云端 KV 未绑定：数据只保存在本机，换设备会丢失';
          }
          if (d.logs && d.logs.length) logs.value = d.logs;
          if (d.foods) { customFoods.value = d.foods.custom || []; overrides.value = d.foods.overrides || {}; }
          // 云端档案可能由旧版本写入：归一化后再用，否则常用展区会空白
          if (d.prefs && d.prefs.users) { prefs.value = normalizePrefs(d.prefs); if (!prefs.value.train) prefs.value.train = defaultPrefs().train; }
          if (d.media) media.value = Object.assign({ avatars: {}, cheer: null }, d.media);
          initDraft();
        } else {
          cloudOk.value = false; cloudMsg.value = '云端返回异常（HTTP ' + res.status + '）：数据仅存本机';
        }
      } catch (e) {
        // 打开就连不上云端也必须立刻说清楚，否则用户会以为已经同步成功
        cloudOk.value = false; cloudMsg.value = '无法连接云端，数据仅存本机（联网后会自动重传）';
      }

      /* ---- 关页面 / 切后台 / 断网前的兜底落盘 ---- */
      const w = (typeof window !== 'undefined') ? window : null;
      if (w && typeof w.addEventListener === 'function') {
        w.addEventListener('pagehide', flush);
        w.addEventListener('beforeunload', flush);
        const doc = w.document;
        let lastToday = todayStr();
        if (doc && typeof doc.addEventListener === 'function') {
          doc.addEventListener('visibilitychange', () => {
            if (doc.visibilityState === 'hidden') { flush(); return; }
            // 回到前台：若已跨天且用户没主动翻日期，自动切到今天
            const now = todayStr();
            if (now !== lastToday) {
              const prev = lastToday; lastToday = now;
              if (dateStr.value === prev) { dateStr.value = now; searchQ.value = ''; showToast('已跨天：自动切到今天'); }
            }
          });
        }
        w.addEventListener('scroll', scheduleSession, { passive: true });
        if (typeof w.setInterval === 'function') w.setInterval(() => { if (dirty) persist(); }, 30000);
      }
      // 恢复上次滚动位置（等一帧，等 DOM 撑开）
      if (sess && sess.scroll) {
        setTimeout(() => {
          try { if (w && typeof w.scrollTo === 'function') w.scrollTo(0, sess.scroll); } catch (e) {}
        }, 60);
      }
      if (sess && resumedInfo.value) showToast('已恢复上次进度：' + resumedInfo.value);
    });

    watch(user, (v) => { LS.set('diet_user', v); prefs.value.activeUser = v; initDraft(); saveSession(); });
    watch([tab, meal, activeCat, searchQ, dateStr], () => scheduleSession());

    function exportJson() {
      const data = { logs: logs.value, foods: { custom: customFoods.value, overrides: overrides.value }, prefs: prefs.value, media: media.value, exportedAt: new Date().toISOString() };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'pulse_diet_' + todayStr() + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    /* ---------- 弹窗期间锁死底盘滚动（Scroll Locking） ----------
     *
     * 现象：弹窗里上下滑动时，底层页面被连带拖动（滚动穿透）。
     * 在 iOS Safari 上尤其明显，且单纯给 body 加 overflow:hidden **无效**——
     * iOS 会忽略 body 的 overflow，只有把 body 变成 position:fixed 才真正锁住。
     *
     * 所以这里做的是「固定定位 + 记录并还原滚动位置」：
     *   锁定：记下 scrollY → body 定位为 fixed 并上移 -scrollY（视觉上原地不动）
     *   解锁：清掉定位 → 把 scrollTop 写回原值（页面不会跳回顶部）
     *
     * 两个容易被忽略的细节：
     *   1. 桌面端滚动条消失会让内容横向跳约 15px → 用 padding-right 补上宽度。
     *   2. 还原滚动位置用 documentElement.scrollTop，不用 window.scrollTo——
     *      后者在部分环境（含测试用的 jsdom）会抛「Not implemented」噪声。
     */
    const modalStates = () => [
      cheerModal.value.visible, cheerMediaModal.value.visible,
      avatarModal.value.visible, foodEdit.value.open, aiImport.value.open,
      showOverride.value, sopPick.value.visible, fixPick.value.visible,
      intakeModal.value.visible
    ];
    let lockOn = false;
    let lockY = 0;
    function applyScrollLock(on) {
      if (typeof document === 'undefined' || !document.body) return;
      const b = document.body;
      const de = document.documentElement;
      if (on) {
        if (lockOn) return;                       // 已在锁：多弹窗叠加时只锁一次
        lockOn = true;
        lockY = (typeof window !== 'undefined' && (window.scrollY || window.pageYOffset)) || (de && de.scrollTop) || 0;
        /* 桌面端滚动条占的宽度：锁定时滚动条消失，不补会让内容横向跳一下 */
        const raw = (typeof window !== 'undefined' && de &&
                     typeof de.clientWidth === 'number' && typeof window.innerWidth === 'number')
          ? (window.innerWidth - de.clientWidth) : 0;
        const sbw = Number.isFinite(raw) && raw > 0 ? raw : 0;
        b.style.position = 'fixed';
        b.style.top = (-lockY) + 'px';
        b.style.left = '0';
        b.style.right = '0';
        b.style.width = '100%';
        b.style.overflow = 'hidden';
        if (sbw > 0) b.style.paddingRight = sbw + 'px';
      } else {
        if (!lockOn) return;
        lockOn = false;
        b.style.position = ''; b.style.top = ''; b.style.left = '';
        b.style.right = ''; b.style.width = ''; b.style.overflow = '';
        b.style.paddingRight = '';
        /* 先解除 fixed 再写回位置，否则写不进去 */
        if (de) de.scrollTop = lockY;
        if (b.scrollTop !== undefined) b.scrollTop = lockY;
      }
    }
    watch(modalStates, (states) => { applyScrollLock(states.some(Boolean)); });

    return {
      user, users, setUser: (u) => { user.value = u; },
      dateStr, day, shiftDay, goToday, goTodayClean, clearToday, pastDays, copyFrom, importFrom,
      tab, setTab: (t) => { tab.value = t; },
      activeCat, setCat: (c) => { activeCat.value = c; }, scrollToCat, scrollToFood, searchQ, copyFromDate,
      dayTypes, adjustOptions,
      weight, dayType, adjust,
      targets, refScaled, totals, rings, netCarb, macroSplit, warnings, fixList,
      recon: computed(() => built.value.recon),
      meal, mealList, setMeal, mealRows, mealName, moveMeal,
      trainCfg, periMeals, periMealNames, periWindow, mealTimeOf, setTrainCfg, fmtMin,
      sopItems, toggleSop, sopState: computed(() => day.value.sop || {}),
      sopFoodName, sopGramsOf, bumpSop, setSopGrams, sopPick, openSopPick, closeSopPick, chooseSopFood, confirmSop,
      draft, foodsInCat, foodSections, itemsByCat, allFoods, foodMap,
      intakeModal, intakeItems, intakeTitle, openIntakeSummary, closeIntakeSummary, gotoMealList, catName,
      intakeSections, gotoIntakeCat, markFav, unmarkFav,
      commonFoods, commonEdit, toggleCommonEdit, addCommon,
      expandedCats, toggleCatExpand, pendingItems, badItems, repairBadItems,
      unitsOf, setItemUnit, setItemCount, kcalOf, pOf,
      savedLabel, savedAt, resumed, resumedInfo, flush, saveSession, restoreSession,
      fixAdj, fixGrams, bumpFix, addFix, fixPick, openFixPick, closeFixPick, pickFood,
      unitOf, gramsOf, gramsPreview, unitLabelOf, confirmDraft, setUnit, setState, addItem, removeItem, bumpGrams, setItemGrams, quickAdd, DEFAULT_AVATARS, isManual, confirmedFoodIds, editItem, pullYesterday, confirmImportedItem,
      undoStack, undoDelete, canUndo: computed(() => undoStack.value.length > 0),
      favs, isFav, toggleFav,
      yesterday, canCopy, copyMsg, copyYesterday,
      trendDays, weightTrend, CATEGORIES: window.CATEGORIES,
      foodEdit, openNewFood, openEditFood, saveFoodEdit, removeCustomFood, resetOverride,
      aiImport, openAiImport, closeAiImport, aiPromptText, copyPrompt, parseAiJson, confirmAiImport,
      aiParseJson: extractJsonObject, aiNormalizeFood: normalizeAiFood,
      showOverride, ovForm, openOverride, saveOverride, clearOverride,
      hasOverride: computed(() => !!(day.value && day.value.targetOverride)),
      cloudOk, cloudMsg, toastMsg,
      itemCount: computed(() => (day.value.items || []).length),
      countedItemCount: computed(() => countedItems(day.value.items).length),
      pendingItemCount: computed(() => (day.value.items || []).filter(i => i && i.pendingConfirmation).length),
      baseKcal: computed(() => built.value.baseKcal),
      unmetKcal: computed(() => built.value.unmet),
      exportJson,
      per100Label: (foodId) => { const d = draft.value[foodId]; return per100(foodMap.value[foodId], d ? d.state : 'cooked'); },
      per100Of: (foodId, state) => per100(foodMap.value[foodId], state),
      isInsensitive: (id) => (window.STATE_INSENSITIVE || new Set()).has(id),
      avatarOf, currentAvatar, avatarModal, openAvatarModal, handleAvatarFile, saveAvatar, resetAvatar,
      cheer, cheerModal, openCheerCard, closeCheer: () => { cheerModal.value.visible = false; },
      cheerMedia, cheerMediaModal, openCheerMediaModal, handleCheerFile, saveCheerMedia, resetCheerMedia,
      cheerCrop, cheerTransparent,
      r0, r1,
      scrollLockOn: () => modalStates().some(Boolean), applyScrollLock
    };
  }
}).mount('#app');
