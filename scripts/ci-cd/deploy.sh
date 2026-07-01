#!/bin/bash
#
# 自动部署脚本
# 在 webhook 服务中调用，执行代码更新和容器重建
#

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
PROJECT_DIR="${PROJECT_DIR:-/app}"
LOG_DIR="${LOG_DIR:-/app/logs/deploy}"
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"

# 确保日志目录存在
mkdir -p "${LOG_DIR}"

# 日志函数
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 开始部署
log_info "========================================="
log_info "开始自动部署"
log_info "项目目录: ${PROJECT_DIR}"
log_info "时间: $(date '+%Y-%m-%d %H:%M:%S')"
log_info "========================================="

# 进入项目目录
cd "${PROJECT_DIR}"

# 从 .env 读取部署配置；docker compose 也会读取同一份文件。
if [ -f "${PROJECT_DIR}/.env" ]; then
    # shellcheck disable=SC1090
    source "${PROJECT_DIR}/.env"
fi

require_env() {
    local name=$1
    local value=${!name:-}
    if [ -z "${value}" ]; then
        log_error "缺少必需生产环境变量: ${name}"
        exit 1
    fi
}

log_info "执行发布前生产配置检查..."
require_env "API_AUTH_TOKEN"
require_env "AUTH_SESSION_SECRET"
require_env "WEBHOOK_SECRET"
require_env "WECOM_CALLBACK_SECRET"

if [ "${NOTIFICATION_PROVIDER_MODE:-}" = "mock" ]; then
    log_error "生产部署禁止 NOTIFICATION_PROVIDER_MODE=mock"
    exit 1
fi

if [ -z "${SEED_ADMIN_PASSWORD_HASH:-}" ] && [ "${SEED_ADMIN_PASSWORD:-ChangeMe123!}" = "ChangeMe123!" ]; then
    log_error "生产部署必须修改 SEED_ADMIN_PASSWORD 或提供 SEED_ADMIN_PASSWORD_HASH"
    exit 1
fi

# 检查 git 仓库
if [ ! -d ".git" ]; then
    log_error "不是 git 仓库，无法执行 git pull"
    exit 1
fi

# 显示当前版本
CURRENT_COMMIT=$(git rev-parse --short HEAD)
log_info "当前版本: ${CURRENT_COMMIT}"

# 执行 git pull
log_info "拉取最新代码..."
git fetch origin
BEFORE_PULL=$(git rev-parse HEAD)
git pull --ff-only origin "${DEPLOY_BRANCH:-main}"
AFTER_PULL=$(git rev-parse HEAD)

if [ "${BEFORE_PULL}" = "${AFTER_PULL}" ]; then
    log_warn "没有新的变更，跳过构建"
    exit 0
fi

NEW_COMMIT=$(git rev-parse --short HEAD)
log_success "代码更新: ${CURRENT_COMMIT} -> ${NEW_COMMIT}"

# 显示变更的 commit
log_info "新增 commits:"
git log --oneline "${BEFORE_PULL}..${AFTER_PULL}" | head -5 | while read line; do
    echo "  ${line}"
done

log_info "执行发布门禁..."
RELEASE_CHECK_STRICT=true RELEASE_CHECK_PROFILE="${RELEASE_CHECK_PROFILE:-production}" npm run ops:release-check

# 重建并重启容器
log_info "重建 Docker 镜像..."
docker compose -f "${COMPOSE_FILE}" build --pull

log_info "重启服务..."
docker compose -f "${COMPOSE_FILE}" up -d --remove-orphans

# 等待服务启动
log_info "等待服务启动..."
sleep 5

# 健康检查
log_info "执行健康检查..."
MAX_RETRIES=30
RETRY_COUNT=0
ALL_HEALTHY=true

# 检查各服务状态
check_service_health() {
    local service=$1
    local url=$2
    local retries=0

    while [ $retries -lt $MAX_RETRIES ]; do
        if curl -sf "${url}" > /dev/null 2>&1; then
            log_success "${service} 健康"
            return 0
        fi
        retries=$((retries + 1))
        sleep 2
    done

    log_error "${service} 健康检查失败"
    return 1
}

# 从 .env 读取端口配置
if [ -f "${PROJECT_DIR}/.env" ]; then
    source "${PROJECT_DIR}/.env"
fi

API_PORT="${API_PORT:-3001}"
WEB_PORT="${WEB_PORT:-5173}"
API_PORT_NUMBER="${API_PORT##*:}"
WEB_PORT_NUMBER="${WEB_PORT##*:}"

# 健康检查各个服务
check_service_health "API" "http://127.0.0.1:${API_PORT_NUMBER}/api/v1/health" || ALL_HEALTHY=false
check_service_health "Web" "http://127.0.0.1:${WEB_PORT_NUMBER}" || ALL_HEALTHY=false

check_api_database_mode() {
    local url=$1
    local body
    body=$(curl -sf "${url}") || return 1
    node -e "const h = JSON.parse(process.argv[1]); if (!h.databaseMode) process.exit(2); if (h.runtime && h.runtime.productionConfigReady === false) process.exit(3);" "${body}"
}

if check_api_database_mode "http://127.0.0.1:${API_PORT_NUMBER}/api/v1/health"; then
    log_success "API 使用 PostgreSQL database mode，生产配置摘要正常"
else
    log_error "API 未运行在 PostgreSQL database mode，或生产配置摘要异常"
    ALL_HEALTHY=false
fi

if PRODUCTION_BASE_URL="${PRODUCTION_BASE_URL:-http://127.0.0.1:${API_PORT_NUMBER}}" API_AUTH_TOKEN="${API_AUTH_TOKEN}" SMOKE_REQUIRE_HERMES="${SMOKE_REQUIRE_HERMES:-true}" npm run ops:production-smoke; then
    log_success "生产只读 smoke 通过"
else
    log_error "生产只读 smoke 失败"
    ALL_HEALTHY=false
fi

# 部署完成
log_info "========================================="
if [ "${ALL_HEALTHY}" = true ]; then
    log_success "部署成功完成!"
    log_success "新版本: ${NEW_COMMIT}"
    log_info "========================================="
    exit 0
else
    log_error "部署完成，但部分服务健康检查失败"
    log_error "请检查: docker compose -f ${COMPOSE_FILE} logs"
    log_info "========================================="
    exit 1
fi
