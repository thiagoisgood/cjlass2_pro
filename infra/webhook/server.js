/**
 * GitHub Webhook 服务
 * 接收 push 事件并触发自动部署
 */

import express from 'express';
import crypto from 'crypto';
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendNotification } from './notify.js';
import { shouldDeploy } from './conditions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 9000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const PROJECT_DIR = process.env.PROJECT_DIR || '/app';
const LOG_DIR = process.env.LOG_DIR || '/app/logs/deploy';

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * 验证 GitHub Webhook 签名
 */
function verifySignature(payload, signature) {
  if (!WEBHOOK_SECRET) {
    console.warn('⚠️ WEBHOOK_SECRET 未设置，跳过签名验证');
    return true;
  }

  if (!signature) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
}

/**
 * 记录部署日志
 */
function logDeploy(entry) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(LOG_DIR, `deploy-${timestamp}.json`);
  fs.writeFileSync(logFile, JSON.stringify(entry, null, 2));
  console.log(`📝 日志已保存: ${logFile}`);
}

/**
 * 执行部署
 */
async function executeDeploy(commitInfo) {
  const startTime = Date.now();
  const logEntry = {
    timestamp: new Date().toISOString(),
    commit: commitInfo,
    status: 'pending',
    duration: null,
    error: null,
  };

  console.log(`🚀 开始部署: ${commitInfo.message}`);

  try {
    // 执行部署脚本
    const deployScript = path.join(PROJECT_DIR, 'scripts/ci-cd/deploy.sh');

    const result = execSync(`bash ${deployScript}`, {
      cwd: PROJECT_DIR,
      encoding: 'utf-8',
      timeout: 300000, // 5分钟超时
    });

    logEntry.status = 'success';
    logEntry.output = result;
    logEntry.duration = Date.now() - startTime;

    console.log(`✅ 部署成功，耗时: ${logEntry.duration}ms`);

    // 发送成功通知
    await sendNotification({
      status: 'success',
      commit: commitInfo,
      duration: logEntry.duration,
    });

  } catch (error) {
    logEntry.status = 'failed';
    logEntry.error = error.message;
    logEntry.duration = Date.now() - startTime;

    console.error(`❌ 部署失败: ${error.message}`);

    // 发送失败通知
    await sendNotification({
      status: 'failed',
      commit: commitInfo,
      error: error.message,
      duration: logEntry.duration,
    });
  }

  // 保存日志
  logDeploy(logEntry);

  return logEntry;
}

/**
 * Webhook 端点
 */
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const payload = req.body;

  // 验证签名
  if (!verifySignature(payload, signature)) {
    console.warn('❌ 签名验证失败');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // 解析 payload
  let data;
  try {
    data = JSON.parse(payload.toString());
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // 只处理 push 事件
  if (req.headers['x-github-event'] !== 'push') {
    return res.json({ message: 'Ignored non-push event' });
  }

  // 提取信息
  const ref = data.ref;
  const branch = ref?.replace('refs/heads/', '');
  const commits = data.commits || [];

  if (commits.length === 0) {
    return res.json({ message: 'No commits in payload' });
  }

  // 获取最新的 commit
  const latestCommit = commits[commits.length - 1];
  const commitInfo = {
    hash: latestCommit.id?.substring(0, 7) || 'unknown',
    message: latestCommit.message || '',
    author: latestCommit.author?.name || 'unknown',
    branch: branch || 'unknown',
    timestamp: latestCommit.timestamp || new Date().toISOString(),
    url: latestCommit.url || '',
    modified: latestCommit.modified || [],
    added: latestCommit.added || [],
    removed: latestCommit.removed || [],
  };

  console.log(`📥 收到 push: ${commitInfo.branch} - ${commitInfo.hash} - ${commitInfo.message}`);

  // 判断是否需要部署
  const decision = shouldDeploy(commitInfo);

  if (!decision.deploy) {
    console.log(`⏭️ 跳过部署: ${decision.reason}`);
    return res.json({
      deployed: false,
      reason: decision.reason,
    });
  }

  console.log(`✅ 触发部署: ${decision.reason}`);

  // 异步执行部署，立即返回响应
  res.json({
    deployed: true,
    reason: decision.reason,
    commit: commitInfo.hash,
  });

  // 执行部署
  await executeDeploy(commitInfo);
});

/**
 * 健康检查端点
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * 启动服务
 */
app.listen(PORT, () => {
  console.log(`🚀 Webhook 服务启动: http://0.0.0.0:${PORT}`);
  console.log(`📂 项目目录: ${PROJECT_DIR}`);
  console.log(`📝 日志目录: ${LOG_DIR}`);
  if (!WEBHOOK_SECRET) {
    console.warn('⚠️ 警告: WEBHOOK_SECRET 未设置，签名验证已禁用');
  }
});
