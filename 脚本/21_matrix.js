// 21_matrix.js —— 确定性出口矩阵测试：每个节点独占一个 http 入口(listeners[].proxy)，无组选择竞态
// 用法: node 21_matrix.js [--limit N] [--only 名称关键词]
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const YAML = require('yaml');

const OUT = process.env.TEST_OUTPUT || path.resolve(__dirname, '../任务/standalone');
const DIR = path.join(OUT, 'matrix');
const MIHOMO = process.env.MIHOMO_CORE;
if (!MIHOMO || !fs.existsSync(MIHOMO)) throw new Error('请选择有效的本地 Mihomo 内核');
const CTL = 19096, PORT0 = 18100, PAR = 8, TMO = 8;

const argv = process.argv.slice(2);
const LIMIT = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : 0;
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : '';
const SKIPCV = argv.includes('--skipcv');
const ONLY_FAILED = argv.includes('--only-failed');
const OUTFILE = SKIPCV ? 'matrix_skipcv.json' : 'matrix.json';

fs.mkdirSync(DIR, { recursive: true });
const allNodes0 = JSON.parse(fs.readFileSync(path.join(OUT, 'nodes.json'), 'utf8'));
const SITEK = fs.existsSync(path.join(OUT,'sites.json')) ? JSON.parse(fs.readFileSync(path.join(OUT,'sites.json'),'utf8')).sites.map(x=>x[0]) : ['github.com','google.com'];
let allNodes = allNodes0;
if (ONLY_FAILED) {
  const m0 = JSON.parse(fs.readFileSync(path.join(OUT, 'matrix.json'), 'utf8'));
  const failed = new Set(Object.values(m0).filter((r) => SITEK.some((k) => !(r.sites[k] && r.sites[k].status > 0))).map((r) => r.name));
  allNodes = allNodes0.filter((n) => failed.has(n.name));
  console.log(`--only-failed: 严格校验证书下失败的 ${allNodes.length} 个节点`);
}
if (SKIPCV) allNodes = allNodes.map((n) => ({ ...n, 'skip-cert-verify': true }));
let nodes = allNodes;
if (ONLY) nodes = nodes.filter((n) => n.name.includes(ONLY));
if (LIMIT) nodes = nodes.slice(0, LIMIT);

const tcp = fs.existsSync(path.join(OUT, 'tcp_probe.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'tcp_probe.json'), 'utf8')) : {};
const UDP_PROTO = new Set(['hysteria2', 'tuic', 'hysteria']);
const DEFAULT_SITES = [['github.com', 'https://github.com/'], ['google.com', 'https://google.com/']];
const SITES = fs.existsSync(path.join(OUT, 'sites.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'sites.json',), 'utf8')).sites : DEFAULT_SITES;

const listeners = [];
nodes.forEach((n, i) => listeners.push({ name: `L${i}`, type: 'http', port: PORT0 + i, listen: '127.0.0.1', proxy: n.name }));

const cfg = {
  'mixed-port': 0, port: 0, 'socks-port': 0, 'allow-lan': false, mode: 'global', 'log-level': 'warning',
  ipv6: true, 'unified-delay': false, 'find-process-mode': 'off', 'external-controller': `127.0.0.1:${CTL}`,
  profile: { 'store-selected': false },
  dns: { enable: true, ipv6: true, 'enhanced-mode': 'fake-ip', 'fake-ip-range': '198.18.0.1/16', nameserver: ['https://223.5.5.5/dns-query', 'https://1.1.1.1/dns-query'] },
  proxies: nodes, listeners, rules: ['MATCH,DIRECT']
};
fs.writeFileSync(path.join(DIR, 'config.yaml'), YAML.stringify(cfg), 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function api(p) {
  return new Promise((r) => {
    http.get({ host: '127.0.0.1', port: CTL, path: p }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => r({ s: res.statusCode, b })); })
      .on('error', (e) => r({ s: 0, b: 'ERR' + e.message }));
  });
}
function curl(url, port) {
  return new Promise((resolve) => {
    const bf = path.join(DIR, `_b${Math.random().toString(36).slice(2)}.tmp`);
    const c = spawn(process.env.CURL_BIN||'curl', ['-sS', '-L', '--ssl-no-revoke', '--noproxy', '', '--max-time', String(TMO), '-o', bf, '-w', '%{http_code}|%{time_total}', '-x', `http://127.0.0.1:${port}`, url], { windowsHide: true });
    let err = '', meta = '';
    c.stderr.on('data', (d) => (err += d.toString())); c.stdout.on('data', (d) => (meta += d.toString()));
    c.on('close', (code) => {
      let body = ''; try { body = fs.readFileSync(bf, 'utf8'); } catch {} try { fs.unlinkSync(bf); } catch {}
      const [st, tt] = meta.trim().split('|');
      resolve({ code, status: Number(st) || 0, t: Math.round((Number(tt) || 0) * 1000), err: err.replace(/\s+/g, ' ').trim().slice(0, 90), body: body.slice(0, 300) });
    });
  });
}
const IPRE = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

(async () => {
  const logFd = fs.openSync(path.join(DIR, SKIPCV ? 'mihomo_skipcv.log' : 'mihomo.log'), 'w');
  const core = spawn(MIHOMO, ['-d', DIR, '-f', path.join(DIR, 'config.yaml'), '-ext-ctl', `127.0.0.1:${CTL}`], { windowsHide: true, stdio: ['ignore', logFd, logFd] });
  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(500); const r = await api('/version'); if (r.s === 200) { ready = true; break; } }
  if (!ready) { console.error('内核未就绪'); core.kill(); process.exit(1); }
  console.log(`内核就绪 mihomo，测 ${nodes.length} 个节点，listener ${PORT0}~${PORT0 + nodes.length - 1}`);

  const res = {};
  const queue = nodes.map((n, i) => ({ n, port: PORT0 + i }));
  let done = 0;
  async function worker() {
    while (queue.length) {
      const { n, port: lp } = queue.shift();
      const rec = { name: n.name, type: n.type, server: n.server, port: n.port, sites: {}, exitIps: [], geo: null, delay: 0 };
      for (const [k, u] of SITES) {
        const r = await curl(u, lp);
        rec.sites[k] = { status: r.status, err: r.code ? 'curl' + r.code : '', ms: r.t, msg: r.err, body: r.code ? '' : r.body.slice(0, 120) };
      }
      const IPURLS = []; // V0.1 tests only user-selected websites; exit geography remains unknown.
      const pick = async (avoid) => {
        for (const u of IPURLS) {
          if (avoid && u === avoid) continue;
          const r = await curl(u, lp);
          if (r.code === 0) {
            let v = r.body.trim();
            try { const j = JSON.parse(v); if (j.query) v = j.query; } catch {}
            if (IPRE.test(v) || /^[0-9a-f:]{6,}$/i.test(v)) return { u, ip: v };
            return { u, ip: `?body:${v.slice(0, 40)}` };
          }
        }
        return null;
      };
      const s1 = await pick(null);
      if (s1) {
        rec.ipSrc = s1.u; rec.exitIps.push(s1.ip);
        await sleep(400);
        const s2 = await pick(s1.u);
        rec.exitIps.push(s2 ? s2.ip : `?去程失败`);
        await sleep(200);
        const s3 = await pick(s1.u);
        if (s3) rec.exitIps.push(s3.ip);
      } else {
        rec.ipSrc = null; rec.exitIps.push('?全部IP端点不可达(E35/E28)');
      }
      const g = {body:''};
      try { const j = JSON.parse(g.body); if (j.status === 'success') rec.geo = { cc: j.countryCode, city: j.city, isp: j.isp, as: j.as, query: j.query }; } catch {}
      const d = await api(`/proxies/${encodeURIComponent(n.name)}/delay?timeout=6000&url=${encodeURIComponent(SITES[0][1])}`);
      try { rec.delay = JSON.parse(d.b).delay || 0; } catch {}
      // 入口探测（TCP 系协议才有意义，UDP 协议标 N/A）
      const tp = tcp[`${n.server}:${n.port}`];
      rec.entry = UDP_PROTO.has(n.type) ? { kind: 'udp', ok: null } : tp ? { kind: 'tcp', ok: tp.ok, ms: tp.ms, why: tp.why } : { kind: 'tcp', ok: null, why: 'unknown' };
      res[n.name] = rec;
      done++;
      const line = `${String(done).padStart(2)}/${nodes.length} ${n.name.slice(0, 32).padEnd(32)} ${SITES.map(([k]) => k.slice(0, 4) + ':' + (rec.sites[k].status || 'E' + (rec.sites[k].err.slice(4) || '?'))).join(' ')} exit=${rec.exitIps[0]} d=${rec.delay}`;
      console.log(line);
      if (done % 4 === 0) fs.writeFileSync(path.join(OUT, OUTFILE), JSON.stringify(res, null, 1), 'utf8');
    }
  }
  await Promise.all(Array.from({ length: PAR }, worker));
  fs.writeFileSync(path.join(OUT, OUTFILE), JSON.stringify(res, null, 1), 'utf8');
  core.kill();
  console.log('完成 ->', path.join(OUT, OUTFILE));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
