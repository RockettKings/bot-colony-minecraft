// Public API of the command parser (Job 1). Pure TS: no @minecraft imports.
export { COORD_LIMITS, isCommand, parseCommand, parseCoord } from "./parse.js";
export type { Axis, ChestAction } from "./parse.js";
export { helpText } from "./help.js";
export { COMMAND_SPECS, BOT_NAME_RE, MAX_COUNT, MIN_COUNT, findSpec } from "./specs.js";
export type { ArgSpec, ArgType, CommandSpec } from "./specs.js";
