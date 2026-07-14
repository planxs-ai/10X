// Cloudflare Pages Function — /api/posts
// 배포 전 1회 설정 필요: Cloudflare 대시보드 > Workers & Pages > 이 프로젝트 >
// Settings > Functions > KV namespace bindings > Variable name: BOARD_KV 로 KV 네임스페이스 연결
//
// GET  /api/posts  → 최근 글 목록 반환 (최대 300개)
// POST /api/posts  → 글 등록 { name, text }

const KV_KEY = "posts";
const MAX_POSTS = 300;
const MAX_NAME = 20;
const MAX_TEXT = 300;

function cors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}
function json(data, status = 200) {
  return cors(new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  }));
}

export async function onRequestOptions() {
  return cors(new Response(null, { status: 204 }));
}

export async function onRequestGet({ env }) {
  if (!env.BOARD_KV) return json({ error: "KV binding(BOARD_KV) missing" }, 500);
  const raw = await env.BOARD_KV.get(KV_KEY);
  const posts = raw ? JSON.parse(raw) : [];
  return json({ posts });
}

export async function onRequestPost({ request, env }) {
  if (!env.BOARD_KV) return json({ error: "KV binding(BOARD_KV) missing" }, 500);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const name = String(body.name || "익명").trim().slice(0, MAX_NAME) || "익명";
  const text = String(body.text || "").trim().slice(0, MAX_TEXT);
  if (!text) return json({ error: "empty text" }, 400);

  const raw = await env.BOARD_KV.get(KV_KEY);
  let posts = raw ? JSON.parse(raw) : [];

  const post = {
    id: crypto.randomUUID(),
    name,
    text,
    ts: Date.now(),
  };
  posts.push(post);
  if (posts.length > MAX_POSTS) posts = posts.slice(posts.length - MAX_POSTS);

  await env.BOARD_KV.put(KV_KEY, JSON.stringify(posts));
  return json({ ok: true, post });
}
