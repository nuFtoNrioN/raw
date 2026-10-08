const TZ_OFFSET_HOURS = 7;
const H = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };

export default {
  async fetch(request, env, ctx) {
    const m = new URL(request.url).pathname.match(/^\/([a-z0-9-]{2,40})$/);
    if (!m || (request.method !== 'GET' && request.method !== 'HEAD')) return new Response('-- Not found', { status: 404, headers: H });
    try {
      const row = await env.DB.prepare('SELECT code FROM scripts WHERE id = ? AND published = 1').bind(m[1]).first();
      if (!row) return new Response('-- Script không tồn tại hoặc chưa công khai', { status: 404, headers: H });
      if (request.method === 'GET') ctx.waitUntil(bumpRun(env, m[1]));
      return new Response(request.method === 'HEAD' ? null : row.code, { headers: H });
    } catch (e) {
      console.error(e);
      return new Response('-- Lỗi máy chủ', { status: 500, headers: H });
    }
  },
};

async function bumpRun(env, id) {
  const day = new Date(Date.now() + TZ_OFFSET_HOURS * 3600e3).toISOString().slice(0, 10);
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO daily_stats (day, kind, count) VALUES (?, 'run', 1) ON CONFLICT(day, kind) DO UPDATE SET count = count + 1").bind(day),
      env.DB.prepare('UPDATE scripts SET runs = runs + 1 WHERE id = ?').bind(id),
    ]);
  } catch (e) { console.error('bump', e); }
}
