// RAW worker: chỉ trả code thô (text/plain) của script đã công khai. Đường dẫn: /<id>
const TZ_OFFSET_HOURS = 7; // phải giống bio và dash
const H = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
const today = () => new Date(Date.now() + TZ_OFFSET_HOURS * 3600e3).toISOString().slice(0, 10);

export default {
  async fetch(request, env, ctx) {
    const m = new URL(request.url).pathname.match(/^\/([a-z0-9-]{2,40})$/);
    if (!m || (request.method !== 'GET' && request.method !== 'HEAD')) return new Response('-- Not found', { status: 404, headers: H });
    try {
      const row = await env.DB.prepare('SELECT code FROM scripts WHERE id = ? AND published = 1').bind(m[1]).first();
      if (!row) return new Response('-- Script không tồn tại hoặc chưa công khai', { status: 404, headers: H });
      if (request.method === 'GET') ctx.waitUntil(bumpRun(env, request, m[1]));
      return new Response(request.method === 'HEAD' ? null : row.code, { headers: H });
    } catch (e) {
      console.error(e);
      return new Response('-- Lỗi máy chủ', { status: 500, headers: H });
    }
  },
};

// Chống spam số liệu: mỗi IP (đã băm, đổi mỗi ngày) chỉ được tính tối đa N lần/ngày cho mỗi loại.
// Không chặn truy cập, chỉ không cộng thêm vào số liệu.
async function allow(env, request, kind, ref, limit) {
  const day = today();
  const ip = (request && request.headers.get('CF-Connecting-IP')) || 'x';
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + '|' + day)));
  const who = [...h.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
  try {
    const r = await env.DB.prepare('INSERT INTO rate_limits (k, n, day) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n')
      .bind(day + '|' + kind + '|' + (ref || '') + '|' + who, day).first();
    return r.n <= limit;
  } catch (e) { return true; } // chưa chạy migration 005 thì không chặn
}

async function bumpRun(env, request, id) {
  if (!(await allow(env, request, 'run', id, 40))) return;
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO daily_stats (day, kind, count) VALUES (?, 'run', 1) ON CONFLICT(day, kind) DO UPDATE SET count = count + 1").bind(today()),
      env.DB.prepare('UPDATE scripts SET runs = runs + 1 WHERE id = ?').bind(id),
    ]);
  } catch (e) { console.error('bump', e); }
  try { await env.DB.prepare("INSERT INTO script_stats (day, script_id, kind, count) VALUES (?, ?, 'run', 1) ON CONFLICT(day, script_id, kind) DO UPDATE SET count = count + 1").bind(today(), id).run(); } catch (e) { /* chưa chạy migration 007 */ }
}
