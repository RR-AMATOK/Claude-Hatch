/**
 * CommandParser + REPL — Module #10 (architecture §2.2)
 *
 * Reads prompt input via Ink's useInput, tokenizes it, and dispatches to
 * CommandHandlers. Exposed as a React component <Prompt />.
 *
 * TODO: Implement in the renderer task (Phase 1d).
 *       Depends on: Ink useInput, CommandHandlers.
 */

import React from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedCommand {
  name: string;
  args: string[];
  raw: string;
}

export type CommandCallback = (cmd: ParsedCommand) => void;

// ---------------------------------------------------------------------------
// Tokenizer stub
// ---------------------------------------------------------------------------

/**
 * Splits a raw input string into command name + args.
 * TODO: Handle quoted strings, escape sequences.
 */
export function parseInput(raw: string): ParsedCommand {
  const parts = raw.trim().split(/\s+/);
  const name = parts[0] ?? "";
  const args = parts.slice(1);
  return { name, args, raw };
}

// ---------------------------------------------------------------------------
// Prompt component stub
// ---------------------------------------------------------------------------

interface PromptProps {
  onCommand: CommandCallback;
}

/**
 * REPL prompt component. Stub — renders nothing until Phase 1d.
 *
 * TODO: Implement with Ink's TextInput (or useInput) and dispatch to onCommand.
 */
export function Prompt(_props: PromptProps): React.ReactElement {
  return React.createElement(React.Fragment, null);
}
