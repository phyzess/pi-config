# Pi Agent — 全局适配

## 工作约定

- 解释、审查和状态报告默认只读;诊断定位原因,只有用户明确要求修复时才修改
- 修改任务完成请求范围内的实现和必要验证;发布、外部消息、不可逆或破坏性操作在最终执行前确认
- 用户明确指令优先于 Skill 的通用建议。不要让 Skill 自动扩大授权或任务范围
- 简单任务直接处理;存在方案选择、跨组件影响或明显风险时才简报计划。测试、复核和多代理数量由风险与独立工作量决定,不用固定文件数或行数阈值
- 保留用户现有改动,不主动 stash、revert 或清理无关内容
- 收尾不留残渣:不留下临时调试文件、`.bak` 备份、注释掉的死代码

## Git 与工具

- 破坏性修改、重构或依赖变更前先了解工作树与分支;只有任务包含提交时才创建原子 conventional commit(`feat:`/`fix:`/`refactor:`/`docs:`…)
- 优先 `edit` 做局部修改;避免为小改动重写整文件,也不要为几行改动 `write` 覆盖长文件
- 可能挂起或联网的命令优先使用带 timeout 的执行能力
- CodeGraph 可用且 repo 已索引时优先做结构和影响分析,不猜文件路径;否则按项目指令中的降级顺序处理

- **禁止嗅探猜图**:图片只用用户消息明确给出的附件路径、`image="..."` id 或 `<vision_proxy_*>` id;不得扫描 `/tmp`、Downloads 或全盘猜测图片来源
- **临时验证目录**:`/tmp` 里的隔离验证(干净 clone/install、门禁复现、试验脚本)一律 `mktemp -d` + `trap 'rm -rf "$T"' EXIT`,**绝不用固定名字**——固定名清理后只留空壳与悬空符号链接;临时 `git worktree` 必须 `worktree remove` 并同时删掉指向它的别名链接;收尾自查(`ls -d /tmp/<前缀>*`)而非靠记忆

## 安全与验证

- 危险命令(`rm -rf` 非明确构建目录、`git push --force`、清库/删表)先确认;依赖变更说明必要性并遵守任务授权
- 运行与变化边界相称的 lint、类型检查或测试;相关检查通过后,只有新失败或未决风险才扩大验证
- advisor、subagents 和额外评审只在能提供独立证据或并行收益时使用

## 代码质量

- 用现代语言特性与严格类型(TypeScript、Python PEP 8、Go idiomatic);边界、`null`/`undefined`、async rejection 显式处理
- 公开 API 与复杂算法补必要注释/docstring,不写复述代码的噪音注释
- 改完主动跑与变化边界相称的 lint/测试,不等用户催

## 调试与记忆

- 先复现:用最小用例隔离失败,再动手改
- 诊断先建立与问题匹配的反馈信号;可用时优先 debugger/结构化工具,再用定向日志或 grep
- 只有产生可复用洞察、决策或未完成事项时才使用 hindsight/项目记忆;简单任务不强制写入

## 浏览器默认

- 浏览器任务(开网页、填表单、点击、截图、提取页面数据、Web 应用测试/QA)默认使用 ego-browser skill:先跑 `ego-browser skill`,再按其指引经 `ego-browser` CLI(ego lite)操作。
- 不要默认用其他自动化工具(如 chrome-devtools MCP)启动 Chrome;仅当任务需要 ego-browser API 覆盖不了的 CDP 级调试时才使用。

## 方案评审(Plannotator)

`plannotator` 工具每个会话都可调用;若它不在工具列表里,直接说明并停下,不要静默跳过评审。

- **触发即调用**:写完或改完方案/设计/规格类文档(`PLAN.md`、`spec*.md`、`docs/**/design*.md`、架构或接口设计说明)后,立刻调用 `plannotator` 工具(`gate: true`),不要先把全文贴进聊天等口头确认,也不要问"要不要开评审"
- 用户说「评审/批注/看看这个/开评审」时,同样直接调用,不再二次确认
- 只有两种豁免:文档自述为草稿或临时笔记(`*.draft.md`、`tmp/` 下),或用户当场明确说不用评审
- 只是评审已有文档不必进 plan mode;需要我在批准前不动代码的规划才用 `/plannotator-plan-mode`(或用户按 Ctrl+Alt+P),写完计划后调 `plannotator_submit_plan`
- 代码改动评审用 `plannotator` 工具的 review(PR/MR 传 URL);会话阻塞到人给出决定,不得 kill,重跑会恢复草稿
- 评审返回的 feedback 就是本轮指令,立即处理;`approved` 附带的 notes 属建议,不算返工要求

## 语言

- 代码/注释/docstring/日志/commit message:专业英语。
- 与用户交流、计划、解释:**简体中文**,资深同侪语气。

## Pi 能力适配

配置在 `~/.pi/agent/mcp.json`;涉及 wiki/Confluence/Jira/GitLab 时先检查 `/mcp` 的实际连接状态,再决定是否使用,不要仅按配置文件推断可用。

| Server | Tools | 用途 |
|---|---|---|
| atlassian | confluence_search/get_page/create/update…、jira_search/get_issue/create/transition… | RC wiki(wiki.ringcentral.com)与 Jira 工单。产品文档页先 confluence_search 找 pageId 再 get_page(convert_to_markdown: true) |
| gitlab | MR/issue/CI(21 个) | int.rclabenv.com 代码评审/流水线 |
| context7 | 库文档查询 | 依赖/框架最新 API 文档 |
| codegraph | codegraph_*(直连工具) | 代码结构与影响分析(见「Git 与工具」) |
| dap-debug | lldb/debugpy attach | 断点调试(见「调试与记忆」) |
| ast-grep | 结构化搜索 | 大规模代码模式检索/改写 |
| chrome-devtools | CDP 级调试 | 仅当 ego-browser 覆盖不了时使用(浏览器任务默认见「浏览器默认」) |

MCP 懒连接并通过代理按需发现工具。subagents 和 hindsight 都是扩展能力:存在且适合当前任务时使用,不可用时按 workspace `AGENTS.md` 降级。
