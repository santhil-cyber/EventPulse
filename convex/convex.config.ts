import { defineApp } from "convex/server";
import { v } from "convex/values";
import workpool from "@convex-dev/workpool/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";

const app = defineApp({ env: {
  OPENAI_API_KEY: v.optional(v.string()),
  OPENAI_BASE_URL: v.optional(v.string()),
  OPENAI_API_MODE: v.optional(v.union(v.literal("responses"), v.literal("chat"))),
  OPENAI_TEXT_MODEL: v.optional(v.string()),
  OPENAI_VISION_MODEL: v.optional(v.string()),
  OPENAI_EMBEDDING_MODEL: v.optional(v.string()),
  EVENTPULSE_AI_ENABLED: v.optional(v.string()),
} });
app.use(workpool, { name: "aiWorkpool" });
app.use(rateLimiter);
export default app;
