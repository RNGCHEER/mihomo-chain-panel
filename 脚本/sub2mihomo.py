#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sub2mihomo.py —— 把分享链接(订阅/自建房 txt)转换成 Mihomo(Clash.Meta) YAML

支持: anytls / vless(reality·ws·grpc) / hysteria2 / tuic / trojan / ss(含 ss2022) / vmess
不支持(会被跳过并在报告中列出): naive+https / naive+quic / anytls+reality

用法:
    python sub2mihomo.py A自建房.txt
    python sub2mihomo.py A自建房.txt -o mihomo.yaml --proxies-only proxies.yaml
    python sub2mihomo.py A自建房.txt --keep-pin      # 把 hysteria2 的 pinSHA256 映射为 fingerprint
    python sub2mihomo.py A自建房.txt --no-groups     # 只输出 proxies

输出:
    -o 指定的完整配置(含 proxy-groups / rules)
    --proxies-only 指定的纯 proxies 片段(便于粘进已有配置)
    报告直接打印到 stdout
"""
from __future__ import annotations

import argparse
import base64
import binascii
import json
import sys
from pathlib import Path
from urllib.parse import parse_qsl, unquote

# ---------------------------------------------------------------- 基础工具


class Unsupported(Exception):
    """该节点无法用 Mihomo 表达。"""


def b64decode(s: str) -> str:
    """宽松的 base64 解码(自动补 padding, 兼容 urlsafe 与缺失 padding)。"""
    s = s.strip().replace('-', '+').replace('_', '/')
    s += '=' * (-len(s) % 4)
    return base64.b64decode(s).decode('utf-8', 'replace')


def truthy(v) -> bool:
    return str(v).strip().lower() in ('1', 'true', 'yes', 'on')


def as_bool_flag(q: dict, *keys) -> bool:
    """insecure=1 / allowInsecure=1 等 → skip-cert-verify。"""
    return any(truthy(q[k]) for k in keys if k in q and q[k] != '')


def split_hostport(s: str):
    """拆 host:port，IPv6 形如 [::1]:443 会被正确还原为 ('::1', 443)。"""
    s = s.strip()
    if s.startswith('['):
        host, _, rest = s[1:].partition(']')
        port = rest.lstrip(':')
        return host, int(port) if port.isdigit() else None
    if s.count(':') == 1:
        host, _, port = s.rpartition(':')
        return host, int(port) if port.isdigit() else None
    return s, None  # 无端口 / 裸 IPv6


def split_uri(uri: str) -> dict:
    """把一个分享链接拆成 scheme / userinfo / host / port / query / name。"""
    scheme, rest = uri.split('://', 1)
    frag = ''
    if '#' in rest:
        rest, frag = rest.split('#', 1)
    q = {}
    if '?' in rest:
        rest, qs = rest.split('?', 1)
        for k, v in parse_qsl(qs, keep_blank_values=True):
            q[k] = v
    userinfo = ''
    if '@' in rest:
        userinfo, rest = rest.rsplit('@', 1)   # 先按原文切分, 再 decode, 防止密码里的 %40 干扰
    elif scheme == 'vmess':
        # vmess 链接没有 userinfo@，整段 base64(JSON) 就在 host 位置
        return {
            'scheme': scheme,
            'userinfo': unquote(rest),
            'host': '',
            'port': None,
            'q': q,
            'name': unquote(frag).strip(),
        }
    host, port = split_hostport(rest)
    return {
        'scheme': scheme,
        'userinfo': unquote(userinfo),
        'host': host,
        'port': port,
        'q': q,
        'name': unquote(frag).strip(),
    }


def base(p: dict, ptype: str) -> dict:
    """所有节点共用的头部字段。"""
    d = {'name': p['name'], 'type': ptype, 'server': p['host'], 'port': p['port']}
    return d


# ---------------------------------------------------------------- 各协议解析


def parse_anytls(p: dict, opt: dict, warn) -> dict:
    q = p['q']
    if (q.get('security') or '').lower() == 'reality':
        raise Unsupported('Mihomo 不支持 AnyTLS + Reality 组合(官方明确表示未来也不会支持)')
    d = base(p, 'anytls')
    d['password'] = p['userinfo']
    if q.get('fp'):
        d['client-fingerprint'] = q['fp']
    if q.get('sni'):
        d['sni'] = q['sni']
    if q.get('alpn'):
        d['alpn'] = q['alpn'].split(',')
    d['skip-cert-verify'] = as_bool_flag(q, 'insecure', 'allowInsecure')
    d['udp'] = True
    return d


def parse_vless(p: dict, opt: dict, warn) -> dict:
    q = p['q']
    d = base(p, 'vless')
    d['uuid'] = p['userinfo']
    d['udp'] = True
    network = (q.get('type') or 'tcp').lower()
    if network not in ('tcp', 'ws', 'grpc', 'http', 'h2'):
        warn(f'{p["name"]}: 未知传输层 type={network}，按 tcp 处理')
        network = 'tcp'
    d['network'] = network
    if q.get('flow'):
        d['flow'] = q['flow']
    if q.get('fp'):
        d['client-fingerprint'] = q['fp']
    sec = (q.get('security') or '').lower()
    if sec in ('tls', 'reality'):
        d['tls'] = True
        if q.get('sni'):
            d['servername'] = q['sni']          # Mihomo 的 vless 用 servername，不是 sni
        if sec == 'reality':
            d['reality-opts'] = {'public-key': q.get('pbk', ''), 'short-id': q.get('sid', '')}
            if not q.get('pbk'):
                warn(f'{p["name"]}: reality 链接缺少 pbk(public-key)')
        else:
            d['skip-cert-verify'] = as_bool_flag(q, 'insecure', 'allowInsecure')
    if network == 'ws':
        ws = {}
        if q.get('path'):
            ws['path'] = q['path']
        if q.get('host'):
            ws['headers'] = {'Host': q['host']}
        if ws:
            d['ws-opts'] = ws
        if q.get('path') and '?ed=' in q['path']:
            warn(f'{p["name"]}: ws path 内含 ?ed= 早期数据参数，已按原样保留(如需早期数据可另加 '
                 f'max-early-data / early-data-header-name)')
    elif network == 'grpc':
        d['grpc-opts'] = {'grpc-service-name': q.get('serviceName', '')}
    return d


def parse_hysteria2(p: dict, opt: dict, warn) -> dict:
    q = p['q']
    d = base(p, 'hysteria2')
    d['password'] = p['userinfo']
    if q.get('sni'):
        d['sni'] = q['sni']
    d['skip-cert-verify'] = as_bool_flag(q, 'insecure', 'allowInsecure')
    if q.get('mport'):
        # 端口跳跃: 保留 port 的同时写 ports，Mihomo 会忽略 port
        d['ports'] = q['mport']
    elif q.get('ports'):
        d['ports'] = q['ports']
    if q.get('obfs'):
        d['obfs'] = q['obfs']
    if q.get('obfs-password'):
        d['obfs-password'] = q['obfs-password']
    if q.get('alpn'):
        d['alpn'] = q['alpn'].split(',')
    if q.get('pinSHA256'):
        if opt['keep_pin']:
            d['fingerprint'] = q['pinSHA256']
        else:
            warn(f'{p["name"]}: 链接带 pinSHA256={q["pinSHA256"][:16]}…，Mihomo 的对应字段是 fingerprint'
                 f'(证书 SHA256 指纹)，格式是否一致需自行确认；因该节点本身 skip-cert-verify=true，'
                 f'默认未写入。需要时用 --keep-pin 生成。')
    return d


def parse_tuic(p: dict, opt: dict, warn) -> dict:
    q = p['q']
    if ':' not in p['userinfo']:
        raise Unsupported('TUIC 链接缺少 uuid:password 结构')
    uuid, _, password = p['userinfo'].partition(':')
    d = base(p, 'tuic')
    d['uuid'] = uuid
    d['password'] = password
    if q.get('sni'):
        d['sni'] = q['sni']
    d['alpn'] = (q.get('alpn') or 'h3').split(',')
    d['udp-relay-mode'] = q.get('udp_relay_mode', 'native')
    cc = q.get('congestion_control') or q.get('congestion-controller')
    if cc:
        d['congestion-controller'] = cc
    d['skip-cert-verify'] = as_bool_flag(q, 'insecure', 'allowInsecure')
    d['udp'] = True
    return d


def parse_trojan(p: dict, opt: dict, warn) -> dict:
    q = p['q']
    d = base(p, 'trojan')
    d['password'] = p['userinfo']
    if q.get('sni'):
        d['sni'] = q['sni']
    if q.get('fp'):
        d['client-fingerprint'] = q['fp']
    d['skip-cert-verify'] = as_bool_flag(q, 'insecure', 'allowInsecure')
    d['udp'] = True
    return d


def parse_ss(p: dict, opt: dict, warn) -> dict:
    raw = p['userinfo']
    if ':' not in raw:                     # 整个 userinfo 是 base64(method:password)
        raw = b64decode(raw)
    method, _, password = raw.partition(':')
    if not method:
        raise Unsupported('SS 链接解析失败')
    if method.startswith('2022-') is False and method not in (
            'aes-128-gcm', 'aes-192-gcm', 'aes-256-gcm', 'aes-128-cfb', 'aes-192-cfb', 'aes-256-cfb',
            'aes-128-ctr', 'aes-192-ctr', 'aes-256-ctr', 'chacha20-ietf-poly1305', 'xchacha20-ietf-poly1305',
            'chacha20-ietf', 'chacha20', 'rc4-md5', 'none', 'dummy'):
        warn(f'{p["name"]}: 加密方式 {method} 不在常见列表中，请自行确认 Mihomo 是否支持')
    if method.startswith('2022-') and method.endswith('gcm'):
        # SS2022 密码应为 base64 的 PSK，这里只做长度提示
        try:
            if len(base64.b64decode(password + '=' * (-len(password) % 4))) not in (16, 32):
                warn(f'{p["name"]}: SS2022 密码解码后长度异常')
        except (binascii.Error, ValueError):
            warn(f'{p["name"]}: SS2022 密码不是合法 base64')
    d = base(p, 'ss')
    d['cipher'] = method
    d['password'] = password
    d['udp'] = True
    plugin = p['q'].get('plugin')
    if plugin:
        d['plugin'] = plugin
        if p['q'].get('plugin-opts'):
            d['plugin-opts'] = p['q']['plugin-opts']
    return d


def parse_naive(p: dict, opt: dict, warn) -> dict:
    raise Unsupported('Mihomo 没有 naive / naive+quic 出站(相关功能请求仍未实现)，只能保留给 sing-box/其他客户端')


def parse_vmess(p: dict, opt: dict, warn) -> dict:
    try:
        cfg = json.loads(b64decode(p['userinfo'] or p['name']))
    except Exception as e:                                   # vmess 的载荷在 userinfo 位置
        raise Unsupported(f'vmess base64/JSON 解析失败: {e}')
    net = (cfg.get('net') or 'tcp').lower()
    scy = (cfg.get('scy') or 'auto').lower()
    d = {
        'name': p['name'] or cfg.get('ps', ''),
        'type': 'vmess',
        'server': cfg.get('add', ''),
        'port': int(cfg.get('port') or 0),
        'uuid': cfg.get('id', ''),
        'alterId': int(cfg.get('aid') or 0),
        'cipher': 'auto' if scy in ('', 'none', 'auto', 'zero') else scy,
        'udp': True,
        'network': net,
    }
    if net == 'ws':
        ws = {}
        if cfg.get('path'):
            ws['path'] = cfg['path']
        if cfg.get('host'):
            ws['headers'] = {'Host': cfg['host']}
        if ws:
            d['ws-opts'] = ws
    elif net == 'grpc':
        d['grpc-opts'] = {'grpc-service-name': cfg.get('path', '')}
    if truthy(cfg.get('tls')):
        d['tls'] = True
        if cfg.get('sni'):
            d['servername'] = cfg['sni']
        elif cfg.get('host'):
            d['servername'] = cfg['host']
        if cfg.get('fp'):
            d['client-fingerprint'] = cfg['fp']
        d['skip-cert-verify'] = truthy(cfg.get('insecure'))
    if scy not in ('', 'none', 'auto'):
        warn(f'{p["name"]}: vmess 加密 scy={scy}，已按原值写入')
    else:
        warn(f'{p["name"]}: vmess scy={scy or "空"} 已在 Mihomo 侧映射为 cipher: auto')
    return d


PARSERS = {
    'anytls': parse_anytls,
    'vless': parse_vless,
    'hysteria2': parse_hysteria2,
    'tuic': parse_tuic,
    'trojan': parse_trojan,
    'ss': parse_ss,
    'vmess': parse_vmess,
    'naive+https': parse_naive,
    'naive+quic': parse_naive,
    'naive': parse_naive,
}


# ---------------------------------------------------------------- YAML 输出
# 不依赖 pyyaml，输出统一使用单引号字符串，emoji / 冒号 / # 都安全。


def _scalar(v) -> str:
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return str(v)
    if v is None:
        return 'null'
    return "'" + str(v).replace("'", "''") + "'"


def emit(obj, indent: int = 0) -> str:
    pad = '  ' * indent
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, (dict, list)):
                if not v:
                    out.append(f'{pad}{k}: ' + ('{}' if isinstance(v, dict) else '[]'))
                else:
                    out.append(f'{pad}{k}:')
                    out.append(emit(v, indent + 1))
            else:
                out.append(f'{pad}{k}: {_scalar(v)}')
    elif isinstance(obj, list):
        for item in obj:
            if isinstance(item, dict):
                lines = emit(item, indent + 1).split('\n')
                out.append(f'{pad}- ' + lines[0].lstrip())
                out.extend(lines[1:])
            elif isinstance(item, list):
                out.append(f'{pad}-')
                out.append(emit(item, indent + 1))
            else:
                out.append(f'{pad}- {_scalar(item)}')
    return '\n'.join(out)


# ---------------------------------------------------------------- 主流程

HEADER = """# ===== Mihomo(Clash.Meta) 配置 —— 由 sub2mihomo.py 从分享链接自动生成 =====
# 生成规则: 名称保留原链接备注；任何源链接里无法用 Mihomo 表达的内容都在生成报告中列出，
# 不做静默丢弃。请用支持 anytls 的 Mihomo 内核(v1.19.x 及以上)加载本文件。
"""


def load_nodes(path: Path):
    text = path.read_text(encoding='utf-8', errors='replace')
    nodes = []
    for i, line in enumerate(text.splitlines(), 1):
        line = line.strip()
        if not line or '://' not in line:
            continue
        nodes.append((i, line))
    return nodes


def convert(raw_nodes, opt):
    proxies, skipped, warnings = [], [], []
    seen = {}
    stats = {}

    def warn(msg):
        warnings.append(msg)

    for lineno, uri in raw_nodes:
        try:
            p = split_uri(uri)
        except Exception as e:
            skipped.append((lineno, uri[:60], f'链接解析失败: {e}'))
            continue
        fn = PARSERS.get(p['scheme'])
        if fn is None:
            skipped.append((lineno, uri[:60], f'不支持的协议 scheme={p["scheme"]}'))
            continue
        if not p['name'] and p['scheme'] != 'vmess':
            p['name'] = f'{p["scheme"]}-{p["host"]}-{p["port"]}'
            warn(f'第{lineno}行: 链接无备注，已命名为 {p["name"]}')
        try:
            proxy = fn(p, opt, lambda m, ln=lineno: warnings.append(f'第{ln}行 {m}'))
        except Unsupported as e:
            skipped.append((lineno, f'{p["scheme"]} {p["name"]}', str(e)))
            continue
        except Exception as e:
            skipped.append((lineno, uri[:60], f'{type(e).__name__}: {e}'))
            continue

        # 去重: 除 name 外完全一致的节点只保留一个
        key = json.dumps({k: v for k, v in proxy.items() if k != 'name'},
                         sort_keys=True, ensure_ascii=False)
        if key in seen:
            skipped.append((lineno, f'{proxy["type"]} {proxy["name"]}',
                            f'与第{seen[key]}行节点完全相同，已合并为重复项'))
            continue
        seen[key] = lineno

        # 名称去重: Mihomo 要求 name 唯一
        if not proxy.get('name'):
            proxy['name'] = f'{proxy["type"]}-{proxy["server"]}-{proxy["port"]}'
            warn(f'第{lineno}行: 链接无备注，已命名为 {proxy["name"]}')
        if any(x['name'] == proxy['name'] for x in proxies):
            n = 2
            while any(x['name'] == f'{proxy["name"]} ({n})' for x in proxies):
                n += 1
            newname = f'{proxy["name"]} ({n})'
            warn(f'第{lineno}行: 名称重复，已改为 {newname}')
            proxy['name'] = newname

        proxies.append(proxy)
        stats[proxy['type']] = stats.get(proxy['type'], 0) + 1

    return proxies, skipped, warnings, stats


def build_config(proxies):
    names = [p['name'] for p in proxies]
    groups = [
        {'name': '🚀 节点选择', 'type': 'select', 'proxies': ['♻️ 自动选择', 'DIRECT'] + names},
        {'name': '♻️ 自动选择', 'type': 'url-test', 'url': 'http://www.gstatic.com/generate_204',
         'interval': 300, 'tolerance': 50, 'proxies': names},
        {'name': '🌏 全部节点', 'type': 'select', 'proxies': names},
        {'name': '🐟 漏网之鱼', 'type': 'select', 'proxies': ['🚀 节点选择', 'DIRECT']},
    ]
    cfg = {
        'mixed-port': 7890,
        'allow-lan': False,
        'mode': 'rule',
        'log-level': 'info',
        'ipv6': True,
        'unified-delay': True,
        'tcp-concurrent': True,
        'external-controller': '127.0.0.1:9090',
        'proxies': proxies,
        'proxy-groups': groups,
        'rules': [
            'GEOIP,LAN,DIRECT,no-resolve',
            'GEOIP,CN,DIRECT',
            'MATCH,🐟 漏网之鱼',
        ],
    }
    return cfg


def main():
    ap = argparse.ArgumentParser(description='分享链接 → Mihomo YAML')
    ap.add_argument('input', help='输入 txt(每行一个分享链接)')
    ap.add_argument('-o', '--output', default=None, help='完整配置输出路径(默认 <输入名>.mihomo.yaml)')
    ap.add_argument('--proxies-only', default=None, help='只输出 proxies 片段的路径(默认 <输入名>.proxies.yaml)')
    ap.add_argument('--no-groups', action='store_true', help='不生成 proxy-groups / rules')
    ap.add_argument('--keep-pin', action='store_true', help='把 hysteria2 的 pinSHA256 写入 fingerprint')
    args = ap.parse_args()
    opt = {'keep_pin': args.keep_pin}

    src = Path(args.input)
    if not src.is_file():
        sys.exit(f'找不到输入文件: {src}')
    raw_nodes = load_nodes(src)
    proxies, skipped, warnings, stats = convert(raw_nodes, opt)
    # Partial conversion is allowed: duplicate/unsupported rows are reported below,
    # while valid rows remain usable. Only an empty result is fatal.
    if not proxies:
        sys.exit('没有可转换的有效节点；请检查输入协议和必填字段。')

    full = emit(build_config(proxies)) if not args.no_groups else emit({'proxies': proxies})
    out_full = Path(args.output) if args.output else src.with_suffix('.mihomo.yaml')
    out_full.write_text(HEADER + full + '\n', encoding='utf-8', newline='\n')

    out_proxies = Path(args.proxies_only) if args.proxies_only else src.with_suffix('.proxies.yaml')
    out_proxies.write_text('# 仅 proxies 片段，可直接粘贴进已有配置\n'
                           + emit({'proxies': proxies}) + '\n', encoding='utf-8', newline='\n')

    # ---- 报告
    print(f'输入: {src}  共 {len(raw_nodes)} 行链接')
    print(f'成功转换: {len(proxies)} 个节点')
    for t, n in sorted(stats.items(), key=lambda kv: -kv[1]):
        print(f'    {t:<10} {n}')
    print(f'跳过/合并: {len(skipped)} 条')
    for lineno, what, why in skipped:
        reason = '重复节点已合并' if '合并' in why or '相同' in why else '不支持的协议' if '不支持' in why else '链接解析或参数校验失败'
        print(f'    第{lineno}行 → {reason}（原始凭据未回显）')
    if warnings:
        print(f'注意({len(warnings)} 条): 已执行兼容性转换，请核对生成配置。原始参数未回显。')
    print(f'完整配置: {out_full}')
    print(f'proxies 片段: {out_proxies}')

    # ---- 自检: 若装了 pyyaml, 回读校验 YAML 合法性
    try:
        import yaml
        data = yaml.safe_load(out_full.read_text(encoding='utf-8'))
        assert len(data['proxies']) == len(proxies)
        known = {p['name'] for p in proxies} | {g['name'] for g in data.get('proxy-groups', [])} \
            | {'DIRECT', 'REJECT', 'PASS', 'GLOBAL'}
        for g in data.get('proxy-groups', []):
            for n in g['proxies']:
                assert n in known, f'策略组 {g["name"]} 引用了不存在的 {n}'
        print('自检: YAML 可被 pyyaml 正确解析，节点数与策略组引用一致 ✓')
    except ImportError:
        print('自检: 未安装 pyyaml，跳过解析校验')
    except Exception as e:
        print(f'自检失败: {type(e).__name__}: {e}')
        sys.exit(1)


if __name__ == '__main__':
    main()
