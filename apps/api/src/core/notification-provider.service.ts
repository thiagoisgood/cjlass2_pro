import { Injectable } from "@nestjs/common";

export interface NotificationProviderRequest {
  channel: string;
  recipient: string;
  title: string;
  content: string;
  deliveryId: string;
}

export interface NotificationProviderResult {
  ok: boolean;
  providerMessageId?: string;
  errorMessage?: string;
}

@Injectable()
export class NotificationProviderService {
  async send(request: NotificationProviderRequest): Promise<NotificationProviderResult> {
    if (request.channel === "站内") {
      return { ok: true, providerMessageId: `internal-${request.deliveryId}` };
    }
    if (process.env.NOTIFICATION_PROVIDER_MODE === "mock") {
      return { ok: true, providerMessageId: `mock-${request.deliveryId}` };
    }
    const webhookUrl = webhookUrlForChannel(request.channel);
    if (!webhookUrl) {
      return { ok: false, errorMessage: `${request.channel}未配置可发送 webhook` };
    }
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipient: request.recipient,
          title: request.title,
          content: request.content,
          deliveryId: request.deliveryId,
        }),
      });
      if (!response.ok) {
        return { ok: false, errorMessage: `${request.channel} provider returned HTTP ${response.status}` };
      }
      return { ok: true, providerMessageId: response.headers.get("x-provider-message-id") ?? `${request.channel}-${request.deliveryId}` };
    } catch (error) {
      return { ok: false, errorMessage: error instanceof Error ? error.message : "provider request failed" };
    }
  }
}

function webhookUrlForChannel(channel: string): string | undefined {
  if (/企业微信|企微/.test(channel)) {
    return process.env.WECOM_WEBHOOK_URL;
  }
  if (/微信/.test(channel)) {
    return process.env.WECHAT_WEBHOOK_URL;
  }
  if (/飞书/.test(channel)) {
    return process.env.FEISHU_WEBHOOK_URL;
  }
  if (/钉钉/.test(channel)) {
    return process.env.DINGTALK_WEBHOOK_URL;
  }
  return process.env.NOTIFICATION_WEBHOOK_URL;
}
