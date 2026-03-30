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

  return router;
}
