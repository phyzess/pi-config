# pi-config

pi agent 环境的备份 + 在新机器上一键复刻。

同步方向是**本机 → 仓库**：日常直接改 `~/.pi/agent/`，想更新仓库时对照下面「维护」一节回填。

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
| 无 | 只补缺失项，已存在的文件一律跳过（不会盖掉本机改动） |
| `--force` / `-f` | 覆盖 `~/.pi/agent` 下的配置 |
| `--dry-run` / `-n` | 只打印动作，不落盘 |

安装步骤（brew / mise / pip / pi packages）失败只 warning，不中断后面的配置部署。

## 仓库内容

```
config/pi/
  settings.json                  providers / packages / compaction / theme
  AGENTS.md                      全局规则（中文）
  mcp.json                       可移植 MCP 服务器（7 个）
  mcp.private.example.json       私有 MCP 模板（gitlab / atlassian / figma）
  mcp.per-project.example.json   按仓库启用的 MCP 模板
  extensions/                    本地 TypeScript 扩展（3 个）
  i-have-adhd-always             ADHD 输出模式常开标记
config/env.example               环境变量模板 → 部署为 ~/.pi-agent-env
lists/brew.txt                   Homebrew 依赖
lists/mise-tools.txt             mise 全局 CLI 工具
lists/pip.txt                    Python 依赖
skills/                          自建 skills（5 个）
setup.sh                         安装入口
```

## pi 扩展包（7 个）

| 包 | 用途 |
|---|---|
| pi-subagents | 子 agent 并行编排 |
| pi-web-access | 网页搜索 + 内容抓取 |
| pi-hashline-edit-pro | 按锚点的精确编辑 |
| pi-ask-user | 结构化单选/多选提问 |
| pi-intercom | 多个 pi 会话之间通信 |
| @plannotator/pi-extension | 浏览器里评审方案 / 代码 / PR |
| i-have-adhd（git 源） | ADHD 输出模式 |

包清单以 `config/pi/settings.json` 的 `packages` 为唯一来源 —— `setup.sh` 从那里读，不另存一份。

`settings.json` 刻意不记录 `lastChangelogVersion` 和 `extensionChangelogVersions`：这两个键每次启动都变，写进仓库只会立刻产生 diff。

## MCP 服务器

### 公开（提交进仓库，7 个）

| 服务器 | 说明 |
|---|---|
| context7 | 库文档查询 |
| codegraph | 代码知识图谱，`directTools` |
| serena | 语义代码检索，`directTools` |
| dap-debug | DAP 断点调试（lldb / debugpy / dlv） |
| ast-grep | 结构化搜索 / 改写 |
| chrome-devtools | CDP 级浏览器调试 |
| computer-use | macOS 桌面控制 |

除 context7 外都标了 `lifecycle: "lazy"`，按需启动。

### 私有（走 `mcp.private.json`，已 gitignore，3 个）

`gitlab`、`atlassian`、`figma`：

```bash
cp config/pi/mcp.private.example.json config/pi/mcp.private.json
# 把 YOUR_*_HOST 换成真实地址，token 保持 ${VAR} 形式
bash setup.sh   # 自动合并进 ~/.pi/agent/mcp.json
```

token 用 `${VAR}` 占位，由环境变量注入 —— pi 会在 `env` 和 `headers` 的值里展开 `${NAME}`。变量写在 `~/.pi-agent-env`（`setup.sh` 从 `config/env.example` 部署），并在 `~/.zshrc` 里 `source` 它。

不想用环境变量，也可以让 macOS keychain 直接给值 —— `!` 命令必须占满整个值：

```json
"gitlab_read_token": "!security find-generic-password -a $USER -s agent-mcp-gitlab -w"
```

### 按仓库启用

把需要的服务器从 `config/pi/mcp.per-project.example.json` 拷到目标仓库的 **`.pi/mcp.json`**（注意不是 `.mcp.json`）。pi 只在**项目被信任**之后才读这份文件；同名条目会覆盖用户级配置，只写 `enabled` / `exposure` / `toolExposure` 的条目则只做覆盖、其余字段继承。

改完在项目里跑 `pi mcp list` 校验。

## Skills（5 个）

`codegraph`、`diagnose`、`hindsight`、`improve-codebase-architecture`、`tdd`

只放自建 skill，部署到 `~/.agents/skills/<name>`（已存在则跳过）。包自带的 skill 不复制 —— `@plannotator/pi-extension`、`pi-subagents`、`pi-intercom`、`pi-ask-user` 自带各自的 skill；`ego-browser` 是软链到 `~/.local/share/ego/ego-skills`，由 ego 安装器管理。

## extensions（3 个）

| 文件 | 作用 |
|---|---|
| thin-cursor.ts | 去掉反色方块光标，露出终端硬件光标 |
| herdr-agent-state.ts | herdr pane 里显示 agent 运行状态 |
| openrouter-live.ts | OpenRouter 实时模型列表 |

部署到 `~/.pi/agent/extensions/`。`thin-cursor.ts` 依赖 `settings.json` 里的 `showHardwareCursor: true`。

## 依赖清单

| 文件 | 内容 |
|---|---|
| `lists/brew.txt` | `ast-grep`（ast-grep-mcp 的前置） |
| `lists/mise-tools.txt` | `dap-mcp-server`、`ast-grep-mcp`、`chrome-devtools-mcp`（`mise use -g npm:<pkg>@<ver>`） |
| `lists/pip.txt` | `debugpy`（Python 调试适配器） |

不走清单、用自己的安装器装的三个：

```bash
npm i -g @earendil-works/pi-coding-agent   # pi 本体 → ~/.local/bin/pi
curl -fsSL <codegraph install.sh> | sh     # codegraph  → ~/.codegraph/
uv tool install serena-agent               # serena     → ~/.local/share/uv/tools/
```

## 维护

新增包 / MCP / skill 之后要手动回填对应位置：

| 你在本机改了什么 | 回填到 |
|---|---|
| 装了 pi 包 | `config/pi/settings.json` 的 `packages` |
| 加了 MCP 服务器 | `config/pi/mcp.json`（无密钥）或 `mcp.private.example.json`（有密钥） |
| 改了全局规则 | `config/pi/AGENTS.md` |
| 改了自己的 skill | 对应的 `skills/<name>/` |
| 装了 CLI 工具 | `lists/mise-tools.txt` 或 `lists/brew.txt` |
| 改了本地扩展 | `config/pi/extensions/` |

`setup.sh` 是单向拷贝，本机改动不会自动回流到仓库。
