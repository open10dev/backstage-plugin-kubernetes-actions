import {
  createBackendPlugin,
  coreServices,
} from '@backstage/backend-plugin-api';
import { createRouter } from './router';

/**
 * The kubernetes-actions backend plugin.
 *
 * Registers two HTTP endpoints:
 *   GET  /api/kubernetes-actions/pods
 *   DELETE /api/kubernetes-actions/pods/:namespace/:name
 *
 * Both require an authenticated Backstage user session.
 * Delete operations are audit-logged with the caller's entity ref.
 *
 * @public
 */
export const kubernetesActionsPlugin = createBackendPlugin({
  pluginId: 'kubernetes-actions',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        httpAuth: coreServices.httpAuth,
        userInfo: coreServices.userInfo,
      },
      async init({ httpRouter, config, logger, httpAuth, userInfo }) {
        const router = await createRouter({
          config,
          logger,
          httpAuth,
          userInfo,
        });

        httpRouter.use(router);

        // Let the Backstage framework forward requests to our handler;
        // we validate credentials manually inside each route.
        httpRouter.addAuthPolicy({
          path: '/pods',
          allow: 'unauthenticated',
        });
        httpRouter.addAuthPolicy({
          path: '/pods/:namespace/:name',
          allow: 'unauthenticated',
        });
      },
    });
  },
});
