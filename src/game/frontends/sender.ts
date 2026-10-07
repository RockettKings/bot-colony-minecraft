import type { Player } from "@minecraft/server";
import type { Sender } from "../../core/types.js";

/** Snapshot a player into a core Sender. Throws if the player is invalid (callers guard). */
export function senderOf(player: Player): Sender {
  const l = player.location;
  return { id: player.id, name: player.name, pos: { x: l.x, y: l.y, z: l.z } };
}
