// Every player-facing string the colony core produces. Keep wording short and consistent.
import type { TaskFailReason, Vec3 } from "../types.js";

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
  // TODO(phase-2, Job 2): final wording (PHASE2-SPEC §Messages)
  no_source: "nothing left to gather nearby",
  no_chest: "no colony chest",
  no_tool: "no tool",
  inventory_full: "the chest is full",
};

export const msg = {
  // general
  slowDown: () => "Slow down… wait a moment between commands.",
  unknownBot: (name: string) => `No bot named '${name}'.`,
  noBots: (prefix: string) => `No bots yet. Type ${prefix}spawn.`,

  // status
  statusIdle: (bot: string) => `${bot}: idle`,
  statusGoing: (bot: string, target: Vec3, owner: string) => `${bot}: going to ${fmtPos(target)} for ${owner}`,
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
  offerBusyBot: (bot: string, target: Vec3, owner: string) => `${bot} is going to ${fmtPos(target)} for ${owner}.`,
  offerHint: (prefix: string, secs: number) =>
    `Reply ${prefix}override to take over or ${prefix}queue to wait (expires in ${secs}s).`,

  // stop offer
  stopOfferHint: (prefix: string, secs: number) => `Reply ${prefix}override to stop it (expires in ${secs}s).`,

  // override / queue
  nothingToOverride: () => "Nothing to override.",
  nothingToQueue: () => "Nothing to queue.",
  reassigned: (bot: string, by: string, target: Vec3) =>
    `${bot} was reassigned by ${by}; your task (go to ${fmtPos(target)}) is queued.`,
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
  pickingUp: (target: Vec3) => `Picking up your queued task: going to ${fmtPos(target)}.`,
  arrived: (target: Vec3) => `Arrived at ${fmtPos(target)}.`,
  failed: (target: Vec3, reason: TaskFailReason) => `Couldn't reach ${fmtPos(target)}: ${FAIL_TEXT[reason]}.`,

  // removal / expiry
  botLeftRequeued: (bot: string, target: Vec3) => `${bot} left; your task (go to ${fmtPos(target)}) is queued.`,
  left: (bot: string, reason: string) => `${bot} left (${reason}).`,
  offerExpired: () => "Your pending request expired.",
} as const;
