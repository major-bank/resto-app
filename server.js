'use strict';
/* ============================================================
 * 云味小馆 · 点餐小程序后端
 * 纯 Node 内置模块：http / fs / path / crypto / url（零 npm 依赖）
 *
 * 双存储引擎（环境变量 RESTO_STORAGE 切换）：
 *   local     → JSON 文件持久化 data/db.json + 图片落盘 uploads/（默认，本地/局域网用）
 *   supabase  → 数据存 Supabase Postgres（resto_state 表）+ 图片存 Storage（resto 桶）
 *               （云端 7×24 运行，数据永久保留，重启/关机不丢）
 *
 * 特性：
 *   - SSE 实时推送 /api/stream（含心跳保活，穿透隧道/CDN 缓冲）
 *   - version 版本号 + 前端 12s 轮询兜底，多端秒级~12s 内同步
 *   - 静态托管 public/（前端）
 *   - 路径越权拦截、请求体大小限制
 *
 * 环境变量：
 *   PORT              监听端口（Render 等云平台自动注入）
 *   RESTO_STORAGE     local | supabase（默认 local）
 *   SUPABASE_URL      如 https://xxxx.supabase.co
 *   SUPABASE_KEY      anon 或 service_role key
 *   SUPABASE_BUCKET   图片桶名（默认 resto）
 * ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PORT = process.env.PORT || 3000;

const STORAGE = (process.env.RESTO_STORAGE || 'local').toLowerCase();
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_KEY || '';
const SB_BUCKET = process.env.SUPABASE_BUCKET || 'resto';
const CLOUD = STORAGE === 'supabase' && !!SB_URL && !!SB_KEY;

/* ---------------- Supabase 帮助函数（仅云模式生效） ---------------- */
async function sbFetch(pathname, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(SB_URL + pathname, {
      ...options,
      signal: ctrl.signal,
      headers: {
        apikey: SB_KEY,
        Authorization: 'Bearer ' + SB_KEY,
        ...(options.headers || {})
      }
    });
    if (!res.ok) throw new Error('Supabase ' + pathname + ' -> HTTP ' + res.status);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// 从 Supabase 读取整个 db JSON
async function sbGetDb() {
  const res = await sbFetch('/rest/v1/resto_state?key=eq.db&select=value');
  const rows = await res.json();
  return rows && rows[0] && rows[0].value ? rows[0].value : null;
}

// 立即推送一次（首次初始化种子数据用）
async function sbPushDb() {
  await sbFetch('/rest/v1/resto_state?key=eq.db', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify({ key: 'db', value: db, updated_at: new Date().toISOString() })
  });
}

// 串行 flush 队列：合并最新快照 + 失败自动重试，避免并发乱序覆盖
let flushDirty = false;
let flushRunning = false;
function queueFlush() {
  if (!CLOUD) return;
  flushDirty = true;
  if (flushRunning) return;
  flushRunning = true;
  (async () => {
    while (flushDirty) {
      flushDirty = false;
      const snapshot = JSON.parse(JSON.stringify(db));
      try {
        await sbPushDb();
      } catch (e) {
        console.error('[supabase] 持久化失败，稍后自动重试:', e.message);
        flushDirty = true;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  })().catch((e) => console.error('[supabase] flush 异常:', e.message))
    .finally(() => { flushRunning = false; });
}

// 上传图片到 Storage，返回公网 URL
async function sbUploadImage(buf, ext) {
  const name = crypto.randomBytes(8).toString('hex') + '.' + ext;
  await sbFetch('/storage/v1/object/' + SB_BUCKET + '/' + name, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' },
    body: new Uint8Array(buf)
  });
  return SB_URL + '/storage/v1/object/public/' + SB_BUCKET + '/' + name;
}

// 删除 Storage 图片
async function sbDeleteImage(urlOrName) {
  const name = String(urlOrName || '').split('/').pop();
  if (!name) return;
  try {
    await sbFetch('/storage/v1/object/' + SB_BUCKET + '/' + name, { method: 'DELETE' });
  } catch (e) {
    console.error('[supabase] 删除图片失败:', e.message);
  }
}

/* ---------------- 数据持久化 ---------------- */
let db = null;
function seedDishes() {
  const mk = (id, name, cat, price, emoji, desc) => ({ id, name, cat, price, emoji, desc, on: true, image: '' });
  return [
    mk('d_seed_1', '招牌红烧肉', '热菜', 38, '🍖', '肥而不腻，入口即化'),
    mk('d_seed_2', '宫保鸡丁', '热菜', 28, '🍗', '经典川味，微辣'),
    mk('d_seed_3', '麻婆豆腐', '热菜', 18, '🌶️', '麻辣鲜香，下饭神器'),
    mk('d_seed_4', '清炒时蔬', '素菜', 16, '🥬', '当季新鲜蔬菜'),
    mk('d_seed_5', '番茄炒蛋', '素菜', 14, '🍅', '家常美味'),
    mk('d_seed_6', '扬州炒饭', '主食', 15, '🍚', '粒粒分明'),
    mk('d_seed_7', '手工水饺', '主食', 20, '🥟', '现包现煮，皮薄馅大'),
    mk('d_seed_8', '冰镇酸梅汤', '饮品', 8, '🥤', '解腻消暑')
  ];
}
function defaultDb() {
  return {
    dishes: seedDishes(),
    orders: [],
    seq: 1,
    version: 0,
    settings: { name: '云味小馆', pin: '123456', slogan: '用心做好每一道菜' }
  };
}
async function loadDb() {
  if (CLOUD) {
    try {
      const remote = await sbGetDb();
      if (remote && typeof remote === 'object') {
        db = remote;
        console.log('[db] 已从 Supabase 云端恢复数据');
      } else {
        db = defaultDb();
        await sbPushDb();
        console.log('[db] 云端无数据，已初始化种子菜谱并写入 Supabase');
      }
    } catch (e) {
      console.error('[db] 云端加载失败，使用默认数据:', e.message);
      db = defaultDb();
    }
  } else {
    try {
      if (fs.existsSync(DB_FILE)) {
        db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      }
    } catch (e) {
      console.error('[db] 加载失败，使用默认数据:', e.message);
    }
    if (!db || typeof db !== 'object') db = defaultDb();
  }
  db.dishes = Array.isArray(db.dishes) ? db.dishes : [];
  db.orders = Array.isArray(db.orders) ? db.orders : [];
  db.seq = Number(db.seq) || 1;
  db.version = Number(db.version) || 0;
  db.settings = Object.assign(defaultDb().settings, db.settings || {});
}
function saveDb() {
  db.version = (Number(db.version) || 0) + 1;
  if (CLOUD) {
    queueFlush();
  } else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }
}

/* ---------------- 图片处理 ---------------- */
const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_IMG_BYTES = 8 * 1024 * 1024; // 8MB
async function saveImage(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([\s\S]+)$/);
  if (!m) return null;
  const ext = MIME_EXT[m[1]];
  if (!ext) return null;
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch (e) { return null; }
  if (!buf.length || buf.length > MAX_IMG_BYTES) return null;
  if (CLOUD) {
    try {
      return await sbUploadImage(buf, ext);
    } catch (e) {
      console.error('[supabase] 上传图片失败:', e.message);
      return null;
    }
  }
  const name = crypto.randomBytes(8).toString('hex') + '.' + ext;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return '/uploads/' + name;
}
async function removeUpload(urlPath) {
  if (typeof urlPath !== 'string' || !urlPath) return;
  if (CLOUD) {
    if (urlPath.includes('/storage/v1/object/public/')) await sbDeleteImage(urlPath);
    return;
  }
  if (!urlPath.startsWith('/uploads/')) return;
  const filePath = path.join(UPLOAD_DIR, path.basename(urlPath));
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { /* 忽略 */ }
}

/* ---------------- 工具 ---------------- */
function nowIso() { return new Date().toISOString(); }
function genId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}
function sendErr(res, code, msg) { sendJson(res, code, { error: msg }); }
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > (limit || 20 * 1024 * 1024)) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function withBody(req, res, fn) {
  readBody(req, 20 * 1024 * 1024).then((raw) => {
    let body = {};
    if (raw) {
      try { body = JSON.parse(raw); } catch (e) { return sendErr(res, 400, 'JSON 解析失败'); }
    }
    Promise.resolve(fn(body || {}, res)).catch((e) => sendErr(res, 500, e.message || 'Server Error'));
  }).catch((e) => sendErr(res, 400, e.message || 'Bad Request'));
}

/* ---------------- SSE 实时推送 ---------------- */
const clients = new Set();
function broadcast() {
  const msg = 'data: change\n\n';
  for (const c of clients) {
    try { c.write(msg); } catch (e) { clients.delete(c); }
  }
}
// 心跳保活：穿透隧道/CDN 缓冲，防止长连接被误判为空闲断开
setInterval(() => {
  if (!clients.size) return;
  const msg = ': ping\n\n';
  for (const c of clients) {
    try { c.write(msg); } catch (e) { clients.delete(c); }
  }
}, 10000).unref();

/* ---------------- 订单 ---------------- */
function computeTotal(items) {
  return (items || []).reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 1), 0);
}
function handleCreateOrder(body, res) {
  const uid = String(body.uid || '').slice(0, 40);
  const items = Array.isArray(body.items) ? body.items.filter((it) => it && it.id && Number(it.qty) > 0) : [];
  if (!uid || items.length === 0) return sendErr(res, 400, '参数不完整');
  const order = {
    id: genId('o'),
    seq: db.seq++,
    uid,
    table: String(body.table || '').slice(0, 20),
    remark: String(body.remark || '').slice(0, 200),
    items: items.map((it) => ({
      id: String(it.id),
      name: String(it.name || '').slice(0, 40),
      price: Number(it.price) || 0,
      qty: Number(it.qty) || 1,
      emoji: String(it.emoji || '🍽️').slice(0, 4),
      image: typeof it.image === 'string' ? it.image : ''
    })),
    total: 0,
    status: 'pending',
    closeReason: null,
    review: null,
    createdAt: nowIso()
  };
  order.total = computeTotal(order.items);
  db.orders.unshift(order);
  saveDb();
  broadcast();
  sendJson(res, 200, { ok: true, order });
}
function handleOrderAction(action, body, res) {
  const id = String(body.id || '');
  const order = db.orders.find((o) => o.id === id);
  if (!order) return sendErr(res, 404, '订单不存在');
  switch (action) {
    case 'accept':
      if (order.status === 'pending') order.status = 'preparing';
      break;
    case 'complete':
      if (order.status === 'pending' || order.status === 'preparing') order.status = 'done';
      break;
    case 'close':
      order.status = 'closed';
      order.closeReason = String(body.reason || '已关闭').slice(0, 100);
      order.closedAt = nowIso();
      break;
    case 'delete': {
      const i = db.orders.indexOf(order);
      if (i >= 0) db.orders.splice(i, 1);
      break;
    }
    case 'review':
      if (order.status !== 'done' && order.status !== 'closed') return sendErr(res, 400, '订单未完成，无法点评');
      order.review = {
        rating: Math.max(1, Math.min(5, Number(body.rating) || 5)),
        comment: String(body.comment || '').slice(0, 300),
        at: nowIso()
      };
      break;
    default:
      return sendErr(res, 400, '未知操作');
  }
  saveDb();
  broadcast();
  sendJson(res, 200, { ok: true, order });
}

/* ---------------- 菜谱 ---------------- */
function cleanDish(d) {
  return {
    id: String(d.id || ''),
    name: String(d.name || '').slice(0, 30),
    cat: String(d.cat || '其他').slice(0, 12),
    price: Math.max(0, Number(d.price) || 0),
    emoji: String(d.emoji || '🍽️').slice(0, 4),
    desc: String(d.desc || '').slice(0, 120),
    on: d.on !== false,
    image: typeof d.image === 'string' ? d.image : ''
  };
}
async function processDishImage(dish) {
  // data URL → 上传（云模式存 Supabase Storage / 本地落盘 uploads/）
  if (typeof dish.image === 'string' && dish.image.startsWith('data:image/')) {
    const p = await saveImage(dish.image);
    dish.image = p || '';
  }
  return dish;
}
async function handleDishSave(body, res) {
  const raw = body.dish || body;
  const dish = cleanDish(raw);
  if (!dish.name) return sendErr(res, 400, '菜名不能为空');
  const idx = db.dishes.findIndex((x) => x.id === dish.id);
  if (idx >= 0) {
    const old = db.dishes[idx];
    await processDishImage(dish);
    if (old.image && old.image !== dish.image &&
        (old.image.startsWith('/uploads/') || old.image.includes('/storage/v1/object/public/'))) {
      await removeUpload(old.image);
    }
    db.dishes[idx] = dish;
  } else {
    dish.id = genId('d');
    await processDishImage(dish);
    db.dishes.unshift(dish);
  }
  saveDb();
  broadcast();
  sendJson(res, 200, { ok: true, dish });
}
function handleDishToggle(body, res) {
  const d = db.dishes.find((x) => x.id === String(body.id || ''));
  if (!d) return sendErr(res, 404, '菜品不存在');
  d.on = !d.on;
  saveDb();
  broadcast();
  sendJson(res, 200, { ok: true, dish: d });
}
async function handleDishDelete(body, res) {
  const id = String(body.id || '');
  const i = db.dishes.findIndex((x) => x.id === id);
  if (i < 0) return sendErr(res, 404, '菜品不存在');
  const d = db.dishes[i];
  if (d.image && (d.image.startsWith('/uploads/') || d.image.includes('/storage/v1/object/public/'))) {
    await removeUpload(d.image);
  }
  db.dishes.splice(i, 1);
  saveDb();
  broadcast();
  sendJson(res, 200, { ok: true });
}

/* ---------------- 设置 ---------------- */
function handleSettings(body, res) {
  const s = body.settings || body || {};
  const cur = db.settings;
  if (typeof s.name === 'string' && s.name.trim()) cur.name = s.name.trim().slice(0, 20);
  if (typeof s.slogan === 'string') cur.slogan = s.slogan.trim().slice(0, 60);
  if (typeof s.pin === 'string' && /^\d{4,8}$/.test(s.pin)) cur.pin = s.pin;
  saveDb();
  broadcast();
  sendJson(res, 200, { ok: true, settings: cur });
}

/* ---------------- 静态文件 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};
function serveFile(res, absPath) {
  let stat;
  try { stat = fs.statSync(absPath); } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }
  if (stat.isDirectory()) {
    const idx = path.join(absPath, 'index.html');
    try { stat = fs.statSync(idx); absPath = idx; } catch (e) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }
  }
  const ext = path.extname(absPath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(absPath).pipe(res);
}
function serveFrom(res, baseDir, relPath) {
  const fp = path.normalize(path.join(baseDir, relPath));
  if (!fp.startsWith(baseDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }
  serveFile(res, fp);
}

/* ---------------- 路由 ---------------- */
function handleApi(req, res, url) {
  const p = url.pathname;

  if (req.method === 'GET') {
    if (p === '/api/state') {
      return sendJson(res, 200, { online: true, version: db.version, dishes: db.dishes, settings: db.settings });
    }
    if (p === '/api/orders') {
      return sendJson(res, 200, { orders: db.orders });
    }
    if (p === '/api/history') {
      const uid = String(url.searchParams.get('uid') || '');
      const list = db.orders.filter((o) => o.uid === uid && (o.status === 'done' || o.status === 'closed'));
      return sendJson(res, 200, { orders: list });
    }
    if (p === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no'
      });
      res.write('retry: 3000\n\n');
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
  }

  if (req.method === 'POST') {
    if (p === '/api/order/create') return withBody(req, res, (b) => handleCreateOrder(b, res));
    if (p === '/api/order/accept' || p === '/api/order/complete' || p === '/api/order/close' ||
        p === '/api/order/delete' || p === '/api/order/review') {
      const action = p.split('/').pop();
      return withBody(req, res, (b) => handleOrderAction(action, b, res));
    }
    if (p === '/api/dish/update') return withBody(req, res, (b) => handleDishSave(b, res));
    if (p === '/api/dish/toggle') return withBody(req, res, (b) => handleDishToggle(b, res));
    if (p === '/api/dish/delete') return withBody(req, res, (b) => handleDishDelete(b, res));
    if (p === '/api/settings') return withBody(req, res, (b) => handleSettings(b, res));
  }

  sendErr(res, 404, 'Not Found');
}

/* ---------------- 启动 ---------------- */
const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  } catch (e) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }
  const p = url.pathname;

  if (p.startsWith('/api/')) return handleApi(req, res, url);
  if (p.startsWith('/uploads/')) return serveFrom(res, UPLOAD_DIR, p.slice('/uploads/'.length));
  // 静态页
  const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
  serveFrom(res, PUBLIC_DIR, rel);
});

async function boot() {
  await loadDb();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  server.listen(PORT, '0.0.0.0', () => {
    console.log('==============================================');
    console.log('  云味小馆 · 点餐小程序后端已启动');
    console.log('  存储模式:  ' + (CLOUD ? 'Supabase 云端持久化' : '本地文件 (data/db.json)'));
    console.log('  本机访问:  http://localhost:' + PORT);
    console.log('  手机访问:  http://<本机局域网IP>:' + PORT);
    console.log('==============================================');
  });
}
boot();
