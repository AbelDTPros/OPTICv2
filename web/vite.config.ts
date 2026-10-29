import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoEnv(): Record<string, string> {
  const envPath = path.resolve(REPO_ROOT, '.env');
  if (!existsSync(envPath)) {
    return {};
  }
  const env: Record<string, string> = {};
  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separator = line.indexOf('=');
    if (separator < 1) {
      continue;
    }
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[line.slice(0, separator).trim()] = value;
  }
  return env;
}

async function originServesOptic(origin: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin}/health/live`, { signal: AbortSignal.timeout(800) });
    if (!response.ok) {
      return false;
    }
    const body = (await response.json()) as { status?: string; checks?: { process?: string } };
    return body.status === 'ok' && body.checks?.process === 'up';
  } catch {
    return false;
  }
}

async function resolveOpticApiOrigin(): Promise<string> {
  const env = readRepoEnv();
  const candidates = [
    process.env.OPTIC_API_ORIGIN,
    env.OPTIC_API_ORIGIN,
    env.OPTIC_API_PORT ? `http://127.0.0.1:${env.OPTIC_API_PORT}` : undefined,
    env.PORT ? `http://127.0.0.1:${env.PORT}` : undefined,
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3000'
  ].filter((origin): origin is string => Boolean(origin));

  const unique = [...new Set(candidates)];
  if (process.env.VITEST) {
    return unique[0] ?? 'http://127.0.0.1:3001';
  }
  for (const origin of unique) {
    if (await originServesOptic(origin)) {
      return origin;
    }
  }
  return unique[0] ?? 'http://127.0.0.1:3001';
}

function opticApiProxyPlugin(apiOrigin: string): Plugin {
  return {
    name: 'optic-api-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !(req.url.startsWith('/api') || req.url.startsWith('/health'))) {
          next();
          return;
        }
        void forwardToOptic(apiOrigin, req, res);
      });
    }
  };
}

async function forwardToOptic(apiOrigin: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await requestBody(req);
    const init: RequestInit & { duplex?: 'half' } = {
      method: req.method,
      headers: forwardedHeaders(req, apiOrigin),
      redirect: 'manual'
    };
    if (body && body.length > 0) {
      init.body = body;
      init.duplex = 'half';
    }
    const upstream = await fetch(new URL(req.url ?? '/', apiOrigin), init);
    res.statusCode = upstream.status;
    upstream.headers.forEach((value, key) => {
      if (key === 'transfer-encoding' || key === 'connection' || key === 'content-encoding') {
        return;
      }
      res.setHeader(key, value);
    });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'proxy failed';
    console.error(`[optic] proxy error to ${apiOrigin}:`, message);
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: {
            errorCode: 'OPTIC-DEV-50201',
            summary: `Vite could not reach the OPTIC API at ${apiOrigin}. Start npm run dev and confirm it logs "API server listening".`,
            message,
            details: []
          }
        })
      );
    }
  }
}

function forwardedHeaders(req: IncomingMessage, apiOrigin: string): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || key === 'host' || key === 'connection' || key === 'content-length') {
      continue;
    }
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  headers.set('host', new URL(apiOrigin).host);
  return headers;
}

async function requestBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return undefined;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

export default defineConfig(async () => {
  const apiOrigin = await resolveOpticApiOrigin();
  if (!process.env.VITEST) {
    console.info(`[optic] Vite proxying /api and /health to ${apiOrigin}`);
  }
  return {
    base:'/OPTIC/v2/',
    plugins: [opticApiProxyPlugin(apiOrigin), react()],
    server: {
      host: true,
      port: 5174,
      strictPort: true,
      fs: {
        allow: [REPO_ROOT]
      },
      allowedHosts: [
        "digicom-dev.uscis.dhs.gov",
        "localhost",
        "127.0.0.1",
      ]
    },
    resolve: {
      alias: {
        '@optic/rules': path.resolve(__dirname, '../src/rules'),
        '@optic/types': path.resolve(__dirname, '../src/modules/configuration/domain/types.ts')
      }
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
      include: ['src/**/*.test.tsx', 'src/**/*.test.ts']
    }
  };
});
