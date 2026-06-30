import { createHash } from "node:crypto";

export interface EmbeddingResult {
  embedding: number[];
  provider: string;
  model: string;
  dimension: number;
}

export class EmbeddingProvider {
  private readonly provider = (process.env.EMBEDDING_PROVIDER || "local").toLowerCase();
  private readonly model = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
  private readonly dimension = normalizeDimension(process.env.EMBEDDING_DIMENSION, 1536);
  private readonly baseUrl = trimTrailingSlash(process.env.EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1");
  private readonly apiKey = process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || "";

  async embed(text: string): Promise<EmbeddingResult> {
    const [result] = await this.embedBatch([text]);
    return result;
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const normalized = texts.map((text) => text.trim());
    if (this.shouldUseRemoteProvider()) {
      return this.embedRemote(normalized);
    }
    return normalized.map((text) => {
      const embedding = localHashEmbedding(text, this.dimension);
      return {
        embedding,
        provider: "local-hash",
        model: `local-hash-${this.dimension}`,
        dimension: embedding.length,
      };
    });
  }

  private shouldUseRemoteProvider(): boolean {
    return this.provider !== "local" && Boolean(this.apiKey);
  }

  private async embedRemote(texts: string[]): Promise<EmbeddingResult[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Embedding provider request failed: ${response.status} ${text}`);
    }
    const payload = await response.json() as { data?: Array<{ embedding?: number[]; index?: number }>; model?: string };
    const data = [...(payload.data ?? [])].sort((left, right) => Number(left.index ?? 0) - Number(right.index ?? 0));
    if (data.length !== texts.length || data.some((item) => !Array.isArray(item.embedding))) {
      throw new Error("Embedding provider returned an invalid embedding payload");
    }
    return data.map((item) => ({
      embedding: normalizeVector(item.embedding ?? []),
      provider: this.provider,
      model: payload.model || this.model,
      dimension: item.embedding?.length ?? 0,
    }));
  }
}

export function cosineSimilarity(left: number[] | undefined, right: number[] | undefined): number {
  if (!left?.length || !right?.length || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (!leftNorm || !rightNorm) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function localHashEmbedding(text: string, dimension: number): number[] {
  const vector = new Array(dimension).fill(0) as number[];
  const tokens = tokenize(text);
  for (const token of tokens.length ? tokens : [text]) {
    const digest = createHash("sha256").update(token).digest();
    const index = digest.readUInt32BE(0) % dimension;
    const sign = digest[4] % 2 === 0 ? 1 : -1;
    const weight = 1 + (digest[5] / 255);
    vector[index] += sign * weight;
  }
  return normalizeVector(vector);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) {
    return vector.map(() => 0);
  }
  return vector.map((value) => Number((value / norm).toFixed(8)));
}

function normalizeDimension(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
