// tunnel-start.js — 用固定边缘 IP 启动 cloudflared（绕过本机 DNS SRV 坏包问题）
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const DIR = __dirname;

const o = fs.openSync(path.join(DIR, 'tunnel.err.log'), 'w');
const c = spawn(path.join(DIR, 'cloudflared.exe'), [
  'tunnel', '--url', 'http://localhost:3000', '--no-autoupdate',
  '--edge', '198.41.192.47:7844',
  '--edge', '198.41.192.67:7844',
  '--edge', '198.41.200.73:7844',
  '--edge', '198.41.200.53:7844'
], { cwd: DIR, detached: true, stdio: ['ignore', o, o] });
c.unref();
console.log('[start] cloudflared pid=' + c.pid);
