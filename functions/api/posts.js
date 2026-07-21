// Cloudflare Pages Function — /api/posts
// 1회 설정 필요:
//  1) Settings > Functions > KV namespace bindings > 변수명 BOARD_KV = board-kv
//  2) Settings > Environment variables > (Secret) ADMIN_KEY = 관리자 삭제 암호 (선택, 없으면 관리자 삭제 비활성)
//
// GET    /api/posts?clientId=xxx   → 목록 (내 글엔 mine:true 표시, 다른 사람 clientId는 노출 안 함)
// POST   /api/posts                → 글 등록 { name, text, clientId }
// PUT    /api/posts                → 본인 글 수정 { id, clientId, text }
// DELETE /api/posts                → 삭제 { id, clientId } (본인) 또는 { id, adminKey } (관리자, 전체 삭제 가능)

const KV_KEY = "posts";
const MAX_POSTS = 300;
const MAX_NAME = 20;
const MAX_TEXT = 300;

function cors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}
function json(data, status = 200) {
  return cors(new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  }));
}
function toPublic(post, requestClientId) {
  // 소유권 판별용 clientId는 절대 그대로 내보내지 않고 mine 불리언만 노출한다.
  return {
    id: post.id,
    name: post.name,
    text: post.text,
    ts: post.ts,
    edited: !!post.edited,
    editedTs: post.editedTs || null,
    mine: !!requestClientId && post.clientId === requestClientId,
  };
}
async function readPosts(env) {
  const raw = await env.BOARD_KV.get(KV_KEY);
  return raw ? JSON.parse(raw) : [];
}
async function writePosts(env, posts) {
  if (posts.length > MAX_POSTS) posts = posts.slice(posts.length - MAX_POSTS);
  await env.BOARD_KV.put(KV_KEY, JSON.stringify(posts));
  return posts;
}

export async function onRequestOptions() {
  return cors(new Response(null, { status: 204 }));
}

export async function onRequestGet({ request, env }) {
  if (!env.BOARD_KV) return json({ error: "KV binding(BOARD_KV) missing" }, 500);
  const url = new URL(request.url);
  const clientId = (url.searchParams.get("clientId") || "").slice(0, 64);
  const posts = await readPosts(env);
  return json({ posts: posts.map(p => toPublic(p, clientId)) });
}

export async function onRequestPost({ request, env }) {
  if (!env.BOARD_KV) return json({ error: "KV binding(BOARD_KV) missing" }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }

  const clientId = String(body.clientId || "").slice(0, 64);
  const name = String(body.name || "익명").trim().slice(0, MAX_NAME) || "익명";
  const text = String(body.text || "").trim().slice(0, MAX_TEXT);
  if (!text) return json({ error: "empty text" }, 400);
  if (!clientId) return json({ error: "missing clientId" }, 400);

  let posts = await readPosts(env);
  const post = { id: crypto.randomUUID(), name, text, ts: Date.now(), clientId, edited: false, editedTs: null };
  posts.push(post);
  posts = await writePosts(env, posts);
  return json({ ok: true, post: toPublic(post, clientId) });
}

export async function onRequestPut({ request, env }) {
  if (!env.BOARD_KV) return json({ error: "KV binding(BOARD_KV) missing" }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }

  const id = String(body.id || "");
  const clientId = String(body.clientId || "").slice(0, 64);
  const text = String(body.text || "").trim().slice(0, MAX_TEXT);
  if (!id || !text) return json({ error: "id and text required" }, 400);

  let posts = await readPosts(env);
  const idx = posts.findIndex(p => p.id === id);
  if (idx === -1) return json({ error: "not found" }, 404);
  if (posts[idx].clientId !== clientId) return json({ error: "forbidden — not owner" }, 403);

  posts[idx].text = text;
  posts[idx].edited = true;
  posts[idx].editedTs = Date.now();
  posts = await writePosts(env, posts);
  return json({ ok: true, post: toPublic(posts[idx], clientId) });
}

export async function onRequestDelete({ request, env }) {
  if (!env.BOARD_KV) return json({ error: "KV binding(BOARD_KV) missing" }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }

  const id = String(body.id || "");
  const clientId = String(body.clientId || "").slice(0, 64);
  const adminKey = String(body.adminKey || "");
  if (!id) return json({ error: "id required" }, 400);

  let posts = await readPosts(env);
  const idx = posts.findIndex(p => p.id === id);
  if (idx === -1) return json({ error: "not found" }, 404);

  const isOwner = posts[idx].clientId === clientId && !!clientId;
  const isAdmin = !!env.ADMIN_KEY && adminKey === env.ADMIN_KEY;
  if (!isOwner && !isAdmin) return json({ error: "forbidden" }, 403);

  posts.splice(idx, 1);
  await writePosts(env, posts);
  return json({ ok: true });
}
