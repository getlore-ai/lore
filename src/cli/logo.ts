/**
 * ASCII Art Logo
 *
 * Renders the `> lore` brand as ASCII art:
 * - Yellow chevron (╲ ▸ ╱) on the left
 * - Cyan bold box-drawing "lore" on the right
 *
 * Used in the welcome screen and setup wizard.
 */

import { colors, c } from './colors.js';

// Yellow chevron          Cyan "lore" in box-drawing
// ╲     ┃  ┏━┓ ┏━┓ ┏━━
//  ▸    ┃  ┃ ┃ ┣┳┛ ┣━
// ╱     ┗━ ┗━┛ ┗┻╸ ┗━━

function yel(s: string): string {
  return `${colors.bold}${colors.yellow}${s}${colors.reset}`;
}

function lore(s: string): string {
  return c.title(s);
}

/**
 * Returns the colored ASCII logo with tagline.
 */
export function getLogo(): string {
  const lines = [
    `  ${yel('╲')}     ${lore('┃  ┏━┓ ┏━┓ ┏━━')}`,
    `   ${yel('▸')}    ${lore('┃  ┃ ┃ ┣┳┛ ┣━')}`,
    `  ${yel('╱')}     ${lore('┗━ ┗━┛ ┗┻╸ ┗━━')}`,
  ].join('\n');
  const tagline = c.dim('        Research Knowledge Repository');
  return `${lines}\n${tagline}`;
}
