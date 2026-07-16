#!/usr/bin/env bash
# ============================================================
# pi-config setup — 一键在新机器上复刻 pi agent 环境
# 用法: bash setup.sh [--with-paseo]
#   --with-paseo  同时部署 Paseo 配置和 paseo-* skills（可选）
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOT_PI="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
DOT_AGENTS="$HOME/.agents"
DOT_PASEO="$HOME/.paseo"

WITH_PASEO=false
for arg in "$@"; do
    case "$arg" in
        --with-paseo) WITH_PASEO=true ;;
    esac
done

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[info]${NC} $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}   $*"; }
warn()  { echo -e "${RED}[warn]${NC}  $*"; }

# ---- Step 1: 检查依赖环境 ----
echo ""
echo "=========================================="
echo "  pi-config setup"
echo "=========================================="
echo ""

info "检查 Node.js..."
if ! command -v node &>/dev/null; then
    warn "Node.js 未安装。推荐用 mise 或 nvm 安装 Node 24+。"
    warn "  brew install mise && mise use node@24"
    exit 1
fi
ok "Node.js $(node --version)"

info "检查 npm..."
npm --version >/dev/null 2>&1 || { warn "npm 不可用"; exit 1; }
ok "npm $(npm --version)"

# ---- Step 2: Homebrew 依赖 ----
if command -v brew &>/dev/null; then
    info "安装 Homebrew 依赖..."
    grep -v '^#' "$SCRIPT_DIR/lists/brew.txt" | grep -v '^$' | sed 's/#.*//' | awk '{print $1}' | grep -v '^$' | while read -r pkg; do
        if brew list "$pkg" &>/dev/null; then
            ok "brew: $pkg (已安装)"
        else
            info "brew install $pkg..."
            brew install "$pkg"
        fi
    done
else
    warn "Homebrew 未安装，跳过。macOS: https://brew.sh"
fi

# ---- Step 3: pip 依赖 ----
info "安装 Python 依赖..."
grep -v '^#' "$SCRIPT_DIR/lists/pip.txt" | grep -v '^$' | sed 's/#.*//' | awk '{print $1}' | grep -v '^$' | while read -r pkg; do
    info "pip3 install $pkg..."
    pip3 install "$pkg" 2>&1 | tail -1
    ok "pip: $pkg"
done

# ---- Step 4: 全局 npm 包 ----
info "安装全局 npm 包..."
grep -v '^#' "$SCRIPT_DIR/lists/npm-global.txt" | grep -v '^$' | sed 's/#.*//' | awk '{print $1}' | grep -v '^$' | while read -r pkg; do
    info "npm install -g $pkg..."
    npm install -g "$pkg"
done
ok "npm 全局包"

# ---- Step 5: pi 扩展包 (pi install) ----
info "安装 pi 扩展包..."
PI_PACKAGES=(
    "npm:pi-subagents"
    "npm:context-mode"
    "npm:pi-mcp-adapter"
    "npm:pi-web-access"
    "npm:pi-codex-goal"
    "npm:pi-multimodal-proxy"
)
for pkg in "${PI_PACKAGES[@]}"; do
    if pi list 2>/dev/null | grep -q "$pkg"; then
        ok "pi: $pkg (已安装)"
    else
        info "pi install $pkg..."
        pi install "$pkg"
    fi
done

# ---- Step 6: 配置文件 ----
info "部署配置文件..."

# pi 配置目录
mkdir -p "$DOT_PI"

# settings.json
cp "$SCRIPT_DIR/config/pi/settings.json" "$DOT_PI/settings.json"
ok "~/.pi/agent/settings.json"

# AGENTS.md
cp "$SCRIPT_DIR/config/pi/AGENTS.md" "$DOT_PI/AGENTS.md"
ok "~/.pi/agent/AGENTS.md"

# mcp.json (公开部分)
cp "$SCRIPT_DIR/config/pi/mcp.json" "$DOT_PI/mcp.json"
ok "~/.pi/agent/mcp.json (公开服务器)"

# mcp.private.json (合并私有服务器 — 仅当存在且非 example 时才处理)
PRIVATE_MCP="$SCRIPT_DIR/config/pi/mcp.private.json"
if [ -f "$PRIVATE_MCP" ] && ! grep -q "YOUR_" "$PRIVATE_MCP" 2>/dev/null; then
    info "合并私有 MCP 服务器配置..."
    # 用 jq 或 python 合并两个 JSON
    if command -v python3 &>/dev/null; then
        python3 -c "
import json
with open('$DOT_PI/mcp.json') as f: pub = json.load(f)
with open('$PRIVATE_MCP') as f: priv = json.load(f)
if '_comment' in priv.get('mcpServers', {}): del priv['mcpServers']['_comment']
pub['mcpServers'].update(priv.get('mcpServers', {}))
with open('$DOT_PI/mcp.json', 'w') as f: json.dump(pub, f, indent=2, ensure_ascii=False)
"
        ok "私有 MCP 服务器已合并"
    else
        warn "需要 python3 合并 JSON，跳过私有 MCP 配置"
    fi
elif [ -f "$PRIVATE_MCP" ]; then
    warn "mcp.private.json 含占位符，请先填入真实值再重新运行。"
    warn "  参考: $SCRIPT_DIR/config/env.example"
fi

# Paseo 配置（可选）
if $WITH_PASEO; then
    if [ -d "$DOT_PASEO" ] || mkdir -p "$DOT_PASEO" 2>/dev/null; then
        cp "$SCRIPT_DIR/config/paseo/config.json" "$DOT_PASEO/config.json" 2>/dev/null && \
            ok "~/.paseo/config.json" || warn "Paseo 配置写入失败（Paseo 可能未安装）"
    fi
else
    info "跳过 Paseo 配置（使用 --with-paseo 启用）"
fi

# ---- Step 7: Skills ----
info "部署核心 skills..."
mkdir -p "$DOT_AGENTS/skills"
# 部署所有非 paseo 的 skills
for skill_dir in "$SCRIPT_DIR/skills"/*/; do
    skill_name="$(basename "$skill_dir")"
    case "$skill_name" in
        paseo|paseo-*) continue ;;
    esac
    cp -r "$skill_dir" "$DOT_AGENTS/skills/"
done
CORE_COUNT=$(ls "$DOT_AGENTS/skills" | grep -v "^paseo" | wc -l | tr -d ' ')
ok "~/.agents/skills/ ($CORE_COUNT 核心 skills)"

# 可选：paseo skills
if $WITH_PASEO; then
    info "部署 Paseo skills..."
    for skill_dir in "$SCRIPT_DIR/skills"/paseo*/; do
        [ -d "$skill_dir" ] && cp -r "$skill_dir" "$DOT_AGENTS/skills/"
    done
    ok "Paseo skills 已部署"
else
    info "跳过 Paseo skills（使用 --with-paseo 启用）"
fi

# ---- Step 8: 环境变量提示 ----
echo ""
echo "=========================================="
echo "  安装完成！"
echo "=========================================="
echo ""
echo "还需要手动操作："
echo ""
echo "1. 配置环境变量（复制并编辑）:"
echo "   cp $SCRIPT_DIR/config/env.example ~/.pi-agent-env"
echo "   编辑 ~/.pi-agent-env 填入真实 token"
echo "   然后在 ~/.zshrc 中加: source ~/.pi-agent-env"
echo ""
echo "2. 初始化各项目的 codegraph 索引:"
echo "   cd <project> && codegraph init"
echo ""
if $WITH_PASEO; then
echo "3. 确保 Paseo daemon 在运行（桌面端或 CLI）:"
echo "   paseo daemon status"
echo ""
echo "4. 重启 pi:"
else
echo "3. 重启 pi:"
fi
echo "   pi"
echo ""
