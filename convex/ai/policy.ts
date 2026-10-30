/** Versioned contracts and pure validation; no provider or database access. */
export const ANALYSIS_VERSION = "intake-v1";
export const EMBEDDING_DIMENSIONS = 1536;
export const MAX_KNOWLEDGE_CHUNKS = 32;
export const MAX_KNOWLEDGE_TEXT = 40_000;
export const PROMPT_VERSION = "eventpulse-intake-2026-10-29";

export function splitKnowledge(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized || normalized.length > MAX_KNOWLEDGE_TEXT) throw new Error("Document must contain 1–40,000 characters.");
  const chunks: string[] = [];
  for (let offset = 0; offset < normalized.length; offset += 1400) {
    chunks.push(normalized.slice(offset, offset + 1600));
  }
  if (chunks.length > MAX_KNOWLEDGE_CHUNKS) throw new Error("Document has too many chunks.");
  return chunks;
}

export function validateEmbedding(vector: number[]) {
  if (vector.length !== EMBEDDING_DIMENSIONS || vector.some(x => !Number.isFinite(x)) || vector.every(x => x === 0)) {
    throw new Error("Invalid embedding dimensions or values.");
  }
  return vector;
}

export function safeLimit(value: number | undefined, fallback = 20, max = 100) {
  return value !== undefined && Number.isFinite(value) ? Math.max(1, Math.min(max, Math.floor(value))) : fallback;
}

export function hasExactQuote(text: string, quote: string) {
  return quote.trim().length >= 8 && quote.length <= 1000 && text.includes(quote);
}
