/**
 * Cloudflare Worker: PULSE DIET 饮食日志 —— 纯 API 层
 *
 * 架构（与 PULSE 8D v11 一致）：
 *   前端（index.html / app.js / style.css / vendor/*）由 Workers Assets 静态托管，
 *   Worker 只做 API。费用 Free $0，静态资源走全球边缘缓存。
 *
 * 数据安全要点：
 *   KV 不可用时必须把 "KV_UNAVAILABLE" 写进 failed 数组且 success=false，
 *   前端据此弹红色常驻告警，杜绝「点了保存其实没存上」的静默失败。
 */

const KV_LOGS_KEY    = "diet_logs";
const KV_FOODS_KEY   = "diet_foods";
const KV_PREFS_KEY   = "diet_prefs";
const KV_MEDIA_KEY   = "diet_media";

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

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const authHeader = request.headers.get("Authorization") || url.searchParams.get("auth");
    const isAuthed = env.ACCESS_PASSWORD ? authHeader === "Bearer " + env.ACCESS_PASSWORD : true;
    const KV = resolveKV(env);
    const hasKV = !!KV;

    // ---------- GET /api/data ----------
    if (url.pathname === "/api/data" && request.method === "GET") {
      if (!isAuthed) return new Response(JSON.stringify({ error: "未授权" }), { status: 401, headers: JSON_HEADERS });
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
      const payload = {
        logs:  safeParse(rawLogs,  []),
        foods: safeParse(rawFoods, { custom: [], overrides: {} }),
        prefs: safeParse(rawPrefs, null),
        media: safeParse(rawMedia, null),
        kvReady: !!hasKV
      };
      if (url.searchParams.get("debug") === "1") {
        payload.kvDebug = {
          envKeys: Object.keys(env || {}),
          workoutKVHasGet: !!(env && env.WORKOUT_KV && typeof env.WORKOUT_KV.get === "function"),
          workoutKVHasPut: !!(env && env.WORKOUT_KV && typeof env.WORKOUT_KV.put === "function"),
          resolvedKV: KV ? "yes" : "no"
        };
      }
      return new Response(JSON.stringify(payload), { headers: JSON_HEADERS });
    }

    // ---------- POST /api/data ----------
    if (url.pathname === "/api/data" && request.method === "POST") {
      if (!isAuthed) return new Response(JSON.stringify({ error: "未授权" }), { status: 401, headers: JSON_HEADERS });
      try {
        const body = await request.json();
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
            try {
              await KV.put(key, JSON.stringify(body[field]));
              saved.push(field);
            } catch (e) {
              failed.push(field + ": " + (e && e.message ? e.message : "unknown"));
            }
          }
        }

        return new Response(JSON.stringify({
          success: failed.length === 0,
          kvReady: !!hasKV,
          saved,
          failed,
          persisted: !!hasKV && failed.length === 0
        }), { headers: JSON_HEADERS });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: JSON_HEADERS });
      }
    }

    return new Response("Not Found", { status: 404 });
  }
};
