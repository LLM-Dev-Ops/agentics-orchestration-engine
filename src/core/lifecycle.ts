/**
 * Lifecycle Manager.
 *
 * Manages simulation lifecycle state machine transitions.
 * Ensures valid state transitions and emits lifecycle events.
 *
 * @module core/lifecycle
 */

import type {
  SimulationId,
  ISOTimestamp,
} from '../types/common.js';
import type { ExecutionPhase } from '../types/state.js';

// ============================================================================
// LIFECYCLE STATE MACHINE
// ============================================================================

/**
 * Valid state transitions for the simulation lifecycle.
 *
 * State Machine:
 * ```
 * INITIALIZING → CONFIGURING → VALIDATING → SETUP → EXECUTING
 *                                              ↓
 *                                           PAUSED ↔ EXECUTING
 *                                              ↓
 *                                           TEARDOWN → COMPLETED
 *                                              ↓
 *                                     FAILED / CANCELLED
 * ```
 */
const VALID_TRANSITIONS: Record<ExecutionPhase, ExecutionPhase[]> = {
  initializing: ['configuring', 'failed'],
  configuring: ['validating', 'failed'],
  validating: ['setup', 'failed'],
  setup: ['executing', 'failed'],
  executing: ['paused', 'teardown', 'failed', 'cancelled'],
  paused: ['executing', 'teardown', 'cancelled'],
  teardown: ['completed', 'failed'],
  completed: [], // Terminal state
  failed: [], // Terminal state
  cancelled: [], // Terminal state
};

// ============================================================================
// LIFECYCLE EVENT TYPES
// ============================================================================

/**
 * Event emitted during lifecycle transitions.
 */
export interface LifecycleEvent {
  readonly simulationId: SimulationId;
  readonly previousPhase: ExecutionPhase;
  readonly newPhase: ExecutionPhase;
  readonly timestamp: ISOTimestamp;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Listener for lifecycle events.
 */
export type LifecycleListener = (event: LifecycleEvent) => void;

// ============================================================================
// LIFECYCLE MANAGER CLASS
// ============================================================================

/**
 * Manages simulation lifecycle state transitions.
 *
 * Key features:
 * - Enforces valid state transitions
 * - Emits lifecycle events
 * - Tracks transition history
 * - Supports phase-specific hooks
 */
export class LifecycleManager {
  private readonly simulationId: SimulationId;
  private currentPhase: ExecutionPhase;
  private readonly history: LifecycleEvent[] = [];
  private readonly listeners: Set<LifecycleListener> = new Set();
  private readonly phaseHooks: Map<ExecutionPhase, PhaseHook[]> = new Map();
  private readonly getTime: () => ISOTimestamp;
  private pauseReason?: string;
  private failureReason?: string;
  private cancellationReason?: string;

  constructor(
    simulationId: SimulationId,
    getTime?: () => ISOTimestamp
  ) {
    this.simulationId = simulationId;
    this.currentPhase = 'initializing';
    this.getTime = getTime ?? (() => new Date().toISOString() as ISOTimestamp);
  }

  // ==========================================================================
  // STATE ACCESS
  // ==========================================================================

  /**
   * Gets the current execution phase.
   */
  getPhase(): ExecutionPhase {
    return this.currentPhase;
  }

  /**
   * Checks if the simulation is in a terminal state.
   */
  isTerminal(): boolean {
    return ['completed', 'failed', 'cancelled'].includes(this.currentPhase);
  }

  /**
   * Checks if the simulation is active (running or paused).
   */
  isActive(): boolean {
    return ['executing', 'paused'].includes(this.currentPhase);
  }

  /**
   * Checks if the simulation can be paused.
   */
  canPause(): boolean {
    return this.currentPhase === 'executing';
  }

  /**
   * Checks if the simulation can be resumed.
   */
  canResume(): boolean {
    return this.currentPhase === 'paused';
  }

  /**
   * Gets the pause reason (if paused).
   */
  getPauseReason(): string | undefined {
    return this.pauseReason;
  }

  /**
   * Gets the failure reason (if failed).
   */
  getFailureReason(): string | undefined {
    return this.failureReason;
  }

  /**
   * Gets the cancellation reason (if cancelled).
   */
  getCancellationReason(): string | undefined {
    return this.cancellationReason;
  }

  // ==========================================================================
  // STATE TRANSITIONS
  // ==========================================================================

  /**
   * Transitions to a new phase.
   *
   * @param newPhase - Phase to transition to
   * @param reason - Reason for the transition
   * @returns True if transition was successful
   */
  async transition(
    newPhase: ExecutionPhase,
    reason?: string
  ): Promise<boolean> {
    // Validate transition
    if (!this.canTransitionTo(newPhase)) {
      throw new Error(
        `Invalid lifecycle transition: ${this.currentPhase} → ${newPhase}`
      );
    }

    const previousPhase = this.currentPhase;

    // Execute exit hooks for previous phase
    await this.executeHooks(previousPhase, 'exit');

    // Perform transition
    this.currentPhase = newPhase;

    // Create event
    const event: LifecycleEvent = {
      simulationId: this.simulationId,
      previousPhase,
      newPhase,
      timestamp: this.getTime(),
      reason,
    };

    // Record in history
    this.history.push(event);

    // Notify listeners
    this.notifyListeners(event);

    // Execute enter hooks for new phase
    await this.executeHooks(newPhase, 'enter');

    return true;
  }

  /**
   * Checks if a transition to the given phase is valid.
   */
  canTransitionTo(phase: ExecutionPhase): boolean {
    const validTargets = VALID_TRANSITIONS[this.currentPhase];
    return validTargets?.includes(phase) ?? false;
  }

  /**
   * Gets valid target phases from current state.
   */
  getValidTransitions(): ExecutionPhase[] {
    return VALID_TRANSITIONS[this.currentPhase] ?? [];
  }

  // ==========================================================================
  // CONVENIENCE TRANSITION METHODS
  // ==========================================================================

  /**
   * Transitions to configuring phase.
   */
  async configure(): Promise<void> {
    await this.transition('configuring', 'Starting configuration');
  }

  /**
   * Transitions to validating phase.
   */
  async validate(): Promise<void> {
    await this.transition('validating', 'Starting validation');
  }

  /**
   * Transitions to setup phase.
   */
  async setup(): Promise<void> {
    await this.transition('setup', 'Starting setup');
  }

  /**
   * Transitions to executing phase.
   */
  async execute(): Promise<void> {
    await this.transition('executing', 'Starting execution');
  }

  /**
   * Pauses the simulation.
   *
   * @param reason - Reason for pausing
   */
  async pause(reason?: string): Promise<void> {
    if (!this.canPause()) {
      throw new Error(`Cannot pause simulation in ${this.currentPhase} phase`);
    }
    this.pauseReason = reason;
    await this.transition('paused', reason);
  }

  /**
   * Resumes the simulation.
   */
  async resume(): Promise<void> {
    if (!this.canResume()) {
      throw new Error(`Cannot resume simulation in ${this.currentPhase} phase`);
    }
    this.pauseReason = undefined;
    await this.transition('executing', 'Resuming execution');
  }

  /**
   * Transitions to teardown phase.
   */
  async teardown(): Promise<void> {
    await this.transition('teardown', 'Starting teardown');
  }

  /**
   * Completes the simulation successfully.
   */
  async complete(): Promise<void> {
    await this.transition('completed', 'Simulation completed successfully');
  }

  /**
   * Marks the simulation as failed.
   *
   * @param reason - Reason for failure
   */
  async fail(reason: string): Promise<void> {
    this.failureReason = reason;
    await this.transition('failed', reason);
  }

  /**
   * Cancels the simulation.
   *
   * @param reason - Reason for cancellation
   */
  async cancel(reason?: string): Promise<void> {
    this.cancellationReason = reason;
    await this.transition('cancelled', reason ?? 'Simulation cancelled');
  }

  // ==========================================================================
  // HOOKS
  // ==========================================================================

  /**
   * Registers a hook for a specific phase.
   *
   * @param phase - Phase to hook
   * @param type - Hook type (enter or exit)
   * @param handler - Handler function
   * @returns Unregister function
   */
  registerHook(
    phase: ExecutionPhase,
    type: 'enter' | 'exit',
    handler: () => Promise<void> | void
  ): () => void {
    const hook: PhaseHook = { type, handler };
    const hooks = this.phaseHooks.get(phase) ?? [];
    hooks.push(hook);
    this.phaseHooks.set(phase, hooks);

    return () => {
      const currentHooks = this.phaseHooks.get(phase) ?? [];
      const index = currentHooks.indexOf(hook);
      if (index >= 0) {
        currentHooks.splice(index, 1);
      }
    };
  }

  private async executeHooks(
    phase: ExecutionPhase,
    type: 'enter' | 'exit'
  ): Promise<void> {
    const hooks = this.phaseHooks.get(phase) ?? [];
    for (const hook of hooks) {
      if (hook.type === type) {
        await hook.handler();
      }
    }
  }

  // ==========================================================================
  // LISTENERS
  // ==========================================================================

  /**
   * Subscribes to lifecycle events.
   *
   * @param listener - Event listener
   * @returns Unsubscribe function
   */
  onTransition(listener: LifecycleListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(event: LifecycleEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in lifecycle listener:', error);
      }
    }
  }

  // ==========================================================================
  // HISTORY
  // ==========================================================================

  /**
   * Gets the transition history.
   */
  getHistory(): ReadonlyArray<LifecycleEvent> {
    return [...this.history];
  }

  /**
   * Gets the time spent in each phase.
   */
  getPhaseTimings(): Record<ExecutionPhase, number> {
    const timings: Record<string, number> = {};

    for (let i = 0; i < this.history.length; i++) {
      const event = this.history[i]!;
      const nextEvent = this.history[i + 1];

      const startTime = new Date(event.timestamp).getTime();
      const endTime = nextEvent
        ? new Date(nextEvent.timestamp).getTime()
        : Date.now();

      const phase = event.newPhase;
      timings[phase] = (timings[phase] ?? 0) + (endTime - startTime);
    }

    return timings as Record<ExecutionPhase, number>;
  }

  /**
   * Gets total elapsed time since initialization.
   */
  getElapsedTime(): number {
    if (this.history.length === 0) {
      return 0;
    }

    const firstEvent = this.history[0]!;
    return Date.now() - new Date(firstEvent.timestamp).getTime();
  }

  // ==========================================================================
  // RESET
  // ==========================================================================

  /**
   * Resets the lifecycle manager to initial state.
   * WARNING: This should only be used in testing.
   */
  reset(): void {
    this.currentPhase = 'initializing';
    this.history.length = 0;
    this.pauseReason = undefined;
    this.failureReason = undefined;
    this.cancellationReason = undefined;
  }
}

// ============================================================================
// SUPPORTING TYPES
// ============================================================================

/**
 * A hook for phase transitions.
 */
interface PhaseHook {
  readonly type: 'enter' | 'exit';
  readonly handler: () => Promise<void> | void;
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a lifecycle manager.
 */
export function createLifecycleManager(
  simulationId: SimulationId,
  getTime?: () => ISOTimestamp
): LifecycleManager {
  return new LifecycleManager(simulationId, getTime);
}
