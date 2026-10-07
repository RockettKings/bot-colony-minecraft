// Behavior pack entry point.
import { startColonyRuntime } from "./game/runtime.js";
import { registerProbes } from "./probes/index.js";
import "./gametests/index.js"; // registers GameTests (only runnable via /gametest on a dev world)

startColonyRuntime();
registerProbes();
