/**
 * Execution Listener Startup.
 *
 * Entry point for starting the event-driven execution listener.
 * This script connects to Ruvector and begins listening for
 * plan_approved events to trigger orchestration (delegation to downstream cores).
 *
 * Usage:
 *   npm run start:listener
 *   or
 *   node dist/ruvector/startup.js
 *
 * Required environment variables:
 *   RUVECTOR_ENDPOINT - Ruvector API endpoint URL
 *   RUVECTOR_API_KEY - API key for authentication (or use secret manager ref)
 *
 * Optional environment variables:
 *   RUVECTOR_CREDENTIALS_REF - Reference to secret in Google Secret Manager
 *   RUVECTOR_CLIENT_ID - Client identifier (default: auto-generated)
 *   RUVECTOR_MODE - polling or streaming (default: polling)
 *   RUVECTOR_POLL_INTERVAL_MS - Poll interval in ms (default: 5000)
 *   ENGINE_ID - Engine identifier for lifecycle events
 *   ASYNC_EXECUTION - Whether to execute asynchronously (default: true)
 *   MAX_CONCURRENT_EXECUTIONS - Max concurrent executions (default: 5)
 *
 * @module ruvector/startup
 */

import { createServer, type Server } from 'node:http';
import {
  ExecutionListener,
  createExecutionListenerFromEnvironment,
  InMemorySimulationResolver,
} from './execution-listener.js';
import type { ExecutionEvent } from './execution-listener.js';

// ============================================================================
// HEALTH SERVER FOR CLOUD RUN
// ============================================================================

/**
 * Starts a minimal HTTP health server for Cloud Run probes.
 * Cloud Run requires an HTTP endpoint to verify the container is healthy.
 */
function startHealthServer(listener: ExecutionListener | null): Server {
  const port = parseInt(process.env['PORT'] ?? '8080', 10);

  const server = createServer((req, res) => {
    if (req.url === '/health' || req.url === '/healthz' || req.url === '/') {
      const status = listener?.getStatus();
      const isHealthy = listener !== null && status?.running;

      res.writeHead(isHealthy ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: isHealthy ? 'healthy' : 'starting',
        service: 'agentics-orchestration-engine-listener',
        timestamp: new Date().toISOString(),
        listener: status ?? { running: false },
      }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Health server listening on port ${port}`);
  });

  return server;
}

// ============================================================================
// STARTUP FUNCTION
// ============================================================================

/**
 * Starts the execution listener.
 *
 * This is the main entry point that:
 * 1. Creates the simulation resolver
 * 2. Creates the execution listener
 * 3. Connects to Ruvector
 * 4. Begins processing plan_approved events (delegated to downstream cores)
 */
async function startExecutionListener(): Promise<void> {
  console.log('='.repeat(60));
  console.log('AGENTICS ORCHESTRATION ENGINE - EXECUTION LISTENER');
  console.log('='.repeat(60));
  console.log('');
  console.log('Environment:');
  console.log(`  RUVECTOR_ENDPOINT: ${process.env['RUVECTOR_ENDPOINT'] ?? '(not set)'}`);
  console.log(`  RUVECTOR_MODE: ${process.env['RUVECTOR_MODE'] ?? 'polling'}`);
  console.log(`  ENGINE_ID: ${process.env['ENGINE_ID'] ?? '(auto-generated)'}`);
  console.log(`  ASYNC_EXECUTION: ${process.env['ASYNC_EXECUTION'] ?? 'true'}`);
  console.log(`  MAX_CONCURRENT_EXECUTIONS: ${process.env['MAX_CONCURRENT_EXECUTIONS'] ?? '5'}`);
  console.log('');

  // Start health server FIRST for Cloud Run probes
  // This allows Cloud Run to mark the container as healthy while we initialize
  let healthServer: Server | null = null;
  let listener: ExecutionListener | null = null;

  healthServer = startHealthServer(null);

  // Validate required environment variables
  if (!process.env['RUVECTOR_ENDPOINT']) {
    console.error('ERROR: RUVECTOR_ENDPOINT environment variable is required');
    console.error('');
    console.error('Please set the following environment variables:');
    console.error('  export RUVECTOR_ENDPOINT=https://ruvector.example.com/api');
    console.error('  export RUVECTOR_API_KEY=your-api-key');
    console.error('');
    process.exit(1);
  }

  // Create simulation resolver
  // In production, this would be replaced with a proper implementation
  // that loads configurations from a database or external service
  const resolver = new InMemorySimulationResolver();

  // Create execution listener
  try {
    listener = createExecutionListenerFromEnvironment(resolver);
  } catch (error) {
    console.error('ERROR: Failed to create execution listener:', error);
    process.exit(1);
  }

  // Update health server to use the listener for status
  healthServer.close();
  healthServer = startHealthServer(listener);

  // Subscribe to execution events for logging
  listener.onExecutionEvent((event: ExecutionEvent) => {
    const timestamp = new Date().toISOString();
    switch (event.type) {
      case 'started':
        console.log(`[${timestamp}] EXECUTION STARTED: plan=${event.planId}, simulation=${event.simulationId}`);
        break;
      case 'completed':
        console.log(`[${timestamp}] EXECUTION COMPLETED: plan=${event.planId}, simulation=${event.simulationId}, status=${event.result?.status}`);
        break;
      case 'failed':
        console.log(`[${timestamp}] EXECUTION FAILED: plan=${event.planId}, simulation=${event.simulationId}, error=${event.error?.message}`);
        break;
      case 'skipped':
        console.log(`[${timestamp}] EXECUTION SKIPPED: plan=${event.planId}, reason=${event.reason}`);
        break;
    }
  });

  // Handle shutdown signals
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    try {
      if (listener) {
        await listener.stop();
        console.log('Execution listener stopped');
      }
      if (healthServer) {
        healthServer.close();
        console.log('Health server stopped');
      }
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Start the listener
  try {
    console.log('Starting execution listener...');
    await listener.start();
    console.log('');
    console.log('='.repeat(60));
    console.log('EXECUTION LISTENER RUNNING');
    console.log('Waiting for plan_approved events from Ruvector...');
    console.log('Press Ctrl+C to stop');
    console.log('='.repeat(60));
    console.log('');

    // Print status periodically
    setInterval(() => {
      const status = listener.getStatus();
      const idempotency = listener.getIdempotencyStatistics();
      console.log(`[STATUS] events=${status.eventsReceived}, started=${status.executionsStarted}, completed=${status.executionsCompleted}, failed=${status.executionsFailed}, skipped=${status.executionsSkipped}, current=${status.currentExecutions}, idempotency_records=${idempotency.total}`);
    }, 60000); // Every minute

  } catch (error) {
    console.error('ERROR: Failed to start execution listener:', error);
    process.exit(1);
  }
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

// Start the listener
startExecutionListener().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
