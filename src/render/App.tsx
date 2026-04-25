/**
 * App — Ink root component — Module #7 (architecture §2.2)
 *
 * Full TUI component tree:
 *
 *   App
 *   ├── PetView       — animated wide-silhouette pet display (4-row wide form)
 *   ├── HudBar        — name · level · XP bar · mood · personality · days alive
 *   ├── LogPanel      — last 5-10 events from events.jsonl, most recent first
 *   └── ReplPrompt    — "> " input line; dispatches via dispatchCommand
 *
 * Layout is top-to-bottom. Booting is async: state is loaded from disk before
 * the first meaningful render. Until state is ready a loading indicator is shown.
 *
 * DEC-008: uses config.stateHome — never touches ~/.claude/ in dev/test.
 * DEC-016: does NOT import or modify statusline.ts.
 * DEC-017: species values are lowercase (circuit | rune | shard | bloom).
 * NO_MOTION=1: animation interval is skipped; single static frame shown.
 * NO_COLOR=1: all ANSI codes suppressed via detectColorMode.
 *
 * TODO(signal-collectors): agent A's `glyphling watch` daemon writes XP signals;
 *   the TUI renders whatever state.json contains. When the daemon is merged,
 *   slot its boot call here (or in cli.tsx) before the StateStore boot.
 */

import React, { useState, useEffect, useCallback, useRef, memo } from "react";
import { Box, Text, useInput, useApp } from "ink";
import type { Config } from "../config/env.js";
import type { Pet } from "../state/schema.js";
import {
  applyEyeBlink,
  getLifeStage,
  deriveMood,
  detectColorMode,
  MOOD_GLYPHS,
  type ColorMode,
} from "./compact.js";
import { glyphlingStore, bootStore, useGlyphlingStore } from "./useGlyphlingStore.js";
import { useEventLog, formatRelativeTime, type LogEntry } from "./useEventLog.js";
import { parseInput } from "../commands/repl.js";
import {
  dispatchCommand,
  type CommandContext,
} from "../commands/handlers.js";

// ---------------------------------------------------------------------------
// Silhouette data — wide (4-row) form for the TUI pet view
//
// compact.ts does not export SILHOUETTES. We inline the wide silhouettes here
// as a lightweight read-only copy to avoid forking compact.ts.
// These mirror SILHOUETTES[species][stage].wide from compact.ts exactly.
// ---------------------------------------------------------------------------
const WIDE_SILHOUETTES: Record<string, Record<string, readonly [string, string, string, string]>> = {
  circuit: {
    hatchling: ["    .", "   [oo]", "   -||-", "    ^^"],
    juvenile: ["    |", "   /[oo]\\", "   +-||-+", "    ^  ^"],
    adult: ["    .v.", "   /[o-o]\\", "  +==|--|==+", "    |_||_|"],
  },
  rune: {
    hatchling: ["    ^", "   <..>", "    \\/", "    ."],
    juvenile: ["   ^ ^", "   <^..^>", "    \\||/", "    o.o"],
    adult: ["    ^^^", "   <^-..-^>", "    \\|||/", "   .  .  ."],
  },
  shard: {
    hatchling: ["    *", "   /oo\\", "   \\\\//", "   . ."],
    juvenile: ["    *", "   /*oo*\\", "   \\\\||//", "   .* *."],
    adult: ["    *   *", "   /**oo**\\", "   \\\\\\||///", "   .*. .*."],
  },
  bloom: {
    hatchling: ["    ~", "   (oo)", "    vv", "    ,."],
    juvenile: ["    ~ ~", "   (~oo~)", "    \\vv/", "    ,.,"],
    adult: ["   ~ * ~", "   (~*oo*~)", "    ~\\vv/~", "    ,.,.,"],
  },
};

// Species accent colors for the pet view (hex truecolor)
const SPECIES_ACCENT_HEX: Record<string, string> = {
  circuit: "#2a7fff",
  rune: "#a77fff",
  shard: "#ff8c2a",
  bloom: "#7fbf5f",
};

// ---------------------------------------------------------------------------
// XP / level helpers
// Mirrors cumulativeTable() + deriveLevel() from compact.ts exactly so we
// don't import the heavy xp/engine module.
// ---------------------------------------------------------------------------

const LEVEL_CAP = 1024;

let _cumTable: number[] | null = null;
function cumulativeTable(): number[] {
  if (_cumTable !== null) return _cumTable;
  const t = new Array<number>(LEVEL_CAP + 1).fill(0);
  let running = 0;
  for (let k = 1; k <= LEVEL_CAP; k++) {
    t[k] = running;
    running += Math.floor(25 * Math.pow(k, 1.2));
  }
  _cumTable = t;
  return t;
}

function deriveLevel(xp: number): number {
  if (xp < 0) return 1;
  const t = cumulativeTable();
  let lo = 1;
  let hi = LEVEL_CAP;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((t[mid] ?? Infinity) <= xp) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Returns { level, filled } where filled is 0–14 (cells for 14-cell XP bar). */
function xpProgress(xp: number): { level: number; filled: number } {
  const level = deriveLevel(xp);
  if (level >= LEVEL_CAP) return { level, filled: 14 };
  const t = cumulativeTable();
  const floorXp = t[level] ?? 0;
  const nextXp = t[level + 1] ?? floorXp + 1;
  const span = Math.max(1, nextXp - floorXp);
  const ratio = Math.min(1, Math.max(0, (xp - floorXp) / span));
  const filled = Math.floor(ratio * 14);
  return { level, filled };
}

// ---------------------------------------------------------------------------
// Ink color helpers
// ---------------------------------------------------------------------------

/** Map palette key → Ink-compatible hex string. */
const INK_COLOR_MAP: Record<string, string> = {
  "text-primary": "white",
  "text-secondary": "#7a7a7a",
  "surface-muted": "#4a4a4a",
  primary: "#2a7fff",
  "accent-level": "#2ab7ca",
  success: "#5fbf87",
  warning: "#d7af00",
  "error-muted": "#b55a5a",
  error: "#d70000",
  "level-up": "#ffd700",
  death: "#6a6a6a",
};

function inkColor(key: string, colorMode: ColorMode): string | undefined {
  if (colorMode === "none") return undefined;
  return INK_COLOR_MAP[key];
}

/**
 * Returns a `{ color: string }` spread-compatible object.
 * When colorMode is "none" or the key has no mapping, returns an empty object
 * so callers can use `{...col(key, mode)}` without hitting exactOptionalPropertyTypes.
 */
function col(key: string, colorMode: ColorMode): { color: string } | Record<never, never> {
  const c = inkColor(key, colorMode);
  if (c === undefined) return {};
  return { color: c };
}

/**
 * Like col() but accepts an already-resolved hex string.
 */
function colHex(hex: string | undefined): { color: string } | Record<never, never> {
  if (hex === undefined) return {};
  return { color: hex };
}

// ---------------------------------------------------------------------------
// PetView — animated 4-row wide silhouette (DEC-015 memo pattern)
// ---------------------------------------------------------------------------

interface PetViewProps {
  pet: Pet;
  colorMode: ColorMode;
}

/**
 * Renders the wide (4-row) pet silhouette at 1 Hz with eye-blink animation.
 * Wrapped in React.memo per DEC-015 rule #3 so only the pet cell repaints.
 * NO_MOTION=1 renders a static single frame with no setInterval.
 * Eye-blink is applied on tick % 4 === 2, matching the statusline behavior.
 */
const PetView = memo(function PetView({ pet, colorMode }: PetViewProps) {
  const noMotion = process.env["NO_MOTION"] === "1";
  const [tick, setTick] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (noMotion) return;
    const id = setInterval(() => {
      setTick(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [noMotion]);

  const level = deriveLevel(pet.xp);
  const stage = getLifeStage(level);
  const wide = WIDE_SILHOUETTES[pet.eggType]?.[stage];

  if (!wide) {
    // Defensive fallback — should never happen with valid DEC-017 species
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Text dimColor>{"(o_o)"}</Text>
        <Text dimColor>{"^v^"}</Text>
      </Box>
    );
  }

  // Eye-blink lives on row index 1 of wide silhouettes (the eye-bearing row)
  const rows: string[] = [
    wide[0],
    applyEyeBlink(wide[1], pet.eggType, stage, tick),
    wide[2],
    wide[3],
  ];

  const accentColor = colorMode !== "none"
    ? (SPECIES_ACCENT_HEX[pet.eggType] ?? "#2a7fff")
    : undefined;

  return (
    <Box flexDirection="column" paddingLeft={2}>
      {rows.map((row, i) => (
        <Text key={i} {...colHex(accentColor)}>
          {row}
        </Text>
      ))}
    </Box>
  );
});

// ---------------------------------------------------------------------------
// HudBar — one-line compact status ≤80 visible cols
// ---------------------------------------------------------------------------

interface HudBarProps {
  pet: Pet;
  colorMode: ColorMode;
  nowMs: number;
}

/**
 * name · Lv NN · [▓▓▓▓░░░░░░░░░░] · mood · dominant trait · Nd alive
 * One line, ≤80 visible cols.
 */
function HudBar({ pet, colorMode, nowMs }: HudBarProps): React.ReactElement {
  const { level, filled } = xpProgress(pet.xp);
  const isAscendant = level >= LEVEL_CAP;

  const name = (pet.name ?? pet.eggType).slice(0, 12);
  const nameDisplay = isAscendant ? name.slice(0, 11) + "*" : name;

  const levelStr = isAscendant ? `Lv ${LEVEL_CAP}` : `Lv ${level}`;

  // 8-cell XP bar (compact variant for HUD line)
  const BAR = 8;
  const filledB = isAscendant ? BAR : Math.round((filled / 14) * BAR);
  const emptyB = BAR - filledB;
  const xpBar = "[" + "█".repeat(filledB) + "░".repeat(emptyB) + "]";

  const mood = deriveMood(pet, nowMs);
  const moodDef = MOOD_GLYPHS[mood];
  const richGlyphs = process.env["GLYPHLING_RICH_GLYPHS"] === "1";
  const moodGlyph = richGlyphs ? moodDef.emoji : moodDef.ascii;

  const dominant = pet.personality.dominant;

  const origin = pet.hatchedAt ?? pet.createdAt;
  const daysAlive = Math.floor((nowMs - new Date(origin).getTime()) / 86400000);
  const daysStr = daysAlive === 1 ? "1d" : `${daysAlive}d`;

  const sep = " · "; // " · "

  return (
    <Box marginTop={1}>
      <Text bold>{nameDisplay}</Text>
      <Text dimColor>{sep}</Text>
      <Text {...col("accent-level", colorMode)}>{levelStr}</Text>
      <Text dimColor>{sep}</Text>
      <Text>{xpBar}</Text>
      <Text dimColor>{sep}</Text>
      <Text {...col(moodDef.color, colorMode)}>{moodGlyph}</Text>
      <Text dimColor>{sep}</Text>
      <Text {...col("text-secondary", colorMode)}>{dominant}</Text>
      <Text dimColor>{sep}</Text>
      <Text {...col("text-secondary", colorMode)}>{daysStr}</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// LogPanel — last N events from events.jsonl + REPL output
// ---------------------------------------------------------------------------

interface LogPanelProps {
  entries: LogEntry[];
  replOutput: string[];
  nowMs: number;
  colorMode: ColorMode;
}

const LOG_DISPLAY_COUNT = 5;

function LogPanel({ entries, replOutput, nowMs, colorMode }: LogPanelProps): React.ReactElement {
  // Show REPL output at top (most recent user interaction), then event entries
  const replLines = replOutput.slice(-4);
  const eventCount = Math.max(0, LOG_DISPLAY_COUNT - replLines.length);
  const eventLines = entries.slice(0, eventCount);

  const borderColorProps = colorMode !== "none" ? { borderColor: "#4a4a4a" as const } : {};

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      {...borderColorProps}
      paddingX={1}
      marginTop={1}
    >
      <Text dimColor>log</Text>

      {replLines.length === 0 && eventLines.length === 0 && (
        <Text dimColor>no events yet — try: help</Text>
      )}

      {replLines.map((line, i) => (
        <Text key={`repl-${i}`} {...col("accent-level", colorMode)}>
          {line}
        </Text>
      ))}

      {eventLines.map((entry) => {
        const rel = formatRelativeTime(entry.ts, nowMs);
        return (
          <Box key={entry.id}>
            <Text {...col("text-secondary", colorMode)}>{rel.padEnd(8, " ")} </Text>
            <Text>{entry.label}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// ReplPrompt — "> " with live input and cursor blink
// ---------------------------------------------------------------------------

interface ReplPromptProps {
  onSubmit: (line: string) => void;
  colorMode: ColorMode;
}

function ReplPrompt({ onSubmit, colorMode }: ReplPromptProps): React.ReactElement {
  const [input, setInput] = useState("");

  useInput((ch, key) => {
    if (key.return) {
      const line = input.trim();
      if (line.length > 0) onSubmit(line);
      setInput("");
      return;
    }

    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
      return;
    }

    // Ignore Ctrl/Meta/Escape combos — Ctrl+C is handled by cli.tsx gracefulExit
    if (key.ctrl || key.meta || key.escape) return;

    // Accept printable characters only
    if (ch && ch.length > 0 && ch.charCodeAt(0) >= 32) {
      setInput((prev) => prev + ch);
    }
  });

  const promptColorProps = colorMode !== "none" ? { color: "#2a7fff" as const } : {};
  const cursorColorProps = colorMode !== "none" ? { color: "#ffd700" as const } : {};

  return (
    <Box marginTop={1}>
      <Text {...promptColorProps} bold>
        {">"}{" "}
      </Text>
      <Text>{input}</Text>
      <Text {...cursorColorProps}>{"_"}</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// NoPetView — shown when no active pet is configured
// ---------------------------------------------------------------------------

function NoPetView({ colorMode }: { colorMode: ColorMode }): React.ReactElement {
  const warningColorProps = colorMode !== "none" ? { color: "#d7af00" as const } : {};
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold {...warningColorProps}>
        no active pet
      </Text>
      <Text>
        {"Run "}
        <Text bold>{"glyphling hatch <circuit|rune|shard|bloom> [name]"}</Text>
        {" to get started."}
      </Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// BootingView — minimal spinner while store loads
// ---------------------------------------------------------------------------

function BootingView(): React.ReactElement {
  const [dots, setDots] = useState(".");
  useEffect(() => {
    const id = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "." : d + "."));
    }, 300);
    return () => clearInterval(id);
  }, []);
  return (
    <Box padding={1}>
      <Text dimColor>loading{dots}</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// IntegrityBanner — non-fatal DEC-018 warning
// ---------------------------------------------------------------------------

function IntegrityBanner({ warning }: { warning: string }): React.ReactElement {
  return (
    <Box borderStyle="single" borderColor="yellow" paddingX={1} marginBottom={1}>
      <Text color="yellow">warn: {warning}</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// AppProps / App — root
// ---------------------------------------------------------------------------

export interface AppProps {
  config: Config;
}

/**
 * Root Ink component. Boots the state store then renders:
 *   PetView → HudBar → LogPanel → ReplPrompt
 *
 * REPL command support:
 *   feed, pet, play, pause, resume, name, status, pets, doctor
 *     — routed to dispatchCommand (currently returns "not yet implemented")
 *   quit / exit — graceful unmount
 *   help — list available commands
 *
 * Ctrl+C is handled by cli.tsx's gracefulExit (unmounts Ink cleanly; no escape bleed).
 */
export function App({ config }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [booting, setBooting] = useState(true);
  const [replOutput, setReplOutput] = useState<string[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const ctxRef = useRef<CommandContext>({ config });

  // Refresh relative timestamps every 10 s
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  // Boot the singleton StateStore once
  useEffect(() => {
    bootStore(config)
      .then(() => setBooting(false))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setReplOutput([`boot error: ${msg}`]);
        setBooting(false);
      });

    // Teardown the store (file watcher) on unmount
    return () => {
      glyphlingStore.teardown();
    };
  }, [config]);

  const state = useGlyphlingStore();
  const eventLog = useEventLog(config);
  const colorMode = detectColorMode();

  // ---------------------------------------------------------------------------
  // REPL dispatch
  // ---------------------------------------------------------------------------

  const handleCommand = useCallback(
    (raw: string) => {
      const lower = raw.trim().toLowerCase();

      if (lower === "quit" || lower === "exit") {
        setReplOutput((prev) => [...prev, `> ${raw}`, "goodbye"].slice(-12));
        setTimeout(() => exit(), 200);
        return;
      }

      if (lower === "help") {
        setReplOutput((prev) =>
          [
            ...prev,
            `> ${raw}`,
            "commands:",
            "  feed  pet  play  pause  resume",
            "  name <n>  status  pets  doctor",
            "  quit  exit  help",
          ].slice(-12)
        );
        return;
      }

      const parsed = parseInput(raw);
      const result = dispatchCommand(parsed, ctxRef.current);
      const echo = `> ${raw}`;
      const reply = result.ok
        ? (result.message ?? "ok")
        : `error: ${result.error}`;

      setReplOutput((prev) => [...prev, echo, reply].slice(-12));
    },
    [exit]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (booting) {
    return <BootingView />;
  }

  const integrityWarning = glyphlingStore.integrityWarning();

  let activePet: Pet | undefined;
  if (state !== null) {
    const { activePetId } = state.globals;
    if (activePetId !== null) {
      activePet = state.pets.find((p) => p.id === activePetId);
    }
  }

  return (
    <Box flexDirection="column" padding={1}>
      {integrityWarning !== null && (
        <IntegrityBanner warning={integrityWarning} />
      )}

      {activePet !== undefined ? (
        <>
          <PetView pet={activePet} colorMode={colorMode} />
          <HudBar pet={activePet} colorMode={colorMode} nowMs={nowMs} />
        </>
      ) : (
        <NoPetView colorMode={colorMode} />
      )}

      <LogPanel
        entries={eventLog}
        replOutput={replOutput}
        nowMs={nowMs}
        colorMode={colorMode}
      />

      <ReplPrompt onSubmit={handleCommand} colorMode={colorMode} />
    </Box>
  );
}
