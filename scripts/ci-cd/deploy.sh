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

API_PORT="${API_PORT:-3011}"
WEB_PORT="${WEB_PORT:-5183}"

# 健康检查各个服务
check_service_health "API" "http://localhost:${API_PORT}/api/v1/health" || ALL_HEALTHY=false
check_service_health "Web" "http://localhost:${WEB_PORT}" || ALL_HEALTHY=false

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
