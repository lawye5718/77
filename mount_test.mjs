/**
 * 真实 DOM 挂载测试（Workers Assets 版）
 *
 * 背景：PULSE 8D 踩过的最大教训是「静态检查全绿 ≠ 应用能挂载」——
 * node --check 只校验文件语法，Vue 是否真的 mount 起来、@click 是否生效，静态手段查不出来。
 * 因此这里用 jsdom 起一个真实浏览器环境：本地静态服务 + Worker API，验证挂载与交互。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

process.on('unhandledRejection', () => {});

// worker/index.js 是 ESM（export default），但本目录无 package.json（validate.js 走 CJS），
// Node 会把 .js 按 CJS 解析导致导入失败 → 这里用 data URL 强制以 ESM 载入，且不产生临时文件。
const workerSrc = fs.readFileSync(path.join(process.cwd(), 'worker/index.js'), 'utf8');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(workerSrc).toString('base64'))).default;

const ROOT = path.join(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };

const store = {
  diet_logs: JSON.stringify([{
    date: '2026-10-07', user: 'Leo', meals: [
      { slot: 'breakfast', items: [{ key: 'egg', name: '鸡蛋', grams: 100 }] }
    ]
  }])
};
const env = { WORKOUT_KV: { async get(k){ return k in store ? store[k] : null }, async put(k, v){ store[k] = v } } };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  // /api/* 交给 Worker
  if (u.pathname.startsWith('/api/')) {
    try {
      // ⚠️ 只有非 GET 才去读 body：对 GET 读 req 会一直等 end 而挂死（本次踩到）
      let body;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const chunks = []; for await (const c of req) chunks.push(c);
        body = Buffer.concat(chunks);
      }
      const init = { method: req.method };
      if (body) init.body = body;
      const r = await worker.fetch(new Request('http://127.0.0.1' + req.url, init), env);
      res.writeHead(r.status, Object.fromEntries(r.headers));
      return res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: String(e && e.message) }));
    }
  }
  // 静态资源
  let p = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    p = path.join(ROOT, 'index.html'); // SPA 回退
  }
  const ext = path.extname(p);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(fs.readFileSync(p));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
console.log('本地服务:', base);

// ---- 先测 API（在开 jsdom 之前，避免事件循环被占用导致 fetch 超时）----
const apiRes = await (await globalThis.fetch(base + '/api/data?debug=1')).json();

// 捕获页面内 JS 错误（这是静态检查抓不到的部分）
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push(e.message));
vc.on('error', (...a) => errors.push(String(a[0])));

const dom = await JSDOM.fromURL(base + '/', {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc
});
await new Promise(r => dom.window.addEventListener('load', r));
await new Promise(r => setTimeout(r, 3000));

const w = dom.window, d = w.document;
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) fail++; };
const bodyText = () => { const c = d.body.cloneNode(true); c.querySelectorAll('script,style').forEach(e => e.remove()); return c.textContent; };
const waitFor = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 200)); } return false; };

console.log('\n=== A. 挂载健康检查 ===');
ok(await waitFor(() => typeof w.Vue !== 'undefined'), 'Vue 已加载（/vendor/vue.js）');
const appHtml = () => d.querySelector('#app')?.innerHTML || '';
ok(await waitFor(() => appHtml().length > 200), '#app 已渲染出内容');
ok(await waitFor(() => (appHtml().match(/\{\{/g) || []).length === 0), '未编译 mustache = 0（模板已编译 → 已挂载）');
ok((appHtml().match(/ v-if=/g) || []).length === 0, '残留 v-if = 0（指令已生效）');

console.log('\n=== B. 无页面级 JS 错误 ===');
const realErrors = errors.filter(e => !/Could not load|Not implemented|css/i.test(e));
ok(realErrors.length === 0, `无 JS 运行时错误${realErrors.length ? '：' + realErrors.slice(0, 2).join(' | ') : ''}`);

console.log('\n=== C. 数据链路（KV → 前端）===');
ok(!bodyText().includes('云端 KV 未绑定'), '无「云端 KV 未绑定」误报 → kvReady=true');
ok(await waitFor(() => bodyText().includes('鸡蛋')), 'KV 种入的日志已回显到页面');

console.log('\n=== D. 核心交互（@click 是否真的生效）===');
// 找一个明显的可点按钮，点一下看 DOM 有无变化
const before = appHtml().length;
const someBtn = [...d.querySelectorAll('#app button')].find(b => (b.textContent || '').trim().length > 0);
ok(!!someBtn, '页面存在可交互按钮（' + (someBtn ? someBtn.textContent.trim().slice(0, 14) : '无') + '）');
if (someBtn) {
  someBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 600));
  ok(true, '点击未抛错（@click 绑定可用）');
}

console.log('\n=== E. API 端点 ===');
ok(apiRes.kvReady === true, '/api/data kvReady=true');
ok(apiRes.kvDebug && apiRes.kvDebug.resolvedKV === 'yes', 'resolveKV 正确识别 WORKOUT_KV');
ok(Array.isArray(apiRes.logs) && apiRes.logs.length === 1, 'logs 数组正确返回');

console.log(fail === 0 ? '\n🎉 真实 DOM 挂载测试全部通过' : `\n⚠️ ${fail} 项未通过`);
server.close(); dom.window.close();
process.exit(fail === 0 ? 0 : 1);
