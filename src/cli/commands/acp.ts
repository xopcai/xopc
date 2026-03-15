/**
 * ACP CLI Commands
 */

import { Command } from "commander";
import { register, formatExamples, type CLIContext } from "../registry.js";
import { getAcpSessionManager } from "../../acp/control-plane/manager.js";
import { listAcpRuntimeBackends } from "../../acp/runtime/registry.js";
import { formatAcpErrorText } from "../../acp/runtime/error-text.js";
import { AcpRuntimeError } from "../../acp/runtime/errors.js";
import { loadConfig } from "../../config/loader.js";
/** Format error for CLI output */
function formatCliError(error: unknown): string {
  if (error instanceof AcpRuntimeError) {
    return formatAcpErrorText(error);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function createAcpCommand(_ctx: CLIContext): Command {
  const acpCmd = new Command("acp")
    .description("ACP runtime management")
    .addHelpText(
      "after",
      formatExamples([
        "xopcbot acp status                 # Show ACP runtime status",
        "xopcbot acp status -s <session>    # Show specific session status",
        "xopcbot acp doctor                 # Run ACP diagnostics",
        "xopcbot acp set-mode <mode> -s <session>  # Set runtime mode",
        "xopcbot acp set-config <key> <value> -s <session>  # Set config option",
        "xopcbot acp list                   # List ACP sessions",
        "xopcbot acp close -s <session>     # Close ACP session",
        "xopcbot acp cancel -s <session>    # Cancel active turn",
      ])
    );

  // acp status
  acpCmd
    .command("status")
    .description("Show ACP runtime status")
    .option("-s, --session <key>", "Session key")
    .option("-j, --json", "Output as JSON")
    .action(async (options) => {
      try {
        const cfg = loadConfig();
        const manager = getAcpSessionManager();

        if (options.session) {
          const status = await manager.getSessionStatus({
            cfg,
            sessionKey: options.session,
          });

          if (options.json) {
            console.log(JSON.stringify(status, null, 2));
          } else {
            console.log(`\n📋 ACP Session Status: ${status.sessionKey}`);
            console.log(`   Backend: ${status.backend}`);
            console.log(`   Agent: ${status.agent}`);
            console.log(`   Mode: ${status.mode}`);
            console.log(`   State: ${status.state}`);
            if (status.lastError) {
              console.log(`   Last Error: ${status.lastError}`);
            }
            if (status.runtimeStatus?.summary) {
              console.log(`   Runtime: ${status.runtimeStatus.summary}`);
            }
          }
        } else {
          const snapshot = manager.getObservabilitySnapshot(cfg);
          const backends = listAcpRuntimeBackends();

          if (options.json) {
            console.log(JSON.stringify({ snapshot, backends }, null, 2));
          } else {
            console.log("\n📊 ACP Runtime Status\n");
            console.log("Backends:");
            if (backends.length === 0) {
              console.log("  (none registered)");
            } else {
              for (const backend of backends) {
                console.log(`  - ${backend.id}`);
              }
            }
            console.log("\nRuntime Cache:");
            console.log(`  Active Sessions: ${snapshot.runtimeCache.activeSessions}`);
            console.log(`  Evicted Total: ${snapshot.runtimeCache.evictedTotal}`);
            console.log("\nTurns:");
            console.log(`  Active: ${snapshot.turns.active}`);
            console.log(`  Completed: ${snapshot.turns.completed}`);
            console.log(`  Failed: ${snapshot.turns.failed}`);
            console.log(`  Avg Latency: ${snapshot.turns.averageLatencyMs}ms`);
          }
        }
      } catch (error) {
        console.error(`❌ ${formatCliError(error)}`);
        process.exit(1);
      }
    });

  // acp doctor
  acpCmd
    .command("doctor")
    .description("Run ACP diagnostics")
    .action(async () => {
      console.log("\n🔍 ACP Diagnostics\n");

      const backends = listAcpRuntimeBackends();
      if (backends.length === 0) {
        console.log("❌ No ACP runtime backends registered.");
        console.log("\nTo use ACP, you need to:");
        console.log("  1. Install an ACP runtime (e.g., acpx)");
        console.log("  2. Configure it in your config file");
        return;
      }

      for (const backend of backends) {
        console.log(`\nBackend: ${backend.id}`);
        if (backend.runtime.doctor) {
          const report = await backend.runtime.doctor();
          if (report.ok) {
            console.log(`  ✅ ${report.message}`);
          } else {
            console.log(`  ❌ ${report.message}`);
            if (report.installCommand) {
              console.log(`  Install: ${report.installCommand}`);
            }
          }
        } else {
          console.log("  ⚠️  Doctor not implemented");
        }
      }
    });

  // acp set-mode
  acpCmd
    .command("set-mode <mode>")
    .description("Set ACP session runtime mode")
    .requiredOption("-s, --session <key>", "Session key")
    .action(async (mode, options) => {
      try {
        const cfg = loadConfig();
        const manager = getAcpSessionManager();

        const result = await manager.setSessionRuntimeMode({
          cfg,
          sessionKey: options.session,
          runtimeMode: mode,
        });

        console.log(`✅ Runtime mode set to: ${mode}`);
        console.log(`   Session: ${options.session}`);
        console.log(`   Options: ${JSON.stringify(result)}`);
      } catch (error) {
        console.error(`❌ ${formatCliError(error)}`);
        process.exit(1);
      }
    });

  // acp set-config
  acpCmd
    .command("set-config <key> <value>")
    .description("Set ACP session config option")
    .requiredOption("-s, --session <key>", "Session key")
    .action(async (key, value, options) => {
      try {
        const cfg = loadConfig();
        const manager = getAcpSessionManager();

        const result = await manager.setSessionConfigOption({
          cfg,
          sessionKey: options.session,
          key,
          value,
        });

        console.log(`✅ Config option set: ${key}=${value}`);
        console.log(`   Session: ${options.session}`);
        console.log(`   Options: ${JSON.stringify(result)}`);
      } catch (error) {
        console.error(`❌ ${formatCliError(error)}`);
        process.exit(1);
      }
    });

  // acp list
  acpCmd
    .command("list")
    .description("List ACP sessions")
    .option("-j, --json", "Output as JSON")
    .action(async (options) => {
      try {
        const cfg = loadConfig();
        const manager = getAcpSessionManager();
        const snapshot = manager.getObservabilitySnapshot(cfg);

        if (options.json) {
          console.log(JSON.stringify(snapshot, null, 2));
        } else {
          console.log("\n📋 ACP Sessions\n");
          console.log(`Active Sessions: ${snapshot.runtimeCache.activeSessions}`);
          console.log(`Active Turns: ${snapshot.turns.active}`);
          console.log(`Queue Depth: ${snapshot.turns.queueDepth}`);
        }
      } catch (error) {
        console.error(`❌ ${formatCliError(error)}`);
        process.exit(1);
      }
    });

  // acp close
  acpCmd
    .command("close")
    .description("Close ACP session")
    .requiredOption("-s, --session <key>", "Session key")
    .option("--clear-meta", "Clear session metadata")
    .option("--force", "Force close even if backend unavailable")
    .action(async (options) => {
      try {
        const cfg = loadConfig();
        const manager = getAcpSessionManager();

        const result = await manager.closeSession({
          cfg,
          sessionKey: options.session,
          reason: "cli-close",
          clearMeta: options.clearMeta,
          allowBackendUnavailable: options.force,
        });

        console.log(`✅ Session closed: ${options.session}`);
        console.log(`   Runtime Closed: ${result.runtimeClosed}`);
        console.log(`   Meta Cleared: ${result.metaCleared}`);
        if (result.runtimeNotice) {
          console.log(`   Note: ${result.runtimeNotice}`);
        }
      } catch (error) {
        console.error(`❌ ${formatCliError(error)}`);
        process.exit(1);
      }
    });

  // acp cancel
  acpCmd
    .command("cancel")
    .description("Cancel active ACP session turn")
    .requiredOption("-s, --session <key>", "Session key")
    .option("-r, --reason <reason>", "Cancel reason", "user-cancel")
    .action(async (options) => {
      try {
        const cfg = loadConfig();
        const manager = getAcpSessionManager();

        await manager.cancelSession({
          cfg,
          sessionKey: options.session,
          reason: options.reason,
        });

        console.log(`✅ Session cancelled: ${options.session}`);
      } catch (error) {
        console.error(`❌ ${formatCliError(error)}`);
        process.exit(1);
      }
    });

  // acp serve
  acpCmd
    .command("serve")
    .description("Start ACP server for IDE integration")
    .option("-s, --session <key>", "Default session key")
    .option("-l, --session-label <label>", "Default session label")
    .option("--require-existing", "Fail if session does not exist")
    .option("--reset-session", "Reset session before use")
    .option("-v, --verbose", "Verbose logging")
    .action(async (_options) => {
      try {
        // Dynamic import to start the ACP server
        // The main function starts the server - it's an infinite loop
        // We just need to import it to run it
        await import("../../acp/server.js");
      } catch (error) {
        console.error(`❌ ${formatCliError(error)}`);
        process.exit(1);
      }
    });

  return acpCmd;
}

// Register the command
register({
  id: "acp",
  name: "acp",
  description: "ACP runtime management",
  factory: createAcpCommand,
  metadata: {
    category: "runtime",
  },
});