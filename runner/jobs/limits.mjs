// Laptop caps (handoff §3, Q5 provisional default): at most 2 agent turns and 1 build at a time.
// Read from the environment; a missing or bad value falls back to the default. The defaults
// are not raised here.
export const DEFAULT_MAX_TURNS = 2;
export const DEFAULT_MAX_BUILDS = 1;
const MAX = 16;

function readCap(value, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX) return fallback;
  return n;
}

/** @returns {{ maxTurns: number, maxBuilds: number }} */
export function readLimits(env = process.env) {
  return {
    maxTurns: readCap(env.SANDBENCH_MAX_TURNS, DEFAULT_MAX_TURNS),
    maxBuilds: readCap(env.SANDBENCH_MAX_BUILDS, DEFAULT_MAX_BUILDS),
  };
}
