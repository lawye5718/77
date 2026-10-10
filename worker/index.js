/**
 * Cloudflare Worker: PULSE DIET 饮食日志 —— 纯 API 层
 *
 * 架构（与 PULSE 8D v11 一致）：
 *   前端（index.html / app.js / style.css / foods.js / vendor/*）由 Workers Assets 静态托管，
 *   Worker 只做 API。费用 Free $0，静态资源走全球边缘缓存。
 *
 * 数据安全要点：
 *   KV 不可用时必须把 "KV_UNAVAILABLE" 写进 failed 数组且 success=false，
 *   前端据此弹红色常驻告警，杜绝「点了保存其实没存上」的静默失败。
 *
 * v5 加固：
 *   1. 非 /api 路径回落到 env.ASSETS —— 万一 wrangler.toml 开了 run_worker_first，
 *      静态资源也不会全部 404（「部署成功但页面空白」最常见的原因就是它）。
 *   2. 写入前做类型与体积校验 —— KV 单值上限 25 MiB，超了会静默失败；
 *      也绝不允许把 null 写成 logs（否则前端读回来 logs.length 直接崩页）。
 *   3. /api/data 一律 no-store：避免中间缓存把「保存前的旧数据」回给用户，
 *      表现为「换设备打开是昨天的进度」。
 */

const KV_LOGS_KEY    = "diet_logs";
const KV_FOODS_KEY   = "diet_foods";
const KV_PREFS_KEY   = "diet_prefs";
const KV_MEDIA_KEY   = "diet_media";

/* KV 单值上限 25 MiB，留足余量；留 18 MiB 给头像/鼓励形象这类 base64 媒体 */
const MAX_VALUE_BYTES = 18 * 1024 * 1024;
const MAX_BODY_BYTES  = 20 * 1024 * 1024;

/**
 * 自动识别 KV 绑定。
 * R2 桶同样具备 get/put，需要排除：R2 有 createMultipartUpload，KV 没有。
 */
function resolveKV(env) {
  if (!env || typeof env !== "object") return null;
  const loose = (v) => v && typeof v === "object" && typeof v.get === "function" && typeof v.put === "function";
  const notR2 = (v) => typeof v.createMultipartUpload !== "function";
  if (loose(env.WORKOUT_KV) && notR2(env.WORKOUT_KV)) return env.WORKOUT_KV;
  for (const k of Object.keys(env)) {
    if (/kv/i.test(k) && loose(env[k]) && notR2(env[k])) return env[k];
  }
  for (const k of Object.keys(env)) {
    if (loose(env[k]) && notR2(env[k])) return env[k];
  }
  return null;
}

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, max-age=0"
};

const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: JSON_HEADERS });

/* 写入前校验：宁可拒绝，也不要把一份坏数据写进 KV（下次开机整页崩） */
function validateField(field, value) {
  if (field === "logs") {
    if (!Array.isArray(value)) return "logs 必须是数组";
    for (const d of value) {
      if (!d || typeof d !== "object") return "logs 内存在非对象项";
      if (typeof d.date !== "string" || typeof d.user !== "string") return "logs 项缺少 date/user";
      if (d.items !== undefined && !Array.isArray(d.items)) return "logs 项 items 必须是数组";
    }
    return null;
  }
  if (field === "foods") {
    if (!value || typeof value !== "object") return "foods 必须是对象";
    if (value.custom !== undefined && !Array.isArray(value.custom)) return "foods.custom 必须是数组";
    if (value.overrides !== undefined && (!value.overrides || typeof value.overrides !== "object")) return "foods.overrides 必须是对象";
    return null;
  }
  if (field === "prefs" || field === "media") {
    if (!value || typeof value !== "object") return field + " 必须是对象";
    return null;
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const authHeader = request.headers.get("Authorization") || url.searchParams.get("auth");
    const isAuthed = env.ACCESS_PASSWORD ? authHeader === "Bearer " + env.ACCESS_PASSWORD : true;
    const KV = resolveKV(env);
    const hasKV = !!KV;

    // ---------- GET /api/data ----------
    if (url.pathname === "/api/data" && request.method === "GET") {
      if (!isAuthed) return json({ error: "未授权" }, 401);
      let rawLogs = null, rawFoods = null, rawPrefs = null, rawMedia = null;
      if (hasKV) {
        try {
          rawLogs  = await KV.get(KV_LOGS_KEY);
          rawFoods = await KV.get(KV_FOODS_KEY);
          rawPrefs = await KV.get(KV_PREFS_KEY);
          rawMedia = await KV.get(KV_MEDIA_KEY);
        } catch (e) {}
      }
      const safeParse = (s, d) => { if (!s) return d; try { return JSON.parse(s); } catch (e) { return d; } };
      // 兜底：KV 里若被写入了非数组的 logs（旧版本/手工写入），一律降级为空数组，
      // 绝不把 null 交给前端——前端 logs.length 会直接崩页。
      const parsedLogs = safeParse(rawLogs, []);
      const payload = {
        logs:  Array.isArray(parsedLogs) ? parsedLogs : [],
        foods: safeParse(rawFoods, { custom: [], overrides: {} }),
        prefs: safeParse(rawPrefs, null),
        media: safeParse(rawMedia, null),
        kvReady: !!hasKV
      };
      if (url.searchParams.get("debug") === "1") {
        payload.kvDebug = {
          envKeys: Object.keys(env || {}),
          hasAssetsBinding: !!(env && env.ASSETS && typeof env.ASSETS.fetch === "function"),
          workoutKVHasGet: !!(env && env.WORKOUT_KV && typeof env.WORKOUT_KV.get === "function"),
          workoutKVHasPut: !!(env && env.WORKOUT_KV && typeof env.WORKOUT_KV.put === "function"),
          resolvedKV: KV ? "yes" : "no"
        };
      }
      return json(payload);
    }

    // ---------- POST /api/data ----------
    if (url.pathname === "/api/data" && request.method === "POST") {
      if (!isAuthed) return json({ error: "未授权" }, 401);
      let body;
      const raw = await request.text().catch(() => "");
      if (raw.length > MAX_BODY_BYTES) {
        return json({ success: false, error: "请求体过大（>20MB），已拒绝写入" }, 413);
      }
      try {
        body = JSON.parse(raw);
      } catch (e) {
        return json({ error: "请求体不是合法 JSON" }, 400);
      }
      if (!body || typeof body !== "object") return json({ error: "请求体必须是对象" }, 400);

      const saved = [];
      const failed = [];

      if (!hasKV) {
        // 关键：不静默成功。前端必须看到 KV_UNAVAILABLE 并弹红色告警。
        failed.push("KV_UNAVAILABLE");
      } else {
        const jobs = [
          ["logs",  KV_LOGS_KEY],
          ["foods", KV_FOODS_KEY],
          ["prefs", KV_PREFS_KEY],
          ["media", KV_MEDIA_KEY]
        ];
        for (const [field, key] of jobs) {
          if (body[field] === undefined) continue;
          const why = validateField(field, body[field]);
          if (why) { failed.push(field + ": 数据格式不合法（" + why + "）"); continue; }
          let str;
          try { str = JSON.stringify(body[field]); } catch (e) { failed.push(field + ": 序列化失败"); continue; }
          if (str.length > MAX_VALUE_BYTES) {
            failed.push(field + ": 超过 KV 单值上限（" + Math.round(str.length / 1048576) + "MB）");
            continue;
          }
          try {
            await KV.put(key, str);
            saved.push(field);
          } catch (e) {
            failed.push(field + ": " + (e && e.message ? e.message : "unknown"));
          }
        }
      }

      return json({
        success: failed.length === 0,
        kvReady: !!hasKV,
        saved,
        failed,
        persisted: !!hasKV && failed.length === 0
      });
    }

    // ---------- 健康检查 ----------
    if (url.pathname === "/api/ping") {
      return json({ ok: true, kvReady: !!hasKV, authed: isAuthed, ts: Date.now() });
    }

    // ---------- 其他路径：回落到静态资源 ----------
    // 默认（assets-first）下不会走到这里；若 wrangler.toml 开了 run_worker_first，
    // 这一行就是「页面不再空白」的保险。
    if (env && env.ASSETS && typeof env.ASSETS.fetch === "function") {
      try { return await env.ASSETS.fetch(request); } catch (e) {}
    }
    return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
};
