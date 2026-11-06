#!/usr/bin/env bash
# ============================================================
# pi-config setup — 在新机器上复刻 pi agent 环境
#
#   bash setup.sh            部署缺失项；已存在的文件一律跳过
#   bash setup.sh --force    覆盖 ~/.pi/agent 下的配置(会盖掉本机改动)
#   bash setup.sh --dry-run  只打印将要执行的动作，不落盘
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOT_PI="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
DOT_AGENTS="$HOME/.agents"

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[0;33m'; NC='\033[0m'
info()  { echo -e "${CYAN}[info]${NC} $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}   $*"; }
warn()  { echo -e "${YELLOW}[skip]${NC} $*"; }
fail()  { echo -e "${RED}[fail]${NC} $*"; }

FORCE=0
DRY_RUN=0
for arg in "$@"; do
    case "$arg" in
        --force|-f)   FORCE=1 ;;
        --dry-run|-n) DRY_RUN=1 ;;
        -h|--help)    sed -n '2,10p' "$0"; exit 0 ;;
        *)            fail "unknown option: $arg"; exit 2 ;;
    esac
done

run() {
    if [ "$DRY_RUN" = 1 ]; then
        info "[dry-run] $*"
    else
        "$@"
    fi
}

# deploy <src> <dst> <label>
# Copies only when the destination is missing, unless --force.
deploy() {
    local src="$1" dst="$2" label="${3:-$2}"
    if [ -e "$dst" ] && [ "$FORCE" != 1 ]; then
        warn "$label (exists, left untouched)"
        return 0
    fi
    run mkdir -p "$(dirname "$dst")"
    run cp -R "$src" "$dst"
    ok "$label"
}

echo ""
echo "=========================================="
echo "  pi-config setup"
[ "$FORCE" = 1 ]   && echo "  mode: --force (overwrite configs)"
[ "$DRY_RUN" = 1 ] && echo "  mode: --dry-run"
echo "=========================================="
echo ""

# ---- Step 1: 依赖检查 ----
info "检查依赖..."
if ! command -v node &>/dev/null; then
    fail "Node.js 未安装。推荐 mise: brew install mise && mise use -g node@latest"
    exit 1
fi
ok "Node.js $(node --version)"

# ---- Step 2: Homebrew ----
if command -v brew &>/dev/null; then
    info "Homebrew 依赖..."
    while read -r pkg; do
        [ -z "$pkg" ] && continue
        if brew list "$pkg" &>/dev/null; then
            ok "brew: $pkg"
        else
            info "brew install $pkg"
            run brew install "$pkg" || warn "brew $pkg 安装失败，继续"
        fi
    done < <(grep -v '^#' "$SCRIPT_DIR/lists/brew.txt" | sed 's/#.*//' | awk 'NF{print $1}')
else
    warn "Homebrew 未安装，跳过。macOS: https://brew.sh"
fi

# ---- Step 3: mise 全局工具 ----
if command -v mise &>/dev/null; then
    info "mise 全局工具..."
    while read -r pkg ver; do
        [ -z "$pkg" ] && continue
        if mise ls "npm:$pkg" 2>/dev/null | grep -q "$pkg"; then
            ok "mise: $pkg"
        else
            info "mise use -g npm:$pkg@$ver"
            run mise use -g "npm:$pkg@$ver" || warn "mise $pkg 安装失败，继续"
        fi
    done < <(grep -v '^#' "$SCRIPT_DIR/lists/mise-tools.txt" | awk 'NF==2{print $1, $2}')
else
    warn "mise 未安装，跳过。brew install mise"
fi

# ---- Step 3b: Python 依赖 ----
if command -v pip3 &>/dev/null; then
    info "Python 依赖..."
    while read -r pkg; do
        [ -z "$pkg" ] && continue
        if pip3 show "$pkg" &>/dev/null; then
            ok "pip: $pkg"
        else
            info "pip3 install $pkg"
            run pip3 install --quiet "$pkg" || warn "pip $pkg 安装失败，继续"
        fi
    done < <(grep -v '^#' "$SCRIPT_DIR/lists/pip.txt" | sed 's/#.*//' | awk 'NF{print $1}')
else
    warn "pip3 未安装，跳过 Python 依赖"
fi

# ---- Step 4: pi 扩展包 ----
info "pi 扩展包..."
if command -v pi &>/dev/null; then
    if command -v python3 &>/dev/null; then
        while read -r pkg; do
            [ -z "$pkg" ] && continue
            if pi list 2>/dev/null | grep -qF "$pkg"; then
                ok "pi: $pkg"
            else
                info "pi install $pkg"
                run pi install "$pkg" || warn "pi install $pkg 失败，继续"
            fi
        done < <(python3 -c "import json,sys;print('\n'.join(json.load(open('$SCRIPT_DIR/config/pi/settings.json'))['packages']))")
    else
        warn "python3 不可用，无法读取 packages 列表"
    fi
else
    warn "pi 未安装，跳过。见 README「手动安装」"
fi

# ---- Step 5: 配置文件 ----
info "配置文件..."
if [ -e "$DOT_PI/settings.json" ] && [ "$FORCE" != 1 ]; then
    MCP_LOCKED=1
else
    MCP_LOCKED=0
fi

deploy "$SCRIPT_DIR/config/pi/settings.json" "$DOT_PI/settings.json" "~/.pi/agent/settings.json"
deploy "$SCRIPT_DIR/config/pi/AGENTS.md"     "$DOT_PI/AGENTS.md"     "~/.pi/agent/AGENTS.md"
deploy "$SCRIPT_DIR/config/pi/mcp.json"      "$DOT_PI/mcp.json"      "~/.pi/agent/mcp.json (public servers)"
deploy "$SCRIPT_DIR/config/pi/i-have-adhd-always" "$DOT_PI/.i-have-adhd-always" "~/.pi/agent/.i-have-adhd-always"

# 私有 MCP: 合并进 mcp.json，只在 mcp.json 被写入时才做
PRIVATE_MCP="$SCRIPT_DIR/config/pi/mcp.private.json"
if [ -f "$PRIVATE_MCP" ] && ! grep -q "YOUR_" "$PRIVATE_MCP"; then
    if [ "$MCP_LOCKED" = 1 ]; then
        warn "mcp.private.json 未合并 (mcp.json 已存在，用 --force 覆盖)"
    elif command -v python3 &>/dev/null; then
        info "合并私有 MCP 服务器..."
        run python3 - "$DOT_PI/mcp.json" "$PRIVATE_MCP" <<'PY'
import json, sys
pub_path, priv_path = sys.argv[1], sys.argv[2]
pub = json.load(open(pub_path))
priv = json.load(open(priv_path))
priv_servers = {k: v for k, v in priv.get("mcpServers", {}).items() if not k.startswith("_")}
pub["mcpServers"].update(priv_servers)
with open(pub_path, "w") as f:
    json.dump(pub, f, indent=2, ensure_ascii=False)
    f.write("\n")
PY
        ok "私有 MCP 已合并"
    else
        warn "需要 python3 合并 JSON，跳过私有 MCP"
    fi
elif [ -f "$PRIVATE_MCP" ]; then
    warn "mcp.private.json 含占位符 YOUR_*，先填真实值"
fi

# ---- Step 6: 扩展 (extensions) ----
info "extensions..."
for ext in "$SCRIPT_DIR"/config/pi/extensions/*.ts; do
    [ -e "$ext" ] || continue
    deploy "$ext" "$DOT_PI/extensions/$(basename "$ext")" "~/.pi/agent/extensions/$(basename "$ext")"
done

# ---- Step 7: Skills ----
info "skills..."
for skill_dir in "$SCRIPT_DIR"/skills/*/; do
    name="$(basename "$skill_dir")"
    deploy "$skill_dir" "$DOT_AGENTS/skills/$name" "~/.agents/skills/$name"
done
if [ "$DRY_RUN" != 1 ]; then
    ok "~/.agents/skills/ ($(ls "$DOT_AGENTS/skills" 2>/dev/null | wc -l | tr -d ' ') skills)"
fi

# ---- Step 8: 收尾提示 ----
echo ""
echo "=========================================="
echo "  完成"
echo "=========================================="
echo ""
echo "仍需手动:"
echo "1. 私有 MCP/密钥: cp config/pi/mcp.private.example.json config/pi/mcp.private.json  # 填值后重跑"
echo "2. codegraph 索引: cd <project> && codegraph init"
echo "3. 重启 pi: pi"
echo ""
