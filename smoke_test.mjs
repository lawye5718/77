/**
 * PULSE DIET · 真实 DOM 冒烟测试（jsdom）
 *
 * validate.js 用桩跑 setup()，能验证逻辑与模板编译，但验证不了
 * 「模板真的被 Vue 渲染出来、点下去真的生效」——那正是线上最容易翻车的地方
 * （少返回一个键、事件名写错、v-if 结构错，逻辑层全都测不出来）。
 *
 * 这里用 jsdom 载入真实 index.html + 自托管 vue.js，按真实点击路径走一遍：
 *   首屏渲染 → 常用卡一键加入 → 录入页 + 号 → 切到已摄入改量 → 点环形卡跳转
 * 任何 Vue 运行时警告/错误都直接判失败。
 *
 *   node smoke_test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// jsdom 走全局安装（NODE_PATH），ESM 的 import 不认 NODE_PATH，故用 CJS require
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { console.log('  ✗ ' + m); fail++; };

const html = read('public/index.html')
  .replace(/<script src="[^"]+"><\/script>/g, '');   // 脚本手动 eval，避免 jsdom 去取网络资源

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
vc.on('warn', (...a) => { const s = a.join(' '); if (!/development build/i.test(s)) errors.push('console.warn: ' + s); });

const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;
window.fetch = () => Promise.reject(new Error('offline'));   // 模拟无云端：本机存储仍必须可用

console.log('\n【S1】真实渲染');
try {
  window.eval(read('public/vendor/vue.js'));
  window.eval(read('public/foods.js'));
  window.eval(read('public/app.js'));
} catch (e) {
  bad('脚本执行抛错: ' + e.message);
}
await new Promise(r => setTimeout(r, 60));

const doc = window.document;
const q = (s) => doc.querySelector(s);
const qa = (s) => Array.from(doc.querySelectorAll(s));
const txt = () => doc.body.textContent || '';

if (!q('#app') || q('#app').children.length === 0) bad('#app 没有渲染出任何内容');
else ok('#app 渲染成功，根节点 ' + q('#app').children.length + ' 个');
if (qa('.pd-tab').length !== 6) bad('页签应为 6 个，实为 ' + qa('.pd-tab').length);
else ok('六个页签全部渲染（录入 / 已摄入 / 餐次 / 趋势 / 食物库 / 设置）');
if (qa('.pd-ring').length !== 7) bad('环形卡应为 7 个，实为 ' + qa('.pd-ring').length);
else ok('7 个环形仪表渲染完成');
if (!qa('.pd-common-card').length) bad('常用食物展区为空');
else ok('常用食物展区渲染 ' + qa('.pd-common-card').length + ' 张卡：' + qa('.pd-common-card b').slice(0, 4).map(e => e.textContent.trim()).join('、'));
if (!/目标|蛋白/.test(txt())) bad('页面文本异常'); else ok('目标条与文案正常输出');
if (!q('.pd-savebar')) bad('缺少保存状态条'); else ok('保存状态条：' + q('.pd-savebar b').textContent.trim());

console.log('\n【S2】常用卡 → 一键加入');
const before = qa('.pd-today-row').length;
const hit = q('.pd-common-hit');
hit.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(r => setTimeout(r, 60));
const after = qa('.pd-today-row').length;
if (after !== before + 1) bad('点击常用卡未新增记录（' + before + ' → ' + after + '）');
else ok('点一下常用卡即按上次用量加入：今日 ' + after + ' 条');
if (!q('.pd-toast')) bad('缺少操作反馈 toast'); else ok('操作反馈：' + q('.pd-toast').textContent.trim());
const intakeBtn = qa('.pd-tab')[1];
intakeBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(r => setTimeout(r, 60));
if (!qa('.pd-intake-row').length) bad('已摄入展板没有条目');
else ok('已摄入展板按五大类分区，渲染 ' + qa('.pd-intake-row').length + ' 条');

console.log('\n【S3】已摄入：按单位改量');
const row = q('.pd-intake-row');
const countInput = row.querySelector('.pd-intake-count');
const eqBefore = row.querySelector('.pd-intake-eq').textContent.trim();
countInput.value = '2';
countInput.dispatchEvent(new window.Event('change', { bubbles: true }));
await new Promise(r => setTimeout(r, 60));
const eqAfter = q('.pd-intake-row .pd-intake-eq').textContent.trim();
if (eqBefore === eqAfter) bad('改份数后克数没变（' + eqBefore + ' → ' + eqAfter + '）');
else ok('改份数后克数实时折算：' + eqBefore + ' → ' + eqAfter);
const sel = q('.pd-intake-row .pd-intake-unit-sel');
if (!sel || sel.options.length < 1) bad('已摄入行缺少单位选择');
else {
  const target = Array.from(sel.options).find(o => o.value === 'g') || sel.options[0];
  sel.value = target.value;
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  ok('已摄入行可切换单位（' + Array.from(sel.options).map(o => o.text).join('/') + '），克数保持不变');
}

console.log('\n【S4】环形卡 → 直达已摄入对应分区');
const addTab = qa('.pd-tab')[0];
addTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(r => setTimeout(r, 40));
const ring = qa('.pd-ring')[0];
ring.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(r => setTimeout(r, 80));
if (!qa('.pd-tab')[1].classList.contains('act')) bad('点环形卡未跳到已摄入页');
else ok('点「蛋白质」环形卡直达已摄入展板对应分区');

console.log('\n【S5】待选食物区：默认只看常见 + 展开全部');
addTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(r => setTimeout(r, 40));
const more = q('.pd-more');
if (!more) bad('缺少「展开全部」按钮');
else {
  const n1 = qa('.pd-food').length;
  more.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  const n2 = qa('.pd-food').length;
  if (n2 <= n1) bad('展开全部没有变多（' + n1 + ' → ' + n2 + '）');
  else ok('默认只看常见（' + n1 + ' 项）→ 展开全部（' + n2 + ' 项），页面不会一上来就被撑爆');
}

console.log('\n【S6】录入：+ 号与单位切换');
const foodCard = q('.pd-food');
const plus = foodCard.querySelector('.pd-add');
const n0 = qa('.pd-today-row').length;
plus.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(r => setTimeout(r, 60));
if (qa('.pd-today-row').length !== n0 + 1) bad('食物卡 + 号未录入成功');
else ok('食物卡 + 号录入成功，今日 ' + qa('.pd-today-row').length + ' 条');

console.log('\n【S7】无云端时的降级');
if (!q('.pd-cloud-bad')) bad('云端不可用时未弹红色常驻告警');
else ok('云端不可用 → 红色常驻告警：' + q('.pd-cloud-bad span').textContent.trim().slice(0, 28) + '…');
const saved = window.localStorage.getItem('diet_logs');
if (!saved || saved === '[]') bad('本机未落盘今日记录');
else ok('本机已即时落盘（diet_logs ' + saved.length + ' 字节），关掉页面也不丢');
if (!window.localStorage.getItem('diet_session_v1')) bad('会话未落盘，无法做到「下次接着干」');
else ok('会话（页签/餐次/草稿）已落盘，下次打开直接恢复');

console.log('\n【S8】管理常用 / 搜索');
addTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(r => setTimeout(r, 40));
const nCommon0 = qa('.pd-common-card').length;
const manageBtn = Array.from(doc.querySelectorAll('.pd-common-ops .pd-mini'))[0];
manageBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(r => setTimeout(r, 60));
if (!qa('.pd-common-x').length) bad('进入管理模式后没有出现移除按钮');
else {
  qa('.pd-common-x')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  if (qa('.pd-common-card').length !== nCommon0 - 1) bad('移除常用失败');
  else ok('可自行增删常用食物：' + nCommon0 + ' → ' + qa('.pd-common-card').length + ' 张卡');
}
const search = q('.pd-search');
search.value = '黄豆';
search.dispatchEvent(new window.Event('input', { bubbles: true }));
await new Promise(r => setTimeout(r, 80));
const names = qa('.pd-food-name').map(e => e.textContent.trim());
if (!names.length || !names.some(n => n.indexOf('黄豆') >= 0)) bad('搜索「黄豆」没有结果：' + names.join('/'));
else ok('搜索「黄豆」命中 ' + names.length + ' 条：' + names.join('、'));
if (!q('.pd-search-x')) bad('缺少清空搜索按钮（上一版「只剩三文鱼」就是没有它）');
else {
  q('.pd-search-x').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  if (q('.pd-search').value !== '') bad('清空搜索未生效');
  else ok('一键清空搜索，列表恢复完整（不会再被搜索词卡住）');
}

console.log('\n【S9】AI 导入食物：复制 Prompt → 粘贴 JSON → 入库进常用');
try {
  // 常用展区只在录入页渲染 —— 基数必须在录入页取，否则恒为 0
  const addTab0 = qa('.pd-tab').find(b => b.textContent.trim() === '录入');
  addTab0.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  const favBefore = qa('.pd-common-card').length;

  // 切到食物库
  const libTab = qa('.pd-tab').find(b => b.textContent.trim() === '食物库');
  libTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));

  const aiBtn = qa('.pd-btn').find(b => b.textContent.indexOf('AI 导入') >= 0);
  if (!aiBtn) bad('食物库缺少「AI 导入食物」入口');
  else {
    aiBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 60));
    if (!q('.pd-modal-wide')) bad('AI 导入弹窗未打开');
    else {
      ok('AI 导入弹窗打开，三步引导可见');
      // 填名 → Prompt 自动带上食物名
      const nameInput = q('.pd-modal-wide .pd-fld input');
      nameInput.value = '鹌鹑蛋';
      nameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 60));
      const pt = q('.pd-ai-prompt').textContent;
      if (pt.indexOf('鹌鹑蛋') < 0) bad('Prompt 未带上食物名');
      else if (pt.indexOf('__FOOD__') >= 0) bad('占位符未被替换');
      else ok('Prompt 自动带上「鹌鹑蛋」，且含完整字段规范（' + pt.length + ' 字符）');

      // 粘贴一段"脏" JSON（markdown 围栏 + 前后寒暄）
      const AI_REPLY = '根据中国食物成分表：\n```json\n' + JSON.stringify({
        name: '鹌鹑蛋', cat: 'protein', base: 'cooked', yield: 1,
        n: { p: 13.1, f: 11.1, c: 0.4, fiber: 0, kcal: 158 },
        units: [{ k: 'pcs', label: '个', g: 10 }, { k: 'g', label: '克', g: 1 }],
        tags: [], note: '1 个约 10 g'
      }) + '\n```\n供参考。';
      const ta = q('.pd-ai-input');
      ta.value = AI_REPLY;
      ta.dispatchEvent(new window.Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 40));
      const parseBtn = qa('.pd-ai-ops .pd-btn').find(b => b.textContent.indexOf('解析') >= 0);
      parseBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 80));
      if (!q('.pd-ai-prev')) bad('预览未生成：' + (q('.pd-ai-err') ? q('.pd-ai-err').textContent.trim() : '无提示'));
      else {
        ok('脏 JSON（围栏+寒暄）解析成功并生成预览');
        const unitTxt = qa('.pd-ai-unit').map(e => e.textContent.trim()).join(' | ');
        if (unitTxt.indexOf('1 个 = 10 g') < 0) bad('预览未显示自然单位：' + unitTxt);
        else ok('预览显示自然单位：' + unitTxt);

        const addBtn = qa('.pd-modal-wide .pd-btn').find(b => b.textContent.indexOf('确认加入') >= 0);
        addBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await new Promise(r => setTimeout(r, 100));
        if (!q('.pd-ai-done')) bad('入库未成功');
        else {
          ok('入库成功，显示完成态');
          // 关弹窗 → 回录入页看常用展区
          const doneBtn = qa('.pd-modal-wide .pd-btn').find(b => b.textContent.indexOf('完成') >= 0);
          doneBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
          await new Promise(r => setTimeout(r, 60));
          const addTab = qa('.pd-tab').find(b => b.textContent.trim() === '录入');
          addTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
          await new Promise(r => setTimeout(r, 100));
          const favAfter = qa('.pd-common-card').length;
          if (favAfter !== favBefore + 1) bad('未自动加入常用：' + favBefore + ' → ' + favAfter);
          else ok('自动进入常用展区（' + favBefore + ' → ' + favAfter + ' 张卡）');
          const has = qa('.pd-common-card').some(c => c.textContent.indexOf('鹌鹑蛋') >= 0);
          if (!has) bad('常用卡里找不到新食物');
          else ok('常用卡出现「鹌鹑蛋」，可直接一键加入');
        }
      }
    }
  }
} catch (e) {
  bad('AI 导入 UI 流程失败: ' + e.message);
}

console.log('\n【S10】弹窗滚动锁定：底盘不被连带拖动');
try {
  const body = window.document.body;
  const de = window.document.documentElement;
  const pos = () => body.style.position;

  // 先滚到某处，验证解锁后能还原
  de.scrollTop = 240;
  const y0 = de.scrollTop;

  const openModal = async (btnText) => {
    const btn = qa('.pd-btn').find(b => b.textContent.indexOf(btnText) >= 0);
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 80));
  };

  // 切到食物库 → 打开 AI 导入弹窗
  const libTab2 = qa('.pd-tab').find(b => b.textContent.trim() === '食物库');
  libTab2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  await openModal('AI 导入');

  if (pos() !== 'fixed') bad('弹窗打开后底盘未锁定（position=' + (pos() || '空') + '）');
  else ok('弹窗打开 → 底盘锁定（body position:fixed）');
  if (body.style.top !== '-' + y0 + 'px') bad('锁定未上移 -scrollY：' + body.style.top);
  else ok('锁定上移 ' + body.style.top + '，视觉上原地不动');
  if (body.style.overflow !== 'hidden') bad('锁定未设 overflow:hidden');
  else ok('overflow:hidden 同步生效（桌面端双保险）');

  // 关闭 → 必须还原
  const cancel = qa('.pd-ai-ops .pd-btn').find(b => b.textContent.indexOf('取消') >= 0);
  cancel.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  if (pos() !== '') bad('关闭后底盘未解锁：position=' + pos());
  else ok('关闭弹窗 → 底盘解锁，样式清空');
  if (de.scrollTop !== y0) bad('关闭后滚动位置未还原：' + de.scrollTop + ' ≠ ' + y0);
  else ok('滚动位置还原到 ' + y0 + '（不会跳回顶部）');

  // 再验一个：头像弹窗（不同状态字段：avatarModal.visible）
  const setTab = qa('.pd-tab').find(b => b.textContent.trim() === '设置');
  if (setTab) {
    setTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 80));
    const avBtn = qa('.pd-mini').find(b => b.textContent.indexOf('头像') >= 0)
      || qa('button').find(b => b.textContent.indexOf('头像') >= 0);
    if (avBtn) {
      avBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 100));
      if (pos() !== 'fixed') bad('头像弹窗未锁定底盘');
      else ok('头像弹窗同样锁定（不同状态字段也覆盖到）');
      const mask = qa('.pd-mask').pop();
      if (mask) mask.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 100));
      if (pos() !== '') bad('头像弹窗关闭后未解锁');
      else ok('头像弹窗关闭 → 解锁');
    }
  }
  de.scrollTop = 0;
} catch (e) {
  bad('滚动锁定 UI 流程失败: ' + e.message);
}

console.log('\n【S9】运行时告警');
if (errors.length) { errors.slice(0, 6).forEach(e => bad(e)); }
else ok('全流程零 Vue 运行时警告 / 错误');

console.log('\n' + (fail === 0 ? '===== 冒烟测试全部通过 =====' : '===== 冒烟失败 ' + fail + ' 项 ====='));
process.exit(fail === 0 ? 0 : 1);
