// 临时功能探针：验证 2026-10-08 五组修复是否真的生效（验证完即删）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
process.on('unhandledRejection', () => {});

const workerSrc = fs.readFileSync(path.join(process.cwd(), 'worker/index.js'), 'utf8');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(workerSrc).toString('base64'))).default;
const ROOT = path.join(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };

const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const TODAY = ymd(new Date());
const yd = new Date(); yd.setDate(yd.getDate() - 1); const YDAY = ymd(yd);
const d3 = new Date(); d3.setDate(d3.getDate() - 3); const D3 = ymd(d3);

const mkItem = (id, foodId, name, cat, grams) => ({ id, foodId, name, cat, grams, state: 'cooked', unitKey: 'g', unitLabel: '克', count: grams, meal: 'breakfast', ts: Date.now() });
const store = {
  diet_logs: JSON.stringify([
    { date: TODAY, user: 'Leo', weight: 83, dayType: 'lower', adjust: 0, items: [mkItem('i_today', 'salmon', '三文鱼', 'protein', 200)], sop: {} },
    { date: YDAY, user: 'Leo', weight: 83, dayType: 'lower', adjust: 0, items: [mkItem('i_y1', 'chicken', '鸡胸', 'protein', 150), mkItem('i_y2', 'rice', '米饭', 'carb', 200)], sop: {} },
    { date: D3, user: 'Leo', weight: 83, dayType: 'rest', adjust: 0, items: [mkItem('i_d3', 'egg', '鸡蛋', 'protein', 100)], sop: {} }
  ])
};
const env = { WORKOUT_KV: { async get(k){ return k in store ? store[k] : null }, async put(k, v){ store[k] = v } } };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname.startsWith('/api/')) {
    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') { const c = []; for await (const x of req) c.push(x); body = Buffer.concat(c); }
    const init = { method: req.method }; if (body) init.body = body;
    const r = await worker.fetch(new Request('http://127.0.0.1' + req.url, init), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  let p = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  res.end(fs.readFileSync(p));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push(e.message));
// jsdom 没有 window.fetch（应用 onMounted 依赖它），且应用优先读 localStorage —— 两者都要补
const dom = await JSDOM.fromURL(base + '/', {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) {
    try { w.localStorage.setItem('diet_logs', store.diet_logs); } catch (e) {}
    w.confirm = () => true;                       // jsdom 未实现 confirm，桩成「确认」
    w.fetch = (u, o) => globalThis.fetch(new URL(String(u), base).href, o);
  }
});
await new Promise(r => dom.window.addEventListener('load', r));
await new Promise(r => setTimeout(r, 2500));

const w = dom.window, d = w.document;
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) fail++; };
const waitFor = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 200)); } return false; };
const txt = () => { const c = d.body.cloneNode(true); c.querySelectorAll('script,style').forEach(e => e.remove()); return c.textContent; };
const click = (el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

console.log('\n=== 1. 食物按五大类全展示（不再只剩一条）===');
const secs = [...d.querySelectorAll('.pd-food-sec')];
const foods = [...d.querySelectorAll('.pd-food')];
ok(secs.length >= 3, '食物分区数 = ' + secs.length + '（应 ≥3，含多个大类）');
ok(foods.length > 8, '食物条目数 = ' + foods.length + '（应 >8，不再只剩三文鱼）');
ok([...d.querySelectorAll('.pd-sec-title')].some(e => /蛋白/.test(e.textContent)), '存在「蛋白」分区标题');
ok([...d.querySelectorAll('.pd-sec-title')].some(e => /碳水/.test(e.textContent)), '存在「碳水」分区标题');

console.log('\n=== 2. 已摄入标色可读（浅底白字已修）===');
const inFood = [...d.querySelectorAll('.pd-food.pd-food-in')];
ok(inFood.length > 0, '已摄入食物带 pd-food-in 标色（' + inFood.length + ' 条）');
if (inFood.length) {
  const bg = w.getComputedStyle(inFood[0]).backgroundColor || '';
  const rgb = (bg.match(/\d+/g) || []).map(Number);
  const bright = rgb.length >= 3 ? (rgb[0] + rgb[1] + rgb[2]) / 3 : 255;
  console.log('    背景色 =', bg);
  ok(bright < 170, '标色背景为深色（平均亮度 ' + Math.round(bright) + ' < 170，白字可读）');
}

console.log('\n=== 3. 点分项小结 → 直接进入已摄入食物栏对应分区 ===');
const ring = [...d.querySelectorAll('.pd-ring')].find(r => /蛋白/.test(r.textContent || ''));
click(ring);
ok(await waitFor(() => !!d.querySelector('.pd-intake-sec')), '点环形「蛋白质」→ 进入已摄入食物栏（不再弹窗）');
const isecs = [...d.querySelectorAll('.pd-intake-sec')];
ok(isecs.length > 0, '已摄入栏按五大类分区（' + isecs.length + ' 个分区）');
ok(!!d.getElementById('intake-cat-protein'), '存在蛋白质分区锚点 intake-cat-protein');
const rows0 = d.querySelectorAll('.pd-intake-row').length;
ok(rows0 > 0, '已摄入栏列出 ' + rows0 + ' 条');
ok(!!d.querySelector('.pd-intake-g'), '每条有可直接改的克数输入框');
const delBtn = d.querySelector('.pd-intake-row .del');
click(delBtn);
ok(await waitFor(() => d.querySelectorAll('.pd-intake-row').length < rows0), '点 × 后该条从已摄入栏消失');
// 切回「录入」页继续后面的用例
click([...d.querySelectorAll('.pd-tab')].find(b => /录入/.test(b.textContent || '')));
await new Promise(r => setTimeout(r, 400));

console.log('\n=== 4. 清空今日 ===');
const clr = [...d.querySelectorAll('.pd-clr')].find(b => /清空今日/.test(b.textContent || ''));
ok(!!clr, '「清空今日」按钮存在');
click(clr);
ok(await waitFor(() => /已清空今日/.test(txt()) || d.querySelectorAll('.pd-intake-row,.pd-today-row').length === 0), '清空生效（已摄入列表归零）');

console.log('\n=== 5. 从任意一天复制（不止昨天）===');
const sel = d.querySelector('.pd-today-ops select');
ok(!!sel, '「从某一天复制」下拉存在');
const opts = sel ? [...sel.querySelectorAll('option')].filter(o => o.value) : [];
console.log('    可选日期:', opts.map(o => o.value).join(', '));
ok(opts.length >= 2, '可选历史日期 ' + opts.length + ' 天（应含昨天与 3 天前）');
if (opts.length) {
  sel.value = opts[opts.length - 1].value;
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  ok(await waitFor(() => /拉入|请逐项确认/.test(txt())), '选择历史某天后触发复制并提示待确认');
  ok(await waitFor(() => d.querySelectorAll('.pd-today-row').length > 0), '复制的条目出现在今日列表（待确认）');
}

console.log('\n=== 7. 翻日：下一天/上一天必须各差一天 ===');
const dInput = () => d.querySelector('.pd-date input[type=date]').value;
const dBtns = [...d.querySelectorAll('.pd-date button')];
const diff = (a, b) => Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000);
const e0 = dInput();
click(dBtns[1]); await new Promise(r => setTimeout(r, 350));
const e1 = dInput();
click(dBtns[0]); click(dBtns[0]); await new Promise(r => setTimeout(r, 350));
const e2 = dInput();
console.log('    ' + e0 + ' →(+1) ' + e1 + ' →(-2) ' + e2);
ok(diff(e1, e0) === 1, '点「下一天」前进 1 天（实际 ' + diff(e1, e0) + '）');
ok(diff(e2, e0) === -1, '从下一天连退两次 → 回到前一天（实际 ' + diff(e2, e0) + '）');
click([...d.querySelectorAll('.pd-date button')].find(b => /今天/.test(b.textContent || '')));
await new Promise(r => setTimeout(r, 300));
ok(dInput() === e0, '点「今天」回到今日 ' + e0);

console.log('\n=== 8. 单条克数上限（防 50000g 这类荒谬值污染总量）===');
const firstFood = d.querySelector('.pd-food');
if (firstFood) {
  const num = firstFood.querySelector('.pd-food-row input[type=number]');
  const addBtn = firstFood.querySelector('.pd-add');
  const before = d.querySelectorAll('.pd-today-row').length;
  num.value = '50000';
  num.dispatchEvent(new w.Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
  click(addBtn);
  await new Promise(r => setTimeout(r, 400));
  const blocked = /不能超过/.test(txt()) || d.querySelectorAll('.pd-today-row').length === before;
  ok(blocked, '数量 50000 g 被拦下，未计入已摄入');
}

console.log('\n=== 9. 围训练期 SOP：香蕉与蛋白粉分开 + 可调量 + 确认计入 ===');
const sopFoods = [...d.querySelectorAll('.pd-sop-food')];
ok(sopFoods.length >= 4, 'SOP 食物条目 ' + sopFoods.length + ' 条（香蕉与蛋白粉已各自独立）');
ok(/香蕉/.test(txt()) && /蛋白粉/.test(txt()), 'SOP 里香蕉与蛋白粉同时出现');
ok(/训练前吃/.test(txt()) && /训练后吃/.test(txt()), '条目标注「训练前吃 / 训练后吃」');
ok(d.querySelectorAll('.pd-sop-step').length >= 2, 'SOP 有 ± 调量按钮');
const rows9 = d.querySelectorAll('.pd-today-row').length;
click([...d.querySelectorAll('.pd-sop-ok')][0]);
ok(await waitFor(() => /已计入已摄入/.test(txt())), '点「确认计入」→ 提示已计入已摄入');
ok(await waitFor(() => d.querySelectorAll('.pd-today-row').length > rows9), 'SOP 条目进入今日已摄入列表');

console.log('\n=== 10. 供能占比：目前 vs 最佳 ===');
ok(/目前\s*\d+%/.test(txt()) && /最佳\s*\d+%/.test(txt()), '占比图例同时给出「目前 %」与「最佳 %」');

console.log('\n=== 11. 常用食物：录入过即点亮常用 ===');
const stars = [...d.querySelectorAll('.pd-star.on')];
ok(stars.length > 0, '录入过的食物已点亮常用星标（' + stars.length + ' 个）');

console.log('\n=== 6. 无 JS 运行时错误 ===');
const real = errors.filter(e => !/Could not load|Not implemented|css/i.test(e));
ok(real.length === 0, '无页面级 JS 错误' + (real.length ? '：' + real.slice(0, 2).join(' | ') : ''));

console.log(fail === 0 ? '\n🎉 五组修复功能验证全部通过' : `\n⚠️ ${fail} 项未通过`);
server.close(); dom.window.close(); process.exit(fail === 0 ? 0 : 1);
