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
  const { message, branch, modified } = commitInfo;
  const msgLower = message.toLowerCase();

  // 规则 1: 只部署 main 分支
  if (branch !== 'main' && branch !== 'master') {
    return {
      deploy: false,
      reason: `非主分支 (${branch})，跳过部署`,
    };
  }

  // 规则 2: [skip-deploy] 标记 - 跳过部署
  if (msgLower.includes('[skip-deploy]') || msgLower.includes('[no-deploy]')) {
    return {
      deploy: false,
      reason: 'Commit 包含 [skip-deploy] 标记',
    };
  }

  // 规则 3: [docs] 标记 - 仅文档更新，跳过部署
  if (msgLower.startsWith('[docs]') || msgLower.startsWith('docs:')) {
    return {
      deploy: false,
      reason: '仅文档更新',
    };
  }

  // 规则 4: [deploy] 标记 - 强制部署
  if (msgLower.includes('[deploy]') || msgLower.includes('[ci]')) {
    return {
      deploy: true,
      reason: 'Commit 包含强制部署标记',
    };
  }

  // 规则 5: 检查是否只有文档/配置文件变更
  const nonDocFiles = (modified || []).filter(file => {
    const docPatterns = [
      /\.md$/i,
      /\.txt$/i,
      /^docs\//i,
      /^README/i,
      /^CHANGELOG/i,
      /^\.gitignore$/,
      /^LICENSE$/,
    ];
    return !docPatterns.some(pattern => pattern.test(file));
  });

  if (nonDocFiles.length === 0 && modified && modified.length > 0) {
    return {
      deploy: false,
      reason: '仅文档/配置文件变更',
    };
  }

  // 默认: 部署
  return {
    deploy: true,
    reason: '默认部署策略: main 分支代码变更',
  };
}
