import { Workpool } from "@convex-dev/workpool";
import { RateLimiter, MINUTE, DAY } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";

// No SDK retry amplification: terminal failures are recorded, reporting stays available.
export const aiPool = new Workpool(components.aiWorkpool, { maxParallelism: 4, retryActionsByDefault: false });
export const aiLimits = new RateLimiter(components.rateLimiter, {
  eventMinute: { kind: "token bucket", rate: 30, period: MINUTE, capacity: 10 },
  eventDay: { kind: "fixed window", rate: 1000, period: DAY },
  question: { kind: "token bucket", rate: 6, period: MINUTE, capacity: 3 },
  document: { kind: "token bucket", rate: 4, period: MINUTE, capacity: 2 },
});
