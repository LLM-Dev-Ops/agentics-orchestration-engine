/**
 * Simulated Clock.
 *
 * Provides virtualized time for deterministic simulation execution.
 * Time can be controlled, accelerated, or run in real-time mode.
 *
 * @module core/determinism/clock
 */

import type {
  ISOTimestamp,
  Duration,
  TimeMode,
  TimingConfig,
} from '../../types/common.js';

// ============================================================================
// CLOCK STATE TYPES
// ============================================================================

/**
 * Internal state of the simulated clock.
 * Can be captured and restored for deterministic replay.
 */
export interface ClockState {
  /** Current simulated time */
  readonly currentTime: ISOTimestamp;
  /** Clock mode */
  readonly mode: TimeMode;
  /** Acceleration factor (if accelerated mode) */
  readonly accelerationFactor: number;
  /** When the clock was started (real time) */
  readonly startedAt: ISOTimestamp;
  /** Simulated start time */
  readonly simulatedStartTime: ISOTimestamp;
  /** Total time advanced manually (controlled mode) */
  readonly totalAdvancedMs: number;
  /** Whether the clock is paused */
  readonly paused: boolean;
}

/**
 * Event emitted when time advances.
 */
export interface TimeAdvanceEvent {
  readonly previousTime: ISOTimestamp;
  readonly newTime: ISOTimestamp;
  readonly advancedMs: number;
  readonly mode: TimeMode;
}

/**
 * Listener for time advance events.
 */
export type TimeAdvanceListener = (event: TimeAdvanceEvent) => void;

// ============================================================================
// SIMULATED CLOCK CLASS
// ============================================================================

/**
 * Simulated clock for deterministic time management.
 *
 * Modes:
 * - controlled: Time only advances when explicitly called (most deterministic)
 * - accelerated: Time advances faster than real-time
 * - real: Time advances at normal wall-clock speed
 *
 * Key features:
 * - Deterministic: Same operations produce same time values
 * - Controllable: Precise control over time advancement
 * - Observable: Subscribe to time changes
 * - Restorable: Capture and restore state
 */
export class SimulatedClock {
  private currentTime: Date;
  private mode: TimeMode;
  private accelerationFactor: number;
  private readonly startedAt: Date;
  private readonly simulatedStartTime: Date;
  private totalAdvancedMs: number;
  private paused: boolean;
  private lastRealTime: Date;
  private readonly listeners: Set<TimeAdvanceListener>;

  /**
   * Creates a new simulated clock.
   *
   * @param config - Timing configuration
   */
  constructor(config: TimingConfig) {
    this.mode = config.mode;
    this.accelerationFactor = config.accelerationFactor ?? 1;
    this.simulatedStartTime = new Date(config.simulatedStartTime);
    this.currentTime = new Date(this.simulatedStartTime);
    this.startedAt = new Date();
    this.lastRealTime = new Date();
    this.totalAdvancedMs = 0;
    this.paused = false;
    this.listeners = new Set();
  }

  // ==========================================================================
  // TIME RETRIEVAL
  // ==========================================================================

  /**
   * Gets the current simulated time as an ISO timestamp.
   *
   * In 'real' or 'accelerated' mode, this updates based on elapsed real time.
   * In 'controlled' mode, this only changes when advance() is called.
   *
   * @returns Current simulated time
   */
  getTime(): ISOTimestamp {
    this.updateTime();
    return this.currentTime.toISOString() as ISOTimestamp;
  }

  /**
   * Gets the current simulated time as a Date object.
   *
   * @returns Current simulated time as Date
   */
  getTimeAsDate(): Date {
    this.updateTime();
    return new Date(this.currentTime);
  }

  /**
   * Gets the current simulated time as Unix timestamp (milliseconds).
   *
   * @returns Unix timestamp in milliseconds
   */
  getTimeMs(): number {
    this.updateTime();
    return this.currentTime.getTime();
  }

  // ==========================================================================
  // TIME CONTROL
  // ==========================================================================

  /**
   * Advances time by the specified duration.
   * Only has effect in 'controlled' mode (throws in other modes).
   *
   * @param duration - Duration to advance (ISO 8601 duration string or milliseconds)
   */
  advance(duration: Duration | number): void {
    if (this.mode !== 'controlled') {
      throw new Error(`Cannot advance time in '${this.mode}' mode`);
    }

    if (this.paused) {
      throw new Error('Cannot advance time while clock is paused');
    }

    const ms = typeof duration === 'number' ? duration : parseDuration(duration);
    const previousTime = this.currentTime.toISOString() as ISOTimestamp;

    this.currentTime = new Date(this.currentTime.getTime() + ms);
    this.totalAdvancedMs += ms;

    this.notifyListeners(previousTime, ms);
  }

  /**
   * Advances time to a specific point.
   * Only has effect in 'controlled' mode.
   *
   * @param newTime - New time to set
   */
  advanceTo(newTime: ISOTimestamp): void {
    if (this.mode !== 'controlled') {
      throw new Error(`Cannot set time in '${this.mode}' mode`);
    }

    const targetTime = new Date(newTime);
    if (targetTime <= this.currentTime) {
      throw new Error('Cannot advance to a time in the past');
    }

    const previousTime = this.currentTime.toISOString() as ISOTimestamp;
    const ms = targetTime.getTime() - this.currentTime.getTime();

    this.currentTime = targetTime;
    this.totalAdvancedMs += ms;

    this.notifyListeners(previousTime, ms);
  }

  /**
   * Sets the time directly (only in 'controlled' mode).
   * Unlike advanceTo, this allows setting time backwards.
   *
   * WARNING: Setting time backwards may cause determinism issues.
   *
   * @param newTime - New time to set
   */
  setTime(newTime: ISOTimestamp): void {
    if (this.mode !== 'controlled') {
      throw new Error(`Cannot set time directly in '${this.mode}' mode`);
    }

    const previousTime = this.currentTime.toISOString() as ISOTimestamp;
    const targetTime = new Date(newTime);
    const ms = targetTime.getTime() - this.currentTime.getTime();

    this.currentTime = targetTime;

    this.notifyListeners(previousTime, ms);
  }

  /**
   * Pauses the clock (only affects 'real' and 'accelerated' modes).
   */
  pause(): void {
    if (this.paused) return;
    this.updateTime(); // Capture current time before pausing
    this.paused = true;
  }

  /**
   * Resumes the clock after pausing.
   */
  resume(): void {
    if (!this.paused) return;
    this.lastRealTime = new Date();
    this.paused = false;
  }

  // ==========================================================================
  // MODE AND CONFIGURATION
  // ==========================================================================

  /**
   * Gets the current clock mode.
   */
  getMode(): TimeMode {
    return this.mode;
  }

  /**
   * Gets the acceleration factor.
   */
  getAccelerationFactor(): number {
    return this.accelerationFactor;
  }

  /**
   * Sets the acceleration factor (only in 'accelerated' mode).
   *
   * @param factor - New acceleration factor
   */
  setAccelerationFactor(factor: number): void {
    if (this.mode !== 'accelerated') {
      throw new Error('Acceleration factor can only be set in accelerated mode');
    }
    if (factor <= 0) {
      throw new Error('Acceleration factor must be positive');
    }
    this.updateTime(); // Update to current time before changing factor
    this.accelerationFactor = factor;
  }

  /**
   * Checks if the clock is paused.
   */
  isPaused(): boolean {
    return this.paused;
  }

  // ==========================================================================
  // STATE MANAGEMENT
  // ==========================================================================

  /**
   * Gets the current state of the clock.
   *
   * @returns Clock state
   */
  getState(): ClockState {
    this.updateTime();
    return {
      currentTime: this.currentTime.toISOString() as ISOTimestamp,
      mode: this.mode,
      accelerationFactor: this.accelerationFactor,
      startedAt: this.startedAt.toISOString() as ISOTimestamp,
      simulatedStartTime: this.simulatedStartTime.toISOString() as ISOTimestamp,
      totalAdvancedMs: this.totalAdvancedMs,
      paused: this.paused,
    };
  }

  /**
   * Restores the clock to a previous state.
   *
   * @param state - State to restore
   */
  restoreState(state: ClockState): void {
    this.currentTime = new Date(state.currentTime);
    this.mode = state.mode;
    this.accelerationFactor = state.accelerationFactor;
    this.totalAdvancedMs = state.totalAdvancedMs;
    this.paused = state.paused;
    this.lastRealTime = new Date();
  }

  /**
   * Resets the clock to its initial state.
   */
  reset(): void {
    this.currentTime = new Date(this.simulatedStartTime);
    this.totalAdvancedMs = 0;
    this.paused = false;
    this.lastRealTime = new Date();
  }

  // ==========================================================================
  // LISTENERS
  // ==========================================================================

  /**
   * Subscribes to time advance events.
   *
   * @param listener - Callback for time changes
   * @returns Unsubscribe function
   */
  onTimeAdvance(listener: TimeAdvanceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  /**
   * Gets the simulated start time.
   */
  getSimulatedStartTime(): ISOTimestamp {
    return this.simulatedStartTime.toISOString() as ISOTimestamp;
  }

  /**
   * Gets elapsed simulated time since start (in milliseconds).
   */
  getElapsedMs(): number {
    this.updateTime();
    return this.currentTime.getTime() - this.simulatedStartTime.getTime();
  }

  /**
   * Gets elapsed simulated time as a duration string.
   */
  getElapsedDuration(): Duration {
    const ms = this.getElapsedMs();
    return formatDuration(ms);
  }

  /**
   * Creates a timestamp offset from current time.
   *
   * @param offsetMs - Offset in milliseconds
   * @returns Offset timestamp
   */
  offsetTime(offsetMs: number): ISOTimestamp {
    this.updateTime();
    return new Date(this.currentTime.getTime() + offsetMs).toISOString() as ISOTimestamp;
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  private updateTime(): void {
    if (this.mode === 'controlled' || this.paused) {
      return;
    }

    const now = new Date();
    const realElapsed = now.getTime() - this.lastRealTime.getTime();
    this.lastRealTime = now;

    if (realElapsed > 0) {
      const simulatedElapsed =
        this.mode === 'accelerated' ? realElapsed * this.accelerationFactor : realElapsed;

      this.currentTime = new Date(this.currentTime.getTime() + simulatedElapsed);
    }
  }

  private notifyListeners(previousTime: ISOTimestamp, advancedMs: number): void {
    const event: TimeAdvanceEvent = {
      previousTime,
      newTime: this.currentTime.toISOString() as ISOTimestamp,
      advancedMs,
      mode: this.mode,
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in time advance listener:', error);
      }
    }
  }
}

// ============================================================================
// DURATION PARSING AND FORMATTING
// ============================================================================

/**
 * Parses an ISO 8601 duration string to milliseconds.
 *
 * Supports: P[n]Y[n]M[n]DT[n]H[n]M[n]S
 * Example: "PT1H30M" = 1 hour 30 minutes = 5400000 ms
 *
 * @param duration - ISO 8601 duration string
 * @returns Duration in milliseconds
 */
export function parseDuration(duration: Duration | string): number {
  const match = String(duration).match(
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/
  );

  if (!match) {
    throw new Error(`Invalid ISO 8601 duration: ${duration}`);
  }

  const [, years, months, days, hours, minutes, seconds] = match;

  let ms = 0;
  if (years) ms += parseInt(years, 10) * 365.25 * 24 * 60 * 60 * 1000;
  if (months) ms += parseInt(months, 10) * 30.44 * 24 * 60 * 60 * 1000;
  if (days) ms += parseInt(days, 10) * 24 * 60 * 60 * 1000;
  if (hours) ms += parseInt(hours, 10) * 60 * 60 * 1000;
  if (minutes) ms += parseInt(minutes, 10) * 60 * 1000;
  if (seconds) ms += parseFloat(seconds) * 1000;

  return Math.round(ms);
}

/**
 * Formats milliseconds as an ISO 8601 duration string.
 *
 * @param ms - Duration in milliseconds
 * @returns ISO 8601 duration string
 */
export function formatDuration(ms: number): Duration {
  if (ms < 0) {
    throw new Error('Duration cannot be negative');
  }

  if (ms === 0) {
    return 'PT0S' as Duration;
  }

  const hours = Math.floor(ms / (60 * 60 * 1000));
  ms %= 60 * 60 * 1000;

  const minutes = Math.floor(ms / (60 * 1000));
  ms %= 60 * 1000;

  const seconds = ms / 1000;

  let result = 'PT';
  if (hours > 0) result += `${hours}H`;
  if (minutes > 0) result += `${minutes}M`;
  if (seconds > 0) result += `${seconds}S`;

  return (result === 'PT' ? 'PT0S' : result) as Duration;
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a controlled clock starting at a specific time.
 * This is the most deterministic mode.
 *
 * @param startTime - Simulated start time
 * @returns New controlled clock
 */
export function createControlledClock(startTime: ISOTimestamp): SimulatedClock {
  return new SimulatedClock({
    mode: 'controlled',
    simulatedStartTime: startTime,
  });
}

/**
 * Creates an accelerated clock.
 *
 * @param startTime - Simulated start time
 * @param accelerationFactor - How much faster than real-time
 * @returns New accelerated clock
 */
export function createAcceleratedClock(
  startTime: ISOTimestamp,
  accelerationFactor: number
): SimulatedClock {
  return new SimulatedClock({
    mode: 'accelerated',
    simulatedStartTime: startTime,
    accelerationFactor,
  });
}

/**
 * Creates a real-time clock.
 *
 * @param startTime - Simulated start time (defaults to current time)
 * @returns New real-time clock
 */
export function createRealTimeClock(startTime?: ISOTimestamp): SimulatedClock {
  return new SimulatedClock({
    mode: 'real',
    simulatedStartTime: startTime ?? (new Date().toISOString() as ISOTimestamp),
  });
}
