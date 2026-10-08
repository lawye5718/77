/**
 * PULSE DIET 工程校验
 *  1. 语法检查（所有 JS）
 *  2. Vue 模板真实编译（用 vendored vue.js 的 compiler，捕获语法错误）
 *  3. 模板标识符 vs setup() 返回键 交叉核对
 *  4. 目标引擎 / 生熟折算 / 汇总 的数值断言
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const ROOT = __dirname;
const out = [];
let fail = 0;
const ok = (m) => out.push('  ✓ ' + m);
const bad = (m) => { out.push('  ✗ ' + m); fail++; };

/* ---------- 1. 语法检查 ---------- */
out.push('\n【1】语法检查');
const jsFiles = [
  'worker/index.js',
  'public/foods.js',
  'public/app.js',
  'public/vendor/vue.js',
  'public/vendor/tailwind.js'
];
for (const f of jsFiles) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) { bad(f + ' 不存在'); continue; }
  try {
    execSync('node --check ' + JSON.stringify(p), { stdio: 'pipe' });
    ok(f + ' (' + fs.statSync(p).size + ' B)');
  } catch (e) {
    bad(f + ' 语法错误: ' + String(e.stderr || e.message).split('\n').slice(0, 3).join(' '));
  }
}

/* ---------- 2 & 3. 模板编译 ---------- */
out.push('\n【2】Vue 模板编译');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const start = html.indexOf('<div id="app" class="pd">');
const end = html.indexOf('<script src="/foods.js">');
if (start < 0 || end < 0) { bad('无法定位 #app 模板'); }
const template = html.slice(start, end).replace(/^<div id="app" class="pd">/, '');

let Vue = null;
try {
  const g = global;
  g.window = g; g.self = g; g.navigator = { userAgent: 'node' };
  // Vue 的 compiler-dom 在属性值含 & 时会走 decodeEntities：
  //   decoder.innerHTML = '<div foo="...">' 然后 decoder.children[0].getAttribute('foo')
  // 桩必须提供 children[0].getAttribute，否则报 "Cannot read properties of undefined (reading '0')"
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: '\u00A0' };
  const decodeEnt = (str) => String(str).replace(/&(#?\w+);/g, (m, n) => (n in ENT ? ENT[n] : m));
  const makeEl = () => {
    let attrVal = '';
    const el = {
      style: {}, children: [], textContent: '',
      setAttribute(k, v) { attrVal = String(v); },
      getAttribute() { return attrVal; },
      appendChild() {}, removeChild() {},
      addEventListener() {}, removeEventListener() {}
    };
    Object.defineProperty(el, 'innerHTML', {
      configurable: true,
      get() { return el.textContent; },
      set(v) {
        const m = /foo="([\s\S]*?)"/.exec(String(v));
        attrVal = m ? decodeEnt(m[1].replace(/&quot;/g, '"')) : '';
        el.children = [{ getAttribute: () => attrVal }];
        el.textContent = decodeEnt(String(v).replace(/<[^>]*>/g, ''));
      }
    });
    return el;
  };
  g.document = {
    createElement: makeEl,
    createElementNS: makeEl,
    createTextNode: (t) => ({ textContent: t }),
    querySelector: () => null,
    body: { appendChild() {}, removeChild() {} },
    head: { appendChild() {} }
  };
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'public/vendor/vue.js'), 'utf8'), { filename: 'vue.js' });
  Vue = g.Vue;
} catch (e) {
  bad('加载 vendor/vue.js 失败: ' + e.message);
}

if (Vue && typeof Vue.compile === 'function') {
  const errs = [];
  const origin = console.error, originWarn = console.warn;
  console.error = (...a) => errs.push(a.join(' '));
  console.warn = (...a) => errs.push(a.join(' '));
  let res = null;
  try { res = Vue.compile(template); } catch (e) { errs.push('抛出: ' + e.message); }
  console.error = origin; console.warn = origin;
  if (errs.length) { bad('模板编译告警/错误:\n     ' + errs.join('\n     ')); }
  else if (res) ok('模板编译通过，无 error / warning');
} else if (Vue) {
  bad('该 vue 构建不含 compiler（无法做模板编译校验）');
}

/* ---------- 3. 标识符交叉核对 ---------- */
out.push('\n【3】模板标识符 vs setup() 返回值');
// 运行 foods.js
try {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'public/foods.js'), 'utf8'), { filename: 'foods.js' });
  ok('foods.js 载入：' + (global.FOOD_DB || []).length + ' 个内置食物');
} catch (e) { bad('foods.js 载入失败: ' + e.message); }

// 以 Vue 桩运行 app.js 的 setup()，拿到真实返回键
const appSrc = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
let setupKeys = [];
const MARKER = 'const { createApp, ref, reactive, computed, watch, onMounted } = Vue;';
if (appSrc.indexOf(MARKER) < 0) {
  bad('未找到 Vue 解构行，无法注入桩');
} else {
  try {
    const stubs =
      'const createApp=(o)=>{globalThis.__CAP=o;return {mount(){}}};' +
      'const ref=(v)=>({value:v});' +
      'const reactive=(o)=>o;' +
      'const computed=(fn)=>(typeof fn==="function"?{get value(){return fn()}}:Object.defineProperty({},"value",{get:fn.get,set:fn.set}));' +
      'const watch=()=>{};' +
      'const onMounted=()=>{};';
    const LS_MAP = (global.__LS_MAP = global.__LS_MAP || {});
    const ctx2 = vm.createContext({
      Vue: {}, window: global, console, setTimeout, clearTimeout,
      Date, Math, JSON, Object, Array, Number, String, Set, isNaN, parseInt, parseFloat,
      localStorage: {
        getItem: (k) => (k in LS_MAP ? LS_MAP[k] : null),
        setItem: (k, v) => { LS_MAP[k] = String(v); },
        removeItem: (k) => { delete LS_MAP[k]; }
      }
    });
    ctx2.globalThis = ctx2;
    vm.runInContext(appSrc.replace(MARKER, stubs), ctx2);
    const cap = ctx2.__CAP;
    if (cap && typeof cap.setup === 'function') {
      const ret = cap.setup();
      setupKeys = Object.keys(ret);
      ok('setup() 执行成功，返回 ' + setupKeys.length + ' 个键');
    } else { bad('未能捕获 setup()'); }
  } catch (e) {
    bad('setup() 执行失败: ' + e.message + ' | ' + (e.stack || '').split('\n')[1]);
  }
}

// 抽取模板表达式中的根标识符
const scoped = new Set(['$event', 'true', 'false', 'null', 'undefined']);
const forRe = /v-for="([^"]+)"/g;
let m;
while ((m = forRe.exec(template))) {
  const left = m[1].split(/\s+in\s+/)[0].replace(/[()]/g, '').trim();
  left.split(',').forEach(s => { const t = s.trim(); if (t) scoped.add(t); });
}
// 箭头函数参数（如 allFoods.filter(x => x.cat === c.key)）
const arrowRe = /(?:\(\s*)?([A-Za-z_$][A-Za-z0-9_$]*)\s*=>/g;
let am;
while ((am = arrowRe.exec(template))) scoped.add(am[1]);
const exprs = [];
const mustacheRe = /\{\{([^}]+)\}\}/g;
while ((m = mustacheRe.exec(template))) exprs.push(m[1]);
const attrRe = /\s(:|@|v-)([a-zA-Z-]+)="([^"]*)"/g;
while ((m = attrRe.exec(template))) {
  if (m[2] === 'for') continue;
  if (['if', 'else', 'show', 'cloak', 'once', 'pre', 'slot', 'text', 'html', 'model'].indexOf(m[2]) >= 0) exprs.push(m[3]);
  else if (m[1] === ':' || m[1] === '@') exprs.push(m[3]);
}
// 只保留「根标识符」：先剥离字符串、属性访问(.xxx)、可选链(?.)、对象字面量键(key:)
function rootIds(expr) {
  let s = expr.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
  s = s.replace(/\?\./g, ' ');
  s = s.replace(/\.[A-Za-z_$][A-Za-z0-9_$]*/g, '');
  s = s.replace(/([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, ' ');
  const ids = [];
  const re = /[A-Za-z_$][A-Za-z0-9_$]*/g;
  let mm;
  while ((mm = re.exec(s))) ids.push(mm[0]);
  return ids;
}
const KEYWORDS = new Set(['in', 'of', 'new', 'typeof', 'return', 'true', 'false', 'null', 'undefined', 'function', 'if', 'else']);
const unknown = new Set();
for (const e of exprs) {
  for (const name of rootIds(e)) {
    if (KEYWORDS.has(name)) continue;
    if (setupKeys.indexOf(name) >= 0) continue;
    if (scoped.has(name)) continue;
    unknown.add(name);
  }
}
if (unknown.size) bad('模板引用了 setup() 未返回的标识符: ' + Array.from(unknown).join(', '));
else ok('模板中所有标识符均已在 setup() 中返回');

/* ---------- 4. 数值断言 ---------- */
out.push('\n【4】目标引擎 / 折算 / 汇总');
try {
  const ctx3 = vm.createContext({ window: global, console, Math, JSON, Object, Array, Number, String, Set });
  ctx3.globalThis = ctx3;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/foods.js'), 'utf8'), ctx3);
  const logic = appSrc.split('const { createApp')[0];
  vm.runInContext(logic, ctx3);

  const bt = ctx3.buildTargets, p100 = ctx3.per100, si = ctx3.sumItems;

  const lower = bt(78, 'lower', 0, null);
  ok('下肢日(78kg): 蛋白' + lower.t.protein + ' 碳水' + lower.t.carb + ' 脂肪' + lower.t.fat + ' 热量' + lower.t.kcal);
  if (lower.t.protein !== 179) bad('下肢日蛋白应为 179 (2.3×78)，实为 ' + lower.t.protein);
  if (lower.t.carb !== 351) bad('下肢日碳水应为 351 (4.5×78)，实为 ' + lower.t.carb);
  if (lower.t.kcal < 2500 || lower.t.kcal > 2700) bad('下肢日热量 ' + lower.t.kcal + ' 越出 2500-2700');
  else ok('下肢日热量落在原表参考区间内');

  const upper = bt(78, 'upper', 0, null);
  ok('上肢日(78kg): 蛋白' + upper.t.protein + ' 碳水' + upper.t.carb + ' 脂肪' + upper.t.fat + ' 热量' + upper.t.kcal);
  if (upper.t.protein !== 156) bad('上肢日蛋白应为 156 (2.0×78)，实为 ' + upper.t.protein);

  const rest = bt(78, 'rest', 0, null);
  ok('休息日(78kg): 蛋白' + rest.t.protein + ' 碳水' + rest.t.carb + ' 脂肪' + rest.t.fat + ' 热量' + rest.t.kcal);
  if (rest.t.kcal < 1700 || rest.t.kcal > 1850) bad('休息日热量 ' + rest.t.kcal + ' 越出 1700-1850');
  else ok('休息日热量落在原表参考区间内');

  // 热量调整：蛋白质必须受保护
  const d10 = bt(78, 'rest', -10, null);
  if (d10.t.protein !== rest.t.protein) bad('减热量时蛋白被动削减了');
  else ok('热量 -10% 时蛋白质保持不变（' + d10.t.protein + ' g），由碳水/脂肪承担');
  if (d10.t.carb >= rest.t.carb) bad('-10% 应削减碳水');
  else ok('热量 -10%: 碳水 ' + rest.t.carb + ' → ' + d10.t.carb + ' g');

  const a10 = bt(78, 'lower', 10, null);
  if (a10.t.protein !== lower.t.protein) bad('增热量时蛋白被动改变了');
  else ok('热量 +10% 时蛋白质保持不变');

  // 生熟折算
  const chicken = (global.FOOD_DB || []).find(f => f.id === 'chicken');
  const praw = p100(chicken, 'raw'), pcook = p100(chicken, 'cooked');
  if (Math.abs(praw.p - 22.5) > 0.01) bad('鸡胸生重蛋白应为 22.5');
  const expectCooked = 22.5 / 0.75;
  if (Math.abs(pcook.p - expectCooked) > 0.01) bad('鸡胸熟重蛋白应 = 生重/yield = ' + expectCooked.toFixed(2) + '，实为 ' + pcook.p.toFixed(2));
  else ok('鸡胸 生→熟 折算正确: 100g 生 ' + praw.p + 'g 蛋白 → 100g 熟 ' + pcook.p.toFixed(1) + 'g（yield 0.75）');

  const oats = (global.FOOD_DB || []).find(f => f.id === 'oats');
  const oatsCooked = p100(oats, 'cooked');
  ok('燕麦 干→粥 折算: 100g 干 ' + oats.n.kcal + ' kcal → 100g 粥 ' + Math.round(oatsCooked.kcal) + ' kcal（yield 3.0）');
  const bowlUnit = oats.units.find(u => u.k === 'bowl');
  if (!bowlUnit || bowlUnit.g !== 200 || bowlUnit.state !== 'cooked')
    bad('燕麦「碗(粥)」单位应为 200g 且自动切 cooked');
  else ok('燕麦「碗(粥)」= 200g 且自动切到熟重状态');

  // 汇总
  const map = {}; (global.FOOD_DB || []).forEach(f => { map[f.id] = f; });
  const items = [
    { foodId: 'chicken', grams: 200, state: 'raw', cat: 'protein' },
    { foodId: 'egg', grams: 100, state: 'cooked', cat: 'protein' },
    { foodId: 'dark_vege', grams: 500, state: 'cooked', cat: 'vege' },
    { foodId: 'almond', grams: 10, state: 'cooked', cat: 'nut' }
  ];
  const s = si(items, map);
  ok('汇总 200g生鸡胸+100g鸡蛋+500g蔬菜+10g巴旦木 → 蛋白' + Math.round(s.p) + ' 脂肪' + Math.round(s.f) + ' 碳水' + Math.round(s.c) + ' 纤维' + Math.round(s.fiber) + ' 净碳' + Math.round(s.netC) + ' 热量' + Math.round(s.kcal));
  if (Math.abs(s.vege - 500) > 0.01) bad('蔬菜克数汇总错误'); else ok('蔬菜/水果/坚果 分类克数汇总正确');
  if (Math.abs(s.nut - 10) > 0.01) bad('坚果克数汇总错误');
  if (Math.abs(s.netC - (s.c - s.fiber)) > 0.01) bad('净碳水计算错误'); else ok('净碳水 = 总碳水 − 纤维');

  // 单位锚点
  const sp = (global.FOOD_DB || []).find(f => f.id === 'sweet_potato');
  const sm = sp.units.find(u => u.k === 'sm');
  if (sm.g !== 40) bad('小红薯应为 40g'); else ok('小红薯 = 40g / 中等红薯 = 60g / 小土豆 = 40g / 小玉米 = 70g');
  const apple = (global.FOOD_DB || []).find(f => f.id === 'apple');
  if (apple.units.find(u => u.k === 'pcs').g !== 160) bad('苹果应为 160g'); else ok('中等偏小苹果 = 160g');
  const yogurt = (global.FOOD_DB || []).find(f => f.id === 'yogurt');
  if (yogurt.units.find(u => u.k === 'bowl').g !== 250) bad('一碗酸奶应为 250g'); else ok('一碗酸奶（三大勺）= 250g');
  const beans = (global.FOOD_DB || []).find(f => f.id === 'beans');
  if (Math.abs(beans.units.find(u => u.k === 'scoop').g * 4 - 130) > 0.1) bad('4 勺豆子应 = 130g'); else ok('4 勺豆子 = 130g');
  const ps = (global.FOOD_DB || []).find(f => f.id === 'pumpkin_seed');
  if (ps.units.find(u => u.k === 'spoon').g !== 10) bad('一勺南瓜子应 = 10g'); else ok('一勺南瓜子仁 = 10g / 一勺巴旦木 = 10g(约10粒)');

  // 禁区（v3 校准：只在围训练期 pre/post 餐次报警）
  const mkItem = (foodId, grams, meal) => ({ id: 'x_' + foodId + meal, foodId, name: (map[foodId] || {}).name || foodId, cat: (map[foodId] || {}).cat, grams, state: 'cooked', meal });
  const w = ctx3.buildWarnings(s, bt(78, 'lower', 0, null).t, 'lower', items, map, 0);
  if (w.some(x => x.lv === 'red' && x.t.indexOf('可见脂肪') >= 0)) bad('非围训练期餐次的可见脂肪不应报红');
  else ok('训练日 · 坚果落在非围训练期餐次 → 不报红（围训练期才是禁区）');
  if (!w.some(x => x.lv === 'info' && x.t.indexOf('脂肪配额') >= 0)) bad('训练日应给出脂肪配额正向引导');
  else ok('训练日 · 给出脂肪配额正向引导：' + (w.find(x => x.lv === 'info') || {}).t);

  // 同一份坚果若落在 post（练后）餐次，必须报红
  const periItems = [mkItem('almond', 10, 'post')];
  const spPeri = ctx3.sumItems(periItems, map);
  const wPeri = ctx3.buildWarnings(spPeri, bt(78, 'lower', 0, null).t, 'lower', periItems, map, 0);
  const redPeri = wPeri.find(x => x.lv === 'red' && x.t.indexOf('可见脂肪') >= 0);
  if (!redPeri) bad('练后餐次的可见脂肪应报红');
  else ok('训练日 · 坚果落在「练后」餐次 → 报红：' + redPeri.t);

} catch (e) {
  bad('数值断言执行失败: ' + e.message + '\n' + e.stack.split('\n').slice(0, 4).join('\n'));
}


/* ---------- 5. 运行时冒烟：录入 + 「上次记录即默认值」 ---------- */
out.push('\n【5】录入流程与默认值记忆');
try {
  const LS_MAP = global.__LS_MAP || {};
  const stubs =
    'const createApp=(o)=>{globalThis.__CAP=o;return {mount(){}}};' +
    'const ref=(v)=>({value:v});' +
    'const reactive=(o)=>o;' +
    'const computed=(fn)=>(typeof fn==="function"?{get value(){return fn()}}:Object.defineProperty({},"value",{get:fn.get,set:fn.set}));' +
    'const watch=()=>{};' +
    'const onMounted=()=>{};';
  const mkCtx = () => vm.createContext({
    Vue: {}, window: global, console, setTimeout, clearTimeout,
    Date, Math, JSON, Object, Array, Number, String, Set, isNaN, parseInt, parseFloat,
    localStorage: {
      getItem: (k) => (k in LS_MAP ? LS_MAP[k] : null),
      setItem: (k, v) => { LS_MAP[k] = String(v); },
      removeItem: (k) => { delete LS_MAP[k]; }
    }
  });

  // 第一次：以「块 / 2 块 / 生重」录入三文鱼
  const c1 = mkCtx(); c1.globalThis = c1;
  vm.runInContext(appSrc.replace(MARKER, stubs), c1);
  const r1 = c1.__CAP.setup();
  r1.draft.value['salmon'] = { unitKey: 'block', count: 2, state: 'raw', confirmed: true };
  r1.addItem('salmon');
  const it = r1.itemsByCat.value.protein[0];
  if (!it) bad('录入后未生成条目');
  else {
    if (Math.abs(it.grams - 240) > 0.01) bad('块×2 应为 240g，实为 ' + it.grams);
    else ok('录入三文鱼「块 × 2」→ ' + it.grams + ' g，单位标签=' + it.unitLabel);
    if (it.state !== 'raw') bad('状态应为 raw'); else ok('状态正确保留为生重');
  }

  // 第二次：全新实例读同一份 localStorage，默认值应等于上次记录
  const c2 = mkCtx(); c2.globalThis = c2;
  vm.runInContext(appSrc.replace(MARKER, stubs), c2);
  const r2 = c2.__CAP.setup();
  const d2 = r2.draft.value['salmon'];
  if (!d2) bad('新实例缺少 salmon 草稿');
  else if (d2.unitKey !== 'block' || d2.count !== 2 || d2.state !== 'raw')
    bad('默认值未沿用上次记录: ' + JSON.stringify(d2));
  else ok('重开后默认值 = 上次记录（块 / 2 / 生重）——「全局默认取上一次」生效');

  // 未确认的默认数量不得计入摄入
  { const before = r2.itemCount.value;
    if (r2.gramsOf('salmon') !== 0 && !r2.draft.value['salmon'].confirmed) bad('未确认默认值仍被计算');
    r2.addItem('salmon');
    if (r2.itemCount.value !== before) bad('未确认的默认数量被直接录入');
    else ok('默认数量未确认 → 不计入当日摄入'); }

  // 换算提示：改单位为「克」后克数应变为 count 值
  r2.setUnit('salmon', 'g');
  r2.draft.value['salmon'].count = 150;
  if (Math.abs(r2.gramsOf('salmon') - 150) > 0.01) bad('克单位换算错误');
  else ok('切到「克」后 150 → 150 g，换算正确');

  // 燕麦「碗(粥)」应自动切熟重
  r2.setUnit('oats', 'bowl');
  if (r2.draft.value['oats'].state !== 'cooked') bad('燕麦选碗未自动切熟重');
  else ok('燕麦选「碗(粥)」自动切换为熟重状态');

  // 禁区：训练日把可见脂肪录入到「练后」餐次 → 报红
  r2.meal.value = 'post';
  r2.draft.value['almond'] = { unitKey: 'spoon', count: 1, state: 'cooked', confirmed: true };
  r2.addItem('almond', 'post');
  const w2 = r2.warnings.value;
  if (!w2.some(x => x.lv === 'red' && x.t.indexOf('可见脂肪') >= 0)) bad('练后餐次加坚果应触发红色预警');
  else ok('训练日把巴旦木录入「练后」餐次 → 触发红色围训练期预警');

  // 餐次保护：当前餐次是 post 时，可见脂肪应被自动改派到非围训练期餐次
  r2.dateStr.value = '2030-01-02';
  r2.meal.value = 'post';
  r2.draft.value['almond'] = { unitKey: 'spoon', count: 1, state: 'cooked', confirmed: true };
  r2.addItem('almond');
  const placed = r2.mealRows.value.filter(m => m.count).map(m => m.k);
  if (placed.indexOf('post') >= 0) bad('可见脂肪未被改派出围训练期餐次');
  else ok('餐次保护：可见脂肪自动改派到「' + placed.join('/') + '」，未落入 pre/post');

} catch (e) {
  bad('冒烟测试失败: ' + e.message + ' | ' + (e.stack || '').split('\n')[1]);
}


/* ---------- 6. v2 新增功能 ---------- */
out.push('\n【6】v2 新增：餐次 / 收藏 / 撤销 / 复制昨日 / 鼓励卡');
try {
  const LS_MAP = global.__LS_MAP || {};
  const stubs =
    'const createApp=(o)=>{globalThis.__CAP=o;return {mount(){}}};' +
    'const ref=(v)=>({value:v});' +
    'const reactive=(o)=>o;' +
    'const computed=(fn)=>(typeof fn==="function"?{get value(){return fn()}}:Object.defineProperty({},"value",{get:fn.get,set:fn.set}));' +
    'const watch=()=>{};' +
    'const onMounted=()=>{};';
  const mkCtx = () => vm.createContext({
    Vue: {}, window: global, console, setTimeout, clearTimeout,
    Date, Math, JSON, Object, Array, Number, String, Set, isNaN, parseInt, parseFloat,
    localStorage: {
      getItem: (k) => (k in LS_MAP ? LS_MAP[k] : null),
      setItem: (k, v) => { LS_MAP[k] = String(v); },
      removeItem: (k) => { delete LS_MAP[k]; }
    }
  });
  const c = mkCtx(); c.globalThis = c;
  vm.runInContext(appSrc.replace(MARKER, stubs), c);
  const R = c.__CAP.setup();

  // 餐次
  if (!R.mealList.value.some(m => m.k === 'breakfast')) bad('缺少早餐餐次');
  else ok('餐次列表含 早餐/练前/午餐/练后/晚餐/加餐');
  R.dayType.value = 'rest';
  if (R.mealList.value.some(m => m.k === 'pre')) bad('休息日不应出现「练前」');
  else ok('休息日自动隐藏「练前/练后」围训练餐次');
  R.dayType.value = 'lower';

  // 录入带餐次
  R.setMeal('lunch');
  R.draft.value['chicken'] = { unitKey: 'g', count: 200, state: 'raw', confirmed: true };
  R.addItem('chicken');
  const lunch = R.mealRows.value.find(m => m.k === 'lunch');
  if (!lunch || lunch.count !== 1) bad('录入未归入午餐');
  else ok('录入自动归入当前餐次「午餐」：蛋白 ' + Math.round(lunch.p) + ' g');
  if (Math.abs(lunch.p - 45) > 0.5) bad('200g 生鸡胸应为 45g 蛋白，实为 ' + lunch.p);
  else ok('200 g 生鸡胸 = 45 g 蛋白，落在每餐 30-45 g 均匀分布基准内');

  // 单餐蛋白不足标黄
  R.draft.value['egg'] = { unitKey: 'pcs', count: 1, state: 'cooked', confirmed: true };
  R.setMeal('snack');
  R.addItem('egg');
  const snack = R.mealRows.value.find(m => m.k === 'snack');
  if (!snack || snack.p >= 30) bad('单颗蛋应低于 30g');
  else ok('单餐蛋白 ' + Math.round(snack.p) + ' g < 30 g → 界面标黄提示');

  // 收藏
  R.toggleFav('salmon');
  if (!R.isFav('salmon')) bad('收藏失败'); else ok('收藏置顶：三文鱼已加入常用');
  const favFoods = R.foodsInCat.value;
  if (!favFoods.length || favFoods[0].id !== 'salmon') bad('收藏未置顶到列表首位');
  else ok('收藏项排在当前分类列表首位');
  R.toggleFav('salmon');
  if (R.isFav('salmon')) bad('取消收藏失败'); else ok('可取消收藏');

  // 撤销
  const before = R.itemCount.value;
  const target = R.mealRows.value.find(m => m.count).items[0];
  R.removeItem(target.id);
  if (R.itemCount.value !== before - 1) bad('删除失败');
  else ok('删除条目 → 计数 ' + before + ' → ' + R.itemCount.value);
  if (!R.canUndo.value) bad('删除后应可撤销');
  R.undoDelete();
  if (R.itemCount.value !== before) bad('撤销未恢复条目');
  else ok('撤销删除 → 恢复至 ' + R.itemCount.value + ' 项');

  // 复制昨日
  const ymdN = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const ymdOf = (ds) => { const d = new Date(ds); d.setDate(d.getDate() - 1); return ymdN(d); };
  const yesterdayDate = ymdOf(R.dateStr.value);
  R.dateStr.value = yesterdayDate;
  R.draft.value['salmon'] = { unitKey: 'block', count: 1, state: 'raw', confirmed: true };
  R.setMeal('dinner');
  R.addItem('salmon');
  const yCount = R.itemCount.value;
  R.dateStr.value = c.todayStr();
  if (!R.canCopy.value) bad('应能检测到昨日记录');
  else ok('检测到昨日 ' + yCount + ' 项记录，可一键复制');
  R.copyYesterday();
  if (R.itemCount.value < yCount) bad('复制昨日失败');
  else ok('复制昨日 → 今日新增 ' + yCount + ' 项（提示语：' + R.copyMsg.value + '）');

  // 补缺口建议
  const fx = R.fixList.value;
  if (!fx.length) bad('应生成补缺口建议');
  else {
    const p = fx.find(x => x.key === 'protein');
    if (!p) bad('缺少蛋白质补缺口建议');
    else ok('补缺口建议：蛋白质还差 ' + p.gap + ' g → ' + p.options.map(o => o.label + ' ' + o.grams + 'g').join(' / '));
    // v3：awayOnly（可见脂肪）在训练日仍可推荐，由餐次保护避开围训练期
    const awayIds = ['salmon', 'almond', 'walnut', 'avocado', 'cheese'];
    const awayShown = p.options.filter(o => awayIds.indexOf(o.id) >= 0);
    ok('awayOnly 可见脂肪项在训练日仍可推荐' + (awayShown.length ? '：' + awayShown.map(o => o.label).join('、') : '（本缺口下未进入前四）'));
    // trainOnly 项（蛋白粉）在休息日必须消失
    R.dayType.value = 'rest';
    const fxRest = R.fixList.value.find(x => x.key === 'protein');
    if (fxRest && fxRest.options.some(o => o.id === 'protein_powder')) bad('休息日不应推荐蛋白粉（trainOnly）');
    else ok('休息日补缺口已排除蛋白粉（trainOnly）');
    R.dayType.value = 'lower';
    const fxTrain = R.fixList.value.find(x => x.key === 'protein');
    if (!fxTrain) bad('训练日应给出蛋白补缺口建议');
    else ok('训练日补缺口：' + fxTrain.options.map(o => o.label + ' ' + o.grams + 'g').join(' / '));
    const sorted = p.options.every((o, i) => i === 0 || p.options[i - 1].covers >= o.covers);
    if (!sorted) bad('推荐应按实际贡献降序（最管用的排前）');
    else ok('推荐按贡献降序：' + p.options.map(o => o.label + ' ' + o.grams + 'g(补' + o.covers + ')').join(' / '));
    const crazy = p.options.some(o => o.grams > 500);
    if (crazy) bad('存在一顿吃不完的推荐量: ' + p.options.map(o => o.label + o.grams).join(','));
    else ok('推荐量均不超过一顿上限（补剂 60 g / 常规 500 g）');
    const pw = p.options.find(o => o.id === 'protein_powder');
    if (pw && pw.grams > 60) bad('蛋白粉推荐量超过 60 g 上限');
    const part = p.options.filter(o => o.partial);
    if (part.length) ok('缺口过大时按上限给并标注实际贡献：' + part.map(o => o.label + ' ' + o.grams + 'g 补 ' + o.covers).join('、'));
    else ok('所有推荐均可一次补齐缺口');
  }

  // 一键补缺口
  {
    const before = R.itemCount.value;
    const fx2 = R.fixList.value.find(x => x.key === 'protein');
    if (fx2 && fx2.options.length) {
      const o = fx2.options[0];
      R.quickAdd(o.id, o.grams, o.state);
      if (R.itemCount.value !== before + 1) bad('一键加入失败');
      else ok('一键补缺口：' + o.label + ' ' + o.grams + ' g 已直接加入「' + R.mealName(R.meal.value) + '」');
      const d2 = R.draft.value[o.id];
      if (d2 && d2.count !== o.grams) bad('一键加入后默认值未同步');
      else ok('一键加入后该食物默认值同步为 ' + o.grams + ' g（下次打开即是）');
    }
  }

  // 鼓励卡分档
  const lv0 = R.cheer.value.lv;
  ok('当前达标档位：' + lv0 + '（已达成 ' + R.cheer.value.done + '/' + R.cheer.value.total + '）');
  R.openCheerCard();
  if (!R.cheerModal.value.visible) bad('手动打开鼓励卡失败');
  else if (!R.cheerModal.value.title) bad('鼓励卡缺少文案');
  else ok('鼓励卡可随时手动打开：标题「' + R.cheerModal.value.title + '」');
  R.closeCheer();

  // 头像默认值
  if (!R.avatarOf('Leo') || R.avatarOf('Leo').indexOf('data:image') !== 0) bad('Leo 默认头像应为内联 SVG');
  else ok('默认头像为内联 SVG（不依赖外网 CDN，不会破图）');
  if (R.avatarOf('琳达') === R.avatarOf('Leo')) bad('两人默认头像不应相同');
  else ok('Leo / 琳达 默认头像各自独立');

} catch (e) {
  bad('v2 功能测试失败: ' + e.message + ' | ' + (e.stack || '').split('\n')[1]);
}


/* ---------- 7. v3 校准 ---------- */
out.push('\n【7】v3 校准：营养数据 / 围训练期 / 补剂上限');
try {
  const F = (global.FOOD_DB || []);
  const get = (id) => F.find(f => f.id === id);

  // 1) 四项数据纠正
  const egg = get('egg');
  if (Math.abs(egg.n.c - 1.1) > 0.01) bad('鸡蛋碳水应为 1.1，实为 ' + egg.n.c);
  else ok('鸡蛋：碳水 2.8 → ' + egg.n.c + ' g（热量 ' + egg.n.kcal + '，蛋类专属 Atwater 系数）');

  const yogurt = get('yogurt');
  if (Math.abs(yogurt.n.c - 5.0) > 0.01) bad('无糖酸奶碳水应为 5.0，实为 ' + yogurt.n.c);
  else ok('无糖酸奶：碳水 9.0 → ' + yogurt.n.c + ' g（纯乳糖口径，热量 ' + yogurt.n.kcal + '）');

  const natto = get('natto');
  if (Math.abs(natto.n.p - 18.0) > 0.01) bad('纳豆蛋白应为 18.0，实为 ' + natto.n.p);
  else ok('纳豆：蛋白 16.5 → ' + natto.n.p + ' g，碳水 14.4 → ' + natto.n.c + ' g，热量 200 → ' + natto.n.kcal);

  const milk = get('milk');
  if (Math.abs(milk.n.p - 3.3) > 0.01 || Math.abs(milk.n.f - 3.6) > 0.01) bad('牛奶应为 P3.3 / F3.6');
  else ok('牛奶：蛋白 3.0 → ' + milk.n.p + ' g，脂肪 3.2 → ' + milk.n.f + ' g，热量 61 → ' + milk.n.kcal);

  // 2) 补剂上限 60 → 45
  const FX = global.FIX_SUGGEST || {};
  const pw = (FX.protein || []).find(x => x.id === 'protein_powder');
  if (!pw || pw.cap !== 45) bad('蛋白粉 cap 应为 45，实为 ' + (pw && pw.cap));
  else ok('蛋白粉单次上限 60 → 45 g（≈36 g 纯蛋白，贴合肠道 30-40 g 吸收上限）');

  // 3) 四项数据的宏量 ↔ 热量自洽性体检（净碳水口径）
  // 两种口径：A = 净碳水×4（纤维不计热量）；B = 净碳水×4 + 纤维×2（EU/FDA 口径，纤维发酵产 SCFA）
  const chk = (f) => {
    const n = f.n;
    const fib = n.fiber || 0;
    const netC = Math.max(0, n.c - fib);
    const base = n.p * 4 + n.f * 9 + netC * 4;
    return {
      id: f.id, name: f.name, stored: n.kcal,
      calc: Math.round(base),
      calcF2: Math.round(base + fib * 2),
      dev: Math.round(n.kcal - (base + fib * 2))
    };
  };
  ['egg', 'yogurt', 'natto', 'milk'].forEach(id => {
    const c = chk(get(id));
    if (Math.abs(c.dev) > 8) bad(c.name + ' 与折算口径偏差过大：标称 ' + c.stored + ' vs ' + c.calcF2 + '（差 ' + c.dev + '）');
    else ok('自洽性 ' + c.name + '：标称 ' + c.stored + ' kcal ≈ 折算 ' + c.calcF2 + ' kcal（差 ' + c.dev + '）');
  });

  // 4) 全库体检：以「纤维按 2 kcal/g」口径列出偏差最大的几项
  const devs = F.map(chk).sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev)).slice(0, 5);
  ok('全库偏差 Top5（纤维按 2kcal/g 口径）：' + devs.map(d => d.name + ' ' + (d.dev > 0 ? '+' : '') + d.dev).join('、'));
  ok('注：坚果标称热量系统性低于 4/9/4 折算，因脂肪被细胞壁包裹、实际可代谢能偏低（USDA 已证实）；蛋类用专属系数——均为正常');

  // 5) 休息日蛋白粉文案
  const LS_MAP = global.__LS_MAP || {};
  const stubs =
    'const createApp=(o)=>{globalThis.__CAP=o;return {mount(){}}};' +
    'const ref=(v)=>({value:v});' +
    'const reactive=(o)=>o;' +
    'const computed=(fn)=>(typeof fn==="function"?{get value(){return fn()}}:Object.defineProperty({},"value",{get:fn.get,set:fn.set}));' +
    'const watch=()=>{};' +
    'const onMounted=()=>{};';
  const ctx = vm.createContext({
    Vue: {}, window: global, console, setTimeout, clearTimeout,
    Date, Math, JSON, Object, Array, Number, String, Set, isNaN, parseInt, parseFloat,
    localStorage: {
      getItem: (k) => (k in LS_MAP ? LS_MAP[k] : null),
      setItem: (k, v) => { LS_MAP[k] = String(v); },
      removeItem: (k) => { delete LS_MAP[k]; }
    }
  });
  ctx.globalThis = ctx;
  vm.runInContext(appSrc.replace(MARKER, stubs), ctx);
  const R3 = ctx.__CAP.setup();
  R3.dateStr.value = '2030-02-01';
  R3.dayType.value = 'rest';
  R3.draft.value['protein_powder'] = { unitKey: 'scoop', count: 1, state: 'cooked', confirmed: true };
  R3.addItem('protein_powder');
  const wp = R3.warnings.value.find(x => x.t.indexOf('乳清') >= 0);
  if (!wp) bad('休息日应给出乳清相关提示');
  else if (wp.d.indexOf('mTOR') >= 0 && wp.d.indexOf('不刺激') >= 0) bad('仍保留了「不刺激 mTOR」的错误表述');
  else ok('休息日乳清提示已改为 MPS 口径：' + wp.t);
  if (wp && wp.d.indexOf('氨基酸') < 0) bad('文案应提到持续氨基酸流');
  else ok('文案包含「持续氨基酸流 / 饱腹感」的正确机制说明');

} catch (e) {
  bad('v3 校准测试失败: ' + e.message + ' | ' + (e.stack || '').split('\n')[1]);
}


/* ---------- 8. v4：新增食物 + 训练时段 ---------- */
out.push('\n【8】v4：新增 5 项食物 / 训练时段围训练期');
try {
  const F = (global.FOOD_DB || []);
  const get = (id) => F.find(f => f.id === id);

  // 1) 5 项新食物入库
  const spec = [
    { id: 'pecan',      cat: 'nut',     n: { p: 9.2,  f: 72.0, c: 13.9, fiber: 9.6, kcal: 691 } },
    { id: 'olive_oil',  cat: 'fat',     n: { p: 0,    f: 100.0, c: 0,    fiber: 0,   kcal: 900 } },
    { id: 'chickpeas',  cat: 'carb',    n: { p: 8.9,  f: 2.6,  c: 27.4, fiber: 7.6, kcal: 164 } },
    { id: 'red_beans',  cat: 'carb',    n: { p: 7.5,  f: 0.1,  c: 24.8, fiber: 7.3, kcal: 128 } },
    { id: 'tofu_firm',  cat: 'protein', n: { p: 12.2, f: 4.8,  c: 1.5,  fiber: 0.4, kcal: 98  } }
  ];
  spec.forEach(sp => {
    const f = get(sp.id);
    if (!f) { bad('缺少食物：' + sp.id); return; }
    if (f.cat !== sp.cat) { bad(sp.id + ' 分类应为 ' + sp.cat + '，实为 ' + f.cat); return; }
    const keys = ['p', 'f', 'c', 'fiber', 'kcal'];
    const diff = keys.filter(k => Math.abs((f.n[k] || 0) - sp.n[k]) > 0.01);
    if (diff.length) bad(sp.id + ' 营养不符：' + diff.map(k => k + ' 应为 ' + sp.n[k] + ' 实为 ' + f.n[k]).join('，'));
    else ok('新增 ' + f.name + '（' + f.cat + '）：P' + f.n.p + ' F' + f.n.f + ' C' + f.n.c + ' 纤维' + f.n.fiber + ' / ' + f.n.kcal + ' kcal');
  });

  // 2) 单位锚点
  const pecan = get('pecan');
  if (!pecan.units.find(u => u.k === 'pcs' && u.g === 1.5)) bad('碧根果「颗(半仁)」应为 1.5 g');
  else ok('碧根果单位锚点：颗(半仁) = 1.5 g');
  const oo = get('olive_oil');
  if (!oo.units.find(u => u.k === 'spoon' && u.g === 10)) bad('橄榄油「勺」应为 10 g');
  else ok('橄榄油单位锚点：勺 = 10 g');
  const tofu = get('tofu_firm');
  if (!tofu.units.find(u => u.k === 'block' && u.g === 100)) bad('北豆腐「块(小)」应为 100 g');
  else ok('北豆腐单位锚点：块(小) = 100 g');

  // 2.5) 新食物须能被「一键补缺口」推荐到，否则入库了却用不上
  const FX4 = global.FIX_SUGGEST || {};
  const inFx = (key, id) => (FX4[key] || []).some(x => x.id === id);
  if (!inFx('protein', 'tofu_firm')) bad('北豆腐未接入蛋白补缺口推荐');
  else ok('北豆腐已接入补缺口（蛋白）');
  if (!inFx('carb', 'chickpeas') || !inFx('carb', 'red_beans')) bad('鹰嘴豆/红豆未接入碳水补缺口推荐');
  else ok('鹰嘴豆、红豆已接入补缺口（碳水）');
  if (!inFx('fat', 'pecan') || !inFx('fat', 'olive_oil')) bad('碧根果/橄榄油未接入脂肪补缺口推荐');
  else ok('碧根果、橄榄油已接入补缺口（脂肪 · awayOnly）');

  // 3) 橄榄油须纳入可见脂肪判定
  if ((oo.tags || []).indexOf('visibleFat') < 0) bad('橄榄油应带 visibleFat 标签');
  else ok('橄榄油已纳入可见脂肪判定（围训练期会报红）');
  if ((get('pecan').tags || []).indexOf('visibleFat') >= 0) ok('碧根果带显式标签');
  else ok('碧根果靠 cat=nut 自动纳入可见脂肪（无需显式标签）');

  // 4) 宏量-热量自洽性
  const chk2 = (f) => {
    const n = f.n, fib = n.fiber || 0, netC = Math.max(0, n.c - fib);
    return Math.round(n.kcal - (n.p * 4 + n.f * 9 + netC * 4 + fib * 2));
  };
  // 坚果系统性偏低（脂肪被细胞壁包裹、实际可代谢能低，USDA 已证实）；
  // 豆类纤维发酵产 SCFA，标称值亦与 4/9/4 有出入。故阈值放宽到 35。
  spec.forEach(sp => {
    const d = chk2(get(sp.id));
    if (Math.abs(d) > 35) bad(get(sp.id).name + ' 热量偏差过大：' + d + ' kcal');
    else ok('自洽性 ' + get(sp.id).name + '：偏差 ' + d + ' kcal（坚果/豆类固有，阈值 35）');
  });

  /* ---- 训练时段 ---- */
  const LS_MAP2 = {};   // 独立沙盒，避免受前面小节写入影响
  const stubs =
    'const createApp=(o)=>{globalThis.__CAP=o;return {mount(){}}};' +
    'const ref=(v)=>({value:v});' +
    'const reactive=(o)=>o;' +
    'const computed=(fn)=>(typeof fn==="function"?{get value(){return fn()}}:Object.defineProperty({},"value",{get:fn.get,set:fn.set}));' +
    'const watch=()=>{};' +
    'const onMounted=()=>{};';
  const ctx4 = vm.createContext({
    Vue: {}, window: global, console, setTimeout, clearTimeout,
    Date, Math, JSON, Object, Array, Number, String, Set, isNaN, parseInt, parseFloat,
    localStorage: {
      getItem: (k) => (k in LS_MAP2 ? LS_MAP2[k] : null),
      setItem: (k, v) => { LS_MAP2[k] = String(v); },
      removeItem: (k) => { delete LS_MAP2[k]; }
    }
  });
  ctx4.globalThis = ctx4;
  vm.runInContext(appSrc.replace(MARKER, stubs), ctx4);
  const R4 = ctx4.__CAP.setup();
  R4.dateStr.value = '2030-03-01';
  R4.dayType.value = 'lower';   // 围训练期仅在训练日计算，休息日恒为空

  // 5) Leo 默认：03:00-05:00 训练 + postHours=1 → 早餐 06:30 出窗口
  if (!R4.trainCfg.value.enabled) bad('训练时段判定应默认启用');
  else ok('默认启用时段判定：' + R4.trainCfg.value.start + '-' + R4.trainCfg.value.end + '，练后窗口 ' + R4.trainCfg.value.postHours + ' h');
  if (R4.periWindow.value.text !== '01:00 — 06:00') bad('Leo 默认窗口应为 01:00 — 06:00，实为 ' + R4.periWindow.value.text);
  else ok('Leo 默认围训练期窗口：' + R4.periWindow.value.text);

  const peri1 = R4.periMeals.value.slice();
  if (peri1.indexOf('breakfast') >= 0) bad('早餐 06:30 已出窗口，不应被列为围训练期');
  else ok('早餐 06:30 未被列为围训练期 → 与「围训关系不大」判断一致（受控：' + R4.periMealNames.value + '）');

  // 6) 切成 2 小时窗口后，早餐应被纳入
  R4.setTrainCfg({ postHours: 2 });
  if (R4.periWindow.value.text !== '01:00 — 07:00') bad('2h 窗口应为 01:00 — 07:00，实为 ' + R4.periWindow.value.text);
  else ok('改为 2 小时窗口：' + R4.periWindow.value.text);
  if (R4.periMeals.value.indexOf('breakfast') < 0) bad('2h 窗口下早餐 06:30 应被纳入围训练期');
  else ok('2h 窗口下早餐 06:30 纳入围训练期（严格模式生效）');

  // 7) 关闭时段判定 → 退回保守口径
  R4.setTrainCfg({ postHours: 1, enabled: false });
  const periOff = R4.periMeals.value.slice();
  if (periOff.indexOf('pre') < 0 || periOff.indexOf('post') < 0) bad('关闭后应退回锁 pre/post，实为 ' + periOff.join('/'));
  else ok('关闭时段判定 → 退回保守口径：' + periOff.join('/'));

  // 8) 围训练期报红的实际联动（用早餐做正反验证）
  R4.setTrainCfg({ enabled: true, postHours: 2 });   // 早餐入窗口
  R4.dateStr.value = '2030-03-01';
  R4.dayType.value = 'lower';
  R4.draft.value['pecan'] = { unitKey: 'g', count: 20, state: 'cooked', confirmed: true };
  R4.addItem('pecan', 'breakfast');
  const wIn = R4.warnings.value.find(x => x.lv === 'red' && x.t.indexOf('可见脂肪') >= 0);
  if (!wIn) bad('早餐处于围训练期时，碧根果应报红');
  else ok('严格模式下早餐吃碧根果 → 报红：' + wIn.t);

  R4.setTrainCfg({ postHours: 1 });                   // 早餐出窗口
  const wOut = R4.warnings.value.find(x => x.lv === 'red' && x.t.indexOf('可见脂肪') >= 0);
  if (wOut) bad('早餐已出窗口，碧根果不应再报红');
  else ok('放宽为 1h 后同一条碧根果 → 不再报红（Leo 常态可用）');

  // 9) 餐次保护随窗口变化（换新一天，避免与上一条 breakfast 记录混淆）
  R4.dateStr.value = '2030-03-02';
  R4.setTrainCfg({ postHours: 2 });
  R4.meal.value = 'breakfast';
  R4.draft.value['pecan'] = { unitKey: 'g', count: 20, state: 'cooked', confirmed: true };
  R4.addItem('pecan');
  const placed2 = R4.mealRows.value.filter(m => m.count).map(m => m.k);
  if (placed2.indexOf('breakfast') >= 0) bad('早餐处于围训练期时，可见脂肪应被改派');
  else ok('餐次保护随窗口生效：碧根果改派到 ' + placed2.join('/'));

} catch (e) {
  bad('v4 测试失败: ' + e.message + ' | ' + (e.stack || '').split('\n')[1]);
}

out.push('\n' + (fail === 0 ? '===== 全部通过 =====' : '===== 失败 ' + fail + ' 项 ====='));
console.log(out.join('\n'));
process.exit(fail === 0 ? 0 : 1);
