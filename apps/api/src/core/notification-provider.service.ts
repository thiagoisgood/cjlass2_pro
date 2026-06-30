import { createHmac } from "node:crypto";
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
    const target = notificationProviderTargetForChannel(request.channel);
    if (!target.webhookUrl) {
      return { ok: false, errorMessage: `${request.channel}未配置可发送 webhook` };
    }
    try {
      const response = await fetch(target.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payloadForTarget(target, request)),
      });
      const responseText = await response.text();
      if (!response.ok) {
        return { ok: false, errorMessage: `${request.channel} provider returned HTTP ${response.status}${responseText ? `: ${responseText}` : ""}` };
      }
      const providerError = providerErrorFromBody(target.kind, responseText);
      if (providerError) {
        return { ok: false, errorMessage: `${request.channel} provider rejected: ${providerError}` };
      }
      return {
        ok: true,
        providerMessageId: response.headers.get("x-provider-message-id") ?? providerMessageIdFromBody(responseText) ?? `${request.channel}-${request.deliveryId}`,
      };
    } catch (error) {
      return { ok: false, errorMessage: error instanceof Error ? error.message : "provider request failed" };
    }
  }
}

type NotificationProviderKind = "feishu" | "generic";

interface NotificationProviderTarget {
  kind: NotificationProviderKind;
  webhookUrl?: string;
  secret?: string;
}

export function isNotificationChannelConfigured(channel: string): boolean {
  return Boolean(notificationProviderTargetForChannel(channel).webhookUrl);
}

function notificationProviderTargetForChannel(channel: string): NotificationProviderTarget {
  if (/企业微信|企微/.test(channel)) {
    return { kind: "generic", webhookUrl: process.env.WECOM_WEBHOOK_URL };
  }
  if (/微信/.test(channel)) {
    return { kind: "generic", webhookUrl: process.env.WECHAT_WEBHOOK_URL };
  }
  if (/飞书/.test(channel)) {
    return {
      kind: "feishu",
      webhookUrl: process.env.FEISHU_WEBHOOK_URL || process.env.NOTIFICATION_WEBHOOK_URL,
      secret: process.env.FEISHU_WEBHOOK_SECRET,
    };
  }
  if (/钉钉/.test(channel)) {
    return { kind: "generic", webhookUrl: process.env.DINGTALK_WEBHOOK_URL };
  }
  return { kind: "generic", webhookUrl: process.env.NOTIFICATION_WEBHOOK_URL };
}

function payloadForTarget(target: NotificationProviderTarget, request: NotificationProviderRequest): Record<string, unknown> {
  if (target.kind === "feishu") {
    return feishuTextPayload(request, target.secret);
  }
  return {
    recipient: request.recipient,
    title: request.title,
    content: request.content,
    deliveryId: request.deliveryId,
  };
}

function feishuTextPayload(request: NotificationProviderRequest, secret?: string): Record<string, unknown> {
  const text = [
    request.title,
    request.content,
    request.recipient ? `接收人：${request.recipient}` : "",
    `投递ID：${request.deliveryId}`,
  ].filter(Boolean).join("\n");
  const payload: Record<string, unknown> = {
    msg_type: "text",
    content: { text },
  };
  if (secret) {
    Object.assign(payload, feishuSignature(secret));
  }
  return payload;
}

function feishuSignature(secret: string): { timestamp: string; sign: string } {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const stringToSign = `${timestamp}\n${secret}`;
  return {
    timestamp,
    sign: createHmac("sha256", stringToSign).update("").digest("base64"),
  };
}

function providerErrorFromBody(kind: NotificationProviderKind, bodyText: string): string | undefined {
  if (kind !== "feishu") {
    return undefined;
  }
  const body = parseJsonObject(bodyText);
  if (!body) {
    return undefined;
  }
  const code = body.code ?? body.StatusCode;
  if (code == null || String(code) === "0") {
    return undefined;
  }
  return [String(code), stringValue(body.msg ?? body.message ?? body.StatusMessage)].filter(Boolean).join(" ");
}

function providerMessageIdFromBody(bodyText: string): string | undefined {
  const body = parseJsonObject(bodyText);
  if (!body) {
    return undefined;
  }
  const data = isRecord(body.data) ? body.data : undefined;
  return stringValue(body.message_id ?? body.MessageId ?? data?.message_id ?? data?.MessageId);
}

function parseJsonObject(bodyText: string): Record<string, unknown> | undefined {
  if (!bodyText.trim()) {
    return undefined;
  }
  try {
    const body: unknown = JSON.parse(bodyText);
    return isRecord(body) ? body : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}
