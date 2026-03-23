/**
 * Zero-dependency ANSI color helpers for terminal output.
 *
 * Automatically disables colors when stdout is not a TTY
 * or when NO_COLOR environment variable is set.
 */

const enabled = process.stdout.isTTY && !process.env.NO_COLOR;

function wrap(open, close) {
  if (!enabled) return (text) => text;
  return (text) => `\x1b[${open}m${text}\x1b[${close}m`;
}

export const c = {
  // Modifiers
  bold:    wrap(1, 22),
  dim:     wrap(2, 22),
  italic:  wrap(3, 23),
  underline: wrap(4, 24),

  // Colors
  red:     wrap(31, 39),
  green:   wrap(32, 39),
  yellow:  wrap(33, 39),
  blue:    wrap(34, 39),
  magenta: wrap(35, 39),
  cyan:    wrap(36, 39),
  white:   wrap(37, 39),
  gray:    wrap(90, 39),
};

/**
 * Print a horizontal separator line across the terminal.
 */
export function separator() {
  const width = Math.min(process.stdout.columns || 60, 60);
  console.log(`\n${c.dim('─'.repeat(width))}`);
}

/**
 * Print a colored step header, e.g., "Step 1 · Project Path"
 */
export function stepHeader(step, title) {
  console.log(`\n  ${c.bold(c.cyan(step))} ${c.dim('·')} ${c.bold(title)}\n`);
}
