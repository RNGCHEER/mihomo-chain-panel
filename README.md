# Mihomo Chain Panel · V0.1

Windows 本地节点测试与链式代理面板。读取 TXT 分享链接或 Mihomo YAML，通过实际网站请求筛选节点，自由选择上游与落地，生成固定八组配置。

## 下载与启动

到 [V0.1 Release](https://github.com/RNGCHEER/mihomo-chain-panel/releases/tag/V0.1) 下载 Windows x64 便携 ZIP，完整解压后双击 `启动面板.cmd`。浏览器自动打开本地面板。不要直接打开 HTML，也不要在压缩包内运行。

Release 包内置 Node.js、Python、curl、Mihomo 内核和本地数据库；无需安装这些运行时或 Clash Party。软件可以离线启动，互联网节点与网站测试需要网络。源码仓库不提交大型二进制和用户配置；直接下载源码不能替代完整便携包。

## 工作流程

1. 选择本地 Mihomo 内核版本；新增版本可放进 `内核/mihomo*.exe` 后刷新。
2. 导入 TXT/粘贴链接，或读取 YAML 中的节点。导入不等于已验证可用。
3. 填写测试网站，执行本轮节点测试。
4. 从通过测试的节点中选择上游、落地并添加链路。
5. 实测组合，导出通过链路与分组配置。最终 YAML 放在程序根目录，同名不会覆盖旧文件。

链路方向：`电脑 → 上游节点 → 落地节点 → 网站`。在落地节点副本上设置 `dialer-proxy: 上游名称`，保留协议、传输和认证参数。参考 [Mihomo dialer-proxy 文档](https://wiki.metacubex.one/config/proxies/dialer-proxy/#relay-select)。

支持作为候选的协议包括 VLESS、VMess、Trojan、Shadowsocks、Hysteria2、TUIC、AnyTLS；以所选内核支持和实测结果为准。两端单独可用不代表组合可用。UDP 落地需要上游支持对应 UDP 转发；Reality 等组合也应实测。网站访问成功不等于 AI 解锁、UDP 应用或落地公网出口均已验证。

## 八个策略组

| 分组 | 成员规则 |
|---|---|
| 手动选择 | 可用节点、自动组及已验证链式入口 |
| 自动选择 | 本轮通过的节点 |
| ai 自动选择 | 本轮符合非中国出口条件的候选节点；不代表解锁验证 |
| ai 服务 | DIRECT、手动选择、ai 自动选择 |
| 国内网络 | DIRECT |
| 非中国 | 手动选择、ai 自动选择、自动选择 |
| 漏网之鱼 | 手动选择、ai 自动选择、自动选择 |
| 链式跳板 | 组合实测通过的链路；空组使用 REJECT |

## 文件与隐私

`panel.html` 为界面，`脚本/` 为后端与测试程序，`runtime/` 为便携运行时，`内核/` 为 Mihomo，`数据/` 为数据库。运行产生的 `任务/`、YAML 和日志可能包含节点凭据，仅保留在本机，不应提交或分享。

仓库和发布包不附带订阅、节点 YAML 或个人测试结果。导入操作不下载远程 proxy-provider；请使用包含实际节点的配置。程序仅在本机回环地址提供面板。

## 第三方组件

Mihomo、Node.js、CPython、curl、yaml npm 包及地理数据库分别遵守各自许可证；本项目不改变其许可。Mihomo 源码见 https://github.com/MetaCubeX/mihomo ，Node.js 见 https://nodejs.org ，Python 见 https://www.python.org ，curl 见 https://curl.se 。第三方二进制不属于本项目原创代码。
