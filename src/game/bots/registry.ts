// Executor registry (Job 6): one factory per task kind. A new task kind = extend Task in src/core/types.ts
// and add its factory here; ExecutorRegistry's mapped type makes a missing entry a compile error.
import type { ExecutorRegistry } from "./executor.js";
import { GatherExecutor } from "./gather-executor.js";
import { GotoExecutor } from "./goto-executor.js";

export const EXECUTORS: ExecutorRegistry = {
  goto: (task, ctx) => new GotoExecutor(ctx.body, task),
  gather: (task, ctx) => new GatherExecutor(task, ctx),
};
