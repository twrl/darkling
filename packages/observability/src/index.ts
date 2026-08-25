/**
 * Darkling observability: leveled, tagged logging backed by `consola`.
 *
 * This is an **implementation concern**, not a normative subsystem. No
 * specification establishes logging; this package exists to give the service
 * bus and the agentic loop a single, consistent logging surface for
 * development and diagnostics. It is out-of-band: logs are for the
 * operator/developer and are not visible to the Guide or the Visitor. In
 * particular, agent-loop traces are diagnostic only — the constrained agent's
 * reasoning is not directly observable to the model or the User, and these
 * logs do not change that.
 *
 * The package uses `consola`'s default reporter, which writes to the console
 * of whatever context it runs in. Because the service bus runs across Web
 * Workers (each with its own console), logs appear per-worker under devtools.
 * Aggregating logs over the bus to a single sink is a follow-up, not provided
 * here.
 *
 * @see packages/observability/package.spec.md
 */

import consola from 'consola';

/**
 * Numeric log levels, mirroring consola's level scheme. Exposed so consumers
 * can configure the threshold without depending on consola directly.
 *
 * - `0` silent — emit nothing.
 * - `1` fatal / error.
 * - `2` warn.
 * - `3` info / log (the default).
 * - `4` debug.
 * - `5` trace / verbose.
 */
export const LogLevel = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

/**
 * The subsystem tags for which loggers are created. Kept as a closed set so
 * that log origins are predictable and greppable. Add a tag here when wiring
 * logging into a new subsystem.
 */
export const LOG_TAGS = [
  'service-bus:broker',
  'service-bus:host',
  'service-bus:client',
  'guide:loop',
  'guide:provider',
] as const;

export type LogTag = (typeof LOG_TAGS)[number];

/**
 * Create a tagged logger for a subsystem. The logger inherits the global
 * level and reporter configured via {@link configureLogging}; each log line
 * is prefixed with its tag so per-worker console output is attributable.
 */
export function createLogger(tag: LogTag): ConsolaInstance {
  return consola.withTag(tag) as ConsolaInstance;
}

/**
 * Configure the global logging level. Call once at startup before creating
 * loggers. In development the default level is `info` (3). Production
 * deployments may raise the threshold (e.g. to `warn`) to suppress diagnostic
 * noise.
 */
export function configureLogging(options: LoggingOptions = {}): void {
  consola.level = options.level ?? LogLevel.info;
}

/** Options for {@link configureLogging}. */
export interface LoggingOptions {
  /** The minimum log level to emit. Defaults to {@link LogLevel.info} (3). */
  level?: LogLevel;
}

/**
 * The minimal logger surface consumers depend on. Kept as a stable interface
 * so consumers do not depend on consola's full (evolving) API.
 */
export interface ConsolaInstance {
  readonly level: number;
  debug(message: unknown, ...args: unknown[]): void;
  info(message: unknown, ...args: unknown[]): void;
  warn(message: unknown, ...args: unknown[]): void;
  error(message: unknown, ...args: unknown[]): void;
  trace(message: unknown, ...args: unknown[]): void;
  withTag(tag: string): ConsolaInstance;
}
