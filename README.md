# pi-config

我的 pi agent 环境备份 + 在新机器上一键复刻。

同步方向：**本机 → 仓库**。日常直接改 `~/.pi/agent/`，之后用 `bash setup.sh --dry-run` 反查差异并手工回填到这里。

## 快速启动

```bash
git clone git@github.com:phyzess/pi-config.git
cd pi-config
bash setup.sh --dry-run   # 先看会做什么
bash setup.sh             # 部署；已存在的文件一律跳过
```

`setup.sh` 三种模式：

| 参数 | 行为 |
|---|---|
| 无 | 只补缺失项，已存在的一律跳过 |
| `--force` / `-f` | 覆盖 `~/.pi/agent` 下的配置（会盖掉本机改动） |
| `--dry-run` / `-n` | 只打印动作，不落盘 |

## 仓库内容

```
config/pi/
  settings.json              providers / packages / compaction / theme
  AGENTS.md                  全局规则（中文）
  mcp.json                   可移植 MCP 服务器（7 个）
  mcp.private.example.json   私有 MCP 模板（gitlab / atlassian / figma）
  mcp.per-project.example.json  按仓库启用的 MCP 模板
  extensions/                本地 TypeScript 扩展（3 个）
  i-have-adhd-always         ADHD 输出模式的常开标记
config/env.example           环境变量模板
lists/{brew,mise-tools,pip}.txt   CLI 依赖清单
skills/                      自建 skills（5 个）
setup.sh                     安装入口
```

### pi 扩展包（7 个）

| 包 | 用途 |
|---|---|
| pi-subagents | 子 agent 并行编排 |
| pi-web-access | 网页搜索 + 内容抓取 |
| pi-hashline-edit-pro | 按锚点的精确编辑 |
| pi-ask-user | 结构化单选/多选提问 |
| pi-intercom | 多 pi 会话之间通信 |
| @plannotator/pi-extension | 浏览器里评审方案 / 代码 / PR |
| i-have-adhd | ADHD 输出模式（git 源） |

包列表以 `config/pi/settings.json` 的 `packages` 为唯一来源，`setup.sh` 从这里读取（不硬编码）。

### MCP 服务器

**公开 / 可移植（提交进仓库）**

| 服务器 | 说明 |
|---|---|
| context7 | 库文档查询 |
| codegraph | 代码知识图谱，`directTools` |
| serena | 语义代码检索，`directTools` |
| dap-debug | DAP 断点调试 |
| ast-grep | 结构化搜索 / 改写 |
| chrome-devtools | CDP 级浏览器调试 |
| computer-use | macOS 桌面控制 |

**私有（走 `mcp.private.json`，已 gitignore）**

`gitlab`、`atlassian`、`figma` —— 复制模板填值：

```bash
cp config/pi/mcp.private.example.json config/pi/mcp.private.json
# 编辑填入真实 host / token
bash setup.sh   # 自动合并进 ~/.pi/agent/mcp.json
```

token 建议不要写成明文，用 macOS keychain 取值：

```json
"gitlab_read_token": "!security find-generic-password -a $USER -s agent-mcp-gitlab -w"
```

**按仓库启用**：把需要的服务器从 `config/pi/mcp.per-project.example.json` 拷到目标仓库根目录，命名为 `.mcp.json`。

### Skills（5 个）

`codegraph`、`diagnose`、`hindsight`、`improve-codebase-architecture`、`tdd`

只放自建 skill。包自带的 skill 不复制（`@plannotator/pi-extension`、`pi-subagents`、`pi-intercom`、`pi-ask-user` 的 skill 由包自己提供）；`ego-browser` 是软链到 `~/.local/share/ego/ego-skills`，由 ego 安装器管理。

部署目标：`~/.agents/skills/<name>`（已存在则跳过）。

### extensions（3 个）

| 文件 | 作用 |
|---|---|
| thin-cursor.ts | 去掉反色方块光标，露出终端硬件光标 |
| herdr-agent-state.ts | herdr pane 里显示 agent 运行状态 |
| openrouter-live.ts | OpenRouter 实时模型列表 |

部署目标：`~/.pi/agent/extensions/`。与 `settings.json` 的 `showHardwareCursor: true` 配套。

## 手动安装（不归 setup.sh 管）

这三个用它自己的安装器：

```bash
# pi 本体
npm i -g @earendil-works/pi-coding-agent   # 或官方 installer，落到 ~/.local/bin/pi

# codegraph
curl -fsSL <codegraph install.sh> | sh     # 落到 ~/.codegraph/

# serena
uv tool install serena-agent               # 落到 ~/.local/share/uv/tools/
```

`settings.json` 刻意不记录 `lastChangelogVersion`、`extensionChangelogVersions` —— 那两个键每次启动都变，写进仓库只会立刻产生 diff。

## 已知偏差

`setup.sh` 是单向拷贝，本机改动不会回流到仓库。新增包 / MCP / skill 之后，记得回来更新 `config/pi/settings.json`、`config/pi/mcp.json`、`skills/`。
