import { Router } from 'express';
import type {
  LoggerService,
  RootConfigService,
  HttpAuthService,
  UserInfoService,
} from '@backstage/backend-plugin-api';
import {
  KubernetesActionsClient,
  readClustersFromConfig,
} from './KubernetesActionsClient';

export interface RouterOptions {
  config: RootConfigService;
  logger: LoggerService;
  httpAuth: HttpAuthService;
  userInfo: UserInfoService;
}

/**
 * Creates the Express router for the kubernetes-actions backend plugin.
 *
 * Endpoints:
 *   GET  /pods?labelSelector=...&namespace=...  — list pods matching a label selector
 *   DELETE /pods/:namespace/:name               — delete a specific pod
 */
export async function createRouter(options: RouterOptions): Promise<Router> {
  const { config, logger, httpAuth, userInfo } = options;

  const clusters = readClustersFromConfig(config);
  const cluster = clusters[0];

  if (!cluster) {
    logger.warn(
      'kubernetes-actions: no cluster found in kubernetes.clusterLocatorMethods config — all endpoints return 503',
    );
  }

  const client = cluster ? new KubernetesActionsClient(cluster) : null;
  const router = Router();

  // ── GET /pods ─────────────────────────────────────────────────────────────
  router.get('/pods', async (req, res) => {
    const credentials = await httpAuth
      .credentials(req, { allow: ['user'] })
      .catch(() => null);

    if (!credentials) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!client) {
      res.status(503).json({ error: 'No Kubernetes cluster configured' });
      return;
    }

    const labelSelector = String(req.query.labelSelector ?? '');
    const namespace = String(req.query.namespace ?? 'default');

    try {
      const pods = await client.listPods(namespace, labelSelector);
      res.json(pods);
    } catch (err: any) {
      logger.error(`[kubernetes-actions] listPods failed: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // ── DELETE /pods/:namespace/:name ─────────────────────────────────────────
  router.delete('/pods/:namespace/:name', async (req, res) => {
    const credentials = await httpAuth
      .credentials(req, { allow: ['user'] })
      .catch(() => null);

    if (!credentials) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!client) {
      res.status(503).json({ error: 'No Kubernetes cluster configured' });
      return;
    }

    const { namespace, name } = req.params;

    // Resolve the Backstage user identity for audit logging
    let actor = 'unknown';
    try {
      const info = await userInfo.getUserInfo(credentials);
      actor = info.userEntityRef;
    } catch {
      // non-fatal — continue with unknown actor
    }

    logger.info(
      `[kubernetes-actions] DELETE pod ${namespace}/${name} requested by ${actor}`,
    );

    try {
      await client.deletePod(namespace, name);
      logger.info(
        `[kubernetes-actions] Pod ${namespace}/${name} deleted by ${actor}`,
      );
      res.json({
        message: `Pod ${name} deleted successfully`,
        pod: name,
        namespace,
        deletedBy: actor,
      });
    } catch (err: any) {
      logger.error(
        `[kubernetes-actions] deletePod ${namespace}/${name} failed: ${err.message}`,
      );
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /pods/:namespace/:name/logs ───────────────────────────────────────
  router.get('/pods/:namespace/:name/logs', async (req, res) => {
    const credentials = await httpAuth
      .credentials(req, { allow: ['user'] })
      .catch(() => null);

    if (!credentials) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!client) {
      res.status(503).json({ error: 'No Kubernetes cluster configured' });
      return;
    }

    const { namespace, name } = req.params;
    const container = req.query.container ? String(req.query.container) : undefined;
    const tail = Math.min(parseInt(String(req.query.tail ?? '100'), 10), 1000);
    const follow = req.query.follow === 'true';

    if (follow) {
      // ── Server-Sent Events streaming ───────────────────────────────────────
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
      res.flushHeaders();

      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const decoder = new TextDecoder();

      req.on('close', () => reader?.cancel());

      try {
        const k8sRes = await client.streamPodLogs(namespace, name, { container, tailLines: tail });
        reader = k8sRes.body!.getReader();

        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n');
          buffer = parts.pop() ?? '';
          for (const line of parts) {
            if (line) res.write(`data: ${JSON.stringify(line)}\n\n`);
          }
        }

        if (buffer) res.write(`data: ${JSON.stringify(buffer)}\n\n`);
        res.write('event: done\ndata: {}\n\n');
        res.end();
      } catch (err: any) {
        logger.error(`[kubernetes-actions] streamPodLogs ${namespace}/${name}: ${err.message}`);
        res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
    } else {
      // ── Static last-N-lines fetch ──────────────────────────────────────────
      try {
        const text = await client.getPodLogs(namespace, name, { container, tailLines: tail });
        res.json({ lines: text.split('\n').filter(Boolean) });
      } catch (err: any) {
        logger.error(`[kubernetes-actions] getPodLogs ${namespace}/${name}: ${err.message}`);
        res.status(500).json({ error: err.message });
      }
    }
  });

  return router;
}
