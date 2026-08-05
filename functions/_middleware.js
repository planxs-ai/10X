// functions/_middleware.js — 강의 사이트 원리진 봉인 (2026-08-06)
//
// 이 사이트(10x-djs.pages.dev)는 index.html 한 파일에 전 강의가 들어 있어, URL 이
// 유출되면 비번 게이트가 무의미해진다("앞단 비번 무용지물"). 그래서 게이트를
// etf2x 앞단이 아니라 **강의 사이트 자신**에 둔다. 유효한 서명 쿠키가 없는 요청은
// 정적 파일·API 를 포함해 전부 게이트로 막힌다 → 유출된 URL 은 남의 브라우저에서
// 비번 화면만 본다.
//
// ── 설정 (Pages 프로젝트 "10x" 시크릿, 1회) ────────────────────────────────
//   wrangler pages secret put SESSION_SECRET --project-name 10x   (아무 랜덤 긴 문자열)
//   wrangler pages secret put GATE_PASSWORD  --project-name 10x   (수강생에게 배포할 비번)
// 둘 다 없으면 사이트가 열리지 않는다(안전 실패 — 열리는 쪽이 아니라 닫히는 쪽).
//
// ── 정직한 한계 ────────────────────────────────────────────────────────────
// 비번을 아는 수강생이 (1) 쿠키 문자열을 복사해 넘기거나 (2) Ctrl+S 로 680KB 파일을
// 통째로 저장해 뿌리는 것은 이 게이트로 못 막는다(어떤 접근제어로도 불가). 쿠키 수명을
// 짧게 두고 유출을 어렵게·추적 가능하게 만드는 것이 목표지, 완전 차단이 아니다.

const COOKIE   = "x10s";
const TTL_SEC  = 6 * 60 * 60;   // 세션 쿠키 수명 6시간(강의 1회 + 여유). 유출 자격의 가치를 시간으로 제한.
const FAIL_MS  = 700;           // 비번 오답 시 지연 — 자동 대입 억제
const GATE_PATH = "/__gate";    // 비번 제출 경로. 이 경로만 미인증 POST 허용.

// IP 레이트리밋(BOARD_KV 바인딩 있을 때). 짧은 비번(예: 4자리)을 스크립트로 병렬
// 대입하는 공격을 막는다. KV 미바인딩이면 조용히 지연만으로 폴백(사이트는 계속 작동).
const RL_MAX    = 10;           // 이 시간창 안 최대 실패
const RL_WIN    = 600;          // 창(초) = 10분. 초과 시 창 만료까지 차단.
const RL_PREFIX = "rl:gate:";

async function rlCheck(env, ip) {          // true = 차단 상태
  if (!env.BOARD_KV || !ip) return false;
  const n = parseInt((await env.BOARD_KV.get(RL_PREFIX + ip)) || "0", 10);
  return n >= RL_MAX;
}
async function rlBump(env, ip) {           // 실패 1회 기록
  if (!env.BOARD_KV || !ip) return;
  const key = RL_PREFIX + ip;
  const n = parseInt((await env.BOARD_KV.get(key)) || "0", 10) + 1;
  await env.BOARD_KV.put(key, String(n), { expirationTtl: RL_WIN });
}
async function rlClear(env, ip) {          // 성공 시 소거
  if (!env.BOARD_KV || !ip) return;
  await env.BOARD_KV.delete(RL_PREFIX + ip);
}

const enc = new TextEncoder();

/* ── HMAC-SHA256 서명/검증 (WebCrypto, 외부 의존 0) ──────────────────────── */
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" },
    false, ["sign", "verify"]);
}
function b64url(bytes) {
  let s = ""; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}
/** 상수시간 비교 — 타이밍 오라클 차단 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function issueCookie(secret) {
  const payload = JSON.stringify({ v: 1, exp: Math.floor(Date.now() / 1000) + TTL_SEC });
  const p = b64url(enc.encode(payload));
  const key = await hmacKey(secret);
  const sig = b64url(await crypto.subtle.sign("HMAC", key, enc.encode(p)));
  return `${p}.${sig}`;
}
async function verifyCookie(value, secret) {
  if (!value || value.indexOf(".") < 0) return false;
  const [p, sig] = value.split(".");
  try {
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(sig), enc.encode(p));
    if (!ok) return false;
    const body = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
    return body.exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}

function cookieOf(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

/* ── 게이트 페이지 (미인증 시 노출) ──────────────────────────────────────── */
function gatePage(nextPath, wrong, blocked) {
  const safeNext = nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
  const msg = blocked
    ? '<div class="err">시도가 많습니다. 잠시 후 다시 시도하세요.</div>'
    : (wrong ? '<div class="err">비밀번호가 올바르지 않습니다.</div>' : "");
  return new Response(`<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,noarchive"><title>수강생 확인</title>
<style>
  body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#0b0d10;color:#e8eaed;
       font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .box{width:min(360px,90vw);padding:32px 26px;background:#14181d;border:1px solid #232a31;border-radius:16px}
  h1{font-size:18px;margin:0 0 6px}p{font-size:13px;color:#9aa4ad;margin:0 0 18px;line-height:1.6}
  input{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:10px;border:1px solid #2a323a;
        background:#0e1216;color:#e8eaed;font-size:15px;outline:none}
  input:focus{border-color:#4a8}button{width:100%;margin-top:12px;padding:12px;border:0;border-radius:10px;
        background:linear-gradient(135deg,#5eead4,#2dd4bf);color:#06231d;font-weight:700;font-size:15px;cursor:pointer}
  .err{color:#f87171;font-size:12.5px;margin-top:10px}
</style></head><body>
  <form class="box" method="POST" action="${GATE_PATH}">
    <h1>수강생 확인</h1>
    <p>이 강의는 수강생 전용입니다. 안내받은 비밀번호를 입력하세요.</p>
    <input type="password" name="pw" placeholder="비밀번호" autofocus autocomplete="current-password" required>
    <input type="hidden" name="next" value="${safeNext.replace(/"/g, "&quot;")}">
    <button type="submit">입장</button>
    ${msg}
  </form>
</body></html>`, {
    status: wrong ? 401 : 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
               "X-Robots-Tag": "noindex, noarchive" },
  });
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // 시크릿 미설정 = 안전 실패(닫힘). 설정 전엔 아무도 못 들어온다.
  if (!env.SESSION_SECRET || !env.GATE_PASSWORD) {
    return new Response("설정 대기 중입니다(관리자에게 문의).", {
      status: 503, headers: { "Cache-Control": "no-store" } });
  }

  // 1) 비번 제출 처리 — 이 경로만 미인증 POST 허용
  if (url.pathname === GATE_PATH && request.method === "POST") {
    const ip = request.headers.get("CF-Connecting-IP") || "";
    const form = await request.formData();
    const pw = String(form.get("pw") || "");
    const nextPath = String(form.get("next") || "/");

    // IP 레이트리밋 — 짧은 비번(2777 등) 스크립트 대입 차단. 창 초과면 비번 검사 자체를 건너뛴다.
    if (await rlCheck(env, ip)) {
      await new Promise((r) => setTimeout(r, FAIL_MS));
      return gatePage(nextPath, true, true);   // blocked
    }

    const ok = timingSafeEqual(pw, env.GATE_PASSWORD);
    if (!ok) {
      await rlBump(env, ip);
      await new Promise((r) => setTimeout(r, FAIL_MS)); // 자동 대입 억제
      return gatePage(nextPath, true);
    }
    await rlClear(env, ip);   // 성공 → 실패 카운터 소거
    const token = await issueCookie(env.SESSION_SECRET);
    const dest = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
    return new Response(null, {
      status: 303,
      headers: {
        "Location": dest,
        "Set-Cookie": `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${TTL_SEC}`,
        "Cache-Control": "no-store",
      },
    });
  }

  // 2) 유효 쿠키면 통과 — 사이트 자기 자산/함수 서빙(외부 fetch 없음)
  if (await verifyCookie(cookieOf(request, COOKIE), env.SESSION_SECRET)) {
    return next();
  }

  // 3) 그 외 전부 게이트. 원래 가려던 경로를 next 로 보존.
  return gatePage(url.pathname + url.search, false);
}
