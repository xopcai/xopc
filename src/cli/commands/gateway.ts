import { Command } from 'commander';
import http from 'http';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('GatewayCommand');

class Gateway {
  private server: http.Server | null = null;

  async start(config: { host: string; port: number }): Promise<void> {
    this.server = http.createServer((req, res) => {
      // Simple health check endpoint
      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: 'xopcbot' }));
        return;
      }

      // Default response
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'xopcbot-gateway',
        version: '0.1.0',
        endpoints: ['GET /health'],
      }));
    });

    return new Promise((resolve) => {
      this.server!.listen(config.port, config.host, () => {
        console.log(`🚀 xopcbot Gateway running at http://${config.host}:${config.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}

export function createGatewayCommand(): Command {
  const cmd = new Command('gateway')
    .description('Start the xopcbot gateway server')
    .option('--host <address>', 'Host to bind to', '0.0.0.0')
    .option('--port <number>', 'Port to listen on', '18790')
    .action(async (options) => {
      const gateway = new Gateway();
      
      const shutdown = async () => {
        console.log('\n🛑 Shutting down gateway...');
        await gateway.stop();
        console.log('✅ Gateway stopped');
        process.exit(0);
      };
      
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      
      try {
        await gateway.start({
          host: options.host,
          port: parseInt(options.port),
        });
      } catch (error) {
        log.error({ err: error }, 'Failed to start gateway');
        process.exit(1);
      }
    });

  return cmd;
}
