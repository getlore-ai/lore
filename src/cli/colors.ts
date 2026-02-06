/**
 * ANSI color utilities for CLI output
 */

export const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  inverse: '\x1b[7m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgRed: '\x1b[41m',
  bgCyan: '\x1b[46m',
  bgMagenta: '\x1b[45m',
};

/**
 * Semantic color helpers
 */
export const c = {
  title: (s: string) => `${colors.bold}${colors.cyan}${s}${colors.reset}`,
  success: (s: string) => `${colors.green}${s}${colors.reset}`,
  warning: (s: string) => `${colors.yellow}${s}${colors.reset}`,
  error: (s: string) => `${colors.bgRed}${colors.white} ${s} ${colors.reset}`,
  info: (s: string) => `${colors.blue}${s}${colors.reset}`,
  dim: (s: string) => `${colors.dim}${s}${colors.reset}`,
  file: (s: string) => `${colors.magenta}${s}${colors.reset}`,
  path: (s: string) => `${colors.gray}${s}${colors.reset}`,
  time: (s: string) => `${colors.dim}${s}${colors.reset}`,
  badge: (s: string, bg: string) => `${bg}${colors.white}${colors.bold} ${s} ${colors.reset}`,
  bold: (s: string) => `${colors.bold}${s}${colors.reset}`,
  italic: (s: string) => `${colors.italic}${s}${colors.reset}`,
  underline: (s: string) => `${colors.underline}${s}${colors.reset}`,
  code: (s: string) => `${colors.bgMagenta}${colors.white}${s}${colors.reset}`,
  header: (s: string) => `${colors.bold}${colors.cyan}${s}${colors.reset}`,
  quote: (s: string) => `${colors.dim}${colors.italic}${s}${colors.reset}`,
  link: (s: string) => `${colors.underline}${colors.blue}${s}${colors.reset}`,
  list: (s: string) => `${colors.yellow}•${colors.reset} ${s}`,
};
