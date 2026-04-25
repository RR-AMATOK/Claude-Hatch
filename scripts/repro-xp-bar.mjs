#!/usr/bin/env node
/**
 * repro-xp-bar.mjs — XP bar sawtooth bug reproduction harness
 *
 * Deliverable: scripts/repro-xp-bar.mjs (committed, NOT gitignored)
 *
 * Demonstrates the DEC-020 XP bar fill bug: the colored branches of
 * renderHudRow and renderHudLeftGroup in src/render/compact.ts use
 *   Math.floor(Math.min(1, (pet.xp % 1000) / 1000) * 14)
 * instead of the correct intra-level ratio. At level 280 the span is
 * ~18,222 XP so xp%1000 wraps 18 times, producing a sawtooth fill.
 *
 * Usage:
 *   # Build first (required — runs compiled dist/):
 *   npm run build
 *
 *   # Default run (table for default + NO_COLOR modes):
 *   GLYPHLING_HOME=/tmp/repro-xp-bar node scripts/repro-xp-bar.mjs
 *
 *   # Stress run (100 invocations/sec for 30 s):
 *   GLYPHLING_HOME=/tmp/repro-xp-bar node scripts/repro-xp-bar.mjs --stress
 *
 * DEC-008: Refuses to run if GLYPHLING_HOME is under ~/.claude/.
 *
 * NOTE (DEC-018 test-only bypass): This script writes state.json directly
 * via fs.writeFile to force exact xp values. This bypasses the normal
 * writeState() / lockfile protocol intentionally — it is a diagnostic
 * harness, not a production code path.
 */

import { spawnSync, spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// DEC-008 guard — refuse to write under ~/.claude/
// ---------------------------------------------------------------------------

function assertNotUnderClaudeDir(resolvedHome) {
  const homeDir = os.homedir();
  const claudeDir = path.resolve(path.join(homeDir, ".claude"));
  let normalised = path.resolve(resolvedHome);

  // Case-insensitive check on macOS / Windows (SEC-013 parity)
  if (process.platform === "darwin" || process.platform === "win32") {
    normalised = normalised.toLowerCase();
    const claudeDirLower = claudeDir.toLowerCase();
    const rel = path.relative(claudeDirLower, normalised);
    const inside = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    if (inside) {
      console.error(
        `[repro-xp-bar] REFUSED: GLYPHLING_HOME="${resolvedHome}" is inside ~/.claude/.\n` +
          `Set GLYPHLING_HOME to a temp path (e.g. /tmp/repro-xp-bar) per DEC-008.`
      );
      process.exit(1);
    }
  } else {
    const rel = path.relative(claudeDir, normalised);
    const inside = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    if (inside) {
      console.error(
        `[repro-xp-bar] REFUSED: GLYPHLING_HOME="${resolvedHome}" is inside ~/.claude/.\n` +
          `Set GLYPHLING_HOME to a temp path (e.g. /tmp/repro-xp-bar) per DEC-008.`
      );
      process.exit(1);
    }
  }
}

// ---------------------------------------------------------------------------
// XP math (mirrors xp/engine.ts — no import to keep script self-contained)
// ---------------------------------------------------------------------------

const PHI = (1 + Math.sqrt(5)) / 2;
const LEVEL_CAP = 1618;

function xpToNext(L) {
  if (L >= LEVEL_CAP) return 0;
  return Math.floor(2 * Math.pow(L, PHI));
}

let _cumTable = null;
function getCumulativeTable() {
  if (_cumTable !== null) return _cumTable;
  const t = new Array(LEVEL_CAP + 2).fill(0);
  let running = 0;
  for (let k = 1; k <= LEVEL_CAP; k++) {
    t[k] = running;
    running += xpToNext(k);
  }
  _cumTable = t;
  return t;
}

function cumulativeXpForLevel(L) {
  const lvl = Math.min(Math.max(1, Math.floor(L)), LEVEL_CAP);
  return getCumulativeTable()[lvl] ?? 0;
}

// ---------------------------------------------------------------------------
// State JSON construction (DEC-018 test-only bypass: direct fs.writeFile)
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid StateFileV1 JSON for a circuit pet with the given xp.
 * Level is derived from the xp value for schema correctness.
 */
function buildStateJson(xp, level) {
  const now = new Date().toISOString();
  return JSON.stringify({
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    pets: [
      {
        id: "repro-pet-001",
        schemaVersion: 1,
        eggType: "circuit",
        name: "Repro",
        createdAt: now,
        hatchedAt: now,
        lastFedAt: now,
        lastInteractionAt: now,
        xp,
        level,
        personality: {
          dominant: "Friendly",
          weights: {
            Stoic: 0.1,
            Friendly: 0.3,
            Pragmatic: 0.15,
            Energetic: 0.1,
            Gruff: 0.05,
            Philosophical: 0.1,
            Paranoid: 0.1,
            Curious: 0.1,
          },
          lockedAt: now,
          lastRefreshAt: now,
        },
        pauseIntervals: [],
        accumulatedNeglectSeconds: 0,
        lastTickAt: now,
        diedAt: null,
        tombstone: null,
        languageExposure: {},
        dailyCaps: {},
        lastLevelUpAt: null,
      },
    ],
    globals: {
      activePetId: "repro-pet-001",
      unlocks: {
        gifTier1: false,
        gifTier2: false,
        gifTier3: false,
        adoption: false,
      },
      eventsCursor: 0,
      eventsHead: "",
      lastEventAt: 0,
    },
  });
}

// ---------------------------------------------------------------------------
// ANSI strip + filled-cell counter
// ---------------------------------------------------------------------------

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(s) {
  return s.replace(ANSI_RE, "");
}

/**
 * Count filled (█ U+2588) cells inside the first [……] segment.
 * Returns -1 if no bar found.
 */
function filledCells(s) {
  const match = /\[([^\]]*)\]/.exec(s);
  if (!match) return -1;
  let count = 0;
  for (const ch of match[1]) {
    if (ch === "█") count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Single invocation: write state.json, spawn statusline, parse result
// ---------------------------------------------------------------------------

/** Resolve the bin path relative to this script's directory. */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "../dist/src/bin.js");

function invokeStatusline(stateHome, xp, level, extraEnv = {}) {
  // DEC-018 test-only bypass: write state directly
  const stateFile = path.join(stateHome, "state.json");
  fs.mkdirSync(stateHome, { recursive: true });
  fs.writeFileSync(stateFile, buildStateJson(xp, level), "utf8");

  const result = spawnSync("node", [BIN, "statusline"], {
    env: {
      ...process.env,
      GLYPHLING_HOME: stateHome,
      NODE_ENV: "test",
      ...extraEnv,
    },
    encoding: "utf8",
    timeout: 5000,
  });

  if (result.error) {
    return { stdout: "", error: result.error.message };
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// ---------------------------------------------------------------------------
// Main table run
// ---------------------------------------------------------------------------

async function runTable(stateHome, level) {
  const cumBase = cumulativeXpForLevel(level);
  const cumNext = cumulativeXpForLevel(level + 1);
  const span = cumNext - cumBase;
  const STEPS = 50;

  console.log(`\n=== XP Bar Sawtooth Reproduction ===`);
  console.log(`Level: ${level}  |  cumXp(${level}) = ${cumBase}  |  span = ${span}`);
  console.log(
    `The bug wraps xp%1000 every 1000 XP — ${Math.floor(span / 1000)} full wraps across this level.\n`
  );

  const modes = [
    { label: "default(ansi256)", env: {} },
    { label: "NO_COLOR", env: { NO_COLOR: "1" } },
    { label: "TRUECOLOR", env: { GLYPHLING_TRUECOLOR: "1", COLORTERM: "truecolor" } },
    { label: "NO_256COLOR", env: { NO_256COLOR: "1" } },
  ];

  // Header
  const colW = 14;
  const stepW = 4;
  const xpW = 12;
  let header = "Step".padEnd(stepW) + " " + "XP".padEnd(xpW);
  for (const m of modes) {
    header += " " + m.label.padStart(colW);
  }
  console.log(header);
  console.log("-".repeat(header.length));

  for (let i = 0; i <= STEPS; i++) {
    const xp = cumBase + Math.floor((span * i) / STEPS);
    let row = String(i).padEnd(stepW) + " " + String(xp).padEnd(xpW);
    for (const m of modes) {
      const { stdout } = invokeStatusline(stateHome, xp, level, m.env);
      const firstLine = stdout.split("\n")[0] ?? "";
      const plain = stripAnsi(firstLine);
      const filled = filledCells(plain);
      row += " " + String(filled).padStart(colW);
    }
    console.log(row);
  }

  console.log(`\nExpected: NO_COLOR column should monotonically rise 0→14.`);
  console.log(`Bug:      The three colored columns show a sawtooth (resets every ~1000 XP).`);
}

// ---------------------------------------------------------------------------
// Stress run (--stress flag)
// ---------------------------------------------------------------------------

async function runStress(stateHome, level) {
  const cumBase = cumulativeXpForLevel(level);
  const cumNext = cumulativeXpForLevel(level + 1);
  const span = cumNext - cumBase;

  const DURATION_MS = 30_000;
  const TARGET_RPS = 100;
  const INTERVAL_MS = Math.floor(1000 / TARGET_RPS);

  console.log(`\n=== Stress Run: ${TARGET_RPS} invocations/sec for ${DURATION_MS / 1000}s ===`);
  console.log(`State path: ${stateHome}`);
  console.log(`Level: ${level}  span: ${span}\n`);

  fs.mkdirSync(stateHome, { recursive: true });

  let invocations = 0;
  let mismatches = 0;
  let xpCounter = cumBase;

  const stateFile = path.join(stateHome, "state.json");
  const startMs = Date.now();

  // Writer: monotonically-increasing xp, rewrites every 100ms
  const writerInterval = setInterval(() => {
    xpCounter = Math.min(xpCounter + Math.floor(span / 300), cumNext - 1);
    fs.writeFileSync(stateFile, buildStateJson(xpCounter, level), "utf8");
  }, 100);

  // Initial write
  fs.writeFileSync(stateFile, buildStateJson(xpCounter, level), "utf8");

  // Invocation loop
  await new Promise((resolve) => {
    const loop = setInterval(async () => {
      if (Date.now() - startMs >= DURATION_MS) {
        clearInterval(loop);
        clearInterval(writerInterval);
        resolve();
        return;
      }

      // Snapshot xp from state.json immediately before spawn
      let snapshotXp = xpCounter;
      try {
        const raw = JSON.parse(fs.readFileSync(stateFile, "utf8"));
        snapshotXp = raw?.pets?.[0]?.xp ?? xpCounter;
      } catch {
        // race: file being written, use last known
      }

      // Spawn statusline asynchronously
      const child = spawn(
        "node",
        [BIN, "statusline"],
        {
          env: {
            ...process.env,
            GLYPHLING_HOME: stateHome,
            NODE_ENV: "test",
          },
          stdio: ["ignore", "pipe", "ignore"],
        }
      );

      let stdout = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.on("close", () => {
        invocations++;
        const firstLine = stdout.split("\n")[0] ?? "";
        const plain = stripAnsi(firstLine);

        // Extract the XP number from the rendered HUD text (digits after the bar)
        // Pattern: "] 1234567" or "] 1234567 " after the bar segment
        const xpMatch = /\]\s+(\d+)/.exec(plain);
        const renderedXp = xpMatch ? parseInt(xpMatch[1], 10) : -1;

        // A mismatch is when the rendered xp number differs from what was in
        // state.json at spawn time. Tolerate off-by-one-tick drift.
        if (renderedXp !== -1 && Math.abs(renderedXp - snapshotXp) > span) {
          mismatches++;
        }

        if (invocations % 500 === 0) {
          const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
          process.stdout.write(
            `  ${elapsed}s: ${invocations} invocations, ${mismatches} mismatches\r`
          );
        }
      });
    }, INTERVAL_MS);
  });

  console.log(`\n`);
  console.log(`Stress run complete.`);
  console.log(`Total invocations: ${invocations}`);
  console.log(`XP mismatches:     ${mismatches}`);
  console.log(
    mismatches === 0
      ? `PASS: 0 / ${invocations} invocations disagreed with state.json (Hypothesis 1 NOT supported).`
      : `FAIL: ${mismatches} / ${invocations} invocations disagreed with state.json (race condition detected).`
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const glyphlingHome = process.env["GLYPHLING_HOME"];
if (!glyphlingHome) {
  console.error(
    `[repro-xp-bar] GLYPHLING_HOME is not set.\n` +
      `Example: GLYPHLING_HOME=/tmp/repro-xp-bar node scripts/repro-xp-bar.mjs`
  );
  process.exit(1);
}

const stateHome = path.resolve(glyphlingHome);
assertNotUnderClaudeDir(stateHome);

// Verify build exists
if (!fs.existsSync(BIN)) {
  console.error(
    `[repro-xp-bar] dist/src/bin.js not found.\n` +
      `Run "npm run build" first, then re-run this script.`
  );
  process.exit(1);
}

const isStress = process.argv.includes("--stress");
const TEST_LEVEL = 280;

if (isStress) {
  await runStress(stateHome, TEST_LEVEL);
} else {
  await runTable(stateHome, TEST_LEVEL);
}
