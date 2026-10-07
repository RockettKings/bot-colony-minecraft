var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/game/runtime.ts
import { system as system3, world as world3 } from "@minecraft/server";

// src/core/items.ts
var MC = "minecraft:";
function ns(id) {
  const t = id.trim().toLowerCase();
  return t.startsWith(MC) ? t : MC + t;
}
function shortId(typeId) {
  return typeId.startsWith(MC) ? typeId.slice(MC.length) : typeId;
}
var GATHER_LIMITS = {
  minAmount: 1,
  maxAmount: 256,
  defaultAmount: 16
};
var TOOL_TIER_PREFERENCE = ["netherite", "diamond", "iron", "stone", "golden", "wooden"];
var TOOL_SPEED = {
  wooden: 2,
  stone: 4,
  iron: 6,
  golden: 12,
  diamond: 8,
  netherite: 9
};
var TOOL_RE = /^minecraft:(wooden|stone|iron|golden|diamond|netherite)_(axe|pickaxe|shovel)$/;
function toolInfo(typeId) {
  const m = TOOL_RE.exec(typeId);
  if (!m) return void 0;
  const tier = m[1];
  return { kind: m[2], tier, rank: TOOL_TIER_PREFERENCE.indexOf(tier) };
}
var LOG_SPECIES = [
  "oak",
  "spruce",
  "birch",
  "jungle",
  "acacia",
  "dark_oak",
  "mangrove",
  "cherry",
  "pale_oak"
];
var LOG_IDS = LOG_SPECIES.map((s) => `${MC}${s}_log`);
var PLANK_IDS = LOG_SPECIES.map((s) => `${MC}${s}_planks`);
function logResource(species) {
  const id = `${MC}${species}_log`;
  return { key: `${species}_log`, label: `${species}_log`, sources: [id], yields: [id], tool: "axe", requiresTool: false };
}
var RESOURCES = {
  log: { key: "log", label: "logs", sources: LOG_IDS, yields: LOG_IDS, tool: "axe", requiresTool: false },
  oak_log: logResource("oak"),
  spruce_log: logResource("spruce"),
  birch_log: logResource("birch"),
  jungle_log: logResource("jungle"),
  acacia_log: logResource("acacia"),
  dark_oak_log: logResource("dark_oak"),
  mangrove_log: logResource("mangrove"),
  cherry_log: logResource("cherry"),
  pale_oak_log: logResource("pale_oak"),
  cobblestone: {
    key: "cobblestone",
    label: "cobblestone",
    sources: [`${MC}stone`, `${MC}cobblestone`],
    yields: [`${MC}cobblestone`],
    tool: "pickaxe",
    requiresTool: true
  },
  dirt: {
    key: "dirt",
    label: "dirt",
    sources: [`${MC}dirt`, `${MC}grass_block`],
    yields: [`${MC}dirt`],
    tool: "shovel",
    requiresTool: false
  },
  sand: { key: "sand", label: "sand", sources: [`${MC}sand`], yields: [`${MC}sand`], tool: "shovel", requiresTool: false },
  gravel: {
    key: "gravel",
    label: "gravel",
    sources: [`${MC}gravel`],
    // Gravel sometimes drops flint instead; only gravel counts (flint is picked up but not deposited).
    yields: [`${MC}gravel`],
    tool: "shovel",
    requiresTool: false
  }
};
var RESOURCE_ALIASES = {
  logs: "log",
  wood: "log",
  woods: "log",
  stone: "cobblestone",
  cobble: "cobblestone",
  cobbles: "cobblestone",
  grass: "dirt",
  grass_block: "dirt"
};
function resolveResource(token) {
  const t = shortId(ns(token));
  if (Object.prototype.hasOwnProperty.call(RESOURCES, t)) return t;
  return Object.prototype.hasOwnProperty.call(RESOURCE_ALIASES, t) ? RESOURCE_ALIASES[t] : void 0;
}
var RESOURCE_NAMES_HINT = "logs (or oak_log, birch_log, ...), cobblestone, dirt, sand, gravel";
var CONTAINER_BLOCK_TYPES = [`${MC}chest`, `${MC}trapped_chest`, `${MC}barrel`];
var CRAFTING_TABLE = `${MC}crafting_table`;
var STICK = `${MC}stick`;
var BLOCK_HARDNESS = {
  ...Object.fromEntries(LOG_IDS.map((id) => [id, 2])),
  [`${MC}stone`]: 1.5,
  [`${MC}cobblestone`]: 2,
  [`${MC}dirt`]: 0.5,
  [`${MC}grass_block`]: 0.6,
  [`${MC}sand`]: 0.5,
  [`${MC}gravel`]: 0.6
};
var DEFAULT_HARDNESS = 2;
var PLANKS_RECIPES = LOG_SPECIES.map((s) => ({
  id: `${s}_planks`,
  output: { typeId: `${MC}${s}_planks`, amount: 4 },
  ingredients: [{ anyOf: [`${MC}${s}_log`], amount: 1 }],
  needsTable: false
}));
var STICK_RECIPE = {
  id: "stick",
  output: { typeId: STICK, amount: 4 },
  ingredients: [{ anyOf: PLANK_IDS, amount: 2 }],
  needsTable: false
};
var CRAFTING_TABLE_RECIPE = {
  id: "crafting_table",
  output: { typeId: CRAFTING_TABLE, amount: 1 },
  ingredients: [{ anyOf: PLANK_IDS, amount: 4 }],
  needsTable: false
};
var WOODEN_PICKAXE_RECIPE = {
  id: "wooden_pickaxe",
  output: { typeId: `${MC}wooden_pickaxe`, amount: 1 },
  ingredients: [
    { anyOf: PLANK_IDS, amount: 3 },
    { anyOf: [STICK], amount: 2 }
  ],
  needsTable: true
};
var RECIPES = [...PLANKS_RECIPES, STICK_RECIPE, CRAFTING_TABLE_RECIPE, WOODEN_PICKAXE_RECIPE];

// src/core/commands/specs.ts
var MIN_COUNT = 1;
var MAX_COUNT = 16;
var BOT_NAME_RE = /^[A-Za-z0-9_-]{1,16}$/;
var req = (name, label, type) => ({ name, label, type, optional: false });
var opt = (name, label, type) => ({ name, label, type, optional: true });
function spec(name, description, args) {
  const parts = args.map((a) => a.optional ? `[${a.name}]` : `<${a.name}>`);
  return { name, usage: [name, ...parts].join(" "), description, args };
}
var COMMAND_SPECS = [
  spec("help", "List commands, or show how to use one.", [opt("command", "command", "topic")]),
  spec("status", "Show what each bot is doing and the queue, or one bot.", [opt("bot", "bot name", "botName")]),
  spec("spawn", "Spawn a bot at your position. Name: 1-16 letters, digits, _ or -.", [opt("name", "bot name", "botName")]),
  spec("goto", `Send bots to x y z (~ = relative to you). Count ${MIN_COUNT}-${MAX_COUNT}, default ${MIN_COUNT}.`, [
    req("x", "x coordinate", "coord"),
    req("y", "y coordinate", "coord"),
    req("z", "z coordinate", "coord"),
    opt("count", "count", "count")
  ]),
  spec("come", `Call bots to your position. Count ${MIN_COUNT}-${MAX_COUNT}, default ${MIN_COUNT}.`, [opt("count", "count", "count")]),
  spec(
    "gather",
    `Gather an item into the colony chest. Amount ${GATHER_LIMITS.minAmount}-${GATHER_LIMITS.maxAmount} (default ${GATHER_LIMITS.defaultAmount}), split across ${MIN_COUNT}-${MAX_COUNT} bots.`,
    [req("item", "item", "item"), opt("amount", "amount", "amount"), opt("bots", "bot count", "count")]
  ),
  spec("chest", "Show the colony chest, or 'set' it to the chest you look at.", [opt("set", "chest action", "chestAction")]),
  spec("stop", "Stop all your tasks (queued too), or one bot. Stopping another player's bot asks first.", [opt("bot", "bot name", "botName")]),
  spec("override", "Answer a busy reply: take (or stop) the busy bots anyway.", []),
  spec("queue", "Answer a busy reply: wait in line for free bots.", [])
];
function findSpec(name) {
  const lower = name.toLowerCase();
  return COMMAND_SPECS.find((s) => s.name === lower);
}

// src/core/commands/parse.ts
var NUMBER_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
var COUNT_RE = /^\d+$/;
var LETTER_RE = /^[A-Za-z]$/;
var COORD_LIMITS = {
  horizontal: 3e7,
  // |x|, |z| and |~n| on x/z
  minY: -64,
  maxY: 320,
  relativeY: 384
  // |~n| on y: full build height
};
var AXES = ["x", "y", "z"];
var ECHO_MAX = 20;
function echo(token) {
  const chars = Array.from(token.replace(/\u00a7/g, ""));
  return chars.length > ECHO_MAX ? chars.slice(0, ECHO_MAX - 1).join("") + "\u2026" : chars.join("");
}
function isCommand(text, prefix = "!") {
  if (prefix.length === 0) return false;
  const t = text.trim();
  return t.startsWith(prefix) && LETTER_RE.test(t.charAt(prefix.length));
}
function parseCommand(text, prefix = "!") {
  if (!isCommand(text, prefix)) return null;
  const tokens = text.trim().slice(prefix.length).split(/\s+/);
  const typed = (tokens[0] ?? "").toLowerCase();
  const args = tokens.slice(1);
  const spec2 = findSpec(typed);
  if (!spec2) return { ok: false, error: `Unknown command '${prefix}${echo(typed)}'. Type ${prefix}help.` };
  const usage = `${prefix}${spec2.usage}`;
  const fail = (error) => ({ ok: false, error, usage });
  if (args.length > spec2.args.length) return fail("Too many arguments.");
  const values = { coords: [] };
  for (let i = 0; i < spec2.args.length; i++) {
    const arg = spec2.args[i];
    const token = args[i];
    if (token === void 0) {
      if (arg.optional) break;
      return fail(`Missing ${arg.label}.`);
    }
    const r = parseArg(arg, token, values, prefix);
    if (!r.ok) return fail(r.error);
  }
  return { ok: true, command: build(spec2, values) };
}
function parseArg(arg, token, values, prefix) {
  switch (arg.type) {
    case "coord": {
      const c = parseCoord(token, AXES[values.coords.length]);
      if (typeof c === "string") return { ok: false, error: c };
      values.coords.push(c);
      return { ok: true };
    }
    case "count": {
      const n = COUNT_RE.test(token) ? Number(token) : NaN;
      if (!Number.isSafeInteger(n) || n < MIN_COUNT || n > MAX_COUNT) {
        return { ok: false, error: `Count must be a whole number from ${MIN_COUNT} to ${MAX_COUNT}.` };
      }
      values.count = n;
      return { ok: true };
    }
    case "botName": {
      const name = token.startsWith("@") ? token.slice(1) : token;
      if (!BOT_NAME_RE.test(name)) {
        return { ok: false, error: `'${echo(token)}' isn't a valid bot name (1-16 letters, digits, _ or -).` };
      }
      values.name = name;
      return { ok: true };
    }
    case "topic":
      values.topic = token;
      return { ok: true };
    case "item": {
      const item = resolveResource(token);
      if (item === void 0) return { ok: false, error: `Unknown item '${echo(token)}'. Try: ${RESOURCE_NAMES_HINT}.` };
      values.item = item;
      return { ok: true };
    }
    case "amount": {
      const { minAmount, maxAmount } = GATHER_LIMITS;
      const n = COUNT_RE.test(token) ? Number(token) : NaN;
      if (!Number.isSafeInteger(n) || n < minAmount || n > maxAmount) {
        return { ok: false, error: `Amount must be a whole number from ${minAmount} to ${maxAmount}.` };
      }
      values.amount = n;
      return { ok: true };
    }
    case "chestAction": {
      if (token.toLowerCase() !== "set") {
        return { ok: false, error: `Unknown chest action '${echo(token)}'. Use ${prefix}chest or ${prefix}chest set.` };
      }
      values.chestAction = "set";
      return { ok: true };
    }
  }
}
function parseCoord(token, axis) {
  const bad = `'${echo(token)}' isn't a valid coordinate. Use a number, ~ or ~n.`;
  if (token.startsWith("^")) return "Local coordinates (^) aren't supported. Use numbers or ~.";
  const relative = token.startsWith("~");
  const rest = relative ? token.slice(1) : token;
  if (relative && rest === "") return { value: 0, relative: true };
  if (!NUMBER_RE.test(rest)) return bad;
  const value = Number(rest) + 0;
  if (!Number.isFinite(value)) return bad;
  if (axis !== void 0) {
    const L = COORD_LIMITS;
    if (axis === "y" && !relative && (value < L.minY || value > L.maxY)) {
      return `Y must be from ${L.minY} to ${L.maxY}.`;
    }
    const max = axis === "y" ? L.relativeY : L.horizontal;
    if (Math.abs(value) > max) return `'${echo(token)}' is out of range (max ${max}).`;
  }
  return { value, relative };
}
function build(spec2, v) {
  const count2 = v.count ?? MIN_COUNT;
  switch (spec2.name) {
    case "help":
      return v.topic === void 0 ? { kind: "help" } : { kind: "help", topic: v.topic };
    case "status":
      return v.name === void 0 ? { kind: "status" } : { kind: "status", bot: v.name };
    case "spawn":
      return v.name === void 0 ? { kind: "spawn" } : { kind: "spawn", name: v.name };
    case "goto": {
      const [x, y, z] = v.coords;
      return { kind: "goto", target: { x, y, z }, count: count2 };
    }
    case "come":
      return { kind: "come", count: count2 };
    case "stop":
      return v.name === void 0 ? { kind: "stop" } : { kind: "stop", bot: v.name };
    case "override":
      return { kind: "override" };
    case "queue":
      return { kind: "queue" };
    case "gather":
      return { kind: "gather", item: v.item, amount: v.amount ?? GATHER_LIMITS.defaultAmount, count: count2 };
    case "chest":
      return { kind: "chest", action: v.chestAction ?? "show" };
  }
}

// src/core/commands/help.ts
function extraHelp(name, prefix) {
  switch (name) {
    case "gather":
      return [
        `Items: ${RESOURCE_NAMES_HINT}. Aliases: wood, stone, cobble.`,
        `Example: ${prefix}gather oak_log 32 2 (two bots, 16 each).`
      ];
    case "chest":
      return [`Look at a chest (or stand next to one) and type ${prefix}chest set. Bots deliver there.`];
    default:
      return [];
  }
}
function helpText(topic, prefix = "!") {
  const t = topic?.trim() ?? "";
  if (t === "") {
    return [`Colony commands (${prefix}help <command> for details):`, ...COMMAND_SPECS.map((s) => prefix + s.usage)];
  }
  const name = prefix.length > 0 && t.startsWith(prefix) ? t.slice(prefix.length) : t;
  const spec2 = findSpec(name);
  if (!spec2) return [`Unknown command '${prefix}${echo(name.toLowerCase())}'. Type ${prefix}help.`];
  return [`Usage: ${prefix}${spec2.usage}`, spec2.description, ...extraHelp(spec2.name, prefix)];
}

// src/core/types.ts
var DEFAULT_CONFIG = {
  prefix: "!",
  maxBots: 3,
  offerTtlTicks: 600,
  commandCooldownTicks: 20,
  defaultBotNamePrefix: "Bot-"
};

// src/core/colony/allocator.ts
function planAllocation(bots, n, requester) {
  const idle = bots.filter((b) => !b.task).slice(0, n);
  const need = n - idle.length;
  if (need <= 0) return { idle, take: [] };
  const busy = bots.filter((b) => b.task);
  const rank = (b) => b.task?.issuer.id === requester ? 0 : 1;
  const take = [...busy].sort((a, b) => rank(a) - rank(b) || (a.task?.createdAt ?? 0) - (b.task?.createdAt ?? 0) || a.seq - b.seq).slice(0, need);
  return { idle, take };
}

// src/core/colony/messages.ts
function fmtNum(v) {
  const r = Math.round(v * 10) / 10;
  if (r === 0) return "0";
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
function fmtPos(p) {
  return `${fmtNum(p.x)} ${fmtNum(p.y)} ${fmtNum(p.z)}`;
}
var plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
var FAIL_TEXT = {
  unreachable: "no path",
  timeout: "timed out",
  bot_died: "I died",
  bot_removed: "I was removed",
  error: "something went wrong",
  no_source: "nothing left to gather nearby",
  no_chest: "can't reach the colony chest",
  no_tool: "no pickaxe and couldn't make one",
  inventory_full: "the chest is full"
};
var resourceLabel = (t) => RESOURCES[t.item].label;
function taskActivity(t, progress) {
  switch (t.kind) {
    case "goto":
      return `going to ${fmtPos(t.target)}`;
    case "gather": {
      const n = progress ? progress.delivered + progress.held : t.delivered;
      return `gathering ${resourceLabel(t)} ${n}/${t.amount}`;
    }
  }
}
function taskNoun(t) {
  switch (t.kind) {
    case "goto":
      return `go to ${fmtPos(t.target)}`;
    case "gather":
      return `gather ${resourceLabel(t)} ${t.delivered}/${t.amount}`;
  }
}
var CHEST_LIST_MAX = 8;
function chestContents(items) {
  const shown = items.slice(0, CHEST_LIST_MAX).map((i) => `${i.amount} ${shortId(i.typeId)}`);
  const more = items.length - shown.length;
  return shown.join(", ") + (more > 0 ? `, +${more} more` : "");
}
var msg = {
  // general
  slowDown: () => "Slow down\u2026 wait a moment between commands.",
  unknownBot: (name) => `No bot named '${name}'.`,
  noBots: (prefix) => `No bots yet. Type ${prefix}spawn.`,
  // status
  statusIdle: (bot) => `${bot}: idle`,
  /** `activity` from taskActivity. */
  statusBusy: (bot, activity, owner) => `${bot}: ${activity} for ${owner}`,
  statusQueued: (n) => `Queued: ${n}`,
  // spawn
  spawnLimit: (max) => `Bot limit reached (${max}/${max}).`,
  nameTaken: (name) => `Name '${name}' is taken.`,
  spawning: (name) => `Spawning ${name}\u2026`,
  joined: (name) => `${name} joined.`,
  spawnFailed: (name, reason) => `Couldn't spawn ${name}: ${reason.replace(/[.\s]+$/, "")}.`,
  // goto / come
  tooMany: (n, have) => `Only ${plural(have, "bot")} ${have === 1 ? "exists" : "exist"}; can't send ${n}.`,
  outOfWorld: (y, min, max) => `Target Y ${fmtNum(y)} is outside the world (${min} to ${max}).`,
  onMyWay: (target) => `On my way to ${fmtPos(target)}.`,
  offerCounts: (n, free, busy) => `Need ${plural(n, "bot")}: ${free} free, ${busy} busy.`,
  offerBusyBot: (bot, activity, owner) => `${bot} is ${activity} for ${owner}.`,
  offerHint: (prefix, secs) => `Reply ${prefix}override to take over or ${prefix}queue to wait (expires in ${secs}s).`,
  // stop offer
  stopOfferHint: (prefix, secs) => `Reply ${prefix}override to stop it (expires in ${secs}s).`,
  // override / queue
  nothingToOverride: () => "Nothing to override.",
  nothingToQueue: () => "Nothing to queue.",
  reassigned: (bot, by, noun) => `${bot} was reassigned by ${by}; your task (${noun}) is queued.`,
  /** Preempted gather that had already delivered its amount: dropped, not requeued. */
  reassignedDone: (bot, by, noun) => `${bot} was reassigned by ${by}; your task (${noun}) was already done.`,
  queuedAt: (count2, first) => count2 === 1 ? `Queued 1 task at position ${first}.` : `Queued ${count2} tasks at positions ${first}-${first + count2 - 1}.`,
  noLongerOnTask: (bot) => `${bot} is no longer on that task.`,
  // stop
  stoppedBot: (bot) => `Stopped ${bot}.`,
  stoppedBy: (bot, by) => `${bot} was stopped by ${by}.`,
  botIdle: (bot) => `${bot} is idle.`,
  stoppedCount: (active, queued) => active === 0 && queued === 0 ? "You have no active or queued tasks." : `Stopped ${plural(active, "task")}, dropped ${queued} queued.`,
  // bot-spoken lifecycle
  pickingUp: (activity) => `Picking up your queued task: ${activity}.`,
  arrived: (target) => `Arrived at ${fmtPos(target)}.`,
  failed: (target, reason) => `Couldn't reach ${fmtPos(target)}: ${FAIL_TEXT[reason]}.`,
  gathering: (amount, label) => `Gathering ${amount} ${label}.`,
  delivered: (n, label) => `Delivered ${n} ${label} to the chest.`,
  gatherFailed: (label, delivered, amount, reason) => `Stopped gathering ${label} at ${delivered}/${amount}: ${FAIL_TEXT[reason]}.`,
  // chest
  noChest: (prefix) => `No colony chest yet. Look at a chest and type ${prefix}chest set.`,
  chestSet: (pos) => `Colony chest set to ${fmtPos(pos)}.`,
  chestLocateFailed: (reason, prefix) => reason === "none_found" ? `No chest found. Look at a chest (or stand next to one) and type ${prefix}chest set.` : "Couldn't look for a chest. Try again.",
  chestUnreadable: (pos) => `Colony chest at ${fmtPos(pos)} can't be read (gone or unloaded).`,
  chestEmpty: (pos) => `Colony chest at ${fmtPos(pos)}: empty.`,
  chestItems: (pos, items) => `Colony chest at ${fmtPos(pos)}: ${chestContents(items)}`,
  // removal / expiry
  botLeftRequeued: (bot, noun) => `${bot} left; your task (${noun}) is queued.`,
  botLeftDone: (bot, noun) => `${bot} left; your task (${noun}) was already done.`,
  left: (bot, reason) => `${bot} left (${reason}).`,
  offerExpired: () => "Your pending request expired."
};

// src/core/colony/state.ts
function createState() {
  return {
    bots: /* @__PURE__ */ new Map(),
    nextBotSeq: 0,
    pendingSpawns: [],
    queue: [],
    offers: /* @__PURE__ */ new Map(),
    lastCommandAt: /* @__PURE__ */ new Map(),
    nextTaskNum: 1
  };
}

// src/core/colony/index.ts
var Colony = class {
  constructor(config) {
    __publicField(this, "config");
    __publicField(this, "s", createState());
    /** Effects for the event currently being handled. */
    __publicField(this, "out", []);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  handle(e) {
    this.out = [];
    switch (e.kind) {
      case "command":
        this.onCommand(e);
        break;
      case "botRegistered":
        this.onBotRegistered(e.botId, e.name);
        break;
      case "botRemoved":
        this.onBotRemoved(e.botId, e.reason);
        break;
      case "spawnFailed":
        this.onSpawnFailed(e.name, e.requestedBy, e.reason);
        break;
      case "taskReport":
        this.onTaskReport(e);
        break;
      case "tick":
        this.onTick(e.now);
        break;
      case "taskProgress":
        this.onTaskProgress(e);
        break;
      case "chestLocated":
        this.s.chest = copyChest(e.chest);
        this.reply(e.requestedBy, msg.chestSet(e.chest.pos));
        break;
      case "chestLocateFailed":
        this.reply(e.requestedBy, msg.chestLocateFailed(e.reason, this.config.prefix));
        break;
      case "chestInspected":
        this.reply(e.to, chestLine(e.chest, e.items));
        break;
    }
    const effects = this.out;
    this.out = [];
    return effects;
  }
  snapshot() {
    return {
      bots: this.botList().map((b) => {
        if (!b.task) return { id: b.id, name: b.name, state: "idle" };
        const view2 = { id: b.id, name: b.name, state: "busy", task: copyTask(b.task) };
        return b.progress ? { ...view2, progress: { ...b.progress } } : view2;
      }),
      queued: this.s.queue.map(copyTask),
      pendingOffers: this.s.offers.size,
      ...this.s.chest ? { chest: copyChest(this.s.chest) } : {}
    };
  }
  // ---------------------------------------------------------------- commands
  onCommand(e) {
    const { command: c, sender: sender2, now: now2 } = e;
    if (c.kind === "help") return;
    if (c.kind !== "override" && c.kind !== "queue") {
      const last = this.s.lastCommandAt.get(sender2.id);
      if (last !== void 0 && now2 - last < this.config.commandCooldownTicks) {
        this.reply(sender2.id, msg.slowDown());
        return;
      }
      this.s.lastCommandAt.set(sender2.id, now2);
    }
    switch (c.kind) {
      case "gather":
        return this.cmdGather(sender2, now2, c);
      case "chest":
        return this.cmdChest(sender2, c.action);
      case "status":
        return this.cmdStatus(sender2, c.bot);
      case "spawn":
        return this.cmdSpawn(sender2, c.name);
      case "goto":
        return this.cmdGoto(sender2, now2, resolveTarget(c, sender2.pos), c.count);
      case "come":
        return this.cmdGoto(sender2, now2, { ...sender2.pos }, c.count);
      case "stop":
        return this.cmdStop(sender2, now2, c.bot);
      case "override":
        return this.cmdOverride(sender2, now2);
      case "queue":
        return this.cmdQueue(sender2, now2);
    }
  }
  cmdStatus(sender2, botName2) {
    if (botName2 !== void 0) {
      const bot = this.findBot(botName2);
      if (!bot) return this.reply(sender2.id, msg.unknownBot(botName2));
      return this.reply(sender2.id, statusLine(bot));
    }
    const bots = this.botList();
    if (bots.length === 0) this.reply(sender2.id, msg.noBots(this.config.prefix));
    for (const b of bots) this.reply(sender2.id, statusLine(b));
    this.reply(sender2.id, msg.statusQueued(this.s.queue.length));
  }
  cmdSpawn(sender2, requested) {
    const max = this.config.maxBots;
    if (this.s.bots.size + this.s.pendingSpawns.length >= max) {
      return this.reply(sender2.id, msg.spawnLimit(max));
    }
    let name;
    if (requested !== void 0) {
      if (this.nameInUse(requested)) return this.reply(sender2.id, msg.nameTaken(requested));
      name = requested;
    } else {
      name = this.defaultName();
    }
    this.s.pendingSpawns.push({ name, requestedBy: sender2.id });
    this.out.push({ kind: "spawn", name, near: { ...sender2.pos }, requestedBy: sender2.id });
    this.reply(sender2.id, msg.spawning(name));
  }
  cmdGoto(sender2, now2, target, rawCount) {
    const n = Math.max(1, Math.floor(rawCount));
    if (target.y < COORD_LIMITS.minY || target.y > COORD_LIMITS.maxY) {
      return this.reply(sender2.id, msg.outOfWorld(target.y, COORD_LIMITS.minY, COORD_LIMITS.maxY));
    }
    const specs = [];
    for (let i = 0; i < n; i++) specs.push({ kind: "goto", target: { ...target } });
    this.request(sender2, now2, specs);
  }
  cmdGather(sender2, now2, c) {
    const chest = this.s.chest;
    if (!chest) return this.reply(sender2.id, msg.noChest(this.config.prefix));
    const n = Math.max(1, Math.min(Math.floor(c.count), c.amount));
    const specs = splitAmount(c.amount, n).map(
      (amount) => ({ kind: "gather", item: c.item, amount, origin: { ...sender2.pos }, chest: copyChest(chest) })
    );
    this.request(sender2, now2, specs);
  }
  cmdChest(sender2, action) {
    if (action === "set") {
      this.out.push({ kind: "locateChest", requestedBy: sender2.id, near: { ...sender2.pos } });
      return;
    }
    const chest = this.s.chest;
    if (!chest) return this.reply(sender2.id, msg.noChest(this.config.prefix));
    this.out.push({ kind: "inspectChest", to: sender2.id, chest: copyChest(chest) });
  }
  /**
   * Shared allocation for every multi-bot task request: one spec per bot. Assigns directly when every bot
   * to take runs the sender's own task (those are dropped, not requeued); otherwise creates an offer.
   */
  request(sender2, now2, specs) {
    const n = specs.length;
    const bots = this.botList();
    if (bots.length === 0) return this.reply(sender2.id, msg.noBots(this.config.prefix));
    if (n > bots.length) return this.reply(sender2.id, msg.tooMany(n, bots.length));
    this.s.offers.delete(sender2.id);
    const plan = planAllocation(bots, n, sender2.id);
    const allOwn = plan.take.every((b) => b.task?.issuer.id === sender2.id);
    if (allOwn) {
      let i = 0;
      for (const b of plan.idle) this.assignNew(b, sender2, now2, specs[i++]);
      for (const b of plan.take) {
        this.cancel(b, "preempted");
        this.assignNew(b, sender2, now2, specs[i++]);
      }
      return;
    }
    this.s.offers.set(sender2.id, { kind: "task", owner: ref(sender2), createdAt: now2, specs });
    const busy = bots.filter((b) => b.task).length;
    this.reply(sender2.id, msg.offerCounts(n, bots.length - busy, busy));
    for (const b of plan.take) {
      const t = b.task;
      this.reply(sender2.id, msg.offerBusyBot(b.name, taskActivity(t, b.progress), t.issuer.name));
    }
    this.reply(sender2.id, msg.offerHint(this.config.prefix, this.offerSecs()));
  }
  cmdStop(sender2, now2, botName2) {
    if (botName2 === void 0) {
      this.s.offers.delete(sender2.id);
      let active = 0;
      for (const b of this.botList()) {
        if (b.task?.issuer.id === sender2.id) {
          this.cancel(b, "stopped");
          active++;
        }
      }
      const before = this.s.queue.length;
      this.s.queue = this.s.queue.filter((t) => t.issuer.id !== sender2.id);
      this.reply(sender2.id, msg.stoppedCount(active, before - this.s.queue.length));
      this.drainQueue();
      return;
    }
    const bot = this.findBot(botName2);
    if (!bot) return this.reply(sender2.id, msg.unknownBot(botName2));
    const task = bot.task;
    if (!task) return this.reply(sender2.id, msg.botIdle(bot.name));
    if (task.issuer.id === sender2.id) {
      this.cancel(bot, "stopped");
      this.reply(sender2.id, msg.stoppedBot(bot.name));
      this.drainQueue();
      return;
    }
    this.s.offers.set(sender2.id, {
      kind: "stop",
      owner: ref(sender2),
      createdAt: now2,
      botId: bot.id,
      botName: bot.name,
      taskId: task.id
    });
    this.reply(sender2.id, msg.offerBusyBot(bot.name, taskActivity(task, bot.progress), task.issuer.name));
    this.reply(sender2.id, msg.stopOfferHint(this.config.prefix, this.offerSecs()));
  }
  cmdOverride(sender2, now2) {
    const offer = this.takeLiveOffer(sender2.id, now2);
    if (!offer) return this.reply(sender2.id, msg.nothingToOverride());
    if (offer.kind === "stop") {
      const bot = this.s.bots.get(offer.botId);
      if (!bot || bot.task?.id !== offer.taskId) {
        return this.reply(sender2.id, msg.noLongerOnTask(bot?.name ?? offer.botName));
      }
      const victim = bot.task;
      this.cancel(bot, "stopped");
      this.reply(sender2.id, msg.stoppedBot(bot.name));
      if (victim.issuer.id !== sender2.id) this.reply(victim.issuer.id, msg.stoppedBy(bot.name, sender2.name));
      this.drainQueue();
      return;
    }
    this.executeTaskOffer(sender2, now2, offer);
  }
  /** Re-plans against current state (bots may have freed up or left since the offer). */
  executeTaskOffer(sender2, now2, offer) {
    const n = offer.specs.length;
    const bots = this.botList();
    if (bots.length === 0) return this.reply(sender2.id, msg.noBots(this.config.prefix));
    if (n > bots.length) return this.reply(sender2.id, msg.tooMany(n, bots.length));
    const plan = planAllocation(bots, n, sender2.id);
    let i = 0;
    for (const b of plan.idle) this.assignNew(b, sender2, now2, offer.specs[i++]);
    const requeue = [];
    for (const b of plan.take) {
      const old = b.task;
      const progress = b.progress;
      this.cancel(b, "preempted");
      if (old.issuer.id !== sender2.id) {
        const again = requeueable(old, progress);
        if (again) {
          requeue.push(again);
          this.reply(old.issuer.id, msg.reassigned(b.name, sender2.name, taskNoun(again)));
        } else {
          this.reply(old.issuer.id, msg.reassignedDone(b.name, sender2.name, taskNoun(withDelivered(old, progress))));
        }
      }
      this.assignNew(b, sender2, now2, offer.specs[i++]);
    }
    this.s.queue.unshift(...requeue);
  }
  cmdQueue(sender2, now2) {
    const offer = this.s.offers.get(sender2.id);
    if (!offer || offer.kind !== "task" || !this.isLive(offer, now2)) {
      if (offer && !this.isLive(offer, now2)) this.s.offers.delete(sender2.id);
      return this.reply(sender2.id, msg.nothingToQueue());
    }
    this.s.offers.delete(sender2.id);
    const specs = [...offer.specs];
    for (const b of this.botList()) {
      if (specs.length === 0) break;
      if (!b.task) this.assignNew(b, sender2, now2, specs.shift());
    }
    if (specs.length === 0) return;
    const first = this.s.queue.length + 1;
    for (const spec2 of specs) this.s.queue.push(this.newTask(sender2, now2, spec2));
    this.reply(sender2.id, msg.queuedAt(specs.length, first));
  }
  // ---------------------------------------------------------------- game events
  onBotRegistered(botId, name) {
    this.dropPendingSpawn(name);
    const existing = this.s.bots.get(botId);
    if (existing) {
      existing.name = name;
    } else {
      this.s.bots.set(botId, { id: botId, name, seq: this.s.nextBotSeq++ });
      this.reply("all", msg.joined(name));
    }
    this.drainQueue();
  }
  onSpawnFailed(name, requestedBy, reason) {
    this.dropPendingSpawn(name);
    this.reply(requestedBy, msg.spawnFailed(name, reason));
  }
  /** Names are reserved case-insensitively (see nameInUse), so release them the same way. */
  dropPendingSpawn(name) {
    const key = name.toLowerCase();
    const pi = this.s.pendingSpawns.findIndex((p) => p.name.toLowerCase() === key);
    if (pi >= 0) this.s.pendingSpawns.splice(pi, 1);
  }
  onBotRemoved(botId, reason) {
    const bot = this.s.bots.get(botId);
    if (!bot) return;
    this.s.bots.delete(botId);
    if (bot.task) {
      const again = requeueable(bot.task, bot.progress);
      if (again) {
        this.s.queue.unshift(again);
        this.reply(again.issuer.id, msg.botLeftRequeued(bot.name, taskNoun(again)));
      } else {
        this.reply(bot.task.issuer.id, msg.botLeftDone(bot.name, taskNoun(withDelivered(bot.task, bot.progress))));
      }
    }
    this.reply("all", msg.left(bot.name, reason));
    this.drainQueue();
  }
  onTaskReport(e) {
    const bot = this.s.bots.get(e.botId);
    const task = bot?.task;
    if (!bot || !task || task.id !== e.taskId) return;
    const progress = bot.progress;
    bot.task = void 0;
    bot.progress = void 0;
    this.botSay(bot, task.issuer.id, reportText(task, progress, e));
    this.drainQueue();
  }
  onTaskProgress(e) {
    const bot = this.s.bots.get(e.botId);
    if (!bot?.task || bot.task.id !== e.taskId) return;
    bot.progress = { ...e.progress };
  }
  onTick(now2) {
    for (const [player, offer] of [...this.s.offers]) {
      if (!this.isLive(offer, now2)) {
        this.s.offers.delete(player);
        this.reply(player, msg.offerExpired());
      }
    }
    this.drainQueue();
  }
  // ---------------------------------------------------------------- helpers
  /** Assign queue heads to idle bots, registration order. */
  drainQueue() {
    for (const b of this.botList()) {
      if (this.s.queue.length === 0) return;
      if (b.task) continue;
      const task = this.s.queue.shift();
      this.assign(b, task);
      this.botSay(b, task.issuer.id, msg.pickingUp(taskActivity(task)));
    }
  }
  assignNew(bot, sender2, now2, spec2) {
    const task = this.newTask(sender2, now2, spec2);
    this.assign(bot, task);
    this.botSay(bot, sender2.id, task.kind === "goto" ? msg.onMyWay(task.target) : msg.gathering(task.amount, resourceLabel(task)));
  }
  /** The only place that emits `assign`. Enforces: bot must be idle (cancel first). */
  assign(bot, task) {
    if (bot.task) throw new Error(`colony invariant: assign to busy bot ${bot.id}`);
    bot.task = task;
    bot.progress = void 0;
    this.out.push({ kind: "assign", botId: bot.id, task: copyTask(task) });
  }
  /** The only place that emits `cancel`. Leaves the bot idle. */
  cancel(bot, reason) {
    const task = bot.task;
    if (!task) return;
    bot.task = void 0;
    bot.progress = void 0;
    this.out.push({ kind: "cancel", botId: bot.id, taskId: task.id, reason });
  }
  newTask(issuer, now2, spec2) {
    const id = `t${this.s.nextTaskNum++}`;
    if (spec2.kind === "goto") {
      return { id, kind: "goto", target: { ...spec2.target }, issuer: ref(issuer), createdAt: now2 };
    }
    return {
      id,
      kind: "gather",
      item: spec2.item,
      amount: spec2.amount,
      delivered: 0,
      origin: { ...spec2.origin },
      chest: copyChest(spec2.chest),
      issuer: ref(issuer),
      createdAt: now2
    };
  }
  takeLiveOffer(player, now2) {
    const offer = this.s.offers.get(player);
    this.s.offers.delete(player);
    return offer && this.isLive(offer, now2) ? offer : void 0;
  }
  isLive(offer, now2) {
    return now2 - offer.createdAt < this.config.offerTtlTicks;
  }
  offerSecs() {
    return Math.ceil(this.config.offerTtlTicks / 20);
  }
  botList() {
    return [...this.s.bots.values()];
  }
  findBot(name) {
    const key = name.replace(/^@/, "").toLowerCase();
    return this.botList().find((b) => b.name.toLowerCase() === key);
  }
  nameInUse(name) {
    const key = name.toLowerCase();
    return this.botList().some((b) => b.name.toLowerCase() === key) || this.s.pendingSpawns.some((p) => p.name.toLowerCase() === key);
  }
  defaultName() {
    for (let i = 1; ; i++) {
      const name = `${this.config.defaultBotNamePrefix}${i}`;
      if (!this.nameInUse(name)) return name;
    }
  }
  reply(to, text) {
    this.out.push({ kind: "reply", to, text });
  }
  botSay(bot, to, text) {
    this.out.push({ kind: "reply", to, from: bot.id, text });
  }
};
function resolveTarget(c, origin) {
  const r = (coord, base) => coord.relative ? base + coord.value : coord.value;
  return { x: r(c.target.x, origin.x), y: r(c.target.y, origin.y), z: r(c.target.z, origin.z) };
}
function statusLine(b) {
  return b.task ? msg.statusBusy(b.name, taskActivity(b.task, b.progress), b.task.issuer.name) : msg.statusIdle(b.name);
}
function splitAmount(amount, n) {
  const base = Math.floor(amount / n);
  const extra = amount % n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}
function withDelivered(t, progress) {
  if (t.kind !== "gather") return t;
  return { ...t, delivered: progress?.delivered ?? t.delivered };
}
function requeueable(t, progress) {
  const again = withDelivered(t, progress);
  return again.kind === "gather" && again.delivered >= again.amount ? void 0 : again;
}
function reportText(t, progress, e) {
  if (t.kind === "goto") return e.outcome === "done" ? msg.arrived(t.target) : msg.failed(t.target, e.reason);
  const label = RESOURCES[t.item].label;
  if (e.outcome === "done") return msg.delivered(Math.max(t.amount, progress?.delivered ?? 0), label);
  return msg.gatherFailed(label, progress?.delivered ?? t.delivered, t.amount, e.reason);
}
function chestLine(chest, items) {
  if (items === void 0) return msg.chestUnreadable(chest.pos);
  if (items.length === 0) return msg.chestEmpty(chest.pos);
  return msg.chestItems(chest.pos, items);
}
function copyChest(c) {
  return { dimensionId: c.dimensionId, pos: { ...c.pos } };
}
function ref(p) {
  return { id: p.id, name: p.name };
}
function copyTask(t) {
  switch (t.kind) {
    case "goto":
      return { ...t, target: { ...t.target }, issuer: { ...t.issuer } };
    case "gather":
      return { ...t, origin: { ...t.origin }, chest: { ...t.chest, pos: { ...t.chest.pos } }, issuer: { ...t.issuer } };
  }
}

// src/core/index.ts
function createColony(config) {
  return new Colony(config);
}
function handleChat(colony, text, sender2, now2) {
  const prefix = colony.config.prefix;
  if (!isCommand(text, prefix)) return { handled: false, effects: [] };
  const parsed = parseCommand(text, prefix);
  if (!parsed) return { handled: false, effects: [] };
  if (!parsed.ok) {
    const lines = parsed.usage ? [parsed.error, `Usage: ${parsed.usage}`] : [parsed.error];
    return { handled: true, effects: lines.map((line) => reply(sender2.id, line)) };
  }
  if (parsed.command.kind === "help") {
    const lines = helpText(parsed.command.topic, prefix);
    return { handled: true, effects: lines.map((line) => reply(sender2.id, line)) };
  }
  return { handled: true, effects: colony.handle({ kind: "command", now: now2, sender: sender2, command: parsed.command }) };
}
function reply(to, text) {
  return { kind: "reply", to, text };
}

// src/game/adapter/index.ts
import { Direction, GameMode, ItemStack } from "@minecraft/server";
import { LookDuration, spawnSimulatedPlayer } from "@minecraft/server-gametest";

// src/game/bots/executor.ts
var DEFAULT_GATHER_CONFIG = {
  scanRadius: 16,
  scanHalfHeight: 8,
  scanLayersPerPump: 2,
  maxTaskTicks: 12e3,
  // 10 min
  maxConsecutiveFailures: 5,
  breakReach: 4.5,
  containerReach: 2.5,
  pickupRadius: 4,
  pickupTimeoutTicks: 100,
  dropSettleTicks: 8,
  reserveSlots: 1,
  tableSearchRadius: 4
};
function createExecutor(registry, task, ctx) {
  const factory = registry[task.kind];
  return factory(task, ctx);
}

// src/game/bots/ports.ts
var HOTBAR_SIZE = 9;

// src/game/log.ts
var TAG = "[colony]";
function logInfo(msg2) {
  console.log(`${TAG} ${msg2}`);
}
function logWarn(msg2) {
  console.warn(`${TAG} ${msg2}`);
}
function logError(msg2, err) {
  console.error(err === void 0 ? `${TAG} ${msg2}` : `${TAG} ${msg2}: ${errText(err)}`);
}
function errText(err) {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

// src/game/adapter/world.ts
import { BlockTypes, BlockVolume, world } from "@minecraft/server";
var OVERWORLD = "minecraft:overworld";
var CHEST_LOOK_DISTANCE = 6;
var CHEST_NEAR_RADIUS = 4;
var LOG_EVERY = 25;
function rateLimitedLogger(prefix) {
  const counts = /* @__PURE__ */ new Map();
  return (key, err) => {
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    if ((n - 1) % LOG_EVERY === 0) logError(`${prefix}${key} failed (x${n})`, err);
  };
}
function blockPos(v) {
  return { x: Math.floor(v.x), y: Math.floor(v.y), z: Math.floor(v.z) };
}
function stackView(s) {
  const view2 = { typeId: s.typeId, amount: s.amount, maxAmount: s.maxAmount };
  try {
    const d = s.getComponent("durability");
    if (d) view2.durability = { damage: d.damage, max: d.maxDurability };
  } catch {
  }
  return view2;
}
function snapshotContainer(c) {
  const out = [];
  const size = c.size;
  for (let i = 0; i < size; i++) {
    const s = c.getItem(i);
    out.push(s ? stackView(s) : void 0);
  }
  return out;
}
function blockContainer(dim, pos) {
  const block = dim.getBlock(blockPos(pos));
  if (!block) return void 0;
  const container = block.getComponent("inventory")?.container;
  if (!container) return void 0;
  return { typeId: block.typeId, container };
}
var knownTypes = /* @__PURE__ */ new Map();
function knownBlockTypes(ids) {
  return ids.filter((id) => {
    const cached = knownTypes.get(id);
    if (cached !== void 0) return cached;
    try {
      const ok = BlockTypes.get(id) !== void 0;
      knownTypes.set(id, ok);
      return ok;
    } catch (err) {
      logError(`BlockTypes.get('${id}') failed`, err);
      return false;
    }
  });
}
function findIn(dim, box, typeIds) {
  const types = knownBlockTypes(typeIds);
  if (types.length === 0) return [];
  const volume = new BlockVolume(blockPos(box.min), blockPos(box.max));
  const out = [];
  for (const l of dim.getBlocks(volume, { includeTypes: types }, true).getBlockLocationIterator()) {
    out.push({ x: l.x, y: l.y, z: l.z });
  }
  return out;
}
var worldLog = rateLimitedLogger("world.");
function createWorldPort(dimensionId) {
  let dim;
  try {
    dim = world.getDimension(dimensionId);
    if (!dim) return void 0;
  } catch (err) {
    worldLog(`getDimension('${dimensionId}')`, err);
    return void 0;
  }
  return {
    dimensionId,
    blockAt(pos) {
      try {
        const b = dim.getBlock(blockPos(pos));
        if (!b) return void 0;
        return { typeId: b.typeId, isAir: b.isAir, isSolid: b.isSolid, isLiquid: b.isLiquid };
      } catch (err) {
        worldLog("blockAt", err);
        return void 0;
      }
    },
    findBlocks(box, typeIds) {
      try {
        return findIn(dim, box, typeIds);
      } catch (err) {
        worldLog("findBlocks", err);
        return void 0;
      }
    },
    itemsNear(center, radius, typeIds) {
      try {
        const out = [];
        for (const e of dim.getEntities({ type: "minecraft:item", location: center, maxDistance: radius })) {
          try {
            const s = e.getComponent("item")?.itemStack;
            if (!s) continue;
            if (typeIds && !typeIds.includes(s.typeId)) continue;
            const l = e.location;
            out.push({ id: e.id, typeId: s.typeId, amount: s.amount, pos: { x: l.x, y: l.y, z: l.z } });
          } catch {
          }
        }
        return out;
      } catch (err) {
        worldLog("itemsNear", err);
        return [];
      }
    },
    containerAt(pos) {
      try {
        const c = blockContainer(dim, pos);
        return c ? snapshotContainer(c.container) : void 0;
      } catch (err) {
        worldLog("containerAt", err);
        return void 0;
      }
    }
  };
}
function distSq(a, blockCorner) {
  const dx = blockCorner.x + 0.5 - a.x;
  const dy = blockCorner.y + 0.5 - a.y;
  const dz = blockCorner.z + 0.5 - a.z;
  return dx * dx + dy * dy + dz * dz;
}
function locateChest(player, near2, fallbackDimensionId = OVERWORLD) {
  let dim;
  try {
    dim = player ? player.dimension : world.getDimension(fallbackDimensionId);
  } catch (err) {
    logError(`locateChest: dimension unavailable`, err);
    return { ok: false, reason: player ? "error" : "no_player" };
  }
  try {
    const dimensionId = dim.id;
    if (player) {
      try {
        const block = player.getBlockFromViewDirection({ maxDistance: CHEST_LOOK_DISTANCE })?.block;
        if (block && CONTAINER_BLOCK_TYPES.includes(block.typeId)) {
          return { ok: true, chest: { dimensionId, pos: blockPos(block.location) } };
        }
      } catch (err) {
        logError(`locateChest: getBlockFromViewDirection failed (falling back to nearby search)`, err);
      }
    }
    const c = blockPos(near2);
    const r = CHEST_NEAR_RADIUS;
    const found = findIn(dim, { min: { x: c.x - r, y: c.y - r, z: c.z - r }, max: { x: c.x + r, y: c.y + r, z: c.z + r } }, CONTAINER_BLOCK_TYPES);
    let best;
    let bestD = Infinity;
    for (const p of found) {
      const d = distSq(near2, p);
      if (d < bestD || d === bestD && best && (p.x - best.x || p.y - best.y || p.z - best.z) < 0) {
        best = p;
        bestD = d;
      }
    }
    return best ? { ok: true, chest: { dimensionId, pos: best } } : { ok: false, reason: "none_found" };
  } catch (err) {
    logError(`locateChest failed`, err);
    return { ok: false, reason: "error" };
  }
}
function readChest(chest) {
  try {
    const c = blockContainer(world.getDimension(chest.dimensionId), chest.pos);
    if (!c) return void 0;
    const totals = /* @__PURE__ */ new Map();
    for (const s of snapshotContainer(c.container)) {
      if (s) totals.set(s.typeId, (totals.get(s.typeId) ?? 0) + s.amount);
    }
    return [...totals].map(([typeId, amount]) => ({ typeId, amount })).sort((a, b) => b.amount - a.amount || (a.typeId < b.typeId ? -1 : a.typeId > b.typeId ? 1 : 0));
  } catch (err) {
    logError(`readChest failed`, err);
    return void 0;
  }
}

// src/game/adapter/index.ts
function spawnBot(where2, name) {
  try {
    const p = spawnSimulatedPlayer(where2, name, GameMode.Survival);
    return { ok: true, body: wrapSimulatedPlayer(p, name) };
  } catch (err) {
    logError(`spawnSimulatedPlayer('${name}') failed`, err);
    return { ok: false, reason: errText(err) };
  }
}
var LOG_EVERY2 = 25;
function wrapSimulatedPlayer(p, name) {
  const id = p.id;
  let navFailures = 0;
  return {
    id,
    name,
    isValid: () => {
      try {
        return p.isValid;
      } catch {
        return false;
      }
    },
    location: () => {
      try {
        const l = p.location;
        return { x: l.x, y: l.y, z: l.z };
      } catch {
        return void 0;
      }
    },
    isOnGround: () => {
      try {
        return p.isOnGround;
      } catch {
        return false;
      }
    },
    navigateTo: (target) => {
      try {
        if (!p.isValid) return void 0;
        const r = p.navigateToLocation({ x: target.x, y: target.y, z: target.z });
        navFailures = 0;
        return { pathLength: r.getPath().length, isFullPath: r.isFullPath };
      } catch (err) {
        if (navFailures++ % LOG_EVERY2 === 0) logError(`${name}.navigateToLocation failed (x${navFailures})`, err);
        return void 0;
      }
    },
    stop: () => {
      try {
        if (!p.isValid) return;
        p.stopMoving();
      } catch (err) {
        logError(`${name}.stopMoving failed`, err);
      }
    },
    respawn: () => {
      try {
        return p.respawn();
      } catch (err) {
        logError(`${name}.respawn failed`, err);
        return false;
      }
    },
    disconnect: () => {
      try {
        if (!p.isValid) return;
        p.disconnect();
      } catch (err) {
        logError(`${name}.disconnect failed`, err);
      }
    },
    // ---------------------------------------------------------- Phase 2 (WorkerBody)
    ...workerMethods(p, name)
  };
}
var CONTAINER_REACH = DEFAULT_GATHER_CONFIG.containerReach;
var CONTAINER_MAX_DY = 2;
var BREAK_REACH = DEFAULT_GATHER_CONFIG.breakReach;
var BREAK_REACH_SLACK = 0.5;
var EYE_HEIGHT = 1.62;
var EPS = 1e-6;
function toDirection(face) {
  return Direction[face];
}
function withinContainerReach(feet, block, reach = CONTAINER_REACH) {
  const dx = block.x + 0.5 - feet.x;
  const dz = block.z + 0.5 - feet.z;
  return Math.hypot(dx, dz) <= reach + EPS && Math.abs(feet.y - (block.y + 0.5)) <= CONTAINER_MAX_DY + EPS;
}
function withinEyeReach(feet, block, reach = BREAK_REACH) {
  const dx = block.x + 0.5 - feet.x;
  const dy = block.y + 0.5 - (feet.y + EYE_HEIGHT);
  const dz = block.z + 0.5 - feet.z;
  return Math.hypot(dx, dy, dz) <= reach + EPS;
}
function recipeFor(plan) {
  return RECIPES.find((r) => r.id === plan.recipeId) ?? RECIPES.find((r) => r.output.typeId === plan.produce.typeId && r.output.amount === plan.produce.amount);
}
function planMatchesRecipe(plan, recipe) {
  if (plan.produce.typeId !== recipe.output.typeId || plan.produce.amount !== recipe.output.amount) return false;
  const used = recipe.ingredients.map(() => 0);
  for (const c of plan.consume) {
    if (!Number.isInteger(c.amount) || c.amount <= 0) return false;
    const i = recipe.ingredients.findIndex((ing) => ing.anyOf.includes(c.typeId));
    if (i < 0) return false;
    used[i] = (used[i] ?? 0) + c.amount;
  }
  return recipe.ingredients.every((ing, i) => used[i] === ing.amount);
}
function workerMethods(p, name) {
  const fail = rateLimitedLogger(`${name}.`);
  const feet = () => {
    const l = p.location;
    return l ? { x: l.x, y: l.y, z: l.z } : void 0;
  };
  const own = () => p.getComponent("inventory")?.container;
  const slotOk = (c, slot) => Number.isInteger(slot) && slot >= 0 && slot < c.size;
  const transferSetup = (chest) => {
    const f = feet();
    if (!f) return { ok: false, result: { ok: false, reason: "error" } };
    const dim = p.dimension;
    if (dim.id !== chest.dimensionId) return { ok: false, result: { ok: false, reason: "no_container" } };
    if (!withinContainerReach(f, chest.pos)) return { ok: false, result: { ok: false, reason: "out_of_reach" } };
    let found;
    try {
      found = blockContainer(dim, chest.pos);
    } catch {
      found = void 0;
    }
    if (!found || !CONTAINER_BLOCK_TYPES.includes(found.typeId)) return { ok: false, result: { ok: false, reason: "no_container" } };
    const bot = own();
    if (!bot) return { ok: false, result: { ok: false, reason: "error" } };
    return { ok: true, bot, box: found.container };
  };
  const settleTransfer = (from, slot, typeId, leftover) => {
    const after = from.getItem(slot);
    if (after && after.typeId === typeId) return after.amount;
    if (!after && leftover && leftover.amount > 0) {
      from.setItem(slot, leftover);
      return leftover.amount;
    }
    return 0;
  };
  return {
    dimensionId: () => {
      try {
        return p.dimension.id;
      } catch (err) {
        fail("dimension", err);
        return void 0;
      }
    },
    lookAtBlock: (block) => {
      try {
        p.lookAtBlock(blockPos(block), LookDuration.UntilMove);
        return true;
      } catch (err) {
        fail("lookAtBlock", err);
        return false;
      }
    },
    startBreaking: (block, face) => {
      try {
        const f = feet();
        const b = blockPos(block);
        if (!f || !withinEyeReach(f, b, BREAK_REACH + BREAK_REACH_SLACK)) return false;
        return p.breakBlock(b, toDirection(face));
      } catch (err) {
        fail("breakBlock", err);
        return false;
      }
    },
    stopBreaking: () => {
      try {
        if (!p.isValid) return;
        p.stopBreakingBlock();
      } catch (err) {
        fail("stopBreakingBlock", err);
      }
    },
    inventory: () => {
      try {
        const c = own();
        return c ? snapshotContainer(c) : void 0;
      } catch (err) {
        fail("inventory", err);
        return void 0;
      }
    },
    selectedSlot: () => {
      try {
        return p.selectedSlotIndex;
      } catch (err) {
        fail("selectedSlotIndex", err);
        return void 0;
      }
    },
    selectSlot: (slot) => {
      if (!Number.isInteger(slot) || slot < 0 || slot >= HOTBAR_SIZE) return false;
      try {
        p.selectedSlotIndex = slot;
        return true;
      } catch (err) {
        fail("selectSlot", err);
        return false;
      }
    },
    swapSlots: (a, b) => {
      try {
        const c = own();
        if (!c || !slotOk(c, a) || !slotOk(c, b)) return false;
        if (a !== b) c.swapItems(a, b, c);
        return true;
      } catch (err) {
        fail("swapSlots", err);
        return false;
      }
    },
    depositSlot: (chest, slot) => {
      try {
        const s = transferSetup(chest);
        if (!s.ok) return s.result;
        if (!slotOk(s.bot, slot)) return { ok: false, reason: "error" };
        const stack = s.bot.getItem(slot);
        if (!stack) return { ok: true, moved: 0 };
        const before = stack.amount;
        const leftover = s.bot.transferItem(slot, s.box);
        const remaining = settleTransfer(s.bot, slot, stack.typeId, leftover);
        return { ok: true, moved: Math.max(0, before - remaining) };
      } catch (err) {
        fail("depositSlot", err);
        return { ok: false, reason: "error" };
      }
    },
    withdrawSlot: (chest, chestSlot, amount) => {
      try {
        const s = transferSetup(chest);
        if (!s.ok) return s.result;
        if (!slotOk(s.box, chestSlot)) return { ok: false, reason: "error" };
        const stack = s.box.getItem(chestSlot);
        const want = Math.floor(amount);
        if (!stack || !(want > 0)) return { ok: true, moved: 0 };
        if (want >= stack.amount) {
          const before = stack.amount;
          const leftover2 = s.box.transferItem(chestSlot, s.bot);
          const remaining = settleTransfer(s.box, chestSlot, stack.typeId, leftover2);
          return { ok: true, moved: Math.max(0, before - remaining) };
        }
        const reduced = stack.clone();
        reduced.amount = stack.amount - want;
        const part = stack.clone();
        part.amount = want;
        s.box.setItem(chestSlot, reduced);
        let leftover;
        try {
          leftover = s.bot.addItem(part);
        } catch (err) {
          s.box.setItem(chestSlot, stack);
          throw err;
        }
        const added = want - (leftover?.amount ?? 0);
        if (added < want) {
          const back = stack.clone();
          back.amount = stack.amount - added;
          s.box.setItem(chestSlot, back);
        }
        return { ok: true, moved: added };
      } catch (err) {
        fail("withdrawSlot", err);
        return { ok: false, reason: "error" };
      }
    },
    applyCraft: (plan) => {
      try {
        const recipe = recipeFor(plan);
        if (!recipe || !planMatchesRecipe(plan, recipe)) return false;
        const c = own();
        if (!c) return false;
        if (recipe.needsTable || plan.tableAt) {
          if (!plan.tableAt) return false;
          const f = feet();
          if (!f || !withinEyeReach(f, blockPos(plan.tableAt))) return false;
          const table = p.dimension.getBlock(blockPos(plan.tableAt));
          if (!table || table.typeId !== CRAFTING_TABLE) return false;
        }
        const take = /* @__PURE__ */ new Map();
        for (const e of plan.consume) {
          if (!slotOk(c, e.slot)) return false;
          take.set(e.slot, (take.get(e.slot) ?? 0) + e.amount);
        }
        const originals = /* @__PURE__ */ new Map();
        for (const [slot, n] of take) {
          const s = c.getItem(slot);
          const types = new Set(plan.consume.filter((e) => e.slot === slot).map((e) => e.typeId));
          if (!s || types.size !== 1 || !types.has(s.typeId) || s.amount < n) return false;
          originals.set(slot, s);
        }
        const out = new ItemStack(plan.produce.typeId, plan.produce.amount);
        let room = 0;
        for (let i = 0; i < c.size && room < out.amount; i++) {
          const s = c.getItem(i);
          const left = (s?.amount ?? 0) - (take.get(i) ?? 0);
          if (!s || left <= 0) room += out.maxAmount;
          else if (s.typeId === out.typeId) room += Math.max(0, s.maxAmount - left);
        }
        if (room < out.amount) return false;
        try {
          for (const [slot, n] of take) {
            const s = originals.get(slot);
            if (s.amount === n) c.setItem(slot, void 0);
            else {
              const r = s.clone();
              r.amount = s.amount - n;
              c.setItem(slot, r);
            }
          }
        } catch (err) {
          for (const [slot, s] of originals) {
            try {
              c.setItem(slot, s);
            } catch {
            }
          }
          throw err;
        }
        const leftover = c.addItem(out);
        if (leftover && leftover.amount > 0) logError(`${name}.applyCraft: ${leftover.amount} ${out.typeId} didn't fit`);
        return true;
      } catch (err) {
        fail("applyCraft", err);
        return false;
      }
    },
    placeFromSlot: (slot, onBlock, face) => {
      try {
        const c = own();
        if (!c || !slotOk(c, slot) || !c.getItem(slot)) return false;
        const f = feet();
        const b = blockPos(onBlock);
        if (!f || !withinEyeReach(f, b, BREAK_REACH + BREAK_REACH_SLACK)) return false;
        return p.useItemInSlotOnBlock(slot, b, toDirection(face));
      } catch (err) {
        fail("useItemInSlotOnBlock", err);
        return false;
      }
    }
  };
}

// src/game/bots/gather-logic.ts
var EYE_HEIGHT2 = 1.62;
var WORLD_MIN_Y = -64;
var WORLD_MAX_Y = 319;
var add = (v, dx, dy, dz) => ({ x: v.x + dx, y: v.y + dy, z: v.z + dz });
function blockOf(v) {
  return { x: Math.floor(v.x), y: Math.floor(v.y), z: Math.floor(v.z) };
}
function blockCenter(b) {
  return { x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 };
}
function posKey(b) {
  return `${b.x},${b.y},${b.z}`;
}
function eyeDistance(feet, block) {
  const c = blockCenter(block);
  return Math.hypot(feet.x - c.x, feet.y + EYE_HEIGHT2 - c.y, feet.z - c.z);
}
function horizontalDistance(feet, block) {
  return Math.hypot(feet.x - (block.x + 0.5), feet.z - (block.z + 0.5));
}
function inBreakReach(feet, block, reach) {
  return eyeDistance(feet, block) <= reach;
}
function inContainerReach(feet, chest, reach) {
  return horizontalDistance(feet, chest) <= reach && Math.abs(feet.y - (chest.y + 0.5)) <= 2;
}
function faceToward(block, eye) {
  const c = blockCenter(block);
  const dx = eye.x - c.x;
  const dy = eye.y - c.y;
  const dz = eye.z - c.z;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const az = Math.abs(dz);
  if (ay >= ax && ay >= az) return dy >= 0 ? "Up" : "Down";
  if (ax >= az) return dx > 0 ? "East" : "West";
  return dz > 0 ? "South" : "North";
}
function scanBox(origin, cfg) {
  const b = blockOf(origin);
  const r = cfg.scanRadius;
  const h = cfg.scanHalfHeight;
  return {
    min: { x: b.x - r, y: Math.max(WORLD_MIN_Y, b.y - h), z: b.z - r },
    max: { x: b.x + r, y: Math.min(WORLD_MAX_Y, b.y + h), z: b.z + r }
  };
}
function scanSlices(origin, cfg) {
  const box = scanBox(origin, cfg);
  const minY = box.min.y;
  const maxY = box.max.y;
  if (minY > maxY) return [];
  const n = Math.max(1, Math.floor(cfg.scanLayersPerPump));
  const oy = Math.min(maxY, Math.max(minY, blockOf(origin).y));
  const firstLo = Math.max(minY, oy - Math.floor((n - 1) / 2));
  const firstHi = Math.min(maxY, firstLo + n - 1);
  const slice = (lo, hi) => ({
    min: { x: box.min.x, y: lo, z: box.min.z },
    max: { x: box.max.x, y: hi, z: box.max.z }
  });
  const out = [slice(firstLo, firstHi)];
  let up = firstHi + 1;
  let down = firstLo - 1;
  while (up <= maxY || down >= minY) {
    if (up <= maxY) {
      const hi = Math.min(maxY, up + n - 1);
      out.push(slice(up, hi));
      up = hi + 1;
    }
    if (down >= minY) {
      const lo = Math.max(minY, down - n + 1);
      out.push(slice(lo, down));
      down = lo - 1;
    }
  }
  return out;
}
function isPassable(b) {
  return b !== void 0 && !b.isSolid && !b.isLiquid;
}
function isStandable(probe, cell) {
  return isPassable(probe(cell)) && isPassable(probe(add(cell, 0, 1, 0))) && probe(add(cell, 0, -1, 0))?.isSolid === true;
}
var NEIGHBOURS = [
  [0, 1, 0],
  [0, -1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1]
];
function isExposed(probe, block) {
  return NEIGHBOURS.some(([dx, dy, dz]) => isPassable(probe(add(block, dx, dy, dz))));
}
function standCells(probe, block, reach) {
  const out = [];
  for (let dy = -3; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0 && dy > -2) continue;
        const cell = add(block, dx, dy, dz);
        const d = eyeDistance({ x: cell.x + 0.5, y: cell.y, z: cell.z + 0.5 }, block);
        if (d > reach) continue;
        if (!isStandable(probe, cell)) continue;
        out.push({ cell, d, key: posKey(cell) });
      }
    }
  }
  out.sort((a, b) => a.d - b.d || cmpStr(a.key, b.key));
  return out.map((e) => e.cell);
}
function cmpStr(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function rankCandidates(found, botPos, origin, cfg, exclude, riskCost = () => 0) {
  const o = blockOf(origin);
  const r = cfg.scanRadius;
  const seen = /* @__PURE__ */ new Set();
  const scored = [];
  for (const pos of found) {
    const key = posKey(pos);
    if (exclude.has(key) || seen.has(key)) continue;
    if (Math.abs(pos.x - o.x) > r || Math.abs(pos.z - o.z) > r) continue;
    seen.add(key);
    const c = blockCenter(pos);
    const dist3 = Math.hypot(botPos.x - c.x, botPos.y - c.y, botPos.z - c.z);
    scored.push({ pos, key, cost: dist3 + riskCost(pos) });
  }
  scored.sort((a, b) => a.cost - b.cost || cmpStr(a.key, b.key));
  return scored.map((s) => s.pos);
}
function estimateBreakTicks(blockTypeId, res, tool) {
  const hardness = BLOCK_HARDNESS[blockTypeId] ?? DEFAULT_HARDNESS;
  const matching = tool !== void 0 && tool.kind === res.tool;
  const speed = matching ? TOOL_SPEED[tool.tier] : 1;
  const harvestable = !res.requiresTool || matching;
  return Math.ceil(hardness * (harvestable ? 1.5 : 5) * 20 / speed - 1e-9);
}
function breakTimeoutTicks(estimate) {
  return 2 * estimate + 40;
}
function countItems(inv, typeIds) {
  let n = 0;
  for (const s of inv) if (s && typeIds.includes(s.typeId)) n += s.amount;
  return n;
}
function slotsWith(inv, typeIds) {
  const out = [];
  inv.forEach((s, i) => {
    if (s && typeIds.includes(s.typeId)) out.push(i);
  });
  return out;
}
function freeSlots(inv) {
  let n = 0;
  for (let i = 0; i < inv.length; i++) if (inv[i] === void 0) n++;
  return n;
}
function shouldDeposit(inv, res, remaining, cfg) {
  if (remaining <= 0) return true;
  if (countItems(inv, res.yields) >= remaining) return true;
  if (freeSlots(inv) > cfg.reserveSlots) return false;
  return !inv.some((s) => s !== void 0 && res.yields.includes(s.typeId) && s.amount < s.maxAmount);
}
function bestToolSlot(inv, kind) {
  let best;
  inv.forEach((s, slot) => {
    if (!s) return;
    const t = toolInfo(s.typeId);
    if (!t || t.kind !== kind) return;
    const left = s.durability ? s.durability.max - s.durability.damage : Number.POSITIVE_INFINITY;
    if (!best || t.rank < best.rank || t.rank === best.rank && left > best.left) best = { slot, rank: t.rank, left };
  });
  return best?.slot;
}
function planHotbar(inv, slot, selected) {
  if (slot >= 0 && slot < HOTBAR_SIZE) return { select: slot };
  for (let i = 0; i < HOTBAR_SIZE; i++) if (inv[i] === void 0) return { select: i, swapFrom: slot };
  const sel = selected !== void 0 && selected >= 0 && selected < HOTBAR_SIZE ? selected : 0;
  return { select: sel, swapFrom: slot };
}

// src/game/bots/crafting.ts
var NEW_STACK_MAX = 64;
function planCraft(recipe, inv, tableAt) {
  if (recipe.needsTable && !tableAt) return void 0;
  const left = inv.map((s) => s?.amount ?? 0);
  const taken = /* @__PURE__ */ new Map();
  for (const ing of recipe.ingredients) {
    let need = ing.amount;
    for (let i = 0; i < inv.length && need > 0; i++) {
      const s = inv[i];
      const l = left[i] ?? 0;
      if (!s || l <= 0 || !ing.anyOf.includes(s.typeId)) continue;
      const take = Math.min(l, need);
      left[i] = l - take;
      taken.set(i, (taken.get(i) ?? 0) + take);
      need -= take;
    }
    if (need > 0) return void 0;
  }
  const out = recipe.output;
  const fits = inv.some((s, i) => {
    const l = left[i] ?? 0;
    if (!s || l === 0) return out.amount <= NEW_STACK_MAX;
    return s.typeId === out.typeId && l + out.amount <= s.maxAmount;
  });
  if (!fits) return void 0;
  const consume = [...taken.entries()].sort((a, b) => a[0] - b[0]).map(([slot, amount]) => ({ slot, typeId: inv[slot].typeId, amount }));
  const plan = { recipeId: recipe.id, consume, produce: { typeId: out.typeId, amount: out.amount } };
  if (recipe.needsTable && tableAt) plan.tableAt = { x: tableAt.x, y: tableAt.y, z: tableAt.z };
  return plan;
}
function planksRecipeFor(logTypeId) {
  const id = ns(logTypeId);
  return PLANKS_RECIPES.find((r) => r.ingredients[0]?.anyOf.includes(id));
}
function count(inv, ids) {
  let n = 0;
  for (const s of inv) if (s && ids.includes(s.typeId)) n += s.amount;
  return n;
}
function planWoodenPickaxe(inv, tableNearby) {
  const planks = count(inv, PLANK_IDS);
  const sticks = count(inv, [STICK]);
  const haveTable = tableNearby || count(inv, [CRAFTING_TABLE]) > 0;
  const stickCrafts = sticks >= 2 ? 0 : 1;
  const tableCrafts = haveTable ? 0 : 1;
  const planksNeeded = 3 + 2 * stickCrafts + 4 * tableCrafts;
  const logsNeeded = Math.ceil(Math.max(0, planksNeeded - planks) / 4);
  const logs = LOG_IDS.map((id, order) => ({ id, order, n: count(inv, [id]) })).filter((l) => l.n > 0).sort((a, b) => b.n - a.n || a.order - b.order);
  const totalLogs = logs.reduce((s, l) => s + l.n, 0);
  if (totalLogs < logsNeeded) return { ok: false, logsMissing: logsNeeded - totalLogs };
  const steps = [];
  let todo = logsNeeded;
  for (const l of logs) {
    const recipe = planksRecipeFor(l.id);
    if (!recipe) continue;
    for (let i = 0; i < l.n && todo > 0; i++, todo--) steps.push({ kind: "craft", recipe });
    if (todo === 0) break;
  }
  if (stickCrafts) steps.push({ kind: "craft", recipe: STICK_RECIPE });
  if (tableCrafts) steps.push({ kind: "craft", recipe: CRAFTING_TABLE_RECIPE });
  if (!tableNearby) steps.push({ kind: "place_table" });
  steps.push({ kind: "craft", recipe: WOODEN_PICKAXE_RECIPE });
  return { ok: true, steps };
}
var TABLE_OFFSETS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1]
];
function tableSpot(probe, feet) {
  const f = blockOf(feet);
  for (const [dx, dz] of TABLE_OFFSETS) {
    const cell = { x: f.x + dx, y: f.y, z: f.z + dz };
    if (isStandable(probe, cell)) return { onBlock: { x: cell.x, y: cell.y - 1, z: cell.z }, face: "Up", tableAt: cell };
  }
  return void 0;
}

// src/game/bots/executor-logic.ts
var ARRIVE_DIST = 1.5;
var STUCK_TICKS = 100;
var MIN_PROGRESS = 0.5;
var TIMEOUT_BASE_TICKS = 200;
var TIMEOUT_TICKS_PER_BLOCK = 20;
function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
function timeoutTicks(dist3) {
  return Math.ceil(TIMEOUT_BASE_TICKS + TIMEOUT_TICKS_PER_BLOCK * Math.max(0, dist3));
}
function classifyNav(nav) {
  if (!nav) return "error";
  if (nav.pathLength === 0) return "none";
  return nav.isFullPath ? "full" : "partial";
}
function initGotoState(target, pos, now2) {
  const d = distance(pos, target);
  return {
    target: { ...target },
    startedAt: now2,
    deadline: now2 + timeoutTicks(d),
    bestDist: d,
    lastProgressAt: now2,
    navigating: false,
    lastNavPartial: false,
    repaths: 0,
    stallsSinceProgress: 0
  };
}
function decide(s, pos, now2) {
  if (pos) {
    const d = distance(pos, s.target);
    if (d <= ARRIVE_DIST) return { kind: "arrived" };
    if (d <= s.bestDist - MIN_PROGRESS) {
      s.bestDist = d;
      s.lastProgressAt = now2;
      s.stallsSinceProgress = 0;
    }
  }
  if (now2 >= s.deadline) return { kind: "timeout" };
  if (!pos) return { kind: "wait" };
  if (!s.navigating) return { kind: "navigate", repath: false };
  if (now2 - s.lastProgressAt >= STUCK_TICKS) {
    if (s.lastNavPartial && s.stallsSinceProgress >= 1) return { kind: "unreachable" };
    s.stallsSinceProgress++;
    s.repaths++;
    s.lastProgressAt = now2;
    return { kind: "navigate", repath: true };
  }
  return { kind: "wait" };
}
function onNavResult(s, nav, now2) {
  switch (nav) {
    case "none":
      return "unreachable";
    case "error":
      s.navigating = false;
      return "retry";
    case "full":
    case "partial":
      s.navigating = true;
      s.lastNavPartial = nav === "partial";
      s.lastProgressAt = now2;
      return "ok";
  }
}

// src/game/bots/nav.ts
var Walker = class {
  constructor(body, target) {
    __publicField(this, "body", body);
    __publicField(this, "target", target);
    __publicField(this, "state");
  }
  /** One pump. `pos` undefined = unreadable this pump (only the deadline is checked once started). */
  step(pos, now2) {
    if (!this.state) {
      if (!pos) return "walking";
      this.state = initGotoState(this.target, pos, now2);
    }
    const s = this.state;
    const d = decide(s, pos, now2);
    switch (d.kind) {
      case "arrived":
        return "arrived";
      case "timeout":
        return "timeout";
      case "unreachable":
        return "unreachable";
      case "wait":
        return "walking";
      case "navigate": {
        if (!this.body.isOnGround()) {
          s.navigating = false;
          return "walking";
        }
        const r = onNavResult(s, classifyNav(this.body.navigateTo(s.target)), now2);
        return r === "unreachable" ? "unreachable" : "walking";
      }
    }
  }
};
function feetIn(c) {
  return { x: c.x + 0.5, y: c.y, z: c.z + 0.5 };
}

// src/game/bots/gather-executor.ts
var START_WAIT_TICKS = 200;
var ARRIVE_GRACE_TICKS = 20;
var DROP_RENAV_TICKS = 20;
var PICK_CHECKS_PER_PUMP = 8;
var CHEST_RETRIES = 2;
var MAX_CRAFT_PUMPS = 24;
var RUNNING = { kind: "running" };
var failed = (reason) => ({ kind: "failed", reason });
var GatherExecutor = class {
  constructor(task, ctx) {
    __publicField(this, "task", task);
    __publicField(this, "ctx", ctx);
    __publicField(this, "taskId");
    __publicField(this, "res");
    __publicField(this, "cfg");
    __publicField(this, "body");
    __publicField(this, "world");
    __publicField(this, "probe", (p) => this.world?.blockAt(p));
    __publicField(this, "ph", "start");
    __publicField(this, "settled", false);
    __publicField(this, "delivered");
    __publicField(this, "lastInv");
    __publicField(this, "firstStepAt");
    __publicField(this, "deadline", Number.POSITIVE_INFINITY);
    /** Set when the task must end after a final deposit (timeout / no_source / unreachable / no_tool). */
    __publicField(this, "pendingFailure");
    __publicField(this, "failures", 0);
    __publicField(this, "blacklist", /* @__PURE__ */ new Set());
    // inner "logs for a pickaxe" gather: logs are kept in the inventory, not deposited
    __publicField(this, "gatheringLogs", false);
    __publicField(this, "logsTarget", 0);
    // scan
    __publicField(this, "slices");
    __publicField(this, "sliceIdx", 0);
    __publicField(this, "found", []);
    __publicField(this, "ranked");
    __publicField(this, "rankIdx", 0);
    __publicField(this, "needRerank", false);
    __publicField(this, "picksFromScan", 0);
    // approach / break / collect
    __publicField(this, "cand");
    __publicField(this, "walker");
    __publicField(this, "arrivedAt");
    __publicField(this, "breakTimeoutAt", 0);
    __publicField(this, "breaking", false);
    __publicField(this, "settleUntil", 0);
    __publicField(this, "collectUntil", 0);
    __publicField(this, "dropId");
    __publicField(this, "dropNavAt", 0);
    // chest
    __publicField(this, "chestPurpose", "deposit");
    __publicField(this, "chestWalker");
    __publicField(this, "chestRetries", 0);
    // craft
    __publicField(this, "tableAt");
    __publicField(this, "placedTableAt");
    __publicField(this, "craftPumps", 0);
    this.taskId = task.id;
    this.res = RESOURCES[task.item];
    this.cfg = ctx.gather;
    this.body = ctx.body;
    this.delivered = task.delivered;
  }
  step(now2) {
    if (this.settled) return RUNNING;
    let r;
    try {
      r = this.advance(now2);
    } catch (e) {
      logError(`${this.body.name}: gather ${this.taskId} crashed in ${this.ph}`, e);
      r = failed("error");
    }
    if (r.kind !== "running") {
      if (this.breaking) this.body.stopBreaking();
      this.body.stop();
      this.settled = true;
      this.ph = "finished";
      logInfo(
        `${this.body.name}: gather ${this.taskId} ${r.kind === "done" ? "done" : `failed (${r.reason})`} ${this.delivered}/${this.task.amount} ${this.res.label}`
      );
    }
    return r;
  }
  cancel() {
    if (this.settled) return;
    this.settled = true;
    this.ph = "finished";
    this.body.stopBreaking();
    this.body.stop();
  }
  progress() {
    return {
      kind: "gather",
      delivered: this.delivered,
      held: this.lastInv ? countItems(this.lastInv, this.res.yields) : 0
    };
  }
  /** Current phase (for tests and logs). */
  phase() {
    return this.ph;
  }
  // ------------------------------------------------------------ dispatch
  advance(now2) {
    if (this.ph === "start") return this.start(now2);
    const inv = this.body.inventory();
    if (inv) this.lastInv = inv;
    if (now2 >= this.deadline && this.pendingFailure === void 0) {
      this.pendingFailure = "timeout";
      const depositing = (this.ph === "toChest" || this.ph === "atChest") && this.chestPurpose === "deposit";
      if (!depositing) {
        this.stopBreakingIfNeeded();
        this.body.stop();
        return this.held() > 0 ? this.goToChest("deposit") : failed("timeout");
      }
    }
    switch (this.ph) {
      case "toChest":
        return this.toChest(now2);
      case "atChest":
        return this.atChest();
      case "craft":
        return this.craft();
      case "scan":
        return this.scan();
      case "approach":
        return this.approach(now2);
      case "break":
        return this.breakStep(now2);
      case "collect":
        return this.collect(now2);
      case "finished":
        return RUNNING;
    }
  }
  start(now2) {
    this.firstStepAt ?? (this.firstStepAt = now2);
    this.world ?? (this.world = this.ctx.world());
    if (!this.world) return failed("error");
    const pos = this.body.location();
    if (!pos) return now2 - this.firstStepAt >= START_WAIT_TICKS ? failed("timeout") : RUNNING;
    const inv = this.body.inventory();
    if (!inv) return now2 - this.firstStepAt >= START_WAIT_TICKS ? failed("error") : RUNNING;
    this.lastInv = inv;
    this.deadline = this.firstStepAt + this.cfg.maxTaskTicks;
    if (this.delivered >= this.task.amount) return { kind: "done" };
    if (this.needsToolFetch(inv)) return this.goToChest("tool");
    this.equipBest(inv, this.res);
    this.resetScan();
    return RUNNING;
  }
  // ------------------------------------------------------------ helpers
  active() {
    return this.gatheringLogs ? RESOURCES.log : this.res;
  }
  held() {
    return this.lastInv ? countItems(this.lastInv, this.res.yields) : 0;
  }
  needsToolFetch(inv) {
    return this.res.requiresTool && this.res.tool !== null && bestToolSlot(inv, this.res.tool) === void 0;
  }
  stopBreakingIfNeeded() {
    if (!this.breaking) return;
    this.breaking = false;
    this.body.stopBreaking();
  }
  /** Deposit held yields first (if any), then fail with `reason`. */
  failOrDeposit(reason) {
    this.body.stop();
    if (this.held() > 0) {
      this.pendingFailure ?? (this.pendingFailure = reason);
      return this.goToChest("deposit");
    }
    return failed(this.pendingFailure ?? reason);
  }
  /** Hold the best tool of `res.tool` (if any). Returns the ToolInfo of the item that ends up selected. */
  equipBest(inv, res) {
    const selected = this.body.selectedSlot();
    const slot = res.tool ? bestToolSlot(inv, res.tool) : void 0;
    if (slot === void 0) {
      const cur = selected !== void 0 ? inv[selected] : void 0;
      return cur ? toolInfo(cur.typeId) : void 0;
    }
    const item = inv[slot];
    if (slot !== selected) {
      const plan = planHotbar(inv, slot, selected);
      if (plan.swapFrom !== void 0 && !this.body.swapSlots(plan.swapFrom, plan.select)) return void 0;
      if (!this.body.selectSlot(plan.select)) return void 0;
    }
    return item ? toolInfo(item.typeId) : void 0;
  }
  resetScan() {
    this.ph = "scan";
    this.slices = void 0;
    this.ranked = void 0;
    this.found = [];
    this.sliceIdx = 0;
    this.rankIdx = 0;
    this.picksFromScan = 0;
    this.needRerank = false;
  }
  /** Back to scan keeping the cached ranked list (re-ranked from the new position). */
  toScan() {
    this.ph = "scan";
    this.cand = void 0;
    this.walker = void 0;
    this.needRerank = true;
    return RUNNING;
  }
  // ------------------------------------------------------------ chest
  goToChest(purpose) {
    this.stopBreakingIfNeeded();
    this.chestPurpose = purpose;
    this.chestWalker = void 0;
    this.chestRetries = 0;
    this.arrivedAt = void 0;
    this.ph = "toChest";
    logInfo(`${this.body.name}: to chest (${purpose}) for ${this.taskId}`);
    return RUNNING;
  }
  chestRetry() {
    this.chestRetries++;
    if (this.chestRetries > CHEST_RETRIES) return failed("no_chest");
    this.chestWalker = void 0;
    this.arrivedAt = void 0;
    this.ph = "toChest";
    return RUNNING;
  }
  toChest(now2) {
    const world10 = this.world;
    const chest = this.task.chest;
    if (world10.dimensionId !== chest.dimensionId) return failed("no_chest");
    const b = world10.blockAt(chest.pos);
    if (!b || !CONTAINER_BLOCK_TYPES.includes(b.typeId)) return failed("no_chest");
    const pos = this.body.location();
    if (!pos) return RUNNING;
    if (inContainerReach(pos, chest.pos, this.cfg.containerReach)) {
      this.body.stop();
      this.ph = "atChest";
      return RUNNING;
    }
    if (!this.chestWalker) {
      const cells = standCells(this.probe, chest.pos, this.cfg.breakReach).filter(
        (c) => inContainerReach(feetIn(c), chest.pos, this.cfg.containerReach)
      );
      const cell = cells[Math.min(this.chestRetries, cells.length - 1)];
      if (!cell) return failed("no_chest");
      this.chestWalker = new Walker(this.body, feetIn(cell));
      this.arrivedAt = void 0;
    }
    const st = this.chestWalker.step(pos, now2);
    if (st === "walking") return RUNNING;
    if (st === "arrived") {
      this.arrivedAt ?? (this.arrivedAt = now2);
      if (now2 - this.arrivedAt < ARRIVE_GRACE_TICKS) return RUNNING;
      this.body.stop();
      this.ph = "atChest";
      return RUNNING;
    }
    this.body.stop();
    return failed("no_chest");
  }
  atChest() {
    const world10 = this.world;
    const chest = this.task.chest;
    const pos = this.body.location();
    let inv = this.body.inventory();
    if (!pos || !inv) return RUNNING;
    if (!inContainerReach(pos, chest.pos, this.cfg.containerReach)) return this.chestRetry();
    let full = false;
    for (const slot of slotsWith(inv, this.res.yields)) {
      const amount = inv[slot]?.amount ?? 0;
      const r = this.body.depositSlot(chest, slot);
      if (!r.ok) return this.transferFailure(r.reason);
      this.delivered += r.moved;
      if (r.moved < amount) {
        full = true;
        break;
      }
    }
    inv = this.body.inventory() ?? inv;
    this.lastInv = inv;
    if (full) return this.delivered >= this.task.amount ? { kind: "done" } : failed("inventory_full");
    if (this.delivered >= this.task.amount) return { kind: "done" };
    if (this.pendingFailure) return failed(this.pendingFailure);
    if (this.res.tool && bestToolSlot(inv, this.res.tool) === void 0) {
      const cinv = world10.containerAt(chest.pos);
      const s = cinv ? bestToolSlot(cinv, this.res.tool) : void 0;
      if (s !== void 0) {
        const r = this.body.withdrawSlot(chest, s, 1);
        if (!r.ok) return this.transferFailure(r.reason);
        inv = this.body.inventory() ?? inv;
        this.lastInv = inv;
      }
    }
    if (this.needsToolFetch(inv)) {
      if (this.res.tool !== "pickaxe") return failed("no_tool");
      const plan = planWoodenPickaxe(inv, this.findTable(pos) !== void 0);
      if (!plan.ok) {
        let need = plan.logsMissing;
        const cinv = world10.containerAt(chest.pos) ?? [];
        for (const s of slotsWith(cinv, LOG_IDS)) {
          if (need <= 0) break;
          const r = this.body.withdrawSlot(chest, s, Math.min(need, cinv[s]?.amount ?? 0));
          if (!r.ok) return this.transferFailure(r.reason);
          need -= r.moved;
        }
      }
      this.ph = "craft";
      this.craftPumps = 0;
      logInfo(`${this.body.name}: crafting a wooden pickaxe for ${this.taskId}`);
      return RUNNING;
    }
    this.equipBest(inv, this.res);
    this.ph = "scan";
    this.needRerank = true;
    return RUNNING;
  }
  transferFailure(reason) {
    if (reason === "out_of_reach") return this.chestRetry();
    return failed(reason === "no_container" ? "no_chest" : "error");
  }
  // ------------------------------------------------------------ crafting
  /** A crafting table within break reach of `feet` (the one we placed first, else the nearest found). */
  findTable(feet) {
    const world10 = this.world;
    const reach = this.cfg.breakReach;
    if (this.tableAt && world10.blockAt(this.tableAt)?.typeId === CRAFTING_TABLE && inBreakReach(feet, this.tableAt, reach)) {
      return this.tableAt;
    }
    const f = blockOf(feet);
    const r = this.cfg.tableSearchRadius;
    const box = { min: { x: f.x - r, y: f.y - r, z: f.z - r }, max: { x: f.x + r, y: f.y + r, z: f.z + r } };
    const tables = (world10.findBlocks(box, [CRAFTING_TABLE]) ?? []).filter((t) => inBreakReach(feet, t, reach));
    tables.sort((a, b) => eyeDistance(feet, a) - eyeDistance(feet, b));
    return tables[0];
  }
  craft() {
    const world10 = this.world;
    const pos = this.body.location();
    const inv = this.body.inventory();
    if (!pos || !inv) return RUNNING;
    if (bestToolSlot(inv, "pickaxe") !== void 0) {
      this.equipBest(inv, this.res);
      this.resetScan();
      return RUNNING;
    }
    if (++this.craftPumps > MAX_CRAFT_PUMPS) return this.failOrDeposit("no_tool");
    if (this.placedTableAt) {
      if (world10.blockAt(this.placedTableAt)?.typeId !== CRAFTING_TABLE) return this.failOrDeposit("no_tool");
      this.tableAt = this.placedTableAt;
      this.placedTableAt = void 0;
    }
    const table = this.findTable(pos);
    const plan = planWoodenPickaxe(inv, table !== void 0);
    if (!plan.ok) {
      this.gatheringLogs = true;
      this.logsTarget = countItems(inv, LOG_IDS) + plan.logsMissing;
      this.resetScan();
      logInfo(`${this.body.name}: chopping ${plan.logsMissing} log(s) for a pickaxe (${this.taskId})`);
      return RUNNING;
    }
    const next = plan.steps[0];
    if (!next) return this.failOrDeposit("no_tool");
    if (next.kind === "place_table") {
      const spot = tableSpot(this.probe, pos);
      const slot = slotsWith(inv, [CRAFTING_TABLE])[0];
      if (!spot || slot === void 0) return this.failOrDeposit("no_tool");
      this.body.lookAtBlock(spot.onBlock);
      if (!this.body.placeFromSlot(slot, spot.onBlock, spot.face)) return this.failOrDeposit("no_tool");
      this.placedTableAt = spot.tableAt;
      return RUNNING;
    }
    const craftPlan = planCraft(next.recipe, inv, next.recipe.needsTable ? table : void 0);
    if (!craftPlan || !this.body.applyCraft(craftPlan)) return this.failOrDeposit("no_tool");
    return RUNNING;
  }
  // ------------------------------------------------------------ scan / approach / break / collect
  scan() {
    const world10 = this.world;
    const pos = this.body.location();
    if (!pos) return RUNNING;
    const act = this.active();
    if (!this.slices) {
      this.slices = scanSlices(this.task.origin, this.cfg);
      this.sliceIdx = 0;
      this.found = [];
      this.ranked = void 0;
      this.picksFromScan = 0;
    }
    if (!this.ranked) {
      const slice = this.slices[this.sliceIdx];
      if (slice) {
        this.sliceIdx++;
        const f = world10.findBlocks(slice, act.sources);
        if (f) this.found.push(...f);
        return RUNNING;
      }
      this.ranked = rankCandidates(this.found, pos, this.task.origin, this.cfg, this.blacklist);
      this.rankIdx = 0;
      this.found = [];
      this.needRerank = false;
    } else if (this.needRerank) {
      this.ranked = rankCandidates(this.ranked.slice(this.rankIdx), pos, this.task.origin, this.cfg, this.blacklist);
      this.rankIdx = 0;
      this.needRerank = false;
    }
    for (let checks = 0; checks < PICK_CHECKS_PER_PUMP && this.rankIdx < this.ranked.length; checks++) {
      const c = this.ranked[this.rankIdx++];
      const key = posKey(c);
      if (this.blacklist.has(key)) continue;
      const b = world10.blockAt(c);
      const cells = b && act.sources.includes(b.typeId) && isExposed(this.probe, c) ? standCells(this.probe, c, this.cfg.breakReach) : [];
      const cell = cells[0];
      if (!cell) {
        this.blacklist.add(key);
        continue;
      }
      this.picksFromScan++;
      this.cand = { block: c, cell };
      this.walker = void 0;
      this.arrivedAt = void 0;
      this.ph = "approach";
      return RUNNING;
    }
    if (this.rankIdx < this.ranked.length) return RUNNING;
    if (this.picksFromScan > 0) {
      this.slices = void 0;
      return RUNNING;
    }
    return this.failOrDeposit(this.gatheringLogs ? "no_tool" : "no_source");
  }
  candidateFailed() {
    if (this.cand) this.blacklist.add(posKey(this.cand.block));
    this.body.stop();
    this.failures++;
    if (this.failures >= this.cfg.maxConsecutiveFailures) {
      return this.failOrDeposit(this.gatheringLogs ? "no_tool" : "unreachable");
    }
    return this.toScan();
  }
  approach(now2) {
    const c = this.cand;
    const pos = this.body.location();
    if (!pos) return RUNNING;
    if (inBreakReach(pos, c.block, this.cfg.breakReach)) {
      if (!this.body.isOnGround()) return RUNNING;
      this.body.stop();
      return this.beginBreak(pos, now2);
    }
    this.walker ?? (this.walker = new Walker(this.body, feetIn(c.cell)));
    const st = this.walker.step(pos, now2);
    if (st === "walking") return RUNNING;
    if (st === "arrived") {
      this.arrivedAt ?? (this.arrivedAt = now2);
      if (now2 - this.arrivedAt < ARRIVE_GRACE_TICKS) return RUNNING;
    }
    return this.candidateFailed();
  }
  beginBreak(pos, now2) {
    const c = this.cand;
    const act = this.active();
    const inv = this.lastInv ?? [];
    if (!this.gatheringLogs && this.needsToolFetch(inv)) return this.goToChest("tool");
    const b = this.world.blockAt(c.block);
    if (!b || !act.sources.includes(b.typeId)) return this.toScan();
    const held = this.equipBest(inv, act);
    this.breakTimeoutAt = now2 + breakTimeoutTicks(estimateBreakTicks(b.typeId, act, held));
    this.body.lookAtBlock(c.block);
    const eye = { x: pos.x, y: pos.y + EYE_HEIGHT2, z: pos.z };
    if (!this.body.startBreaking(c.block, faceToward(c.block, eye))) return this.candidateFailed();
    this.breaking = true;
    this.ph = "break";
    return RUNNING;
  }
  breakStep(now2) {
    const c = this.cand;
    const b = this.world.blockAt(c.block);
    const present = b === void 0 || this.active().sources.includes(b.typeId);
    if (!present) {
      this.breaking = false;
      this.failures = 0;
      this.settleUntil = now2 + this.cfg.dropSettleTicks;
      this.collectUntil = this.settleUntil + this.cfg.pickupTimeoutTicks;
      this.dropId = void 0;
      this.ph = "collect";
      return RUNNING;
    }
    if (now2 >= this.breakTimeoutAt) {
      this.stopBreakingIfNeeded();
      return this.candidateFailed();
    }
    return RUNNING;
  }
  collect(now2) {
    if (now2 < this.settleUntil) return RUNNING;
    const c = this.cand;
    const pos = this.body.location();
    const drops = now2 < this.collectUntil ? this.world.itemsNear(blockCenter(c.block), this.cfg.pickupRadius, this.active().yields) : [];
    if (drops.length === 0) return this.finishCollect();
    if (!pos) return RUNNING;
    let d = drops[0];
    for (const x of drops) if (dist2(pos, x.pos) < dist2(pos, d.pos)) d = x;
    if (d.id !== this.dropId || now2 - this.dropNavAt >= DROP_RENAV_TICKS) {
      if (this.body.isOnGround()) this.body.navigateTo(d.pos);
      this.dropId = d.id;
      this.dropNavAt = now2;
    }
    return RUNNING;
  }
  finishCollect() {
    this.body.stop();
    this.cand = void 0;
    const inv = this.body.inventory() ?? this.lastInv ?? [];
    this.lastInv = inv;
    if (this.gatheringLogs) {
      if (countItems(inv, LOG_IDS) < this.logsTarget) return this.toScan();
      this.gatheringLogs = false;
      this.ph = "craft";
      this.craftPumps = 0;
      this.slices = void 0;
      return RUNNING;
    }
    if (shouldDeposit(inv, this.res, this.task.amount - this.delivered, this.cfg)) return this.goToChest("deposit");
    return this.toScan();
  }
};
function dist2(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

// src/game/bots/goto-executor.ts
var GotoExecutor = class {
  constructor(body, task) {
    __publicField(this, "body", body);
    __publicField(this, "task", task);
    __publicField(this, "taskId");
    __publicField(this, "state");
    /** Tick of the first step; bounds the wait for a readable start position. */
    __publicField(this, "firstStepAt");
    /** Cancelled or reported a terminal result. A settled executor never moves the body or reports again. */
    __publicField(this, "settled", false);
    this.taskId = task.id;
  }
  /** Call once per pump. Starts navigation on the first step. Returns a terminal result at most once. */
  step(now2) {
    if (this.settled) return { kind: "running" };
    const r = this.advance(now2);
    if (r.kind !== "running") this.settled = true;
    return r;
  }
  /** Goto has no progress to report. */
  progress() {
    return void 0;
  }
  /** Stops movement. Idempotent; after this, step() never reports. */
  cancel() {
    if (this.settled) return;
    this.settled = true;
    this.body.stop();
  }
  advance(now2) {
    const pos = this.body.location();
    if (!this.state) {
      this.firstStepAt ?? (this.firstStepAt = now2);
      if (!pos) {
        if (now2 - this.firstStepAt >= timeoutTicks(0)) return { kind: "failed", reason: "timeout" };
        return { kind: "running" };
      }
      this.state = initGotoState(this.task.target, pos, now2);
    }
    const s = this.state;
    const d = decide(s, pos, now2);
    switch (d.kind) {
      case "arrived":
        this.body.stop();
        return { kind: "done" };
      case "timeout":
        this.body.stop();
        return { kind: "failed", reason: "timeout" };
      case "unreachable":
        this.body.stop();
        return { kind: "failed", reason: "unreachable" };
      case "wait":
        return { kind: "running" };
      case "navigate": {
        if (!this.body.isOnGround()) {
          s.navigating = false;
          return { kind: "running" };
        }
        if (d.repath) logInfo(`${this.body.name}: no progress, re-pathing (#${s.repaths}) for ${this.taskId}`);
        const r = onNavResult(s, classifyNav(this.body.navigateTo(s.target)), now2);
        if (r === "unreachable") {
          this.body.stop();
          return { kind: "failed", reason: "unreachable" };
        }
        return { kind: "running" };
      }
    }
  }
};

// src/game/bots/registry.ts
var EXECUTORS = {
  goto: (task, ctx) => new GotoExecutor(ctx.body, task),
  gather: (task, ctx) => new GatherExecutor(task, ctx)
};

// src/game/frontends/chat.ts
import { system, world as world2 } from "@minecraft/server";
function installChatFrontend(prefix, submit) {
  let signal;
  try {
    signal = world2.beforeEvents.chatSend;
  } catch (err) {
    logError("world.beforeEvents.chatSend threw", err);
  }
  if (!signal || typeof signal.subscribe !== "function") {
    logWarn("world.beforeEvents.chatSend unavailable; use /colony:c <text> instead");
    return false;
  }
  try {
    signal.subscribe((ev) => {
      try {
        const message = ev.message;
        if (!isCommand(message, prefix)) return;
        ev.cancel = true;
        const sender2 = ev.sender;
        system.run(() => submit(sender2, message));
      } catch (err) {
        logError("chatSend handler failed", err);
      }
    });
    logInfo("chat front-end installed");
    return true;
  } catch (err) {
    logError("chatSend.subscribe failed; use /colony:c <text> instead", err);
    return false;
  }
}

// src/game/frontends/sender.ts
function senderOf(player) {
  const l = player.location;
  return { id: player.id, name: player.name, pos: { x: l.x, y: l.y, z: l.z } };
}

// src/game/frontends/slash.ts
import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  Player,
  system as system2
} from "@minecraft/server";
var SLASH_COMMAND = "colony:c";
function withPrefix(text, prefix) {
  const t = text.trim();
  return t.startsWith(prefix) ? t : `${prefix}${t}`;
}
var USAGE = `Usage: /${SLASH_COMMAND} <command> [args...] (or quote it: /${SLASH_COMMAND} "goto 1 2 3")`;
function playerOf(origin) {
  try {
    const src = origin.sourceEntity;
    if (src instanceof Player) return src;
    const init = origin.initiator;
    if (init instanceof Player) return init;
  } catch (err) {
    logError(`/${SLASH_COMMAND}: could not read command origin`, err);
  }
  return void 0;
}
function installSlashFrontend(prefix, submit) {
  try {
    system2.beforeEvents.startup.subscribe((ev) => {
      try {
        ev.customCommandRegistry.registerCommand(
          {
            name: SLASH_COMMAND,
            description: `Run a colony command, e.g. /${SLASH_COMMAND} come (same as ${prefix}come in chat)`,
            permissionLevel: CommandPermissionLevel.Any,
            cheatsRequired: false,
            // CustomCommandParamType has no message/rawtext type, and a String param captures one token
            // (or one "quoted string"), so the line is spread over 5 String params and re-joined: enough for
            // the longest command, goto <x> <y> <z> [count]. Longer input, or tokens the engine's String
            // parser rejects, must be quoted as one string. Whether "~5", "-3" and "@Bot-1" parse as plain
            // tokens is a SPIKE-CHECKLIST item.
            mandatoryParameters: [{ name: "text", type: CustomCommandParamType.String }],
            optionalParameters: [
              { name: "arg1", type: CustomCommandParamType.String },
              { name: "arg2", type: CustomCommandParamType.String },
              { name: "arg3", type: CustomCommandParamType.String },
              { name: "arg4", type: CustomCommandParamType.String }
            ]
          },
          (origin, ...args) => {
            const source = playerOf(origin);
            if (!source) {
              return { status: CustomCommandStatus.Failure, message: "Only players can use colony commands." };
            }
            const parts = args.filter((a) => typeof a === "string" && a.trim().length > 0);
            if (parts.length === 0) {
              return { status: CustomCommandStatus.Failure, message: USAGE };
            }
            const text = withPrefix(parts.join(" "), prefix);
            system2.run(() => submit(source, text));
            return { status: CustomCommandStatus.Success };
          }
        );
        logInfo(`registered /${SLASH_COMMAND}`);
      } catch (err) {
        logError(`registerCommand /${SLASH_COMMAND} failed`, err);
      }
    });
  } catch (err) {
    logError("system.beforeEvents.startup unavailable", err);
  }
}

// src/game/runtime.ts
var REPLY_BUFFER_PER_ID = 50;
var REPLY_BUFFER_IDS = 64;
var PUMP_INTERVAL_TICKS = 4;
var RESPAWN_DELAY_TICKS = 20;
var RESPAWN_RETRY_TICKS = 20;
var RESPAWN_MAX_ATTEMPTS = 5;
var Runtime = class {
  constructor() {
    __publicField(this, "colony", createColony());
    __publicField(this, "bots", /* @__PURE__ */ new Map());
    /** Events raised while executing effects; handled after the current effect list, in order. */
    __publicField(this, "pending", []);
    __publicField(this, "draining", false);
    /** Replies to ids with no online player (GameTest senders, offline players). Map order = least recently used first. */
    __publicField(this, "offlineReplies", /* @__PURE__ */ new Map());
  }
  start() {
    const prefix = this.colony.config.prefix;
    const submitFromPlayer = (player, text) => {
      let sender2;
      try {
        sender2 = senderOf(player);
      } catch (err) {
        logError("could not read command sender", err);
        return;
      }
      this.submitText(sender2, text);
    };
    guard("chat front-end install", () => installChatFrontend(prefix, submitFromPlayer));
    guard("slash front-end install", () => installSlashFrontend(prefix, submitFromPlayer));
    try {
      world3.afterEvents.entityDie.subscribe(
        (ev) => {
          let id;
          try {
            id = ev.deadEntity.id;
          } catch (err) {
            logError("entityDie: could not read dead entity id", err);
            return;
          }
          this.onEntityDie(id);
        },
        { entityTypes: ["minecraft:player"] }
      );
    } catch (err) {
      logError("entityDie subscribe failed; bot deaths won't be reported", err);
    }
    system3.runInterval(() => this.pump(), PUMP_INTERVAL_TICKS);
    logInfo("runtime started");
  }
  // ------------------------------------------------------------ public API
  submitText(sender2, text) {
    try {
      const out = handleChat(this.colony, text, sender2, now());
      if (!out.handled) return;
      this.execute(out.effects);
      this.drain();
    } catch (err) {
      logError(`submitText failed for '${text}'`, err);
    }
  }
  adoptBot(player, name) {
    const body = wrapSimulatedPlayer(player, name);
    if (!this.bots.has(body.id)) this.register(body);
    this.drain();
    return body.id;
  }
  botIds() {
    return [...this.bots.keys()];
  }
  snapshot() {
    return this.colony.snapshot();
  }
  recentReplies(to) {
    return [...this.offlineReplies.get(to) ?? []];
  }
  // ------------------------------------------------------------ event plumbing
  emit(e) {
    this.pending.push(e);
  }
  drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      for (let e = this.pending.shift(); e; e = this.pending.shift()) {
        let effects;
        try {
          effects = this.colony.handle(e);
        } catch (err) {
          logError(`colony.handle(${e.kind}) failed`, err);
          continue;
        }
        this.execute(effects);
      }
    } finally {
      this.draining = false;
    }
  }
  /** Strictly in order (cancel before assign). */
  execute(effects) {
    for (const fx of effects) {
      try {
        this.executeOne(fx);
      } catch (err) {
        logError(`effect ${fx.kind} failed`, err);
      }
    }
  }
  executeOne(fx) {
    switch (fx.kind) {
      case "reply":
        return this.reply(fx.to, fx.from, fx.text);
      case "assign": {
        const bot = this.bots.get(fx.botId);
        if (!bot) {
          logWarn(`assign to unknown bot ${fx.botId}`);
          this.emit({ kind: "botRemoved", now: now(), botId: fx.botId, reason: "missing" });
          return;
        }
        if (bot.executor) {
          logWarn(`${bot.name}: assign while busy with ${bot.executor.taskId}; replacing`);
          bot.executor.cancel();
        }
        bot.executor = void 0;
        bot.lastProgress = void 0;
        bot.executor = createExecutor(EXECUTORS, fx.task, contextFor(bot.body));
        return;
      }
      case "cancel": {
        const bot = this.bots.get(fx.botId);
        if (bot?.executor && bot.executor.taskId === fx.taskId) {
          bot.executor.cancel();
          bot.executor = void 0;
          bot.lastProgress = void 0;
        }
        return;
      }
      case "spawn":
        return this.spawn(fx.name, fx.near, fx.requestedBy);
      case "locateChest":
        return this.locateChest(fx.requestedBy, fx.near);
      case "inspectChest":
        return this.inspectChest(fx.to, fx.chest);
    }
  }
  // ------------------------------------------------------------ effects
  reply(to, from, text) {
    const line = from !== void 0 ? `<${this.botName(from)}> ${text}` : `\xA77[Colony]\xA7r ${text}`;
    if (to === "all") {
      world3.sendMessage(line);
      return;
    }
    const player = findPlayer(to);
    if (player) player.sendMessage(line);
    else this.bufferReply(to, line);
  }
  bufferReply(to, line) {
    let buf = this.offlineReplies.get(to);
    if (buf) {
      this.offlineReplies.delete(to);
    } else {
      buf = [];
      while (this.offlineReplies.size >= REPLY_BUFFER_IDS) {
        const oldest = this.offlineReplies.keys().next().value;
        if (oldest === void 0) break;
        this.offlineReplies.delete(oldest);
      }
    }
    buf.push(line);
    if (buf.length > REPLY_BUFFER_PER_ID) buf.splice(0, buf.length - REPLY_BUFFER_PER_ID);
    this.offlineReplies.set(to, buf);
  }
  /** `!chest set`: the looked-at / nearby container. GameTest senders have no player -> search near `near`. */
  locateChest(requestedBy, near2) {
    let ev;
    try {
      const res = locateChest(findPlayer(requestedBy), near2);
      ev = res.ok ? { kind: "chestLocated", now: now(), requestedBy, chest: res.chest } : { kind: "chestLocateFailed", now: now(), requestedBy, reason: res.reason };
    } catch (err) {
      logError("locateChest failed", err);
      ev = { kind: "chestLocateFailed", now: now(), requestedBy, reason: "error" };
    }
    this.emit(ev);
  }
  inspectChest(to, chest) {
    let items;
    try {
      items = readChest(chest);
    } catch (err) {
      logError("readChest failed", err);
      items = void 0;
    }
    this.emit({ kind: "chestInspected", now: now(), to, chest, items });
  }
  botName(id) {
    return this.bots.get(id)?.name ?? this.colony.snapshot().bots.find((b) => b.id === id)?.name ?? id;
  }
  spawn(name, near2, requestedBy) {
    const dimension = dimensionOf(requestedBy);
    const res = dimension ? spawnBot({ dimension, x: near2.x, y: near2.y, z: near2.z }, name) : { ok: false, reason: "no dimension" };
    if (!res.ok) {
      this.emit({ kind: "spawnFailed", now: now(), name, requestedBy, reason: res.reason });
      return;
    }
    this.register(res.body);
  }
  register(body) {
    this.bots.set(body.id, { body, name: body.name, respawnAttempts: 0 });
    logInfo(`registered bot ${body.name} (${body.id})`);
    this.emit({ kind: "botRegistered", now: now(), botId: body.id, name: body.name });
  }
  // ------------------------------------------------------------ game happenings
  onEntityDie(entityId) {
    const bot = this.bots.get(entityId);
    if (!bot) return;
    const t = now();
    logInfo(`${bot.name} died`);
    const ex = bot.executor;
    bot.executor = void 0;
    bot.lastProgress = void 0;
    bot.respawnAt = t + RESPAWN_DELAY_TICKS;
    bot.respawnAttempts = 0;
    if (ex) this.emit({ kind: "taskReport", now: t, botId: entityId, taskId: ex.taskId, outcome: "failed", reason: "bot_died" });
    this.drain();
  }
  /**
   * Every PUMP_INTERVAL_TICKS. Two passes so removals reach the core before reports (a report frees a
   * bot and drains the queue; the core must already know which bots are gone). Each bot is isolated:
   * one throwing executor fails only its own task. The whole body is guarded so the interval survives.
   */
  pump() {
    try {
      const t = now();
      const live = [];
      for (const [id, bot] of [...this.bots]) {
        try {
          if (bot.respawnAt !== void 0) {
            this.tryRespawn(id, bot, t);
            continue;
          }
          if (!bot.body.isValid()) {
            this.removeBot(id, bot, "gone");
            continue;
          }
          live.push([id, bot]);
        } catch (err) {
          logError(`pump: ${bot.name} lifecycle failed`, err);
        }
      }
      for (const [id, bot] of live) this.stepBot(id, bot, t);
      this.emit({ kind: "tick", now: t });
    } catch (err) {
      logError("pump failed", err);
    }
    try {
      this.drain();
    } catch (err) {
      logError("pump drain failed", err);
    }
  }
  stepBot(id, bot, t) {
    const ex = bot.executor;
    if (!ex) return;
    let r;
    try {
      r = ex.step(t);
    } catch (err) {
      logError(`${bot.name}: executor for ${ex.taskId} threw; failing the task`, err);
      ex.cancel();
      r = { kind: "failed", reason: "error" };
    }
    this.emitProgress(id, bot, ex, t);
    if (r.kind === "running") return;
    bot.executor = void 0;
    bot.lastProgress = void 0;
    this.emit(
      r.kind === "done" ? { kind: "taskReport", now: t, botId: id, taskId: ex.taskId, outcome: "done" } : { kind: "taskReport", now: t, botId: id, taskId: ex.taskId, outcome: "failed", reason: r.reason }
    );
  }
  /** taskProgress only when the executor's progress differs from the last value emitted for it. */
  emitProgress(id, bot, ex, t) {
    let p;
    try {
      p = ex.progress();
    } catch (err) {
      logError(`${bot.name}: progress() for ${ex.taskId} threw`, err);
      return;
    }
    if (!p || sameProgress(p, bot.lastProgress)) return;
    bot.lastProgress = { ...p };
    this.emit({ kind: "taskProgress", now: t, botId: id, taskId: ex.taskId, progress: { ...p } });
  }
  tryRespawn(id, bot, t) {
    if (bot.respawnAt === void 0 || t < bot.respawnAt) return;
    if (bot.body.respawn()) {
      logInfo(`${bot.name} respawned`);
      bot.respawnAt = void 0;
      bot.respawnAttempts = 0;
      return;
    }
    bot.respawnAttempts++;
    if (bot.respawnAttempts >= RESPAWN_MAX_ATTEMPTS) {
      logWarn(`${bot.name}: respawn failed ${bot.respawnAttempts}x; disconnecting`);
      bot.body.disconnect();
      this.removeBot(id, bot, "couldn't respawn");
      return;
    }
    bot.respawnAt = t + RESPAWN_RETRY_TICKS;
  }
  /** The core requeues the bot's task on botRemoved, so no taskReport here. */
  removeBot(id, bot, reason) {
    bot.executor = void 0;
    bot.lastProgress = void 0;
    this.bots.delete(id);
    logInfo(`bot ${bot.name} removed (${reason})`);
    this.emit({ kind: "botRemoved", now: now(), botId: id, reason });
  }
};
function contextFor(body) {
  return {
    body,
    world: () => {
      const dim = body.dimensionId();
      return dim === void 0 ? void 0 : createWorldPort(dim);
    },
    gather: DEFAULT_GATHER_CONFIG
  };
}
function sameProgress(a, b) {
  return b !== void 0 && a.kind === b.kind && a.delivered === b.delivered && a.held === b.held;
}
function guard(what, fn) {
  try {
    fn();
  } catch (err) {
    logError(`${what} failed`, err);
  }
}
function now() {
  return system3.currentTick;
}
function findPlayer(id) {
  try {
    return world3.getAllPlayers().find((p) => p.id === id);
  } catch (err) {
    logError("getAllPlayers failed", err);
    return void 0;
  }
}
function dimensionOf(playerId) {
  const player = findPlayer(playerId);
  if (player) {
    try {
      return player.dimension;
    } catch {
    }
  }
  try {
    return world3.getDimension("overworld");
  } catch (err) {
    logError("getDimension(overworld) failed", err);
    return void 0;
  }
}
var instance;
function startColonyRuntime() {
  if (!instance) {
    instance = new Runtime();
    instance.start();
  }
  return instance;
}
function getRuntime() {
  return instance;
}

// src/probes/index.ts
import {
  CommandPermissionLevel as CommandPermissionLevel2,
  CustomCommandParamType as CustomCommandParamType2,
  CustomCommandStatus as CustomCommandStatus2,
  Player as Player5,
  system as system9,
  world as world9
} from "@minecraft/server";
import * as gametest from "@minecraft/server-gametest";

// src/probes/chat.ts
import { system as system5, world as world5 } from "@minecraft/server";

// src/probes/util.ts
import { GameMode as GameMode2, system as system4, world as world4 } from "@minecraft/server";
import { SimulatedPlayer, spawnSimulatedPlayer as spawnSimulatedPlayer2 } from "@minecraft/server-gametest";
var VERDICT_COLOR = { PASS: "\xA7a", FAIL: "\xA7c", INCONCLUSIVE: "\xA76" };
function log(text, chat = true) {
  try {
    console.warn(`[probe] ${text}`);
  } catch {
  }
  if (chat) {
    try {
      world4.sendMessage(`\xA7e[probe]\xA7r ${text}`);
    } catch {
    }
  }
}
function trace(text) {
  try {
    console.info(`[probe] ${text}`);
  } catch {
  }
}
var ProbeReport = class {
  constructor(name) {
    __publicField(this, "name", name);
    __publicField(this, "facts", []);
    __publicField(this, "ended", false);
    log(`${name}: started`);
  }
  note(text, chat = true) {
    log(`${this.name}: ${text}`, chat);
  }
  fact(key, value) {
    this.facts.push(`${key}=${fmt(value)}`);
  }
  end(verdict, summary) {
    if (this.ended) return;
    this.ended = true;
    if (this.facts.length > 0) log(`${this.name}: facts: ${this.facts.join("  ")}`);
    try {
      console.warn(`[probe] ${this.name}: RESULT ${verdict} - ${summary}`);
    } catch {
    }
    try {
      world4.sendMessage(`\xA7e[probe]\xA7r ${this.name}: ${VERDICT_COLOR[verdict]}RESULT ${verdict}\xA7r - ${summary}`);
    } catch {
    }
  }
};
function fmt(v) {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (v && typeof v === "object" && "x" in v && "y" in v && "z" in v) return fmtVec(v);
  if (Array.isArray(v)) return `[${v.map(fmt).join(", ")}]`;
  return String(v);
}
function fmtVec(v) {
  return `(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`;
}
function errMsg(e) {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
function hdist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
function copy(v) {
  return { x: v.x, y: v.y, z: v.z };
}
function sleep(ticks) {
  return new Promise((resolve) => {
    system4.runTimeout(() => resolve(), Math.max(1, Math.floor(ticks)));
  });
}
async function waitUntil(cond, maxTicks, step = 2) {
  for (let t = 0; t <= maxTicks; t += step) {
    try {
      if (cond()) return true;
    } catch {
    }
    await sleep(step);
  }
  return false;
}
function spawnBotNear(player, name, dx, dz) {
  const l = player.location;
  return spawnSimulatedPlayer2(
    { dimension: player.dimension, x: Math.floor(l.x) + dx + 0.5, y: l.y, z: Math.floor(l.z) + dz + 0.5 },
    name,
    GameMode2.Survival
  );
}
function safeDisconnect(bot, name) {
  try {
    if (bot?.isValid) {
      bot.disconnect();
      return true;
    }
  } catch (e) {
    log(`disconnect failed: ${errMsg(e)}`, false);
  }
  if (name === void 0) return false;
  try {
    const p = world4.getAllPlayers().find((x) => x.name === name);
    if (p && isSimulated(p)) {
      p.disconnect();
      return true;
    }
  } catch (e) {
    log(`disconnect by name '${name}' failed: ${errMsg(e)}`, false);
  }
  return false;
}
function isSimulated(p) {
  try {
    if (p instanceof SimulatedPlayer) return true;
    const sp = p;
    return typeof sp.disconnect === "function" && typeof sp.navigateToLocation === "function";
  } catch {
    return false;
  }
}
function inPlayerList(id) {
  try {
    return world4.getAllPlayers().some((p) => p.id === id);
  } catch {
    return false;
  }
}
async function waitOnGround(bot, maxTicks) {
  return waitUntil(() => bot.isValid && bot.isOnGround, maxTicks, 2);
}

// src/probes/chat.ts
var TOKEN = "!probe-chat";
var WINDOW_TICKS = 600;
var SETTLE_TICKS = 20;
function chatProbe() {
  return new Promise((resolve) => {
    const r = new ProbeReport("chat");
    let beforeSig;
    let afterSig;
    try {
      beforeSig = world5.beforeEvents.chatSend;
    } catch (e) {
      r.note(`beforeEvents.chatSend threw: ${errMsg(e)}`);
    }
    if (!beforeSig || typeof beforeSig.subscribe !== "function") {
      r.end("FAIL", "world.beforeEvents.chatSend is unavailable (Beta APIs off?)");
      resolve();
      return;
    }
    try {
      afterSig = world5.afterEvents.chatSend;
    } catch {
      afterSig = void 0;
    }
    let fired = 0;
    let cancelReadBack;
    let sender2 = "";
    let afterSeen = 0;
    let finished = false;
    let windowRun;
    let afterSub = false;
    const onBefore = (ev) => {
      try {
        if (ev.message.trim().toLowerCase() !== TOKEN) return;
        fired++;
        ev.cancel = true;
        cancelReadBack = ev.cancel;
        sender2 = ev.sender.name;
        if (fired === 1) system5.runTimeout(() => finish(), SETTLE_TICKS);
      } catch {
      }
    };
    const onAfter = (ev) => {
      try {
        if (ev.message.trim().toLowerCase() === TOKEN) afterSeen++;
      } catch {
      }
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      try {
        if (windowRun !== void 0) system5.clearRun(windowRun);
      } catch {
      }
      try {
        beforeSig?.unsubscribe(onBefore);
      } catch {
      }
      try {
        afterSig?.unsubscribe(onAfter);
      } catch {
      }
      r.fact("beforeFired", fired);
      r.fact("sender", sender2 || "-");
      r.fact("cancelReadBack", cancelReadBack);
      r.fact("afterEventAvailable", afterSub);
      r.fact("afterFiredForToken", afterSeen);
      if (fired === 0) {
        r.end("FAIL", `no chatSend before-event for '${TOKEN}' within 30 s (if nobody typed it, rerun)`);
      } else if (!afterSub) {
        r.end("INCONCLUSIVE", "before-event fired and cancel was set, but the after-event is unavailable - check by eye that the message was hidden");
      } else if (afterSeen === 0) {
        r.end("PASS", "before-event fired, cancel was set and no after-event followed. Check by eye that the message did NOT appear in chat");
      } else {
        r.end("FAIL", "before-event fired, but the message was still broadcast (after-event fired) - cancel has no effect");
      }
      resolve();
    };
    try {
      beforeSig.subscribe(onBefore);
    } catch (e) {
      r.end("FAIL", `chatSend.subscribe threw: ${errMsg(e)}`);
      resolve();
      return;
    }
    try {
      if (afterSig) {
        afterSig.subscribe(onAfter);
        afterSub = true;
      }
    } catch {
      afterSub = false;
    }
    r.note(`type \xA7b${TOKEN}\xA7r in chat within 30 s, then note whether it appeared in chat`);
    windowRun = system5.runTimeout(() => finish(), WINDOW_TICKS);
  });
}

// src/probes/chunks.ts
import { system as system6, world as world6 } from "@minecraft/server";
var FAR = 160;
var OVERSHOOT = 340;
var TOTAL_SECONDS = 120;
var FAR_SECONDS = 30;
var WAYPOINT = 8;
var MOVED_EPS = 0.2;
function nearestRealPlayer(pos, dimId, botId) {
  let best = Number.POSITIVE_INFINITY;
  try {
    for (const p of world6.getAllPlayers()) {
      if (p.id === botId || isSimulated(p) || p.dimension.id !== dimId) continue;
      const d = hdist(p.location, pos);
      if (d < best) best = d;
    }
  } catch {
  }
  return best;
}
async function chunksProbe(player) {
  const r = new ProbeReport("chunks");
  let bot;
  const botName2 = `Probe-far-${system6.currentTick % 1e3}`;
  try {
    const playerStart = copy(player.location);
    try {
      bot = spawnBotNear(player, botName2, 2, 0);
    } catch (e) {
      r.end("FAIL", `spawnSimulatedPlayer threw: ${errMsg(e)}`);
      return;
    }
    await waitOnGround(bot, 60);
    const dimId = bot.dimension.id;
    const botId = bot.id;
    const dim = bot.dimension;
    const origin = copy(bot.location);
    const farTarget = { x: origin.x + OVERSHOOT, y: origin.y, z: origin.z };
    try {
      bot.isSprinting = true;
    } catch {
    }
    let mode = "navigateToLocation";
    try {
      const res = bot.navigateToLocation(farTarget);
      r.fact("nav.isFullPath", res.isFullPath);
      r.fact("nav.pathLen", res.getPath().length);
      if (res.getPath().length === 0) mode = "waypoints";
    } catch (e) {
      r.note(`navigateToLocation(far) threw: ${errMsg(e)} - using waypoints`, false);
      mode = "waypoints";
    }
    r.note(`stay where you are. The bot walks east (+x) from ${fmtVec(origin)} for up to ${TOTAL_SECONDS} s (1 sample/s)`);
    const samples = [];
    let prev = copy(bot.location);
    let stuckSeconds = 0;
    let triedFly = false;
    let farCount = 0;
    let maxDx = 0;
    let playerWandered = 0;
    for (let t = 1; t <= TOTAL_SECONDS; t++) {
      await sleep(20);
      const s = { t, valid: false, dReal: Number.NaN, moved: 0 };
      try {
        s.valid = bot.isValid;
        if (s.valid) {
          const pos = copy(bot.location);
          s.pos = pos;
          s.moved = prev ? hdist(pos, prev) : 0;
          prev = pos;
          s.dReal = nearestRealPlayer(pos, dimId, botId);
          try {
            s.chunkLoaded = dim.isChunkLoaded(pos);
          } catch {
            s.chunkLoaded = void 0;
          }
          maxDx = Math.max(maxDx, pos.x - origin.x);
        }
      } catch (e) {
        trace(`chunks: sample ${t} error ${errMsg(e)}`);
      }
      try {
        if (player.isValid) playerWandered = Math.max(playerWandered, hdist(player.location, playerStart));
      } catch {
      }
      samples.push(s);
      trace(
        `chunks t=${t}s valid=${s.valid} pos=${s.pos ? fmtVec(s.pos) : "-"} moved=${s.moved.toFixed(2)} dReal=${Number.isFinite(s.dReal) ? s.dReal.toFixed(1) : "none"} chunkLoaded=${String(s.chunkLoaded)}`
      );
      if (t % 10 === 0) r.note(`t=${t}s dx=${maxDx.toFixed(0)} dReal=${Number.isFinite(s.dReal) ? s.dReal.toFixed(0) : "none"} valid=${s.valid}`, true);
      if (!s.valid) {
        if (samples.slice(-5).every((x) => !x.valid)) break;
        continue;
      }
      if (s.dReal >= FAR) farCount++;
      if (farCount >= FAR_SECONDS) break;
      if (s.moved < MOVED_EPS) stuckSeconds++;
      else stuckSeconds = 0;
      if (s.pos && (mode === "waypoints" || stuckSeconds >= 2)) {
        try {
          if (stuckSeconds >= 2) bot.jump();
          if (stuckSeconds >= 6 && !triedFly) {
            triedFly = true;
            bot.fly();
            r.note("bot stuck for 6 s - trying fly() to clear terrain", false);
          }
          const yBoost = triedFly ? 3 : 0;
          bot.moveToLocation({ x: s.pos.x + WAYPOINT, y: s.pos.y + yBoost, z: origin.z });
          mode = "waypoints";
        } catch (e) {
          trace(`chunks: step error ${errMsg(e)}`);
        }
      }
    }
    const far = samples.filter((s) => s.valid && s.dReal >= FAR);
    let farIntervals = 0;
    let farMoving = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      if (!a || !b || !a.valid || !b.valid || a.dReal < FAR || b.dReal < FAR) continue;
      farIntervals++;
      if (b.moved >= MOVED_EPS) farMoving++;
    }
    const farUnloaded = far.filter((s) => s.chunkLoaded === false).length;
    const wentInvalid = samples.some((s) => !s.valid);
    const firstInvalid = samples.find((s) => !s.valid);
    const lastValid = [...samples].reverse().find((s) => s.valid);
    r.fact("maxDx", maxDx);
    r.fact(`farSamples(>=${FAR})`, far.length);
    r.fact("farIntervalsMoving", `${farMoving}/${farIntervals}`);
    r.fact("farChunkUnloaded", farUnloaded);
    r.fact("wentInvalid", wentInvalid ? `yes at t=${firstInvalid?.t}s` : "no");
    r.fact("lastValid.dReal", lastValid?.dReal ?? Number.NaN);
    r.fact("playerWandered", playerWandered);
    r.fact("flew", triedFly);
    if (playerWandered > 16) {
      r.end("INCONCLUSIVE", `you moved ${playerWandered.toFixed(0)} blocks - stay put and rerun`);
    } else if (wentInvalid && (lastValid?.dReal ?? 0) >= FAR - 32) {
      r.end("FAIL", `bot became invalid ~${(lastValid?.dReal ?? 0).toFixed(0)} blocks from you - it does NOT stay loaded when far away`);
    } else if (farIntervals < 5) {
      r.end("INCONCLUSIVE", `bot only got ${maxDx.toFixed(0)} blocks away (needs >${FAR}); use a flat world or a clear path east (+x)`);
    } else if (farMoving / farIntervals >= 0.6) {
      r.end("PASS", `bot kept moving beyond ${FAR} blocks (${farMoving}/${farIntervals} 1-s intervals moved, ${farUnloaded} samples in unloaded chunks) - it ticks away from players`);
    } else if (farUnloaded > 0 || farMoving === 0) {
      r.end("FAIL", `bot froze beyond ${FAR} blocks (${farMoving}/${farIntervals} intervals moved, chunkUnloaded=${farUnloaded}) - not ticking away from players`);
    } else {
      r.end("INCONCLUSIVE", `mixed movement beyond ${FAR} (${farMoving}/${farIntervals}); chunk stayed loaded - possibly stuck on terrain`);
    }
  } catch (e) {
    r.end("INCONCLUSIVE", `probe error: ${errMsg(e)}`);
  } finally {
    const did = safeDisconnect(bot, botName2);
    r.note(`cleanup: disconnect called=${did}${did ? "" : " (bot already gone or unloaded - check /list)"}`, false);
  }
}

// src/probes/reload.ts
import { system as system7, world as world7 } from "@minecraft/server";
var KEY = "colony:probe_reload";
var SESSION = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
function readPrev() {
  try {
    const raw = world7.getDynamicProperty(KEY);
    if (typeof raw !== "string") return void 0;
    const v = JSON.parse(raw);
    if (typeof v.session === "string" && Array.isArray(v.names)) {
      return { session: v.session, names: v.names.map(String), tick: typeof v.tick === "number" ? v.tick : void 0 };
    }
  } catch {
  }
  return void 0;
}
function reloadProbe() {
  const r = new ProbeReport("reload");
  try {
    const all = world7.getAllPlayers();
    const allNames = all.map((p) => p.name);
    const sims = all.filter(isSimulated);
    const names = sims.map((p) => p.name);
    r.fact("players", allNames);
    if (sims.length === 0) r.note("no simulated players detected in the world");
    for (const p of sims) {
      let where2 = "?";
      try {
        where2 = `${fmtVec(p.location)} ${p.dimension.id} valid=${p.isValid}`;
      } catch (e) {
        where2 = `err ${errMsg(e)}`;
      }
      r.note(`simulated player '${p.name}' at ${where2}`);
    }
    const prev = readPrev();
    try {
      world7.setDynamicProperty(KEY, JSON.stringify({ session: SESSION, names, tick: system7.currentTick }));
    } catch (e) {
      r.note(`could not store snapshot: ${errMsg(e)}`);
    }
    r.fact("now", names);
    r.fact("prev", prev ? prev.names : "none");
    r.fact("reloadedSincePrev", prev ? prev.session !== SESSION : "n/a");
    const scriptOnly = prev?.tick !== void 0 && prev.session !== SESSION && system7.currentTick > prev.tick;
    r.fact("tick", `${prev?.tick ?? "?"} -> ${system7.currentTick}`);
    if (!prev || prev.session === SESSION) {
      r.end(
        "INCONCLUSIVE",
        `baseline recorded (${names.length} simulated player${names.length === 1 ? "" : "s"}). Spawn bots first if 0. Then save & quit, reopen the world, wait ~5 s and run /colony:probe reload again`
      );
      return;
    }
    if (scriptOnly) r.note("tick did not restart since the baseline - this looks like /reload, not Save & Quit + reopen");
    if (prev.names.length === 0) {
      r.end("INCONCLUSIVE", "reload detected, but the baseline had no bots. Spawn some, record a baseline, reload and rerun");
      return;
    }
    const survived = prev.names.filter((n) => allNames.includes(n));
    const notDetected = survived.filter((n) => !names.includes(n));
    if (notDetected.length > 0) r.fact("presentButNotDetectedAsSimulated", notDetected);
    r.fact("survived", survived);
    if (survived.length === prev.names.length) {
      r.end("PASS", `${survived.length === 1 ? "the 1 simulated player" : `all ${survived.length} simulated players`} came back after the reload (the Phase 1 runtime does not re-adopt them)`);
    } else if (survived.length === 0) {
      r.end("FAIL", `${prev.names.length === 1 ? "the 1 simulated player did not come" : `none of ${prev.names.length} simulated players came`} back after the reload - the colony must respawn bots itself`);
    } else {
      r.end("INCONCLUSIVE", `${survived.length}/${prev.names.length} came back - rerun in a few seconds (late join?)`);
    }
  } catch (e) {
    r.end("INCONCLUSIVE", `probe error: ${errMsg(e)}`);
  }
}

// src/probes/spawn.ts
import { system as system8, world as world8 } from "@minecraft/server";
var ARRIVE = 1.5;
var STEP = 5;
function readCheats() {
  try {
    return String(world8.allowCheats);
  } catch (e) {
    return `unknown (${errMsg(e)})`;
  }
}
function pickTarget(dim, from) {
  const base = { x: Math.floor(from.x), y: Math.floor(from.y + 0.01), z: Math.floor(from.z) };
  const dirs = [
    ["+x", STEP, 0],
    ["-x", -STEP, 0],
    ["+z", 0, STEP],
    ["-z", 0, -STEP]
  ];
  for (const [name, dx, dz] of dirs) {
    try {
      const x = base.x + dx;
      const z = base.z + dz;
      const below = dim.getBlock({ x, y: base.y - 1, z });
      const feet = dim.getBlock({ x, y: base.y, z });
      const head = dim.getBlock({ x, y: base.y + 1, z });
      if (below?.isSolid && feet?.isAir && head?.isAir) return { target: { x: x + 0.5, y: base.y, z: z + 0.5 }, dir: name };
    } catch {
    }
  }
  return { target: { x: base.x + STEP + 0.5, y: base.y, z: base.z + 0.5 }, dir: "+x (unchecked)" };
}
async function spawnProbe(player) {
  const r = new ProbeReport("spawn");
  const cheats = readCheats();
  r.fact("allowCheats", cheats);
  let bot;
  const botName2 = `Probe-${system8.currentTick % 1e5}`;
  try {
    try {
      bot = spawnBotNear(player, botName2, 2, 0);
    } catch (e) {
      r.end("FAIL", `top-level spawnSimulatedPlayer threw (cheats=${cheats}): ${errMsg(e)}`);
      return;
    }
    const botId = bot.id;
    const listed = await waitUntil(() => inPlayerList(botId), 40, 2);
    r.fact("isValid", bot.isValid);
    r.fact("inGetAllPlayers", listed);
    try {
      r.fact("gameMode", bot.getGameMode());
    } catch (e) {
      r.fact("gameMode", `err ${errMsg(e)}`);
    }
    if (!bot.isValid) {
      r.end("FAIL", `spawn returned but bot is not valid (cheats=${cheats})`);
      return;
    }
    const grounded = await waitOnGround(bot, 60);
    r.fact("onGround", grounded);
    const start = copy(bot.location);
    const { target, dir } = pickTarget(bot.dimension, start);
    r.fact("start", start);
    r.fact("target(abs)", target);
    r.fact("dir", dir);
    r.note(`navigating ${STEP} blocks ${dir} to ABSOLUTE ${fmtVec(target)}`);
    let method = "navigateToLocation";
    try {
      const res = bot.navigateToLocation(target);
      const path = res.getPath();
      const last = path[path.length - 1];
      r.fact("nav.isFullPath", res.isFullPath);
      r.fact("nav.pathLen", path.length);
      if (last) {
        r.fact("nav.pathEnd", last);
        r.fact("nav.pathEndToTarget", dist(last, target));
      }
    } catch (e) {
      r.note(`navigateToLocation threw: ${errMsg(e)}`);
      method = "none";
    }
    const near2 = () => bot !== void 0 && bot.isValid && dist(bot.location, target) <= ARRIVE;
    let arrived = await waitUntil(near2, 100, 2);
    let end = copy(bot.location);
    let moved = hdist(end, start);
    if (!arrived && moved < 0.5) {
      r.note("no movement from navigation; retrying with moveToLocation");
      try {
        bot.moveToLocation(target);
        method = "moveToLocation (fallback)";
        arrived = await waitUntil(near2, 60, 2);
        end = copy(bot.location);
        moved = hdist(end, start);
      } catch (e) {
        r.note(`moveToLocation threw: ${errMsg(e)}`);
      }
    }
    const off = { x: end.x - target.x, y: end.y - target.y, z: end.z - target.z };
    r.fact("method", method);
    r.fact("end", end);
    r.fact("endToTarget", dist(end, target));
    r.fact("offset", off);
    r.fact("moved", moved);
    try {
      bot.stopMoving();
    } catch {
    }
    const cheatsOff = cheats === "false";
    if (arrived) {
      const msg2 = `spawn OK (cheats=${cheats}), bot listed=${listed}, reached absolute target via ${method} -> coords are ABSOLUTE`;
      if (cheatsOff) r.end("PASS", msg2);
      else r.end("INCONCLUSIVE", `${msg2}; but cheats are not OFF - rerun on a cheats-off world`);
    } else if (moved < 0.5) {
      r.end("INCONCLUSIVE", `spawn OK (cheats=${cheats}) but the bot never moved - stand on open flat ground and rerun`);
    } else {
      r.end("FAIL", `spawn OK (cheats=${cheats}) but bot ended ${fmtVec(off)} away from the absolute target - coords look NOT absolute (or blocked)`);
    }
  } catch (e) {
    r.end("INCONCLUSIVE", `probe error: ${errMsg(e)}`);
  } finally {
    const id = bot?.id;
    const did = safeDisconnect(bot, botName2);
    if (id !== void 0) {
      await sleep(10);
      const still = inPlayerList(id);
      r.note(`cleanup: disconnect called=${did}, still listed after 10 ticks=${still}`, false);
    }
  }
}

// src/probes/index.ts
var PROBES = ["spawn", "chat", "chunks", "reload"];
var ENUM_NAME = "colony:probename";
var COMMAND_NAME = "colony:probe";
var registered = false;
var commandStatus = "startup event not seen";
var running = /* @__PURE__ */ new Set();
function isProbeName(v) {
  return typeof v === "string" && PROBES.includes(v);
}
function originPlayer(origin) {
  try {
    const e = origin.sourceEntity ?? origin.initiator;
    if (e instanceof Player5) return e;
  } catch {
  }
  return void 0;
}
function runProbe(name, invoker) {
  if (running.has(name)) {
    log(`${name}: already running - wait for its RESULT line`);
    return;
  }
  const player = invoker ?? world9.getAllPlayers().find((p) => !isSimulated(p));
  if ((name === "spawn" || name === "chunks") && !player) {
    log(`${name}: RESULT INCONCLUSIVE - needs a real player in the world to run near`);
    return;
  }
  running.add(name);
  const done = () => {
    running.delete(name);
  };
  const fail = (e) => {
    log(`${name}: RESULT INCONCLUSIVE - uncaught probe error: ${errMsg(e)}`);
    done();
  };
  try {
    switch (name) {
      case "spawn":
        if (player) spawnProbe(player).then(done, fail);
        break;
      case "chat":
        chatProbe().then(done, fail);
        break;
      case "chunks":
        if (player) chunksProbe(player).then(done, fail);
        break;
      case "reload":
        reloadProbe();
        done();
        break;
    }
  } catch (e) {
    fail(e);
  }
}
function onProbeCommand(origin, ...args) {
  try {
    const arg = args[0];
    if (!isProbeName(arg)) {
      return { status: CustomCommandStatus2.Failure, message: `Unknown probe '${String(arg)}'. Use: ${PROBES.join(", ")}` };
    }
    const invoker = originPlayer(origin);
    system9.run(() => {
      try {
        runProbe(arg, invoker);
      } catch (e) {
        log(`${arg}: RESULT INCONCLUSIVE - ${errMsg(e)}`);
      }
    });
    return { status: CustomCommandStatus2.Success };
  } catch (e) {
    return { status: CustomCommandStatus2.Failure, message: `[probe] error: ${errMsg(e)}` };
  }
}
function onStartup(ev) {
  try {
    const reg3 = ev.customCommandRegistry;
    reg3.registerEnum(ENUM_NAME, [...PROBES]);
    reg3.registerCommand(
      {
        name: COMMAND_NAME,
        description: "Run a colony spike probe: spawn, chat, chunks or reload",
        permissionLevel: CommandPermissionLevel2.Any,
        cheatsRequired: false,
        mandatoryParameters: [{ name: "probe", type: CustomCommandParamType2.Enum, enumName: ENUM_NAME }]
      },
      onProbeCommand
    );
    commandStatus = "registered";
  } catch (e) {
    commandStatus = `registration failed: ${errMsg(e)}`;
  }
}
function startupProbe(toChat) {
  const r = new ProbeReport("startup");
  let spawnFn = false;
  let chatSend = false;
  let chatSendErr = "";
  let cheats = "unknown";
  try {
    spawnFn = typeof gametest.spawnSimulatedPlayer === "function";
  } catch {
    spawnFn = false;
  }
  try {
    const sig = world9.beforeEvents.chatSend;
    chatSend = !!sig && typeof sig.subscribe === "function";
  } catch (e) {
    chatSendErr = errMsg(e);
  }
  try {
    cheats = String(world9.allowCheats);
  } catch {
  }
  r.fact("spawnSimulatedPlayer(top-level)", spawnFn);
  r.fact("beforeEvents.chatSend", chatSend ? true : `false${chatSendErr ? ` (${chatSendErr})` : ""}`);
  r.fact("customCommand /colony:probe", commandStatus);
  r.fact("allowCheats", cheats);
  const ok = spawnFn && chatSend && commandStatus === "registered";
  const summary = ok ? "all three mechanisms are present (existence only; run /colony:probe spawn|chat|chunks|reload for behaviour)" : "a required mechanism is missing - check that Beta APIs is on, then check the content log";
  if (!toChat) {
    log(`startup: spawn=${spawnFn} chatSend=${chatSend} command=${commandStatus} cheats=${cheats}`, false);
  }
  r.end(ok ? "PASS" : "FAIL", summary);
}
function registerProbes() {
  if (registered) return;
  registered = true;
  try {
    system9.beforeEvents.startup.subscribe(onStartup);
  } catch (e) {
    commandStatus = `startup subscribe failed: ${errMsg(e)}`;
  }
  let reportedToChat = false;
  try {
    const onLoad = () => {
      system9.run(() => {
        try {
          startupProbe(false);
        } catch (e) {
          log(`startup: RESULT INCONCLUSIVE - ${errMsg(e)}`, false);
        }
      });
    };
    world9.afterEvents.worldLoad.subscribe(onLoad);
  } catch (e) {
    log(`startup: worldLoad subscribe failed: ${errMsg(e)}`, false);
  }
  try {
    const onSpawn = (ev) => {
      try {
        if (reportedToChat || !ev.initialSpawn || isSimulated(ev.player)) return;
        reportedToChat = true;
        system9.runTimeout(() => {
          try {
            startupProbe(true);
          } catch (e) {
            log(`startup: RESULT INCONCLUSIVE - ${errMsg(e)}`);
          }
        }, 60);
      } catch {
      }
    };
    world9.afterEvents.playerSpawn.subscribe(onSpawn);
  } catch (e) {
    log(`startup: playerSpawn subscribe failed: ${errMsg(e)}`, false);
  }
}

// src/gametests/index.ts
import { system as system11 } from "@minecraft/server";
import { registerAsync as registerAsync2 } from "@minecraft/server-gametest";

// src/gametests/helpers.ts
import { GameMode as GameMode3, ItemStack as ItemStack2, system as system10 } from "@minecraft/server";
import { spawnSimulatedPlayer as spawnSimulatedPlayer4 } from "@minecraft/server-gametest";
var ARRIVE2 = 1.5;
var COOLDOWN = 25;
function runtime() {
  return getRuntime() ?? startColonyRuntime();
}
var senderSeq = 0;
function makeSender(label, pos) {
  senderSeq++;
  return { id: `gametest:${label}:${system10.currentTick}:${senderSeq}`, name: `GT-${label}`, pos: { x: pos.x, y: pos.y, z: pos.z } };
}
function absCell(test, rel) {
  return test.worldLocation({ x: rel.x + 0.5, y: rel.y, z: rel.z + 0.5 });
}
function gotoText(abs) {
  return `!goto ${abs.x.toFixed(2)} ${abs.y.toFixed(2)} ${abs.z.toFixed(2)}`;
}
function near(bot, abs, radius = ARRIVE2) {
  try {
    if (!bot.isValid) return false;
    const l = bot.location;
    return Math.hypot(l.x - abs.x, l.z - abs.z) <= radius && Math.abs(l.y - abs.y) <= 1.5;
  } catch {
    return false;
  }
}
function fmt2(v) {
  return `(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`;
}
function where(test, bot) {
  try {
    const l = bot.location;
    return `abs ${fmt2(l)} rel ${fmt2(test.relativeLocation(l))}`;
  } catch {
    return "unknown (bot invalid)";
  }
}
async function waitFor(test, cond, maxTicks, onTick) {
  for (let t = 0; t <= maxTicks; t++) {
    onTick?.(t);
    let ok = false;
    try {
      ok = cond();
    } catch {
      ok = false;
    }
    if (ok) return t;
    await test.idle(1);
  }
  return -1;
}
function view(id) {
  return runtime().snapshot().bots.find((b) => b.id === id);
}
function isIdle(id) {
  return view(id)?.state === "idle";
}
function sameVec(a, b, eps = 0.01) {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps && Math.abs(a.z - b.z) <= eps;
}
function taskStr(t) {
  if (!t) return "none";
  const what = t.kind === "goto" ? fmt2(t.target) : `gather ${t.item} ${t.delivered}/${t.amount}`;
  return `${t.id}->${what} for ${t.issuer.name}`;
}
function snapStr() {
  const s = runtime().snapshot();
  const bots = s.bots.map((b) => {
    const p = b.progress ? ` delivered ${b.progress.delivered} held ${b.progress.held}` : "";
    return `${b.name}:${b.state}(${taskStr(b.task)}${p})`;
  }).join(", ");
  const chest = s.chest ? ` chest ${fmt2(s.chest.pos)}` : "";
  return `bots [${bots}] queued [${s.queued.map((t) => t.id).join(", ")}] offers ${s.pendingOffers}${chest}`;
}
var usedSenders = [];
function sender(label, pos) {
  const s = makeSender(label, pos);
  usedSenders.push(s);
  return s;
}
async function beginTest(test) {
  const rt = runtime();
  const waited = await waitFor(test, () => rt.botIds().length === 0, 60);
  if (waited < 0) {
    test.fail(
      `colony already has ${rt.botIds().length} bot(s) (${rt.botIds().join(", ")}). Run GameTests on a world without colony bots.`
    );
    return false;
  }
  const stale = usedSenders.splice(0);
  if (stale.length > 0) {
    await test.idle(COOLDOWN);
    for (const s of stale) rt.submitText(s, "!stop");
    await test.idle(2);
  }
  const queued = rt.snapshot().queued;
  if (queued.length > 0) {
    test.fail(`colony queue not empty at test start: ${queued.map(taskStr).join("; ")}`);
    return false;
  }
  return true;
}
function floorY(test, x = 8, z = 8) {
  for (const y of [0, 1, 2, 3, -1]) {
    try {
      if (test.getBlock({ x, y, z }).typeId === "minecraft:stone") return y;
    } catch {
    }
  }
  test.fail("could not find the stone floor of the test structure");
  return void 0;
}
async function waitGrounded(test, bots) {
  const t = await waitFor(test, () => bots.every((b) => b.isValid && b.isOnGround), 60);
  if (t < 0) test.fail(`bots not on ground after 60 ticks: ${bots.map((b) => b.name).join(", ")}`);
  return t >= 0;
}
function spawnBot2(test, mode, rel, name) {
  if (mode === "test") return test.spawnSimulatedPlayer(rel, name, GameMode3.Survival);
  const w = test.worldLocation({ x: rel.x + 0.5, y: rel.y, z: rel.z + 0.5 });
  const bot = spawnSimulatedPlayer4({ dimension: test.getDimension(), x: w.x, y: w.y, z: w.z }, name, GameMode3.Survival);
  test.runOnFinish(() => {
    try {
      if (bot.isValid) bot.disconnect();
    } catch {
    }
  });
  return bot;
}
function botName(prefix) {
  return `${prefix}${system10.currentTick % 1e4}`;
}
var CHEST = "minecraft:chest";
var CRAFTING_TABLE2 = "minecraft:crafting_table";
function placeChest(test, rel) {
  test.setBlockType(CHEST, rel);
  return test.worldBlockLocation(rel);
}
function chestContainer(test, rel) {
  try {
    return test.getBlock(rel).getComponent("inventory")?.container;
  } catch {
    return void 0;
  }
}
function fillChest(test, rel, typeId, amount) {
  const c = chestContainer(test, rel);
  if (!c) return false;
  try {
    for (let i = 0; i < c.size; i++) {
      if (c.getItem(i) === void 0) {
        c.setItem(i, new ItemStack2(typeId, amount));
        return true;
      }
    }
  } catch {
  }
  return false;
}
function chestContents2(test, rel) {
  const c = chestContainer(test, rel);
  if (!c) return void 0;
  const out = /* @__PURE__ */ new Map();
  try {
    for (let i = 0; i < c.size; i++) {
      const it = c.getItem(i);
      if (it) out.set(it.typeId, (out.get(it.typeId) ?? 0) + it.amount);
    }
  } catch {
    return void 0;
  }
  return out;
}
function chestCount(test, rel, typeId) {
  return chestContents2(test, rel)?.get(typeId) ?? 0;
}
function chestStr(test, rel) {
  const m = chestContents2(test, rel);
  if (!m) return "chest unreadable";
  if (m.size === 0) return "chest empty";
  return `chest: ${[...m].map(([id, n]) => `${n} ${id.replace("minecraft:", "")}`).join(", ")}`;
}
function replies(s) {
  return runtime().recentReplies(s.id);
}
function hasReply(s, fragment) {
  return replies(s).some((l) => l.includes(fragment));
}
function repliesStr(s, last = 6) {
  const r = replies(s);
  return r.length === 0 ? "no replies" : `replies: ${r.slice(-last).map((l) => JSON.stringify(l)).join(" | ")}`;
}
function waitAllIdle(test, ids, maxTicks) {
  return waitFor(test, () => ids.every((id) => isIdle(id)), maxTicks);
}
function findInArea(test, typeId, size, yLo, yHi) {
  const out = [];
  for (let x = 0; x < size.x; x++)
    for (let y = yLo; y <= yHi; y++)
      for (let z = 0; z < size.z; z++) {
        try {
          if (test.getBlock({ x, y, z }).typeId === typeId) out.push({ x, y, z });
        } catch {
        }
      }
  return out;
}

// src/gametests/gather.ts
import { registerAsync } from "@minecraft/server-gametest";
var CLASS = "colony";
var TAG2 = "colony";
var OAK = "minecraft:oak_log";
var COBBLE = "minecraft:cobblestone";
var CHEST_XZ = { x: 2, z: 2 };
var AREA = { x: 16, z: 16 };
function floor(test) {
  for (const y of [0, 1, -1]) {
    try {
      if (test.getBlock({ x: 1, y, z: 1 }).typeId === "minecraft:stone") return y;
    } catch {
    }
  }
  test.fail("could not find the stone floor of the test structure");
  return void 0;
}
async function setup(test, botCells) {
  if (!await beginTest(test)) return void 0;
  const fy = floor(test);
  if (fy === void 0) return void 0;
  const y = fy + 1;
  const chestRel = { x: CHEST_XZ.x, y, z: CHEST_XZ.z };
  let chestAbs;
  try {
    chestAbs = placeChest(test, chestRel);
  } catch (e) {
    test.fail(`could not place the chest: ${String(e)}`);
    return void 0;
  }
  const bots = botCells.map((c, i) => spawnBot2(test, "toplevel", { x: c.x, y, z: c.z }, botName(`GG${i}`)));
  if (!await waitGrounded(test, bots)) return void 0;
  const rt = runtime();
  const ids = bots.map((b) => rt.adoptBot(b, b.name));
  const s = sender("G", absCell(test, { x: CHEST_XZ.x + 1, y, z: CHEST_XZ.z }));
  rt.submitText(s, "!chest set");
  const chest = rt.snapshot().chest;
  if (!chest || !sameBlock(chest.pos, chestAbs)) {
    test.fail(`!chest set: expected colony chest at ${fmt2(chestAbs)}, got ${chest ? fmt2(chest.pos) : "none"}. ${repliesStr(s)}`);
    return void 0;
  }
  if (!hasReply(s, "Colony chest set to")) {
    test.fail(`!chest set: no confirmation reply. ${repliesStr(s)}`);
    return void 0;
  }
  await test.idle(COOLDOWN);
  return { y, chestRel, chestAbs, s, bots, ids };
}
function sameBlock(a, b) {
  return Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y) && Math.floor(a.z) === Math.floor(b.z);
}
function expectGathering(test, sc, what) {
  for (const id of sc.ids) {
    const t = view(id)?.task;
    if (!t || t.kind !== "gather") {
      test.fail(`${what}: expected ${view(id)?.name ?? id} gathering. ${snapStr()}. ${repliesStr(sc.s)}`);
      return false;
    }
  }
  return true;
}
function diag(test, sc) {
  return `${chestStr(test, sc.chestRel)}. ${snapStr()}. ${repliesStr(sc.s)}`;
}
async function chestSet(test) {
  const sc = await setup(test, [{ x: 6, z: 6 }]);
  if (!sc) return;
  runtime().submitText(sc.s, "!chest");
  if (!hasReply(sc.s, "empty")) return test.fail(`!chest on an empty chest: expected 'empty'. ${repliesStr(sc.s)}`);
  test.print(`chest_set: colony chest at ${fmt2(sc.chestAbs)}; !chest reports it empty.`);
  test.succeed();
}
async function gatherLogs(test) {
  const sc = await setup(test, [{ x: 4, z: 3 }]);
  if (!sc) return;
  runtime().submitText(sc.s, "!gather oak_log 6");
  if (!expectGathering(test, sc, "after !gather oak_log 6")) return;
  const t = await waitAllIdle(test, sc.ids, 3e3);
  if (t < 0) return test.fail(`gather still running after 3000 ticks. ${diag(test, sc)}`);
  const n = chestCount(test, sc.chestRel, OAK);
  if (n < 6) return test.fail(`chest has ${n} oak_log, expected >= 6. ${diag(test, sc)}`);
  if (!hasReply(sc.s, "Delivered")) return test.fail(`no 'Delivered' report. ${diag(test, sc)}`);
  test.print(`gather_logs: ${n} oak_log delivered after ${t} ticks.`);
  test.succeed();
}
async function gatherTwoBots(test) {
  const sc = await setup(test, [
    { x: 4, z: 3 },
    { x: 3, z: 4 }
  ]);
  if (!sc) return;
  runtime().submitText(sc.s, "!gather oak_log 8 2");
  if (!expectGathering(test, sc, "after !gather oak_log 8 2")) return;
  const t = await waitAllIdle(test, sc.ids, 3e3);
  if (t < 0) return test.fail(`gather still running after 3000 ticks. ${diag(test, sc)}`);
  const n = chestCount(test, sc.chestRel, OAK);
  if (n < 8) return test.fail(`chest has ${n} oak_log, expected >= 8. ${diag(test, sc)}`);
  test.print(`gather_two_bots: ${n} oak_log delivered by 2 bots after ${t} ticks.`);
  test.succeed();
}
async function gatherCobbleCraft(test) {
  const sc = await setup(test, [{ x: 4, z: 4 }]);
  if (!sc) return;
  if (!fillChest(test, sc.chestRel, OAK, 3)) return test.fail(`could not prefill the chest with 3 oak_log. ${chestStr(test, sc.chestRel)}`);
  runtime().submitText(sc.s, "!gather cobblestone 3");
  if (!expectGathering(test, sc, "after !gather cobblestone 3")) return;
  const t = await waitAllIdle(test, sc.ids, 3600);
  if (t < 0) return test.fail(`gather still running after 3600 ticks. ${diag(test, sc)}`);
  const n = chestCount(test, sc.chestRel, COBBLE);
  if (n < 3) return test.fail(`chest has ${n} cobblestone, expected >= 3. ${diag(test, sc)}`);
  const tables = findInArea(test, CRAFTING_TABLE2, AREA, sc.y - 1, sc.y + 4);
  if (tables.length === 0) return test.fail(`no crafting table in the test area (bot should have placed one). ${diag(test, sc)}`);
  test.print(`gather_cobble_craft: ${n} cobblestone after ${t} ticks; crafting table at rel ${fmt2(tables[0] ?? { x: 0, y: 0, z: 0 })}.`);
  test.succeed();
}
async function gatherNoSource(test) {
  const sc = await setup(test, [{ x: 6, z: 6 }]);
  if (!sc) return;
  runtime().submitText(sc.s, "!gather sand 4");
  if (!expectGathering(test, sc, "after !gather sand 4")) return;
  const t = await waitAllIdle(test, sc.ids, 600);
  if (t < 0) return test.fail(`no-source gather still running after 600 ticks. ${diag(test, sc)}`);
  if (!hasReply(sc.s, "nothing left")) return test.fail(`expected a 'nothing left' report. ${diag(test, sc)}`);
  if (sc.ids.some((id) => !isIdle(id))) return test.fail(`bot not idle. ${diag(test, sc)}`);
  test.print(`gather_no_source: failed with no_source after ${t} ticks.`);
  test.succeed();
}
function reg(name, structure, maxTicks, body) {
  try {
    registerAsync(CLASS, name, body).structureName(structure).maxTicks(maxTicks).setupTicks(5).padding(4).batch(`colony_${name}`).required(true).tag(TAG2);
  } catch (e) {
    void e;
  }
}
reg("chest_set", "colony:flat", 400, chestSet);
reg("gather_logs", "colony:grove", 3400, gatherLogs);
reg("gather_two_bots", "colony:grove", 3400, gatherTwoBots);
reg("gather_cobble_craft", "colony:quarry", 4e3, gatherCobbleCraft);
reg("gather_no_source", "colony:flat", 1e3, gatherNoSource);

// src/gametests/index.ts
var CLASS2 = "colony";
var TAG3 = "colony";
var WALLED_TARGET = { x: 12, z: 12 };
function coordHint(test, bot, target) {
  let asRel = "?";
  try {
    asRel = fmt2(test.worldLocation(target));
  } catch {
  }
  return `bot ${where(test, bot)}; target abs ${fmt2(target)}; if abs coords were read as test-relative the bot would head to ${asRel}`;
}
function expectTask(test, id, target, issuer, what) {
  const v = view(id);
  const t = v?.task;
  if (!t || t.kind !== "goto" || !sameVec(t.target, target) || t.issuer.name !== issuer) {
    test.fail(`${what}: expected ${v?.name ?? id} busy going to ${fmt2(target)} for ${issuer}, got ${taskStr(t)}. ${snapStr()}`);
    return void 0;
  }
  return t.id;
}
async function gotoFlat(test, mode) {
  if (!await beginTest(test)) return;
  const fy = floorY(test);
  if (fy === void 0) return;
  const y = fy + 1;
  const bot = spawnBot2(test, mode, { x: 2, y, z: 2 }, botName("GTa"));
  if (!await waitGrounded(test, [bot])) return;
  const rt = runtime();
  const id = rt.adoptBot(bot, bot.name);
  if (!isIdle(id)) return test.fail(`adopted bot is not idle: ${snapStr()}`);
  const target = absCell(test, { x: 12, y, z: 12 });
  const a = sender("A", target);
  rt.submitText(a, gotoText(target));
  if (!expectTask(test, id, target, a.name, "after !goto")) return;
  const t = await waitFor(test, () => isIdle(id), 600);
  if (t < 0) return test.fail(`task still active after 600 ticks. ${coordHint(test, bot, target)}. ${snapStr()}`);
  if (!near(bot, target)) {
    return test.fail(`task ended (failed) without arriving. ${coordHint(test, bot, target)}`);
  }
  test.print(`goto_flat(${mode}): arrived and reported done after ${t} ticks.`);
  test.succeed();
}
async function gotoUnreachable(test, mode) {
  if (!await beginTest(test)) return;
  const fy = floorY(test);
  if (fy === void 0) return;
  const y = fy + 1;
  const bot = spawnBot2(test, mode, { x: 2, y, z: 2 }, botName("GTu"));
  if (!await waitGrounded(test, [bot])) return;
  const rt = runtime();
  const id = rt.adoptBot(bot, bot.name);
  const target = absCell(test, { x: WALLED_TARGET.x, y, z: WALLED_TARGET.z });
  const l = bot.location;
  const startDist = Math.hypot(l.x - target.x, l.y - target.y, l.z - target.z);
  const deadline = 200 + 20 * startDist;
  const a = sender("A", target);
  const t0 = system11.currentTick;
  rt.submitText(a, gotoText(target));
  if (!expectTask(test, id, target, a.name, "after !goto")) return;
  let reached = false;
  const freed = await waitFor(
    test,
    () => {
      if (near(bot, target)) reached = true;
      return reached || isIdle(id);
    },
    Math.ceil(deadline + 200)
  );
  if (reached) return test.fail(`bot reached a sealed target - structure or nav is wrong. bot ${where(test, bot)}`);
  if (freed < 0) return test.fail(`bot never gave up on the sealed target (> ${Math.round(deadline + 200)} ticks). ${snapStr()}`);
  const freedAt = system11.currentTick - t0;
  if (freedAt >= deadline) {
    return test.fail(`bot gave up only after the timeout (${freedAt} >= ${Math.round(deadline)} ticks): reason was 'timeout', expected 'unreachable'`);
  }
  test.print(
    `goto_unreachable(${mode}): task failed after ${freedAt} ticks (deadline ${Math.round(deadline)}), so reason=unreachable. Only meaningful if goto_flat passes for the same mode (else coords may simply be wrong).`
  );
  test.succeed();
}
async function overrideFlow(test, mode) {
  if (!await beginTest(test)) return;
  const fy = floorY(test);
  if (fy === void 0) return;
  const y = fy + 1;
  const x = spawnBot2(test, mode, { x: 1, y, z: 3 }, botName("GTx"));
  const yb = spawnBot2(test, mode, { x: 1, y, z: 12 }, botName("GTy"));
  if (!await waitGrounded(test, [x, yb])) return;
  const rt = runtime();
  const xId = rt.adoptBot(x, x.name);
  const yId = rt.adoptBot(yb, yb.name);
  const t1 = absCell(test, { x: 14, y, z: 3 });
  const t2 = absCell(test, { x: 14, y, z: 12 });
  const t3 = absCell(test, { x: 8, y, z: 8 });
  const a1 = sender("A1", t1);
  const a2 = sender("A2", t2);
  const b = sender("B", t3);
  rt.submitText(a1, gotoText(t1));
  await test.idle(1);
  rt.submitText(a2, gotoText(t2));
  const a1Task = expectTask(test, xId, t1, a1.name, "A1's goto");
  if (!a1Task || !expectTask(test, yId, t2, a2.name, "A2's goto")) return;
  const offersBefore = rt.snapshot().pendingOffers;
  rt.submitText(b, "!come");
  const afterCome = rt.snapshot();
  if (afterCome.pendingOffers !== offersBefore + 1 || view(xId)?.task?.id !== a1Task) {
    return test.fail(`!come with all bots busy should only create an offer. ${snapStr()}`);
  }
  rt.submitText(b, "!override");
  if (!expectTask(test, xId, t3, b.name, "after !override")) return;
  if (!expectTask(test, yId, t2, a2.name, "untouched bot after !override")) return;
  const head = rt.snapshot().queued[0];
  if (head?.id !== a1Task) return test.fail(`A1's task ${a1Task} should head the queue. ${snapStr()}`);
  const picked = await waitFor(test, () => [xId, yId].some((id) => view(id)?.task?.id === a1Task), 800);
  if (picked < 0) return test.fail(`A1's requeued task was never picked up. ${snapStr()}`);
  const pickerId = view(xId)?.task?.id === a1Task ? xId : yId;
  const picker = pickerId === xId ? x : yb;
  const done = await waitFor(test, () => isIdle(pickerId), 600);
  if (done < 0 || !near(picker, t1)) {
    return test.fail(`A1's requeued task didn't complete at ${fmt2(t1)}. ${where(test, picker)}. ${snapStr()}`);
  }
  test.print(`override_flow(${mode}): ${x.name} reassigned to B; ${picker.name} picked up and finished A1's requeued task.`);
  test.succeed();
}
function reg2(name, structure, maxTicks, body) {
  for (const mode of ["test", "toplevel"]) {
    const testName = mode === "test" ? name : `${name}_abs`;
    try {
      registerAsync2(CLASS2, testName, (test) => body(test, mode)).structureName(structure).maxTicks(maxTicks).setupTicks(5).padding(4).batch(`colony_${testName}`).required(true).tag(TAG3);
    } catch (e) {
      void e;
    }
  }
}
reg2("goto_flat", "colony:flat", 1200, gotoFlat);
reg2("goto_unreachable", "colony:walled", 1600, gotoUnreachable);
reg2("override_flow", "colony:flat", 2e3, overrideFlow);

// src/main.ts
startColonyRuntime();
registerProbes();
