# 第三方组件与许可

本仓库自身代码以 **MIT** 许可发布（见 [LICENSE](LICENSE)）。发布 ZIP 中随包分发的第三方组件
保留其原始许可，**不因本项目的 MIT 许可而改变**。分发、再分发或二次打包前请自行核对下表。

| 组件 | 位置（发布包内） | 上游项目 | 许可 |
|---|---|---|---|
| Node.js | `runtime/node/node.exe` | [nodejs.org](https://nodejs.org/) | MIT（含若干第三方许可，见 Node 分发中的 `LICENSE`） |
| CPython | `runtime/python/` | [python.org](https://www.python.org/) | PSF License（`runtime/python/LICENSE.txt`） |
| curl | `runtime/curl/curl.exe` | [curl.se](https://curl.se/) | curl License（MIT/X 派生） |
| Mihomo 内核 | `内核/mihomo.exe`、`内核/mihomo-smart.exe`、`内核/mihomo-alpha.exe` | [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo) | MIT（以各内核分发自带声明为准） |
| mmdb 数据 | `数据/country.mmdb` | [MaxMind](https://www.maxmind.com/) GeoLite2 | MaxMind EULA / CC BY-SA 4.0 |
| geoip.metadb | `数据/geoip.metadb` | MetaCubeX 生态 | 以上游仓库声明为准 |
| yaml (npm) | `脚本/node_modules/yaml/` | [eemeli/yaml](https://github.com/eemeli/yaml) | ISC |

说明：

- `runtime/python/` 与 `脚本/node_modules/` 属于「打包运行时」，上游许可文件随包保留。
- 若你只克隆仓库源码（`runtime/`、`内核/`、`数据/`、`任务/` 均被 `.gitignore` 排除），
  则仓库内容仅为本项目代码 + 脚本，全部适用 MIT。
- 未列出的传递依赖请以对应组件的 `LICENSE` 文件为准；发现遗漏欢迎提 Issue 补充。

## 本项目代码

| 文件 | 说明 |
|---|---|
| `panel.html`、`panel.js` | 前端界面（无框架，原生 DOM/CSS） |
| `launch.cjs` | 便携启动器：探测端口、拉起后端、打开浏览器 |
| `启动面板.cmd` | 双击入口（Windows CMD） |
| `脚本/server_v2.js` 等 | 本地 HTTP 服务与测试/生成逻辑 |
