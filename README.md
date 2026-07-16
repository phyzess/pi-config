# pi-config

> 一键在新机器上复刻 pi agent 完整环境。
> 包含：pi 核心 + 6 个扩展包 + 14 个 MCP 服务器 + 20 个 skills + Paseo + AGENTS.md。

## 新机器快速启动

```bash
git clone <this-repo-url> pi-config
cd pi-config
bash setup.sh            # 核心环境
bash setup.sh --with-paseo  # 含 Paseo 多 agent 编排（可选）
```

搞定后重启 pi：`pi`

## 包含什么

### pi 扩展包（6 个）
| 包 | 用途 |
|----|------|
| pi-subagents | 子 agent 并行编排 |
| context-mode | 上下文管理/FTS5 知识库 |
| pi-mcp-adapter | MCP 协议支持 |
| pi-web-access | 网页搜索+内容抓取 |
| pi-codex-goal | 目标追踪 |
| pi-multimodal-proxy | 多模态/图片处理 |

### MCP 服务器

**全局服务器**（所有仓库可用，共 7 个）：
| 服务器 | 用途 |
|--------|------|
| gitlab | GitLab API（公司内部，含 token） |
| atlassian | Jira + Confluence（公司内部，含 token） |
| context7 | 文档上下文查询 |
| **codegraph** | 代码知识图谱（directTools） |
| **dap-debug** | DAP 调试桥接（proxy 模式） |
| **ast-grep** | AST 结构化搜索/重写（proxy 模式） |
| **chrome-devtools** | 浏览器自动化（proxy 模式） |

**按仓库启用的服务器**（复制 `config/pi/mcp.per-project.example.json` 到目标仓库的 `.mcp.json`）：
| 服务器 | 适用场景 |
|--------|---------|
| cloudflare-* (5×) | Cloudflare Workers/Pages/R2 开发 |
| shadcn | 前端 UI 开发 |
| figma | 设计稿对接 |

### Skills（15 个核心 + 5 个可选）

核心（默认部署）：
```
codegraph     → 代码知识图谱使用引导
hindsight     → 主动记忆 (retain/recall/reflect)
diagnose      → 诊断调试
tdd           → 测试驱动开发
prototype     → 快速原型
triage        → Issue 分类
to-issues     → 计划→Issue 拆分
...等（共 15 个）
```

可选（`--with-paseo` 才部署）：
```
paseo         → Paseo daemon 控制
paseo-advisor → 二次审查 agent
paseo-committee → 多 agent 委员会决策
paseo-handoff → 任务交接
paseo-loop    → 循环任务编排
```

### 系统级依赖
```
npm global: pi-coding-agent, codegraph, dap-mcp-server, ast-grep-mcp, chrome-devtools-mcp
brew:       ast-grep
pip:        debugpy
```

## 密钥配置

部分 MCP 服务器需要 API token。配置方式：

```bash
# 1. 创建环境变量文件
cp config/env.example ~/.pi-agent-env

# 2. 编辑填入真实值
vim ~/.pi-agent-env

# 3. 在 ~/.zshrc 末尾加载
echo 'source ~/.pi-agent-env' >> ~/.zshrc
source ~/.zshrc
```

私有 MCP 配置模板：`config/pi/mcp.private.example.json`

复制并填入真实 token 后重命名为 `config/pi/mcp.private.json`，再运行 `setup.sh` 会自动合并。

```
cp config/pi/mcp.private.example.json config/pi/mcp.private.json
# 编辑填入真实值，然后:
bash setup.sh   # 自动检测并合并
```

## AGENTS.md 行为规则

`config/pi/AGENTS.md` 定义了 agent 的全局行为：

- **Discovery Phase**: codegraph 优先，grep/find 兜底
- **Pre-Commit Review**: 大改动前 agent 自查 diff；有 Paseo 时可选触发 paseo-advisor
- **Debugging Protocol**: 优先用 dap 调试器，不是 print
- **Memory**: 用 hindsight skill 积累跨会话记忆
- **Token 意识**: 高频工具直接暴露（codegraph），低频工具代理发现（dap/ast-grep/chrome）

## 项目级初始化

新项目 clone 后还需要：

```bash
# 1. 初始化 codegraph 索引
cd <project>
codegraph init

# 2. 确保 AGENTS.md 正确加载
# pi 会自动从 ~/.pi/agent/AGENTS.md 和项目目录向上查找 AGENTS.md
```

## 文件结构

```
pi-config/
├── setup.sh                      # 一键安装脚本
├── config/
│   ├── pi/
│   │   ├── settings.json         # pi 设置（包列表/provider/thinking）
│   │   ├── mcp.json              # MCP 公开服务器配置
│   │   ├── mcp.private.example.json  # MCP 私有服务器模板
│   │   └── AGENTS.md             # 全局行为规则
│   ├── paseo/
│   │   └── config.json           # Paseo daemon 配置
│   └── env.example               # 环境变量模板
├── skills/                       # 20 个 agent skills
├── lists/
│   ├── brew.txt                  # Homebrew 依赖
│   ├── npm-global.txt            # 全局 npm 依赖
│   └── pip.txt                   # Python 依赖
└── .gitignore
```

## 更新同步

在新机器上拉取最新配置：

```bash
cd pi-config
git pull
bash setup.sh   # 覆盖更新配置和 skills
```

日常迭代后（新增 skill、调整配置）提交回 repo：

```bash
cd pi-config
# skill 变更:
cp -r ~/.agents/skills/<new-skill>/ skills/
# 配置变更:
cp ~/.pi/agent/settings.json config/pi/
cp ~/.pi/agent/AGENTS.md config/pi/
# 新增 MCP server:
# 编辑 config/pi/mcp.json 或 mcp.private.example.json

git add -A && git commit -m "sync: <描述>"
git push
```
