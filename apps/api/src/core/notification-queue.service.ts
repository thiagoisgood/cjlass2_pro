import { Injectable, OnModuleDestroy } from "@nestjs/common";

export interface NotificationQueueJob {
  id: string;
  tenantId: string;
  notificationId: string;
  deliveryId: string;
  channel: string;
  recipient: string;
  action: "send" | "retry" | "scheduled_send";
  runAt?: string;
  attempt: number;
  createdAt: string;
}

interface RedisLikeClient {
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  xAdd(key: string, id: string, message: Record<string, string>): Promise<string>;
  xDel(key: string, id: string | string[]): Promise<number>;
  xRange(key: string, start: string, end: string, options?: { COUNT?: number }): Promise<Array<{ id: string; message: Record<string, string> }>>;
  isOpen?: boolean;
}

@Injectable()
export class NotificationQueueService implements OnModuleDestroy {
  private static readonly streamName = "cjlass2:notification_jobs";
  private readonly memoryJobs: NotificationQueueJob[] = [];
  private redisClient: RedisLikeClient | null = null;
  private redisUnavailable = false;

  async enqueue(job: NotificationQueueJob): Promise<{ backend: "redis" | "memory"; queued: boolean }> {
    if (!process.env.REDIS_URL || this.redisUnavailable) {
      this.memoryJobs.push(job);
      return { backend: "memory", queued: true };
    }
    try {
      const client = await this.getRedisClient();
      await client.xAdd(NotificationQueueService.streamName, "*", serializeJob(job));
      return { backend: "redis", queued: true };
    } catch {
      this.redisUnavailable = true;
      this.memoryJobs.push(job);
      return { backend: "memory", queued: true };
    }
  }

  getMemoryJobs(): NotificationQueueJob[] {
    return structuredClone(this.memoryJobs);
  }

  async claimDueJobs(limit: number, now = new Date()): Promise<NotificationQueueJob[]> {
    const claimed = this.claimDueMemoryJobs(limit, now);
    if (claimed.length >= limit || !process.env.REDIS_URL || this.redisUnavailable) {
      return claimed;
    }

    try {
      const client = await this.getRedisClient();
      const redisLimit = Math.max((limit - claimed.length) * 10, limit);
      const entries = await client.xRange(NotificationQueueService.streamName, "-", "+", { COUNT: redisLimit });
      for (const entry of entries) {
        if (claimed.length >= limit) {
          break;
        }
        const job = deserializeJob(entry.message);
        if (!job || !isDue(job, now)) {
          continue;
        }
        await client.xDel(NotificationQueueService.streamName, entry.id);
        claimed.push(job);
      }
    } catch {
      this.redisUnavailable = true;
    }
    return structuredClone(claimed);
  }

  claimDueMemoryJobs(limit: number, now = new Date()): NotificationQueueJob[] {
    const claimed: NotificationQueueJob[] = [];
    for (let index = 0; index < this.memoryJobs.length && claimed.length < limit;) {
      const job = this.memoryJobs[index];
      if (isDue(job, now)) {
        claimed.push(job);
        this.memoryJobs.splice(index, 1);
      } else {
        index += 1;
      }
    }
    return structuredClone(claimed);
  }

  requeueMemoryJob(job: NotificationQueueJob): void {
    this.memoryJobs.push(structuredClone(job));
  }

  async requeue(job: NotificationQueueJob): Promise<void> {
    await this.enqueue(job);
  }

  status() {
    return {
      backend: process.env.REDIS_URL && !this.redisUnavailable ? "redis" : "memory",
      redisConfigured: Boolean(process.env.REDIS_URL),
      redisUnavailable: this.redisUnavailable,
      memoryDepth: this.memoryJobs.length,
      stream: NotificationQueueService.streamName,
    };
  }

  async onModuleDestroy() {
    if (this.redisClient?.isOpen) {
      await this.redisClient.quit();
    }
  }

  private async getRedisClient(): Promise<RedisLikeClient> {
    if (this.redisClient?.isOpen) {
      return this.redisClient;
    }
    const { createClient } = await import("redis");
    this.redisClient = createClient({ url: process.env.REDIS_URL }) as RedisLikeClient;
    await this.redisClient.connect();
    return this.redisClient;
  }
}

function isDue(job: NotificationQueueJob, now: Date): boolean {
  if (!job.runAt) {
    return true;
  }
  const runAt = Date.parse(job.runAt.replace(/\//g, "-"));
  return Number.isNaN(runAt) || runAt <= now.getTime();
}

function serializeJob(job: NotificationQueueJob): Record<string, string> {
  return {
    id: job.id,
    tenantId: job.tenantId,
    notificationId: job.notificationId,
    deliveryId: job.deliveryId,
    channel: job.channel,
    recipient: job.recipient,
    action: job.action,
    runAt: job.runAt ?? "",
    attempt: String(job.attempt),
    createdAt: job.createdAt,
  };
}

function deserializeJob(message: Record<string, string>): NotificationQueueJob | null {
  const action = message.action;
  if (action !== "send" && action !== "retry" && action !== "scheduled_send") {
    return null;
  }
  if (!message.id || !message.tenantId || !message.notificationId || !message.deliveryId) {
    return null;
  }
  return {
    id: String(message.id),
    tenantId: String(message.tenantId),
    notificationId: String(message.notificationId),
    deliveryId: String(message.deliveryId),
    channel: String(message.channel ?? ""),
    recipient: String(message.recipient ?? ""),
    action,
    runAt: message.runAt ? String(message.runAt) : undefined,
    attempt: Number(message.attempt || 1),
    createdAt: String(message.createdAt ?? ""),
  };
}
