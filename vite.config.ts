import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { app } from './src/server/app';
import { LocalD1Database, loadDevVars } from './src/server/localD1';
import type { Env } from './src/server/types';

function readBodyBuffer(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sfeedApiPlugin(): Plugin {
  let env: Env | null = null;

  return {
    name: 'sfeed-hono-d1-dev-middleware',
    configureServer(server) {
      const rootDir = process.cwd();
      const dbPath = path.join(rootDir, '.local', 'sfeed.sqlite');
      const schemaPath = path.join(rootDir, 'migrations', '0001_schema.sql');
      const localDb = new LocalD1Database(dbPath, schemaPath);
      const devVars = loadDevVars(rootDir);

      env = {
        DB: localDb,
        GOOGLE_CLIENT_ID: devVars.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET:
          devVars.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
        JWT_SECRET: devVars.JWT_SECRET || process.env.JWT_SECRET || 'dev-secret',
        AI_MODEL:
          devVars.AI_MODEL ||
          process.env.AI_MODEL ||
          '@cf/meta/llama-3.1-8b-instruct',
        // configureServer는 로컬 개발 서버에서만 돌므로, 여기서는 빠른 로그인이 기본으로 켜진다
        ALLOW_QUICK_LOGIN: devVars.ALLOW_QUICK_LOGIN || 'true',
      };

      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) {
          return next();
        }

        try {
          const host = req.headers.host || 'localhost:5173';
          const fullUrl = `http://${host}${req.url}`;
          const method = req.method || 'GET';

          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (Array.isArray(v)) {
              headers.set(k, v.join(', '));
            } else if (typeof v === 'string') {
              headers.set(k, v);
            }
          }

          let body: BodyInit | undefined = undefined;
          if (method !== 'GET' && method !== 'HEAD') {
            const buf = await readBodyBuffer(req);
            if (buf.length > 0) {
              body = new Uint8Array(buf);
            }
          }

          const webReq = new Request(fullUrl, {
            method,
            headers,
            body,
          });

          const webRes = await app.fetch(webReq, env!);

          res.statusCode = webRes.status;
          webRes.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });

          const respBuffer = Buffer.from(await webRes.arrayBuffer());
          res.end(respBuffer);
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : 'Internal Server Error',
            })
          );
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), sfeedApiPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
