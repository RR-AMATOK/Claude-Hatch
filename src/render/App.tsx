/**
 * Renderer — Ink root component — Module #7 (architecture §2.2)
 *
 * AppContainer: wires stores and providers, renders the pet view, status bar,
 * log panel, and REPL prompt. Subscribes to StateStore via useSyncExternalStore.
 *
 * TODO: Wire StateStore context provider, AnimationEngine, CommandParser,
 *       and the full component tree once downstream modules land.
 */

import React from "react";
import { Box, Text } from "ink";
import type { Config } from "../config/env.js";

interface AppProps {
  config: Config;
}

/**
 * Root Ink component. Currently renders a "hello glyphling" placeholder
 * while the real UI is being built out in subsequent tasks.
 */
export function App({ config }: AppProps): React.ReactElement {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        hello glyphling
      </Text>
      <Text dimColor>state home: {config.stateHome}</Text>
      <Text dimColor>(scaffold placeholder — TODO-007 renderer incoming)</Text>
    </Box>
  );
}
