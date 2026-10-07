// Deterministic bot selection for goto/come with a count.
import type { PlayerId } from "../types.js";
import type { BotRecord } from "./state.js";

export interface Plan {
  /** Idle bots to assign directly, registration order. */
  idle: BotRecord[];
  /** Busy bots that would have to be taken, in preference order. */
  take: BotRecord[];
}

/**
 * Pick `n` bots: idle ones first (registration order), then busy ones, preferring the
 * requester's own tasks, then the oldest other tasks. Ties break on registration order.
 * Caller guarantees n <= bots.length.
 */
export function planAllocation(bots: readonly BotRecord[], n: number, requester: PlayerId): Plan {
  const idle = bots.filter((b) => !b.task).slice(0, n);
  const need = n - idle.length;
  if (need <= 0) return { idle, take: [] };

  const busy = bots.filter((b) => b.task);
  const rank = (b: BotRecord): number => (b.task?.issuer.id === requester ? 0 : 1);
  const take = [...busy]
    .sort((a, b) => rank(a) - rank(b) || (a.task?.createdAt ?? 0) - (b.task?.createdAt ?? 0) || a.seq - b.seq)
    .slice(0, need);
  return { idle, take };
}
