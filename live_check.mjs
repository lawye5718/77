/**
 * 线上真实挂载验证（部署后必跑）
 * 只验证「页面能被真实浏览器环境挂载并交互」——静态资源返回 200 并不等于应用能跑起来。
 */
import { JSDOM, VirtualConsole, ResourceLoader } from 'jsdom';

const URL_ = 'https://pulse-diet.1670534445.workers.dev/';
process.on('unhandledRejection', () => {});

// 必须带浏览器 UA，否则 CF WAF 返回 403 error 1010
class BrowserUA extends ResourceLoader {
  constructor() { super({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36' }); }
  fetch(url, opts) { return super.fetch(url, opts).catch(() => null); }
}

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push(e.message));
vc.on('error', (...a) => errors.push(String(a[0])));

// ⚠️ 不能用 JSDOM.fromURL + 自定义 ResourceLoader（两者冲突，jsdom 内部取不到 headers），
//    改为自己抓 HTML 再 new JSDOM —— 与 PULSE 8D 时踩到的坑同源。
const html = await (await globalThis.fetch(URL_, {
  headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36' }
})).text();
const dom = new JSDOM(html, {
  url: URL_, runScripts: 'dangerously', resources: new BrowserUA(), pretendToBeVisual: true, virtualConsole: vc
});
await new Promise(r => dom.window.addEventListener('load', r));
await new Promise(r => setTimeout(r, 4000));

const w = dom.window, d = w.document;
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) fail++; };
const waitFor = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 250)); } return false; };
const appHtml = () => d.querySelector('#app')?.innerHTML || '';

console.log('线上挂载检查：', URL_);
ok(await waitFor(() => typeof w.Vue !== 'undefined'), 'Vue 已加载（线上 /vendor/vue.js）');
ok(await waitFor(() => appHtml().length > 200), '#app 已渲染内容');
ok(await waitFor(() => (appHtml().match(/\{\{/g) || []).length === 0), '未编译 mustache = 0（模板已编译 → 已挂载）');
ok((appHtml().match(/ v-if=/g) || []).length === 0, '残留 v-if = 0（指令已生效）');

const bodyText = () => { const c = d.body.cloneNode(true); c.querySelectorAll('script,style').forEach(e => e.remove()); return c.textContent; };
ok(!bodyText().includes('云端 KV 未绑定'), '无「云端 KV 未绑定」→ kvReady=true');

const realErrors = errors.filter(e => !/Could not load|Not implemented|css|stylesheet/i.test(e));
ok(realErrors.length === 0, `无页面级 JS 错误${realErrors.length ? '：' + realErrors.slice(0, 2).join(' | ') : ''}`);

console.log(fail === 0 ? '\n🎉 线上真实挂载通过' : `\n⚠️ ${fail} 项未通过`);
dom.window.close();
process.exit(fail === 0 ? 0 : 1);
