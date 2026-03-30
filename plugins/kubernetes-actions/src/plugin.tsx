import { createFrontendPlugin, type FrontendPlugin } from '@backstage/frontend-plugin-api';
import { EntityCardBlueprint } from '@backstage/plugin-catalog-react/alpha';

const podActionsCard = EntityCardBlueprint.make({
  name: 'pod-actions',
  params: {
    filter: 'kind:component',
    loader: async () => {
      const { PodActionsCard } = await import(
        './components/PodActionsCard/PodActionsCard'
      );
      return <PodActionsCard />;
    },
  },
});

export const kubernetesActionsPlugin: FrontendPlugin = createFrontendPlugin({
  pluginId: 'kubernetes-actions',
  extensions: [podActionsCard],
});
