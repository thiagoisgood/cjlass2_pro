/**
 * 部署条件判断模块
 * 根据 commit message 决定是否触发部署
 */

/**
 * 判断是否应该部署
 * @param {Object} commitInfo - commit 信息
 * @param {string} commitInfo.message - commit message
 * @param {string} commitInfo.branch - 分支名
 * @param {string[]} commitInfo.modified - 修改的文件列表
 * @returns {{deploy: boolean, reason: string}}
 */
export function shouldDeploy(commitInfo) {
  const { message, branch } = commitInfo;
  const subject = firstNonEmptyLine(message);
  const tag = subject.match(/^\[([a-z-]+)\]\s*/i)?.[1]?.toLowerCase() ?? '';

  // 规则 1: [deploy] 标记 - 强制部署
  if (tag === 'deploy') {
    return {
      deploy: true,
      reason: '[deploy] 强制部署',
    };
  }

  // 规则 2: [skip-deploy] 标记 - 跳过部署
  if (tag === 'skip-deploy') {
    return {
      deploy: false,
      reason: '[skip-deploy] 跳过部署',
    };
  }

  // 规则 3: [docs] 标记 - 仅文档更新，跳过部署
  if (tag === 'docs') {
    return {
      deploy: false,
      reason: '[docs] 仅文档更新，跳过部署',
    };
  }

  // 规则 4: main 分支 push 默认部署
  if (branch === 'main') {
    return {
      deploy: true,
      reason: 'main 分支 push 默认部署',
    };
  }

  return {
    deploy: false,
    reason: `非 main 分支 (${branch})，跳过部署`,
  };
}

function firstNonEmptyLine(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || '';
}
