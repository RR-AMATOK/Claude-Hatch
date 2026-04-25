/**
 * Shared types for signal collectors (architecture §6.3).
 */

import type { EventBus } from "../events/bus.js";
import type { Config } from "../config/env.js";

export interface SignalCollectorContext {
  bus: EventBus;
  config: Config;
}

/**
 * A signal collector starts, emits events to the bus, and returns a stop
 * function. Pattern shared by all collectors per architecture §2.2.
 */
export type SignalCollector = (ctx: SignalCollectorContext) => () => void;
