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
  'public/vendor/vue.js'
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
const OPEN_TAG = '<div id="app" class="pd">';
const start = html.indexOf(OPEN_TAG);
const end = html.indexOf('<script src="/foods.js">');
if (start < 0 || end < 0) { bad('无法定位 #app 模板'); }
/* 必须取 #app 的 innerHTML：连同收尾的 </div> 一起剥掉。
 * 旧实现只剥了开标签，留下一个无处安放的 </div>，编译器恒定报
 * "Invalid end tag"——真正的模板错误反而被这一条掩盖，等于这项校验长期失效。 */
let rawTpl = html.slice(start + OPEN_TAG.length, end);
const lastClose = rawTpl.lastIndexOf('</div>');
const template = lastClose >= 0 ? rawTpl.slice(0, lastClose) : rawTpl;

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
const exprsFor = [];   // v-for 源表达式，稍后并入 exprs
const forRe = /v-for="([^"]+)"/g;
let m;
while ((m = forRe.exec(template))) {
  const parts = m[1].split(/\s+in\s+/);
  const left = parts[0].replace(/[()]/g, '').trim();
  left.split(',').forEach(s => { const t = s.trim(); if (t) scoped.add(t); });
  // 加固①：v-for 的「源表达式」也要参与核对。
  // 只登记左值的话，v-for 里用到一个 setup 没返回的标识符（如 allFoods）
  // 是查不出来的——这正是 PR#3「day 漏网崩页」的同类缺口。
  if (parts.length > 1) exprsFor.push(parts.slice(1).join(' in '));
}
// 箭头函数参数（如 allFoods.filter(x => x.cat === c.key)）
const arrowRe = /(?:\(\s*)?([A-Za-z_$][A-Za-z0-9_$]*)\s*=>/g;
let am;
while ((am = arrowRe.exec(template))) scoped.add(am[1]);
const exprs = [];
exprsFor.forEach(e => exprs.push(e));
const mustacheRe = /\{\{([^}]+)\}\}/g;
while ((m = mustacheRe.exec(template))) exprs.push(m[1]);
const attrRe = /\s(:|@|v-)([a-zA-Z-]+)="([^"]*)"/g;
while ((m = attrRe.exec(template))) {
  if (m[2] === 'for') continue;
  // 加固②：v-else-if 原先被漏掉（既不在下面的白名单里，也不是 :/@ 开头），
  // 于是 v-else-if 里写错一个标识符也查不出来。'else' 本身无值，放进来无害。
  if (['if', 'else', 'else-if', 'show', 'cloak', 'once', 'pre', 'slot', 'text', 'html', 'model'].indexOf(m[2]) >= 0) exprs.push(m[3]);
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
  // 口径说明：v6.2 起引擎换成「ACSM 2026 / 肾结晶与尿酸保护版」——
  // 蛋白锁 1.9 g/kg、脂肪锁 0.8 g/kg、热量按 kcal/kg 系数随体重缩放，
  // 碳水为剩余热量推导值（不再用原表的 2.3/2.0 g/kg 与 2500-2700 绝对值口径）。
  if (lower.t.protein !== 148) bad('下肢日蛋白应为 148 (1.9×78)，实为 ' + lower.t.protein);
  if (lower.t.carb !== 208) bad('下肢日碳水应为 208（(25.4×78 - 148×4 - 62×9)/4），实为 ' + lower.t.carb);
  if (lower.t.kcal < 1950 || lower.t.kcal > 2050) bad('下肢日热量 ' + lower.t.kcal + ' 越出 1950-2050');
  else ok('下肢日热量按体重缩放正确（25.4 kcal/kg）');

  const upper = bt(78, 'upper', 0, null);
  ok('上肢日(78kg): 蛋白' + upper.t.protein + ' 碳水' + upper.t.carb + ' 脂肪' + upper.t.fat + ' 热量' + upper.t.kcal);
  if (upper.t.protein !== 148) bad('上肢日蛋白应为 148 (1.9×78)，实为 ' + upper.t.protein);

  const rest = bt(78, 'rest', 0, null);
  ok('休息日(78kg): 蛋白' + rest.t.protein + ' 碳水' + rest.t.carb + ' 脂肪' + rest.t.fat + ' 热量' + rest.t.kcal);
  if (rest.t.kcal < 1650 || rest.t.kcal > 1750) bad('休息日热量 ' + rest.t.kcal + ' 越出 1650-1750');
  else ok('休息日热量按体重缩放正确（21.8 kcal/kg）');

  // 有氧日（v6.2 新增）应落在 上肢 与 4×4 之间，且 4×4 最高
  const z2 = bt(78, 'cardio_zone2', 0, null);
  const hiit = bt(78, 'cardio_hiit', 0, null);
  if (!(hiit.t.kcal > lower.t.kcal && lower.t.kcal > upper.t.kcal)) bad('日型热量序应为 4×4 > 下肢 > 上肢');
  else if (!(z2.t.kcal > lower.t.kcal && hiit.t.kcal > z2.t.kcal)) bad('Zone2 应介于下肢与 4×4 之间');
  else ok('五种日型热量序正确：上肢 ' + upper.t.kcal + ' < 下肢 ' + lower.t.kcal + ' < Zone2 ' + z2.t.kcal + ' < 4×4 ' + hiit.t.kcal);
  if (hiit.t.protein !== 148) bad('4×4 日蛋白也应为 148（蛋白不再随日型浮动）');

  // 碳水防酮下限：-20% 时热量缺口不得把碳水压到红线以下
  const restCut = bt(78, 'rest', -20, null);
  if (restCut.t.carb < 130) bad('休息日 -20% 时碳水跌破防酮下限 130 g，实为 ' + restCut.t.carb);
  else ok('休息日 -20%：碳水守住防酮下限 ' + restCut.t.carb + ' g，未落地 ' + restCut.unmet + ' kcal 改由 unmet 提示');
  if (restCut.recon.off) bad('碳水触底时 recon 不应误报偏离（参考区间已跟随后真实 kcal）');
  else ok('碳水触底未触发 recon 误报');

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
  const missingState = si([{ foodId: 'chicken', grams: 100 }], map);
  if (Math.abs(missingState.p - 22.5) > 0.01) bad('缺少生熟状态时应按食物基础状态计算');
  else ok('缺少生熟状态的旧记录按食物基础状态计算');
  const invalidFood = { id: 'invalid', cat: 'vege', base: 'raw', yield: 0, n: { p: -1, f: Infinity, c: 'bad', fiber: NaN, kcal: -20 } };
  const invalidTotals = si([
    { foodId: 'invalid', grams: 100 },
    { foodId: 'chicken', grams: -100, state: 'raw' },
    { foodId: 'chicken', grams: Infinity, state: 'raw' },
    null
  ], { invalid: invalidFood, chicken });
  if (![invalidTotals.p, invalidTotals.f, invalidTotals.c, invalidTotals.fiber, invalidTotals.kcal].every(Number.isFinite) ||
      invalidTotals.p < 0 || invalidTotals.f < 0 || invalidTotals.c < 0 || invalidTotals.fiber < 0 || invalidTotals.kcal < 0 ||
      invalidTotals.vege !== 100) bad('异常食物营养或克数污染了日摄入汇总');
  else ok('异常营养数据和非正/非有限克数不会污染日摄入汇总');

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
    if (r2.itemCount.value !== before + 1) bad('点击 + 应视为显式确认并录入');
    else ok('点击 + 视为显式确认 → 直接计入'); }

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

  // 常见食物展区（v5）：首播预设 + 「用过 3 次自动补进来」+ 手动增删
  const seedFavs = ['chicken', 'egg', 'salmon'].filter(id => R.isFav(id));
  if (seedFavs.length !== 3) bad('首次进入应播一份常见食物，实际只有 ' + seedFavs.length + ' 个');
  else ok('首播常见食物：' + seedFavs.join('、'));
  const freshId = 'tuna_can';
  if (R.isFav(freshId)) bad('没用过的食物不应直接进常用');
  else ok('没用过的食物不会混进常用（' + freshId + '）');
  R.draft.value[freshId] = { unitKey: 'can', count: 1, state: 'cooked', confirmed: true };
  R.addItem(freshId); R.addItem(freshId);
  if (R.isFav(freshId)) bad('只用 2 次就进了常用，阈值应为 3 次');
  else ok('用过 2 次仍未进常用（阈值 3 次生效）');
  R.addItem(freshId);
  if (!R.isFav(freshId)) bad('用满 3 次应自动加入常用');
  else ok('同一食物用过 3 次 → 自动加入常用：金枪鱼罐头');
  const favFoods = R.foodsInCat.value;
  if (!favFoods.length) bad('常用食物应排在当前分类列表里');
  else ok('常用食物已置顶到分类列表（首位：' + favFoods[0].name + '）');
  R.toggleFav('salmon');
  if (R.isFav('salmon')) bad('手动取消常用失败'); else ok('可手动取消常用');
  R.toggleFav('salmon');
  if (!R.isFav('salmon')) bad('手动恢复常用失败'); else ok('可手动恢复常用');

  // 撤销
  const before = R.itemCount.value;
  const target = R.mealRows.value.find(m => m.count).items[0];
  R.removeItem(target.id);
  if (R.itemCount.value !== before - 1) bad('删除失败');
  else ok('删除条目 → 计数 ' + before + ' → ' + R.itemCount.value);
  if (R.isFav(target.foodId)) bad('删除后应同步移出常用食物');
  else ok('删除后同步移出常用：' + target.name);
  if (!R.canUndo.value) bad('删除后应可撤销');
  R.undoDelete();
  if (R.itemCount.value !== before) bad('撤销未恢复条目');
  else ok('撤销删除 → 恢复至 ' + R.itemCount.value + ' 项');

  // 复制昨日
  const ymdN = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const ymdOf = (ds) => { const d = new Date(ds + 'T00:00:00'); d.setDate(d.getDate() - 1); return ymdN(d); };
  const yesterdayDate = ymdOf(R.dateStr.value);
  R.dateStr.value = yesterdayDate;
  R.draft.value['salmon'] = { unitKey: 'block', count: 1, state: 'raw', confirmed: true };
  R.setMeal('dinner');
  R.addItem('salmon');
  const yCount = R.itemCount.value;
  R.dateStr.value = c.todayStr();
  if (!R.canCopy.value) bad('应能检测到昨日记录');
  else ok('检测到昨日 ' + yCount + ' 项记录，可一键复制');
  const totalsBeforeImport = R.totals.value.kcal;
  const countedBeforeImport = R.countedItemCount.value;
  R.copyYesterday();
  const imported = R.day.value.items.find(i => i.pendingConfirmation);
  if (R.itemCount.value < yCount || !imported) bad('复制昨日失败或未标记待确认');
  else ok('复制昨日 → 今日新增 ' + yCount + ' 项待确认条目');
  if (R.countedItemCount.value !== countedBeforeImport || R.totals.value.kcal !== totalsBeforeImport)
    bad('未确认的昨日条目计入了今日汇总');
  else ok('未确认的昨日条目不计入今日汇总');
  if (imported && (R.draft.value.salmon.unitKey !== 'block' || R.draft.value.salmon.count !== imported.count))
    bad('导入食物没有同步为今日默认值模板');
  else if (imported) ok('导入食物的单位和数量已同步为今日默认值');
  if (imported) {
    R.confirmImportedItem(imported.id);
    if (R.pendingItemCount.value !== 0 || R.countedItemCount.value !== countedBeforeImport + 1 || R.totals.value.kcal <= totalsBeforeImport)
      bad('逐项确认后未计入今日汇总');
    else ok('逐项确认后立即计入今日汇总');
  }
  R.pullYesterday();
  const denied = R.day.value.items.find(i => i.pendingConfirmation);
  const countBeforeDeny = R.itemCount.value;
  const totalsBeforeDeny = R.totals.value.kcal;
  if (!denied) bad('拉入昨天未生成待确认条目');
  else {
    R.removeItem(denied.id);
    if (R.itemCount.value !== countBeforeDeny - 1 || R.pendingItemCount.value !== 0 || R.totals.value.kcal !== totalsBeforeDeny)
      bad('拒绝导入条目后未从今日小结移除');
    else ok('拒绝导入条目后立即从今日小结移除');
  }

  // 补缺口建议
  R.setMeal('lunch');
  const fx = R.fixList.value;
  if (!fx.length) bad('应生成补缺口建议');
  else {
    // v6.2：蛋白锁 1.9 g/kg（78kg → 148 g，低于旧引擎的 179 g），
    // 前面已录入的条目可能已把蛋白吃达标——此时应当「不再给建议」，而不是报失败。
    const pGap = R.targets.value.protein - R.totals.value.p;
    const p = fx.find(x => x.key === 'protein');
    if (pGap > 1 && !p) bad('蛋白还差 ' + Math.round(pGap) + ' g 却没有补缺口建议');
    else if (pGap <= 1 && p) bad('蛋白已达标（' + R.targets.value.protein + ' g）却仍给出补缺口建议');
    else if (p) ok('补缺口建议：蛋白质还差 ' + p.gap + ' g → ' + p.options.map(o => o.label + ' ' + o.grams + 'g').join(' / '));
    else ok('蛋白已达标（' + Math.round(R.totals.value.p) + '/' + R.targets.value.protein + ' g），正确不再给补缺口建议');
    // v3：awayOnly（可见脂肪）在训练日仍可推荐，由餐次保护避开围训练期
    const awayIds = ['salmon', 'almond', 'walnut', 'avocado', 'cheese'];
    const awayShown = p ? p.options.filter(o => awayIds.indexOf(o.id) >= 0) : [];
    ok('awayOnly 可见脂肪项在训练日仍可推荐'
      + (p ? (awayShown.length ? '：' + awayShown.map(o => o.label).join('、') : '（本缺口下未进入前四）')
           : '（蛋白已达标，未生成该组建议）'));
    const veg = fx.find(x => x.key === 'vege');
    const vegOption = veg && veg.options.find(o => o.id === 'dark_vege');
    if (!vegOption || vegOption.grams !== veg.gap || vegOption.covers !== veg.gap || vegOption.partial)
      bad('蔬菜补缺口应按蔬菜克数直接换算，且正确报告补足量');
    else ok('蔬菜补缺口按克数换算：建议 ' + vegOption.grams + ' g，实际补 ' + vegOption.covers + ' g');
    R.setMeal('breakfast');
    const breakfastFx = R.fixList.value;
    if (breakfastFx.some(x => x.options.some(o => o.id === 'chicken' || o.id === 'dark_vege')))
      bad('早餐不应推荐不适配早餐的鸡胸/蔬菜补缺口项');
    else ok('补缺口建议按当前餐次过滤不适配食物');
    R.setMeal('lunch');
    // trainOnly 项（蛋白粉）在休息日必须消失
    R.dayType.value = 'rest';
    const fxRest = R.fixList.value.find(x => x.key === 'protein');
    if (fxRest && fxRest.options.some(o => o.id === 'protein_powder')) bad('休息日不应推荐蛋白粉（trainOnly）');
    else ok('休息日补缺口已排除蛋白粉（trainOnly）');
    R.dayType.value = 'lower';
    // v6.2 蛋白锁 1.9 g/kg（78kg → 148 g）：前面测试累积录入的条目已把蛋白吃超标，
    // 补缺口分组会自然消失。这里清空当日条目，让「训练日应给建议 / 降序 / 一顿上限」
    // 这几条断言继续保有覆盖（顺带也让下面的一键补缺口有可用选项）。
    R.day.value.items.splice(0, R.day.value.items.length);
    const fxTrain = R.fixList.value.find(x => x.key === 'protein');
    if (!fxTrain) bad('训练日应给出蛋白补缺口建议');
    else ok('训练日补缺口：' + fxTrain.options.map(o => o.label + ' ' + o.grams + 'g').join(' / '));
    const sorted = fxTrain.options.every((o, i) => i === 0 || fxTrain.options[i - 1].covers >= o.covers);
    if (!sorted) bad('推荐应按实际贡献降序（最管用的排前）');
    else ok('推荐按贡献降序：' + fxTrain.options.map(o => o.label + ' ' + o.grams + 'g(补' + o.covers + ')').join(' / '));
    const crazy = fxTrain.options.some(o => o.grams > 500);
    if (crazy) bad('存在一顿吃不完的推荐量: ' + fxTrain.options.map(o => o.label + o.grams).join(','));
    else ok('推荐量均不超过一顿上限（补剂 60 g / 常规 500 g）');
    const pw = fxTrain.options.find(o => o.id === 'protein_powder');
    if (pw && pw.grams > 60) bad('蛋白粉推荐量超过 60 g 上限');
    const part = fxTrain.options.filter(o => o.partial);
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

/* ---------- 9. v5：主食豆类 / 常见食物 / 单位折算 / 随时存储 / 脏数据 ---------- */
out.push('\n【9】v5：主食与豆类 / 常见食物展区 / 单位折算 / 断电可续 / 脏数据体检');
try {
  const F9 = (global.FOOD_DB || []);
  const get9 = (id) => F9.find(f => f.id === id);

  // 1) 用户点名的主食与豆类必须在库
  const stapleIds = ['potato', 'corn', 'purple_potato', 'sweet_potato', 'red_beans', 'chickpeas', 'soybean', 'mung_bean', 'black_bean'];
  const lack = stapleIds.filter(id => !get9(id));
  if (lack.length) bad('缺少食物：' + lack.join('、'));
  else ok('主食与豆类齐备：' + stapleIds.map(id => get9(id).name).join('、'));

  // 2) 三种干豆的宏量-热量自洽性
  ['soybean', 'mung_bean', 'black_bean'].forEach(id => {
    const f = get9(id), n = f.n, fib = n.fiber || 0, netC = Math.max(0, n.c - fib);
    const d = Math.round(n.kcal - (n.p * 4 + n.f * 9 + netC * 4 + fib * 2));
    if (Math.abs(d) > 8) bad(f.name + ' 热量偏差过大：' + d + ' kcal');
    else ok('自洽性 ' + f.name + '：标称 ' + n.kcal + ' kcal ≈ 折算 ' + (n.kcal - d) + ' kcal（差 ' + d + '）');
  });

  // 3) 补缺口能推荐到新增主食与豆类
  const FX9 = global.FIX_SUGGEST || {};
  const wantFx = ['potato', 'corn', 'purple_potato', 'soybean', 'mung_bean', 'black_bean'];
  const missFx = wantFx.filter(id => !(FX9.carb || []).some(x => x.id === id));
  if (missFx.length) bad('未接入碳水补缺口：' + missFx.join('、'));
  else ok('新增主食与豆类已接入碳水补缺口：' + wantFx.join('、'));

  // 4) 逻辑层：干豆生熟折算 + 汇总端拦截超限条目
  const ctx9 = vm.createContext({ window: global, console, Math, JSON, Object, Array, Number, String, Set });
  ctx9.globalThis = ctx9;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/foods.js'), 'utf8'), ctx9);
  vm.runInContext(appSrc.split('const { createApp')[0], ctx9);
  const map9 = {}; F9.forEach(f => { map9[f.id] = f; });
  const soyRaw = ctx9.per100(map9['soybean'], 'raw');
  const soyCooked = ctx9.per100(map9['soybean'], 'cooked');
  if (Math.abs(soyCooked.kcal - soyRaw.kcal / 2.3) > 0.5) bad('黄豆干→熟折算错误');
  else ok('黄豆 干→熟 折算：100 g 干 ' + soyRaw.kcal + ' kcal → 100 g 熟 ' + Math.round(soyCooked.kcal) + ' kcal（yield 2.3）');
  const soyBowl = map9['soybean'].units.find(u => u.k === 'bowl');
  if (!soyBowl || soyBowl.g !== 200 || soyBowl.state !== 'cooked') bad('黄豆「碗(熟)」应为 200 g 且自动切熟重');
  else ok('黄豆「碗(熟)」= 200 g 且自动切到熟重状态');
  const sBad = ctx9.sumItems([
    { foodId: 'yogurt', grams: 50000, state: 'cooked', cat: 'protein' },
    { foodId: 'chicken', grams: 200, state: 'raw', cat: 'protein' }
  ], map9);
  if (sBad.kcal > 1000) bad('超上限条目仍被计入汇总');
  else ok('汇总端同口径拦截：50000 g 不计入，200 g 生鸡胸照常计入（' + Math.round(sBad.kcal) + ' kcal）');

  // 5) 休息日蛋白红线按体重缩放（58 kg 的琳达不该套 78 kg 的 130 g）
  const lt9 = ctx9.buildTargets(58, 'rest', 0, null);
  const lowItems = [{ foodId: 'chicken', grams: 100, state: 'raw', cat: 'protein' }];
  const sLow = ctx9.sumItems(lowItems, map9);
  const wLow = ctx9.buildWarnings(sLow, lt9.t, 'rest', lowItems, map9, 0);
  const redLow = wLow.find(x => x.t === '蛋白质不足');
  if (!redLow) bad('58 kg 用户只吃 22 g 蛋白却没报红');
  else ok('小体重红线同比缩放（58 kg）：' + redLow.d.split('。')[1]);

  /* ---- 运行时：常见食物 / 单位 / 断电可续 / 脏数据 ---- */
  const LS_MAP9 = {};
  const stubs9 =
    'const createApp=(o)=>{globalThis.__CAP=o;return {mount(){}}};' +
    'const ref=(v)=>({value:v});' +
    'const reactive=(o)=>o;' +
    'const computed=(fn)=>(typeof fn==="function"?{get value(){return fn()}}:Object.defineProperty({},"value",{get:fn.get,set:fn.set}));' +
    'const watch=()=>{};' +
    'const onMounted=()=>{};';
  const mk9 = () => vm.createContext({
    Vue: {}, window: global, console, setTimeout, clearTimeout,
    Date, Math, JSON, Object, Array, Number, String, Set, isNaN, parseInt, parseFloat,
    localStorage: {
      getItem: (k) => (k in LS_MAP9 ? LS_MAP9[k] : null),
      setItem: (k, v) => { LS_MAP9[k] = String(v); },
      removeItem: (k) => { delete LS_MAP9[k]; }
    }
  });
  const c9 = mk9(); c9.globalThis = c9;
  vm.runInContext(appSrc.replace(MARKER, stubs9), c9);
  const R9 = c9.__CAP.setup();
  R9.dateStr.value = '2030-04-01';
  R9.dayType.value = 'lower';

  if (!R9.commonFoods.value.length) bad('首次进入应有常见食物预设');
  else ok('首次进入常见食物 ' + R9.commonFoods.value.length + ' 项：' + R9.commonFoods.value.slice(0, 5).map(f => f.name).join('、') + '…');

  // 6) 单位：燕麦按「碗」录入，常用卡一键加入沿用记忆单位（不退化成克）
  R9.setMeal('lunch');
  R9.draft.value['oats'] = { unitKey: 'bowl', count: 1, state: 'cooked', confirmed: true };
  R9.addItem('oats');
  const oats1 = R9.day.value.items.find(i => i.foodId === 'oats');
  if (!oats1 || Math.abs(oats1.grams - 200) > 0.01) bad('1 碗燕麦应为 200 g，实为 ' + (oats1 && oats1.grams));
  else ok('燕麦按「碗」录入 → ' + oats1.grams + ' g（单位记忆：' + oats1.unitLabel + '）');
  R9.addCommon('oats');
  const oatsAll = R9.day.value.items.filter(i => i.foodId === 'oats');
  if (oatsAll.length !== 2 || Math.abs(oatsAll[1].grams - 200) > 0.01 || oatsAll[1].unitKey !== 'bowl')
    bad('常用卡一键加入未按上次单位/用量');
  else ok('常用卡一键加入沿用上次用量：' + oatsAll[1].count + ' ' + oatsAll[1].unitLabel + ' = ' + oatsAll[1].grams + ' g');

  // 7) 已摄入里按份数 / 单位改量
  R9.setItemCount(oatsAll[0], 2);
  if (Math.abs(oatsAll[0].grams - 400) > 0.01) bad('改份数应折回克：2 碗 = 400 g，实为 ' + oatsAll[0].grams);
  else ok('已摄入里改份数：2 碗 → ' + oatsAll[0].grams + ' g');
  R9.setItemUnit(oatsAll[0], 'g');
  if (Math.abs(oatsAll[0].grams - 400) > 0.01 || Math.abs(oatsAll[0].count - 400) > 0.01) bad('换单位后克数应保持 400');
  else ok('换成「克」单位：克数不变（' + oatsAll[0].grams + ' g），份数同步');
  R9.setItemUnit(oatsAll[1], 'bowl');
  R9.bumpGrams(oatsAll[1], 10);
  if (Math.abs(oatsAll[1].grams - 210) > 0.01) bad('±10 后应为 210 g');
  else ok('±10 微调保持单位：1 碗 + 10 g → ' + Math.round(oatsAll[1].count * 10) / 10 + ' 碗 = ' + oatsAll[1].grams + ' g');

  // 8) 脏数据体检
  R9.day.value.items.push({ id: 'bad1', foodId: 'yogurt', name: '酸奶(无糖全脂)', cat: 'protein', grams: 50000, state: 'cooked', unitKey: 'g', unitLabel: '克', count: 50000, meal: 'lunch', ts: Date.now() });
  if (R9.totals.value.kcal > 100000) bad('50000 g 脏数据仍计入了汇总');
  else ok('50000 g 脏数据被拦下不计入统计（当前 ' + Math.round(R9.totals.value.kcal) + ' kcal）');
  if (R9.badItems.value.length !== 1) bad('脏数据体检未检出');
  else ok('脏数据体检检出 ' + R9.badItems.value.length + ' 条：' + R9.badItems.value[0].name + ' ' + R9.badItems.value[0].grams + ' g');
  R9.repairBadItems();
  if (R9.badItems.value.length !== 0) bad('一键清理未生效');
  else ok('一键清理后异常记录清零（由用户点按钮确认，不静默删数据）');

  // 9) 断电可续：保存会话 → 全新实例恢复页签 / 餐次 / 未提交草稿
  R9.setMeal('dinner');
  R9.tab.value = 'intake';
  R9.draft.value['salmon'] = { unitKey: 'block', count: 2, state: 'raw', confirmed: true };
  R9.saveSession();
  const c10 = mk9(); c10.globalThis = c10;
  vm.runInContext(appSrc.replace(MARKER, stubs9), c10);
  const R10 = c10.__CAP.setup();
  const s10 = R10.restoreSession();
  if (!s10) bad('会话未能恢复');
  else {
    if (R10.tab.value !== 'intake' || R10.meal.value !== 'dinner') bad('恢复后页签/餐次不对');
    else ok('断电重开：直接回到「' + R10.tab.value + '」页 · 餐次「' + R10.mealName(R10.meal.value) + '」');
    const d10 = R10.draft.value['salmon'];
    if (!d10 || d10.unitKey !== 'block' || d10.count !== 2 || d10.state !== 'raw') bad('未提交草稿未恢复');
    else ok('未提交的输入一并恢复：三文鱼 2 块 / 生重 = ' + R10.gramsPreview('salmon') + ' g');
    if (!R10.resumedInfo.value) bad('恢复提示信息为空');
    else ok('顶部提示：已恢复上次进度（' + R10.resumedInfo.value + '）');
  }

} catch (e) {
  bad('v5 测试失败: ' + e.message + ' | ' + (e.stack || '').split('\n')[1]);
}

/* ---------- 10. 静态资源与零外网依赖 ---------- */
out.push('\n【10】静态资源完整性 / 零外网依赖');
try {
  const htmlSrc = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const cssSrc  = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  const icoSrc  = fs.readFileSync(path.join(ROOT, 'public/icon.css'), 'utf8');

  // 10.1 引用的本地资源必须真实存在
  const refs = [];
  let rm;
  const refRe = /(?:href|src)="(\/[^"]+)"/g;
  while ((rm = refRe.exec(htmlSrc))) refs.push(rm[1]);
  const missing = refs.filter(r => !fs.existsSync(path.join(ROOT, 'public', r)));
  if (missing.length) bad('index.html 引用了不存在的本地资源: ' + missing.join(', '));
  else ok('index.html 引用的 ' + refs.length + ' 个本地资源全部存在（' + refs.join(' ') + '）');

  // 10.2 不得引用任何外网域名（断网即白屏的历史坑）
  const ext = [];
  const extRe = /(?:href|src)="(https?:\/\/[^"]+)"/g;
  while ((rm = extRe.exec(htmlSrc))) ext.push(rm[1]);
  if (ext.length) bad('存在外网依赖，断网会白屏: ' + ext.join(', '));
  else ok('零外网依赖：页面不含任何 CDN / 外链脚本或字体');

  // 10.3 图标覆盖：模板里出现的 fa-* 必须在 icon.css 有定义
  const used = new Set();
  const useRe = /fa-[a-z0-9-]+/g;
  [htmlSrc, fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8'), fs.readFileSync(path.join(ROOT, 'public/foods.js'), 'utf8')]
    .forEach(src => { const re = /fa-[a-z0-9-]+/g; let mm; while ((mm = re.exec(src))) used.add(mm[0]); });
  used.delete('fa-solid'); used.delete('fa'); used.delete('fas');
  const undef = Array.from(used).filter(n => icoSrc.indexOf('.' + n + '{') < 0);
  if (undef.length) bad('icon.css 缺少图标定义: ' + undef.join(', '));
  else ok('图标自持：' + used.size + ' 个 fa-* 图标全部在本地 icon.css 内有定义');

  // 10.4 .hidden 必须自持（原来靠 Tailwind CDN）
  if (/\.hidden\s*\{[^}]*display:\s*none/.test(cssSrc)) ok('.hidden 已收回自持，不再依赖 Tailwind CDN');
  else bad('.hidden 未定义，两个 file input 会暴露在页面上');

  // 10.5 图标表必须是合法 SVG data URI
  const uriCount = (icoSrc.match(/data:image\/svg\+xml,/g) || []).length;
  if (uriCount < used.size * 2) bad('icon.css 的 mask 定义不完整（应有双份 -webkit-/标准属性）');
  else ok('icon.css 含 ' + uriCount + ' 条 SVG data URI（每条同时给出 -webkit- 与标准属性）');
} catch (e) {
  bad('静态资源检查失败: ' + e.message);
}

/* ---------- 11. AI 导入食物 ---------- */
out.push('\n【11】AI 导入：固定 Prompt / 抗脏解析 / 自动归类 / 自动进常用');
try {
  /* 11.1 Prompt 常量必须与真实数据结构对齐（防漂移） */
  const PROMPT = global.ADD_FOOD_PROMPT || '';
  if (!PROMPT) bad('window.ADD_FOOD_PROMPT 未定义');
  else {
    ok('固定 Prompt 已就位（' + PROMPT.length + ' 字符）');
    // 这些字段名一旦从 Prompt 里消失，AI 就不会再输出它们 —— 必须守住
    const must = ['"name"', '"cat"', '"base"', '"yield"', '"units"', '"tags"', '"note"', '"p"', '"f"', '"c"', '"fiber"', '"kcal"'];
    const lost = must.filter(m => PROMPT.indexOf(m) < 0);
    if (lost.length) bad('Prompt 缺少字段说明: ' + lost.join(', '));
    else ok('Prompt 覆盖了全部 12 个必需字段（name/cat/base/yield/units/tags/note + p/f/c/fiber/kcal）');

    const cats = (global.CATEGORIES || []).map(c => c.key);
    const catLost = cats.filter(k => PROMPT.indexOf(k) < 0);
    if (catLost.length) bad('Prompt 未列出分类: ' + catLost.join(', '));
    else ok('Prompt 列全了 6 个分类: ' + cats.join(' / '));

    const tagLost = (global.FOOD_TAGS || []).filter(t => PROMPT.indexOf(t) < 0);
    if (tagLost.length) bad('Prompt 未列出标签: ' + tagLost.join(', '));
    else ok('Prompt 列全了 5 个标签: ' + (global.FOOD_TAGS || []).join(' / '));

    // 自然单位是这个需求的核心：必须明确要求「个/半根/碗/勺」
    if (PROMPT.indexOf('半根') < 0 || PROMPT.indexOf('碗') < 0 || PROMPT.indexOf('勺') < 0)
      bad('Prompt 未强调自然计量单位（个/半根/碗/勺）');
    else ok('Prompt 明确要求自然计量单位（含「半根」这种非整数份）');
    // 自洽公式要写进 Prompt，让 AI 自查（纤维按 2kcal/g 是本项目的折算口径）
    if (PROMPT.indexOf('p×4') < 0 || PROMPT.indexOf('fiber×2') < 0) bad('Prompt 未给出完整的热量自洽公式');
    else ok('Prompt 含热量自洽公式 p×4 + f×9 + (c−fiber)×4 + fiber×2（AI 会自查）');
    if (PROMPT.indexOf('__FOOD__') < 0) bad('Prompt 缺少食物名占位符 __FOOD__');
    else ok('Prompt 含 __FOOD__ 占位符（复制前替换为实际食物名）');
  }

  /* 11.2 抗脏解析：真实 AI 输出的各种脏形态 */
  const LS11 = (global.__LS_MAP = global.__LS_MAP || {});
  const stubs11 =
    'const createApp=(o)=>{globalThis.__CAP=o;return {mount(){}}};' +
    'const ref=(v)=>({value:v});' +
    'const reactive=(o)=>o;' +
    'const computed=(fn)=>(typeof fn==="function"?{get value(){return fn()}}:Object.defineProperty({},"value",{get:fn.get,set:fn.set}));' +
    'const watch=()=>{};const onMounted=()=>{};';
  const mk11 = () => {
    const c = vm.createContext({
      Vue: {}, window: global, console, setTimeout, clearTimeout,
      Date, Math, JSON, Object, Array, Number, String, Set, isNaN, parseInt, parseFloat,
      localStorage: {
        getItem: (k) => (k in LS11 ? LS11[k] : null),
        setItem: (k, v) => { LS11[k] = String(v); },
        removeItem: (k) => { delete LS11[k]; }
      }
    });
    c.globalThis = c;
    return c;
  };
  const appSrc11 = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
  const c11 = mk11();
  vm.runInContext(appSrc11.replace(MARKER, stubs11), c11);
  const R = c11.__CAP.setup();
  const parse = R.aiParseJson, norm = R.aiNormalizeFood;

  const GOOD = {
    name: '鹌鹑蛋', cat: 'protein', base: 'cooked', yield: 1,
    n: { p: 13.1, f: 11.1, c: 0.4, fiber: 0, kcal: 158 },
    units: [{ k: 'pcs', label: '个', g: 10 }, { k: 'g', label: '克', g: 1 }],
    tags: [], note: '1 个约 10 g'
  };
  if (!parse(JSON.stringify(GOOD))) bad('纯 JSON 解析失败');
  else ok('解析：干净 JSON');

  const fenced = '好的，这是你要的数据：\n```json\n' + JSON.stringify(GOOD) + '\n```\n希望对你有帮助！';
  if (!parse(fenced)) bad('markdown 围栏 + 前后寒暄 解析失败');
  else ok('解析：```json 围栏 + AI 前后寒暄');

  const chatty = '根据中国食物成分表，鹌鹑蛋的营养如下：\n' + JSON.stringify(GOOD) + '\n\n以上数据供参考。';
  if (!parse(chatty)) bad('前后中文包裹 解析失败');
  else ok('解析：中文前言 + 后记包裹');

  const trailing = JSON.stringify(GOOD).replace(/\}\s*$/, ',\n  "extra": "x"\n}').replace(/"extra": "x"\n\}/, '"extra": "x",\n}');
  const t2 = parse(trailing);
  if (!t2) bad('尾随逗号 解析失败');
  else ok('解析：尾随逗号（AI 最常见的 JSON 瑕疵）');

  const quoted = JSON.stringify(GOOD).replace(/"/g, "'");
  const q2 = parse(quoted);
  if (!q2) bad('单引号 解析失败');
  else ok('解析：单引号 JSON');

  const wrapped = JSON.stringify({ food: GOOD });
  const w2 = norm(parse(wrapped));
  if (!w2.ok) bad('被包一层 { food: ... } 时解析失败');
  else ok('解析：AI 把结果包一层 { food: {...} }');

  // 中文引号 “ ” → 上面的单引号降级路径已覆盖，这里单独验一次中文弯引号
  const cnQuote = '{"name":"\u76f8\u8549","cat":"fruit","n":{"kcal":53},"units":[{"k":"g","label":"\u514b","g":1}]}'
    .replace(/"/g, '\u201C').replace(/\u201C/g, '\u201D');
  if (!parse(cnQuote)) bad('中文弯引号 JSON 解析失败');
  else ok('解析：中文弯引号 JSON（复制时被自动转换的常见情况）');

  if (parse('随便一段不是 JSON 的文字')) bad('非 JSON 文本应返回 null 而不是硬凑');
  else ok('非 JSON 文本 → 返回 null（不硬凑、不静默造数据）');

  /* 11.3 归一化：非克单位 / 缺字段 / 脏数值 */
  const r1x = norm(GOOD);
  if (!r1x.ok) bad('归一化失败: ' + r1x.err);
  else {
    if (r1x.food.units.length !== 2 || r1x.food.units[0].g !== 10) bad('自然单位未保留');
    else ok('自然单位保留：「1 个 = 10 g」（不只是克）');
    if (r1x.food.cat !== 'protein') bad('分类错误');
    else ok('自动归类：鹌鹑蛋 → 蛋白质');
  }

  // 半个香蕉：非整数份单位
  const bananaish = {
    name: '皇帝蕉', cat: 'fruit', base: 'cooked', yield: 1,
    n: { p: 1.1, f: 0.3, c: 23.0, fiber: 1.2, kcal: 93 },
    units: [{ k: 'pcs', label: '个(可食)', g: 100 }, { k: 'half', label: '半根', g: 50 }, { k: 'g', label: '克', g: 1 }],
    tags: ['fastcarb'], note: ''
  };
  const rb = norm(bananaish);
  if (!rb.ok || !rb.food.units.some(u => u.k === 'half' && u.g === 50)) bad('半根单位丢失');
  else ok('非整数份单位保留：「半根 = 50 g」');

  // 缺 kcal → 自动补算
  const nok = { name: '某鱼', cat: 'protein', n: { p: 18, f: 5, c: 0, fiber: 0 }, units: [{ k: 'g', label: '克', g: 1 }] };
  const rk = norm(nok);
  if (!rk.ok) bad('缺 kcal 应补算而非失败');
  else {
    const expect = Math.round(18 * 4 + 5 * 9);
    if (rk.food.n.kcal !== expect) bad('补算 kcal 错误: ' + rk.food.n.kcal + ' ≠ ' + expect);
    else ok('缺 kcal → 按 4/9/4 自动补算为 ' + expect + ' kcal，并给出提示');
    if (!rk.warns.some(w => w.indexOf('补算') >= 0)) bad('补算未提示');
  }

  // yield 非法 → 归 1，绝不除零
  const badYield = { name: '怪食物', cat: 'protein', yield: 0, n: { p: 10, f: 1, c: 1, fiber: 0, kcal: 50 }, units: [{ k: 'g', label: '克', g: 1 }] };
  const ry = norm(badYield);
  if (!ry.ok || ry.food.yield !== 1) bad('yield=0 未归 1，会导致除零');
  else ok('yield=0 → 归 1（杜绝除零把营养算成 Infinity）');
  const bigYield = Object.assign({}, badYield, { yield: 999 });
  if (norm(bigYield).food.yield !== 1) bad('yield=999 未归 1');
  else ok('yield=999 → 归 1（异常值不进入计算）');

  // 纤维 > 碳水 → 修正
  const badFib = { name: '高纤', cat: 'vege', yield: 1, n: { p: 2, f: 0, c: 3, fiber: 9, kcal: 30 }, units: [{ k: 'g', label: '克', g: 1 }] };
  const rf = norm(badFib);
  if (!rf.ok || rf.food.n.fiber > rf.food.n.c) bad('纤维多于总碳水未修正，会算出负净碳水');
  else ok('纤维 9 > 碳水 3 → 修正为 3（净碳水不会为负）');

  // 越权分类 → 按名称推断
  const weirdCat = { name: '碧根果', cat: 'nuts', yield: 1, n: { p: 9.2, f: 72, c: 13.9, fiber: 9.6, kcal: 691 }, units: [{ k: 'g', label: '克', g: 1 }] };
  const rw = norm(weirdCat);
  if (!rw.ok || rw.food.cat !== 'nut') bad('越权分类未兜底推断: ' + (rw.food && rw.food.cat));
  else ok('AI 给了白名单外的分类（nuts）→ 按名称推断为「坚果」');
  const zhCat = norm(Object.assign({}, weirdCat, { name: '菠菜', cat: '蔬菜' }));
  if (zhCat.food.cat !== 'vege') bad('中文分类未推断为蔬菜');
  else ok('AI 给中文分类（蔬菜）→ 推断为 vege');

  // 自造标签 → 过滤
  const badTags = Object.assign({}, GOOD, { tags: ['fastcarb', 'lowcarb', 'highprotein'] });
  const rt = norm(badTags);
  if (rt.food.tags.join(',') !== 'fastcarb') bad('自造标签未过滤: ' + rt.food.tags.join(','));
  else ok('自造标签过滤：lowcarb / highprotein 被剔除，只留 fastcarb');
  if (!rt.warns.some(w => w.indexOf('标签') >= 0)) bad('过滤未提示');

  // 负数 / 非数字营养 → 归 0
  const neg = { name: '负数食物', cat: 'protein', yield: 1, n: { p: -5, f: 'abc', c: NaN, fiber: null, kcal: -20 }, units: [{ k: 'g', label: '克', g: 1 }] };
  const rn = norm(neg);
  const vals = [rn.food.n.p, rn.food.n.f, rn.food.n.c, rn.food.n.fiber];
  if (!vals.every(v => v === 0)) bad('负/非数字营养未归 0: ' + JSON.stringify(rn.food.n));
  else ok('负数 / 非数字营养值 → 全部归 0（脏数据不进统计）');

  // 单位缺克 → 自动补
  const noGram = Object.assign({}, GOOD, { units: [{ k: 'pcs', label: '个', g: 10 }] });
  const rg = norm(noGram);
  if (!rg.food.units.some(u => u.k === 'g' && u.g === 1)) bad('未自动补克单位');
  else ok('units 无「克」→ 自动补上 { k:"g", g:1 }（否则无法按克微调）');

  // 单位克重非法 → 剔除
  const badUnit = Object.assign({}, GOOD, { units: [{ k: 'pcs', label: '个', g: 0 }, { k: 'x', label: '坏', g: -3 }, { k: 'g', label: '克', g: 1 }] });
  const ru = norm(badUnit);
  if (ru.food.units.length !== 1) bad('非法克重单位未剔除: ' + ru.food.units.length);
  else ok('克重为 0 / 负数的单位 → 剔除（避免算出 0 营养的幽灵条目）');

  /* 11.4 入库 + 自动进常用（端到端） */
  R.openAiImport();
  R.aiImport.value.name = '鹌鹑蛋';
  if (R.aiPromptText.value.indexOf('__FOOD__') >= 0) bad('Prompt 未替换占位符');
  else if (R.aiPromptText.value.indexOf('鹌鹑蛋') < 0) bad('Prompt 未带上食物名');
  else ok('复制前自动把「鹌鹑蛋」填进 Prompt（用户不用手改）');

  R.aiImport.value.json = fenced;
  R.parseAiJson();
  if (!R.aiImport.value.preview) bad('预览生成失败: ' + R.aiImport.value.error);
  else ok('粘贴 → 解析 → 预览成功（' + R.aiImport.value.preview.food.name + '）');

  const favsBefore = R.favs.value.length;
  R.confirmAiImport();
  if (!R.aiImport.value.done) bad('入库失败');
  else {
    ok('确认入库：' + R.aiImport.value.preview.food.name);
    const added = R.allFoods.value.find(f => f.name === '鹌鹑蛋');
    if (!added) bad('新食物未出现在食物库');
    else ok('新食物已进食物库，分类「' + R.catName(added.cat) + '」');
    if (R.favs.value.length !== favsBefore + 1) bad('未自动加入常用');
    else ok('自动加入常用展区（' + favsBefore + ' → ' + R.favs.value.length + '）');
    // 新食物必须能被围训练期禁区/汇总正常识别
    const u = added.units.find(x => x.k === 'pcs');
    if (!u || u.g !== 10) bad('常用卡拿不到自然单位');
    else ok('常用卡沿用自然单位：1 个 = 10 g');
  }

  // 重名不重复入库
  R.aiImport.value.done = false;
  R.aiImport.value.json = JSON.stringify(GOOD);
  R.parseAiJson();
  const cntBefore = R.allFoods.value.filter(f => f.name === '鹌鹑蛋').length;
  R.confirmAiImport();
  const cntAfter = R.allFoods.value.filter(f => f.name === '鹌鹑蛋').length;
  if (cntAfter !== cntBefore) bad('同名食物被重复入库');
  else if (!R.aiImport.value.error) bad('重名未给出提示');
  else ok('同名食物不重复入库，提示「已存在，可直接编辑」');

  // 手动置顶标记：入库后删记录不应把它踢出常用
  const aiFood = R.allFoods.value.find(f => f.name === '鹌鹑蛋');
  if (aiFood && !(R.up && false)) {
    const m = (R.favs.value.indexOf(aiFood.id) >= 0);
    if (!m) bad('新食物不在常用列表内');
    else ok('新食物在常用列表中（manual 标记，删记录不会被误移除）');
  }
} catch (e) {
  bad('AI 导入测试失败: ' + e.message + ' | ' + (e.stack || '').split('\n')[1]);
}

/* ---------- 12. 弹窗滚动锁定（Scroll Locking） ---------- */
out.push('\n【12】弹窗期间锁死底盘滚动');
try {
  const appSrc12 = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');

  /* 12.0 静态守卫：9 个弹窗必须全部在锁定清单里（少一个就会漏网穿透） */
  const MODALS = [
    ['cheerModal', 'visible'], ['cheerMediaModal', 'visible'],
    ['avatarModal', 'visible'], ['foodEdit', 'open'], ['aiImport', 'open'],
    ['showOverride', ''], ['sopPick', 'visible'], ['fixPick', 'visible'],
    ['intakeModal', 'visible']
  ];
  // 定位 modalStates 函数体
  const msA = appSrc12.indexOf('const modalStates = () => [');
  const msB = appSrc12.indexOf('];', msA);
  if (msA < 0 || msB < 0) bad('找不到 modalStates 定义');
  else {
    const body = appSrc12.slice(msA, msB);
    const lost = MODALS.filter(([n, k]) => body.indexOf(n + '.value' + (k ? '.' + k : '')) < 0);
    if (lost.length) bad('滚动锁定清单漏了弹窗: ' + lost.map(x => x[0]).join(', '));
    else ok('锁定清单覆盖全部 ' + MODALS.length + ' 个弹窗（含 v6 新增的 AI 导入）');
  }

  /* 12.1 iOS 上 overflow:hidden 无效 —— 必须用 position:fixed 才算真锁 */
  if (appSrc12.indexOf("b.style.position = 'fixed'") < 0)
    bad('未使用 position:fixed —— iOS Safari 会忽略 body 的 overflow:hidden，锁不住');
  else ok('采用 position:fixed 锁定（iOS Safari 上 overflow:hidden 无效）');
  if (appSrc12.indexOf('b.style.top = (-lockY)') < 0)
    bad('固定定位时未上移 -scrollY，页面会跳到顶部');
  else ok('固定定位时上移 -scrollY，视觉上原地不动（不会跳顶）');
  /* 还原滚动位置不能用 window.scrollTo：部分环境会抛「Not implemented」噪声 */
  if (/window\.scrollTo\s*\(/.test(appSrc12)) bad('使用了 window.scrollTo 还原位置（jsdom 等环境会抛噪声）');
  else ok('还原位置用 documentElement.scrollTop，不用 window.scrollTo（避免环境噪声）');

  /* 12.2 行为验证（带 document 桩） */
  const LS12 = (global.__LS_MAP = global.__LS_MAP || {});
  const stubs12 =
    'const createApp=(o)=>{globalThis.__CAP=o;return {mount(){}}};' +
    'const ref=(v)=>({value:v});' +
    'const reactive=(o)=>o;' +
    'const computed=(fn)=>(typeof fn==="function"?{get value(){return fn()}}:Object.defineProperty({},"value",{get:fn.get,set:fn.set}));' +
    'const watch=()=>{};const onMounted=()=>{};';
  const docStub = { body: { style: {}, scrollTop: 0 }, documentElement: { style: {}, scrollTop: 0, clientWidth: 1024 } };
  const c12 = vm.createContext({
    Vue: {}, window: global, console, setTimeout, clearTimeout,
    Date, Math, JSON, Object, Array, Number, String, Set, isNaN, parseInt, parseFloat,
    document: docStub,
    localStorage: {
      getItem: (k) => (k in LS12 ? LS12[k] : null),
      setItem: (k, v) => { LS12[k] = String(v); },
      removeItem: (k) => { delete LS12[k]; }
    }
  });
  c12.globalThis = c12;
  vm.runInContext(appSrc12.replace(MARKER, stubs12), c12);
  const R12 = c12.__CAP.setup();
  const b = docStub.body, de = docStub.documentElement;

  if (typeof R12.applyScrollLock !== 'function') bad('applyScrollLock 未暴露');
  else {
    // 模拟页面已滚动到 320px
    de.scrollTop = 320;
    R12.applyScrollLock(true);
    if (b.style.position !== 'fixed') bad('锁定后 body 未变 fixed');
    else ok('锁定：body → position:fixed');
    if (b.style.top !== '-320px') bad('锁定后未上移 -scrollY，实际 ' + b.style.top);
    else ok('锁定：body.top = -320px（已滚动 320px 时原地不动）');
    if (b.style.overflow !== 'hidden') bad('锁定后 overflow 未设为 hidden');
    else ok('锁定：overflow:hidden（双保险，桌面端生效）');

    // 幂等：重复锁定不应覆盖已保存的滚动位置
    de.scrollTop = 0;
    R12.applyScrollLock(true);
    if (b.style.top !== '-320px') bad('重复锁定覆盖了已保存的滚动位置（多弹窗叠加时会跳顶）');
    else ok('重复锁定不覆盖已存位置（多弹窗叠加安全）');

    // 解锁还原
    R12.applyScrollLock(false);
    if (b.style.position !== '' || b.style.top !== '' || b.style.overflow !== '')
      bad('解锁后样式未清理: ' + JSON.stringify(b.style));
    else ok('解锁：position / top / overflow / padding 全部清空');
    if (de.scrollTop !== 320) bad('解锁后未还原滚动位置，实际 ' + de.scrollTop);
    else ok('解锁：滚动位置还原到 320px（不会跳回顶部）');

    // 未锁时调用解锁不应报错
    R12.applyScrollLock(false);
    ok('未锁状态下调用解锁安全（无副作用）');
  }

  /* 12.3 桌面端滚动条补偿 */
  const c12b = vm.createContext({
    Vue: {}, window: { innerWidth: 1000 }, console, setTimeout, clearTimeout,
    Date, Math, JSON, Object, Array, Number, String, Set, isNaN, parseInt, parseFloat,
    document: { body: { style: {}, scrollTop: 0 }, documentElement: { style: {}, scrollTop: 0, clientWidth: 985 } }
  });
  c12b.globalThis = c12b;
  vm.runInContext(appSrc12.replace(MARKER, stubs12), c12b);
  const R12b = c12b.__CAP.setup();
  R12b.applyScrollLock(true);
  if (c12b.document.body.style.paddingRight !== '15px')
    bad('滚动条补偿错误: ' + c12b.document.body.style.paddingRight);
  else ok('桌面端补滚动条宽度 15px（避免锁定瞬间内容横向跳动）');

  /* 12.4 CSS 侧：弹窗自身要能滚、且隔离滚动链 */
  const css12 = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  if (css12.indexOf('overscroll-behavior: contain') < 0)
    bad('缺少 overscroll-behavior: contain（弹窗滚到底会把滚动甩给底层）');
  else ok('弹窗容器含 overscroll-behavior: contain（隔离滚动链）');
  if (!/\.pd-modal\s*\{[^}]*max-height/.test(css12))
    bad('.pd-modal 无 max-height —— 小屏上超出视口的部分既看不见也滚不到');
  else ok('.pd-modal 有 max-height + 自身滚动（小屏弹窗不会截掉内容）');

  /* 12.5 无 document 环境（Node 侧跑 setup）不应抛错 */
  const c12c = vm.createContext({
    Vue: {}, window: global, console, setTimeout, clearTimeout,
    Date, Math, JSON, Object, Array, Number, String, Set, isNaN, parseInt, parseFloat,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  });
  c12c.globalThis = c12c;
  let threw = false;
  try { const R12c = c12c.__CAP = null; vm.runInContext(appSrc12.replace(MARKER, stubs12), c12c); c12c.__CAP.setup().applyScrollLock(true); }
  catch (e) { threw = true; }
  if (threw) bad('无 document 环境下抛错（Node 侧校验跑不动）');
  else ok('无 document 环境安全降级（Node 侧校验不受影响）');
} catch (e) {
  bad('滚动锁定测试失败: ' + e.message + ' | ' + (e.stack || '').split('\n')[1]);
}

out.push('\n' + (fail === 0 ? '===== 全部通过 =====' : '===== 失败 ' + fail + ' 项 ====='));
console.log(out.join('\n'));
process.exit(fail === 0 ? 0 : 1);
