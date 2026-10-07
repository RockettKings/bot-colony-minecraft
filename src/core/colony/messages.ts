// Every player-facing string the colony core produces. Keep wording short and consistent.
import { RESOURCES, shortId } from "../items.js";
import type { ChestLocateFailure, ItemCount, Task, TaskFailReason, TaskProgress, Vec3 } from "../types.js";

/** Integer when whole, otherwise one decimal. Never prints "-0". */
export function fmtNum(v: number): string {
  const r = Math.round(v * 10) / 10;
  if (r === 0) return "0";
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function fmtPos(p: Vec3): string {
  return `${fmtNum(p.x)} ${fmtNum(p.y)} ${fmtNum(p.z)}`;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

const FAIL_TEXT: Record<TaskFailReason, string> = {
  unreachable: "no path",
  timeout: "timed out",
  bot_died: "I died",
  bot_removed: "I was removed",
  error: "something went wrong",
  no_source: "nothing left to gather nearby",
  no_chest: "can't reach the colony chest",
  no_tool: "no pickaxe and couldn't make one",
  inventory_full: "the chest is full",
};

/** Player-facing label of a gather resource (`logs`, `oak_log`, `cobblestone`, ...). */
export const resourceLabel = (t: Extract<Task, { kind: "gather" }>): string => RESOURCES[t.item].label;

/**
 * What a bot is doing, for status / busy-offer / picking-up lines.
 * goto: `going to x y z`; gather: `gathering <label> <n>/<amount>`, n = delivered + held (progress) else task.delivered.
 */
export function taskActivity(t: Task, progress?: TaskProgress): string {
  switch (t.kind) {
    case "goto":
      return `going to ${fmtPos(t.target)}`;
    case "gather": {
      const n = progress ? progress.delivered + progress.held : t.delivered;
      return `gathering ${resourceLabel(t)} ${n}/${t.amount}`;
    }
  }
}

/** A task as a noun, for reassigned / left / queued notices. goto: `go to x y z`; gather: `gather <label> d/a`. */
export function taskNoun(t: Task): string {
  switch (t.kind) {
    case "goto":
      return `go to ${fmtPos(t.target)}`;
    case "gather":
      return `gather ${resourceLabel(t)} ${t.delivered}/${t.amount}`;
  }
}

/** Max entries listed by `!chest` before `, +N more`. */
export const CHEST_LIST_MAX = 8;

function chestContents(items: readonly ItemCount[]): string {
  const shown = items.slice(0, CHEST_LIST_MAX).map((i) => `${i.amount} ${shortId(i.typeId)}`);
  const more = items.length - shown.length;
  return shown.join(", ") + (more > 0 ? `, +${more} more` : "");
}

export const msg = {
  // general
  slowDown: () => "Slow down… wait a moment between commands.",
  unknownBot: (name: string) => `No bot named '${name}'.`,
  noBots: (prefix: string) => `No bots yet. Type ${prefix}spawn.`,

  // status
  statusIdle: (bot: string) => `${bot}: idle`,
  /** `activity` from taskActivity. */
  statusBusy: (bot: string, activity: string, owner: string) => `${bot}: ${activity} for ${owner}`,
  statusQueued: (n: number) => `Queued: ${n}`,

  // spawn
  spawnLimit: (max: number) => `Bot limit reached (${max}/${max}).`,
  nameTaken: (name: string) => `Name '${name}' is taken.`,
  spawning: (name: string) => `Spawning ${name}…`,
  joined: (name: string) => `${name} joined.`,
  spawnFailed: (name: string, reason: string) => `Couldn't spawn ${name}: ${reason.replace(/[.\s]+$/, "")}.`,

  // goto / come
  tooMany: (n: number, have: number) => `Only ${plural(have, "bot")} ${have === 1 ? "exists" : "exist"}; can't send ${n}.`,
  outOfWorld: (y: number, min: number, max: number) =>
    `Target Y ${fmtNum(y)} is outside the world (${min} to ${max}).`,
  onMyWay: (target: Vec3) => `On my way to ${fmtPos(target)}.`,
  offerCounts: (n: number, free: number, busy: number) => `Need ${plural(n, "bot")}: ${free} free, ${busy} busy.`,
  offerBusyBot: (bot: string, activity: string, owner: string) => `${bot} is ${activity} for ${owner}.`,
  offerHint: (prefix: string, secs: number) =>
    `Reply ${prefix}override to take over or ${prefix}queue to wait (expires in ${secs}s).`,

  // stop offer
  stopOfferHint: (prefix: string, secs: number) => `Reply ${prefix}override to stop it (expires in ${secs}s).`,

  // override / queue
  nothingToOverride: () => "Nothing to override.",
  nothingToQueue: () => "Nothing to queue.",
  reassigned: (bot: string, by: string, noun: string) => `${bot} was reassigned by ${by}; your task (${noun}) is queued.`,
  /** Preempted gather that had already delivered its amount: dropped, not requeued. */
  reassignedDone: (bot: string, by: string, noun: string) =>
    `${bot} was reassigned by ${by}; your task (${noun}) was already done.`,
  queuedAt: (count: number, first: number) =>
    count === 1 ? `Queued 1 task at position ${first}.` : `Queued ${count} tasks at positions ${first}-${first + count - 1}.`,
  noLongerOnTask: (bot: string) => `${bot} is no longer on that task.`,

  // stop
  stoppedBot: (bot: string) => `Stopped ${bot}.`,
  stoppedBy: (bot: string, by: string) => `${bot} was stopped by ${by}.`,
  botIdle: (bot: string) => `${bot} is idle.`,
  stoppedCount: (active: number, queued: number) =>
    active === 0 && queued === 0
      ? "You have no active or queued tasks."
      : `Stopped ${plural(active, "task")}, dropped ${queued} queued.`,

  // bot-spoken lifecycle
  pickingUp: (activity: string) => `Picking up your queued task: ${activity}.`,
  arrived: (target: Vec3) => `Arrived at ${fmtPos(target)}.`,
  failed: (target: Vec3, reason: TaskFailReason) => `Couldn't reach ${fmtPos(target)}: ${FAIL_TEXT[reason]}.`,
  gathering: (amount: number, label: string) => `Gathering ${amount} ${label}.`,
  delivered: (n: number, label: string) => `Delivered ${n} ${label} to the chest.`,
  gatherFailed: (label: string, delivered: number, amount: number, reason: TaskFailReason) =>
    `Stopped gathering ${label} at ${delivered}/${amount}: ${FAIL_TEXT[reason]}.`,

  // chest
  noChest: (prefix: string) => `No colony chest yet. Look at a chest and type ${prefix}chest set.`,
  chestSet: (pos: Vec3) => `Colony chest set to ${fmtPos(pos)}.`,
  chestLocateFailed: (reason: ChestLocateFailure, prefix: string) =>
    reason === "none_found"
      ? `No chest found. Look at a chest (or stand next to one) and type ${prefix}chest set.`
      : "Couldn't look for a chest. Try again.",
  chestUnreadable: (pos: Vec3) => `Colony chest at ${fmtPos(pos)} can't be read (gone or unloaded).`,
  chestEmpty: (pos: Vec3) => `Colony chest at ${fmtPos(pos)}: empty.`,
  chestItems: (pos: Vec3, items: readonly ItemCount[]) => `Colony chest at ${fmtPos(pos)}: ${chestContents(items)}`,

  // removal / expiry
  botLeftRequeued: (bot: string, noun: string) => `${bot} left; your task (${noun}) is queued.`,
  botLeftDone: (bot: string, noun: string) => `${bot} left; your task (${noun}) was already done.`,
  left: (bot: string, reason: string) => `${bot} left (${reason}).`,
  offerExpired: () => "Your pending request expired.",
} as const;
