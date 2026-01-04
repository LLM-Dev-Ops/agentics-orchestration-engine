/**
 * Execution Graph.
 *
 * Builds and manages a directed acyclic graph (DAG) from scenario steps.
 * Provides topological ordering and dependency tracking.
 *
 * @module scenario/graph
 */

import type { StepId } from '../types/common.js';
import type { ScenarioStep, StepOrder } from '../types/scenario.js';

// ============================================================================
// GRAPH NODE
// ============================================================================

/**
 * A node in the execution graph representing a step.
 */
export interface GraphNode {
  /** Step identifier */
  readonly stepId: StepId;
  /** Original step definition */
  readonly step: ScenarioStep;
  /** Direct dependencies (steps that must run before) */
  readonly dependencies: ReadonlyArray<StepId>;
  /** Direct dependents (steps that must run after) */
  readonly dependents: StepId[];
  /** Parallel execution group */
  readonly parallelGroup?: string;
  /** Execution order index */
  readonly orderIndex: number;
  /** Depth in the dependency graph (0 = root) */
  depth: number;
}

/**
 * Status of a node during execution.
 */
export type NodeStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

/**
 * Runtime state of a graph node.
 */
export interface NodeState {
  readonly stepId: StepId;
  status: NodeStatus;
  result?: unknown;
  error?: Error;
  startTime?: number;
  endTime?: number;
  retryCount: number;
}

// ============================================================================
// EXECUTION GRAPH CLASS
// ============================================================================

/**
 * Directed acyclic graph for scenario execution ordering.
 *
 * Key features:
 * - Topological sorting for correct execution order
 * - Cycle detection
 * - Parallel group support
 * - Dependency tracking
 */
export class ExecutionGraph {
  private readonly nodes: Map<StepId, GraphNode> = new Map();
  private readonly nodeStates: Map<StepId, NodeState> = new Map();
  private sortedOrder: StepId[] = [];
  private validated = false;

  constructor(steps: ReadonlyArray<ScenarioStep>) {
    this.buildGraph(steps);
    this.validate();
  }

  // ==========================================================================
  // GRAPH CONSTRUCTION
  // ==========================================================================

  /**
   * Builds the graph from scenario steps.
   */
  private buildGraph(steps: ReadonlyArray<ScenarioStep>): void {
    // First pass: create all nodes
    for (const step of steps) {
      const node: GraphNode = {
        stepId: step.stepId,
        step,
        dependencies: step.order.dependsOn ?? [],
        dependents: [],
        parallelGroup: step.order.parallelGroup,
        orderIndex: step.order.index,
        depth: 0,
      };
      this.nodes.set(step.stepId, node);

      // Initialize state
      this.nodeStates.set(step.stepId, {
        stepId: step.stepId,
        status: 'pending',
        retryCount: 0,
      });
    }

    // Second pass: build reverse dependencies (dependents)
    for (const node of this.nodes.values()) {
      for (const depId of node.dependencies) {
        const depNode = this.nodes.get(depId);
        if (depNode) {
          depNode.dependents.push(node.stepId);
        }
      }
    }

    // Third pass: compute depths
    this.computeDepths();
  }

  /**
   * Computes depth for each node (max depth of dependencies + 1).
   */
  private computeDepths(): void {
    const computed = new Set<StepId>();

    const computeDepth = (stepId: StepId): number => {
      if (computed.has(stepId)) {
        return this.nodes.get(stepId)!.depth;
      }

      const node = this.nodes.get(stepId)!;
      let maxDepth = -1;

      for (const depId of node.dependencies) {
        if (this.nodes.has(depId)) {
          const depDepth = computeDepth(depId);
          maxDepth = Math.max(maxDepth, depDepth);
        }
      }

      node.depth = maxDepth + 1;
      computed.add(stepId);
      return node.depth;
    };

    for (const stepId of this.nodes.keys()) {
      computeDepth(stepId);
    }
  }

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  /**
   * Validates the graph for cycles and missing dependencies.
   */
  private validate(): void {
    // Check for missing dependencies
    for (const node of this.nodes.values()) {
      for (const depId of node.dependencies) {
        if (!this.nodes.has(depId)) {
          throw new GraphValidationError(
            `Step '${node.stepId}' depends on unknown step '${depId}'`
          );
        }
      }
    }

    // Check for cycles using DFS
    this.detectCycles();

    // Perform topological sort
    this.topologicalSort();

    this.validated = true;
  }

  /**
   * Detects cycles in the graph using DFS.
   */
  private detectCycles(): void {
    const WHITE = 0; // Not visited
    const GRAY = 1;  // In progress
    const BLACK = 2; // Completed

    const colors = new Map<StepId, number>();
    for (const stepId of this.nodes.keys()) {
      colors.set(stepId, WHITE);
    }

    const dfs = (stepId: StepId, path: StepId[]): void => {
      colors.set(stepId, GRAY);
      path.push(stepId);

      const node = this.nodes.get(stepId)!;
      for (const depId of node.dependents) {
        const color = colors.get(depId);

        if (color === GRAY) {
          // Found cycle
          const cycleStart = path.indexOf(depId);
          const cycle = [...path.slice(cycleStart), depId];
          throw new GraphValidationError(
            `Cycle detected in scenario steps: ${cycle.join(' -> ')}`
          );
        }

        if (color === WHITE) {
          dfs(depId, path);
        }
      }

      colors.set(stepId, BLACK);
      path.pop();
    };

    for (const stepId of this.nodes.keys()) {
      if (colors.get(stepId) === WHITE) {
        dfs(stepId, []);
      }
    }
  }

  /**
   * Performs topological sort using Kahn's algorithm.
   */
  private topologicalSort(): void {
    const inDegree = new Map<StepId, number>();
    const queue: StepId[] = [];
    const result: StepId[] = [];

    // Calculate in-degrees
    for (const node of this.nodes.values()) {
      inDegree.set(node.stepId, node.dependencies.length);
      if (node.dependencies.length === 0) {
        queue.push(node.stepId);
      }
    }

    // Process queue, sorting by orderIndex within same depth
    while (queue.length > 0) {
      // Sort queue by orderIndex for deterministic ordering
      queue.sort((a, b) => {
        const nodeA = this.nodes.get(a)!;
        const nodeB = this.nodes.get(b)!;
        if (nodeA.depth !== nodeB.depth) {
          return nodeA.depth - nodeB.depth;
        }
        return nodeA.orderIndex - nodeB.orderIndex;
      });

      const stepId = queue.shift()!;
      result.push(stepId);

      const node = this.nodes.get(stepId)!;
      for (const dependentId of node.dependents) {
        const newDegree = inDegree.get(dependentId)! - 1;
        inDegree.set(dependentId, newDegree);
        if (newDegree === 0) {
          queue.push(dependentId);
        }
      }
    }

    if (result.length !== this.nodes.size) {
      throw new GraphValidationError(
        'Graph contains cycles (topological sort incomplete)'
      );
    }

    this.sortedOrder = result;
  }

  // ==========================================================================
  // GRAPH ACCESS
  // ==========================================================================

  /**
   * Gets a node by step ID.
   */
  getNode(stepId: StepId): GraphNode | undefined {
    return this.nodes.get(stepId);
  }

  /**
   * Gets the state of a node.
   */
  getNodeState(stepId: StepId): NodeState | undefined {
    return this.nodeStates.get(stepId);
  }

  /**
   * Gets all nodes.
   */
  getAllNodes(): ReadonlyArray<GraphNode> {
    return Array.from(this.nodes.values());
  }

  /**
   * Gets steps in topological order.
   */
  getExecutionOrder(): ReadonlyArray<StepId> {
    return this.sortedOrder;
  }

  /**
   * Gets steps that are ready to execute (all dependencies satisfied).
   */
  getReadySteps(): ReadonlyArray<StepId> {
    const ready: StepId[] = [];

    for (const node of this.nodes.values()) {
      const state = this.nodeStates.get(node.stepId)!;
      if (state.status !== 'pending') {
        continue;
      }

      // Check if all dependencies are completed
      const allDepsComplete = node.dependencies.every((depId) => {
        const depState = this.nodeStates.get(depId);
        return depState?.status === 'completed' || depState?.status === 'skipped';
      });

      if (allDepsComplete) {
        ready.push(node.stepId);
      }
    }

    // Sort by orderIndex for deterministic ordering
    return ready.sort((a, b) => {
      const nodeA = this.nodes.get(a)!;
      const nodeB = this.nodes.get(b)!;
      return nodeA.orderIndex - nodeB.orderIndex;
    });
  }

  /**
   * Gets steps in the same parallel group that are ready.
   */
  getParallelReadySteps(): Map<string, StepId[]> {
    const ready = this.getReadySteps();
    const groups = new Map<string, StepId[]>();

    for (const stepId of ready) {
      const node = this.nodes.get(stepId)!;
      const group = node.parallelGroup ?? stepId; // Use stepId as unique group if no group

      if (!groups.has(group)) {
        groups.set(group, []);
      }
      groups.get(group)!.push(stepId);
    }

    return groups;
  }

  /**
   * Gets the total number of steps.
   */
  size(): number {
    return this.nodes.size;
  }

  /**
   * Checks if all steps are complete.
   */
  isComplete(): boolean {
    for (const state of this.nodeStates.values()) {
      if (state.status !== 'completed' && state.status !== 'skipped' && state.status !== 'failed') {
        return false;
      }
    }
    return true;
  }

  /**
   * Checks if any steps have failed.
   */
  hasFailures(): boolean {
    for (const state of this.nodeStates.values()) {
      if (state.status === 'failed') {
        return true;
      }
    }
    return false;
  }

  // ==========================================================================
  // STATE MANAGEMENT
  // ==========================================================================

  /**
   * Updates the state of a step.
   */
  updateNodeState(
    stepId: StepId,
    update: Partial<Omit<NodeState, 'stepId'>>
  ): void {
    const state = this.nodeStates.get(stepId);
    if (!state) {
      throw new Error(`Unknown step: ${stepId}`);
    }

    Object.assign(state, update);
  }

  /**
   * Marks a step as started.
   */
  markStarted(stepId: StepId): void {
    this.updateNodeState(stepId, {
      status: 'running',
      startTime: performance.now(),
    });
  }

  /**
   * Marks a step as completed.
   */
  markCompleted(stepId: StepId, result?: unknown): void {
    this.updateNodeState(stepId, {
      status: 'completed',
      result,
      endTime: performance.now(),
    });
  }

  /**
   * Marks a step as failed.
   */
  markFailed(stepId: StepId, error: Error): void {
    this.updateNodeState(stepId, {
      status: 'failed',
      error,
      endTime: performance.now(),
    });
  }

  /**
   * Marks a step as skipped.
   */
  markSkipped(stepId: StepId): void {
    this.updateNodeState(stepId, {
      status: 'skipped',
      endTime: performance.now(),
    });
  }

  /**
   * Increments retry count for a step.
   */
  incrementRetry(stepId: StepId): number {
    const state = this.nodeStates.get(stepId);
    if (!state) {
      throw new Error(`Unknown step: ${stepId}`);
    }
    state.retryCount++;
    state.status = 'pending';
    return state.retryCount;
  }

  /**
   * Resets the graph state for re-execution.
   */
  reset(): void {
    for (const state of this.nodeStates.values()) {
      state.status = 'pending';
      state.result = undefined;
      state.error = undefined;
      state.startTime = undefined;
      state.endTime = undefined;
      state.retryCount = 0;
    }
  }

  // ==========================================================================
  // ANALYSIS
  // ==========================================================================

  /**
   * Gets execution statistics.
   */
  getStatistics(): GraphStatistics {
    let completed = 0;
    let failed = 0;
    let skipped = 0;
    let pending = 0;
    let running = 0;

    for (const state of this.nodeStates.values()) {
      switch (state.status) {
        case 'completed':
          completed++;
          break;
        case 'failed':
          failed++;
          break;
        case 'skipped':
          skipped++;
          break;
        case 'pending':
        case 'ready':
          pending++;
          break;
        case 'running':
          running++;
          break;
      }
    }

    return {
      total: this.nodes.size,
      completed,
      failed,
      skipped,
      pending,
      running,
      maxDepth: Math.max(...Array.from(this.nodes.values()).map((n) => n.depth)),
    };
  }

  /**
   * Gets the critical path (longest execution path).
   */
  getCriticalPath(): ReadonlyArray<StepId> {
    // Find the node with maximum depth
    let maxDepthNode: GraphNode | null = null;
    let maxDepth = -1;

    for (const node of this.nodes.values()) {
      if (node.depth > maxDepth) {
        maxDepth = node.depth;
        maxDepthNode = node;
      }
    }

    if (!maxDepthNode) {
      return [];
    }

    // Trace back through dependencies to build critical path
    const path: StepId[] = [maxDepthNode.stepId];
    let current = maxDepthNode;

    while (current.dependencies.length > 0) {
      // Find dependency with highest depth
      let maxDepDep: GraphNode | null = null;
      let maxDepDepth = -1;

      for (const depId of current.dependencies) {
        const depNode = this.nodes.get(depId);
        if (depNode && depNode.depth > maxDepDepth) {
          maxDepDepth = depNode.depth;
          maxDepDep = depNode;
        }
      }

      if (!maxDepDep) break;
      path.unshift(maxDepDep.stepId);
      current = maxDepDep;
    }

    return path;
  }
}

// ============================================================================
// SUPPORTING TYPES
// ============================================================================

/**
 * Statistics about the execution graph.
 */
export interface GraphStatistics {
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly pending: number;
  readonly running: number;
  readonly maxDepth: number;
}

/**
 * Error thrown during graph validation.
 */
export class GraphValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphValidationError';
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates an execution graph from steps.
 */
export function createExecutionGraph(
  steps: ReadonlyArray<ScenarioStep>
): ExecutionGraph {
  return new ExecutionGraph(steps);
}
