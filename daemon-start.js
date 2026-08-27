// daemon-start.js — 幂等启动 node server + cloudflared 隧道（detached 独立进程）
// v3: 隧道用固定边缘 IP 启动（绕过本机 DNS SRV 坏包问题）+ 公网健康自愈
// 用法: node daemon-start.js   (可反复执行, 适合开机自启和手动修复)
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const NODE = process.execPath;
const LOG = path.join(DIR, 'tunnel.err.log');
const EDGE_IPS = ['198.41.192.47:7844', '198.41.192.67:7844', '198.41.200.73:7844', '198.41.200.53:7844'];

function tunnelRunning() {
  try {
    return execSync('tasklist /FI "IMAGENAME eq cloudflared.exe"').toString().includes('cloudflared.exe');
  } catch { return false; }
}

function lastUrlFromLog() {
  try {
    const m = fs.readFileSync(LOG, 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
    if (!m) return null;
    const urls = m.filter(u => u !== 'https://api.trycloudflare.com');
    return urls.length ? urls[urls.length - 1] : null;
  } catch { return null; }
}

function startTunnel() {
  const o = fs.openSync(LOG, 'w'); // 覆盖写, 保证新 URL 好提取
  const args = ['tunnel', '--url', 'http://localhost:3000', '--no-autoupdate'];
  for (const ip of EDGE_IPS) args.push('--edge', ip);
  const c = spawn(path.join(DIR, 'cloudflared.exe'), args, { cwd: DIR, detached: true, stdio: ['ignore', o, o] });
  c.unref();
  console.log('[start] cloudflared pid=' + c.pid);
  return c.pid;
}

async function main() {
  // 1) node server（端口探测幂等）
  let serverUp = false;
  try {
    const r = await fetch('http://localhost:3000/api/state', { signal: AbortSignal.timeout(2000) });
    serverUp = r.ok;
  } catch {}
  if (serverUp) {
    console.log('[ok] node server 已在运行');
  } else {
    const o = fs.openSync(path.join(DIR, 'server.log'), 'a');
    const s = spawn(NODE, ['server.js'], { cwd: DIR, detached: true, stdio: ['ignore', o, o] });
    s.unref();
    console.log('[start] node server pid=' + s.pid);
  }

  // 2) cloudflared 隧道（进程探测 + 公网健康检查幂等）
  if (tunnelRunning()) {
    const url = lastUrlFromLog();
    let healthy = false;
    if (url) {
      try {
        const r = await fetch(url + '/api/state', { signal: AbortSignal.timeout(8000) });
        healthy = r.ok;
      } catch {}
    }
    if (healthy) {
      console.log('[ok] cloudflared 隧道正常: ' + url);
    } else {
      console.log('[fix] cloudflared 在运行但隧道不通, 重启隧道');
      try { execSync('taskkill /IM cloudflared.exe /F'); } catch {}
      await new Promise(r => setTimeout(r, 2000));
      startTunnel();
    }
  } else {
    startTunnel();
  }
}

main();
