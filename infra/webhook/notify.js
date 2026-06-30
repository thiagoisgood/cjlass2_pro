/**
 * 通知模块
 * 支持飞书、钉钉、Slack 通知
 */

/**
 * 发送部署通知
 * @param {Object} params - 通知参数
 * @param {string} params.status - 状态: 'success' | 'failed'
 * @param {Object} params.commit - commit 信息
 * @param {number} params.duration - 部署耗时(ms)
 * @param {string} params.error - 错误信息(失败时)
 */
export async function sendNotification(params) {
  const provider = process.env.NOTIFICATION_PROVIDER;
  const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;

  if (!provider || !webhookUrl) {
    console.log('📭 通知未配置，跳过发送');
    return;
  }

  try {
    switch (provider.toLowerCase()) {
      case 'feishu':
      case 'lark':
        await sendFeishu(webhookUrl, params);
        break;
      case 'dingtalk':
        await sendDingTalk(webhookUrl, params);
        break;
      case 'slack':
        await sendSlack(webhookUrl, params);
        break;
      default:
        console.warn(`⚠️ 未知的通知渠道: ${provider}`);
    }
  } catch (error) {
    console.error('❌ 发送通知失败:', error.message);
  }
}

/**
 * 飞书通知
 */
async function sendFeishu(webhookUrl, params) {
  const { status, commit, duration, error } = params;
  const emoji = status === 'success' ? '✅' : '❌';
  const statusText = status === 'success' ? '部署成功' : '部署失败';
  const durationStr = duration ? `${(duration / 1000).toFixed(1)}s` : '-';

  const content = [
    `${emoji} **${statusText}**`,
    '',
    `**项目**: cjlass2_pro`,
    `**分支**: ${commit.branch}`,
    `**Commit**: ${commit.hash}`,
    `**信息**: ${commit.message}`,
    `**作者**: ${commit.author}`,
    `**耗时**: ${durationStr}`,
    `**时间**: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
  ];

  if (error) {
    content.push(`**错误**: ${error}`);
  }

  if (commit.url) {
    content.push(`**详情**: [查看 Commit](${commit.url})`);
  }

  const payload = {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: `${emoji} cjlass2_pro ${statusText}` },
        template: status === 'success' ? 'green' : 'red',
      },
      elements: [
        {
          tag: 'markdown',
          content: content.join('\n'),
        },
      ],
    },
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`飞书通知发送失败: ${response.status}`);
  }

  console.log('✅ 飞书通知已发送');
}

/**
 * 钉钉通知
 */
async function sendDingTalk(webhookUrl, params) {
  const { status, commit, duration, error } = params;
  const emoji = status === 'success' ? '✅' : '❌';
  const statusText = status === 'success' ? '部署成功' : '部署失败';
  const durationStr = duration ? `${(duration / 1000).toFixed(1)}s` : '-';

  const content = [
    `## ${emoji} cjlass2_pro ${statusText}`,
    '',
    `- **分支**: ${commit.branch}`,
    `- **Commit**: ${commit.hash}`,
    `- **信息**: ${commit.message}`,
    `- **作者**: ${commit.author}`,
    `- **耗时**: ${durationStr}`,
    `- **时间**: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
  ];

  if (error) {
    content.push(`- **错误**: ${error}`);
  }

  if (commit.url) {
    content.push(`- **详情**: [查看 Commit](${commit.url})`);
  }

  const payload = {
    msgtype: 'markdown',
    markdown: {
      title: `cjlass2_pro ${statusText}`,
      text: content.join('\n'),
    },
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`钉钉通知发送失败: ${response.status}`);
  }

  console.log('✅ 钉钉通知已发送');
}

/**
 * Slack 通知
 */
async function sendSlack(webhookUrl, params) {
  const { status, commit, duration, error } = params;
  const emoji = status === 'success' ? ':white_check_mark:' : ':x:';
  const statusText = status === 'success' ? '部署成功' : '部署失败';
  const durationStr = duration ? `${(duration / 1000).toFixed(1)}s` : '-';
  const color = status === 'success' ? '#36a64f' : '#dc3545';

  const fields = [
    { type: 'mrkdwn', text: `*分支*\n${commit.branch}` },
    { type: 'mrkdwn', text: `*Commit*\n${commit.hash}` },
    { type: 'mrkdwn', text: `*信息*\n${commit.message}` },
    { type: 'mrkdwn', text: `*作者*\n${commit.author}` },
    { type: 'mrkdwn', text: `*耗时*\n${durationStr}` },
  ];

  if (error) {
    fields.push({ type: 'mrkdwn', text: `*错误*\n${error}` });
  }

  const payload = {
    attachments: [
      {
        color,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `${emoji} cjlass2_pro ${statusText}`,
            },
          },
          {
            type: 'section',
            fields,
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
              },
            ],
          },
        ],
      },
    ],
  };

  if (commit.url) {
    payload.attachments[0].blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '查看 Commit' },
          url: commit.url,
        },
      ],
    });
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Slack 通知发送失败: ${response.status}`);
  }

  console.log('✅ Slack 通知已发送');
}
