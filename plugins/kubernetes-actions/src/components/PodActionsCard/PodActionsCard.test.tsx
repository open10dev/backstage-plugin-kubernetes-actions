import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PodActionsCard } from './PodActionsCard';
import {
  TestApiProvider,
  mockApis,
} from '@backstage/frontend-test-utils';
import { discoveryApiRef } from '@backstage/core-plugin-api';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import type { Entity } from '@backstage/catalog-model';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ENTITY_WITH_SELECTOR: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: {
    name: 'my-laravel-app',
    annotations: {
      'backstage.io/kubernetes-label-selector': 'app=my-laravel-app',
    },
  },
  spec: { type: 'service', lifecycle: 'development', owner: 'team-a' },
};

const ENTITY_WITHOUT_SELECTOR: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name: 'no-k8s-app' },
  spec: { type: 'service', lifecycle: 'development', owner: 'team-a' },
};

const MOCK_POD_LIST = {
  kind: 'PodList',
  items: [
    {
      metadata: {
        name: 'my-laravel-app-abc123',
        namespace: 'default',
        creationTimestamp: new Date(Date.now() - 3600_000).toISOString(),
      },
      status: {
        phase: 'Running',
        podIP: '10.0.0.1',
        containerStatuses: [
          { name: 'app', ready: true, restartCount: 0 },
          { name: 'nginx', ready: true, restartCount: 0 },
        ],
      },
      spec: { containers: [{ name: 'app' }, { name: 'nginx' }] },
    },
    {
      metadata: {
        name: 'my-laravel-app-def456',
        namespace: 'default',
        creationTimestamp: new Date(Date.now() - 7200_000).toISOString(),
      },
      status: {
        phase: 'Pending',
        containerStatuses: [],
      },
      spec: { containers: [{ name: 'app' }] },
    },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockDiscovery = {
  getBaseUrl: jest.fn().mockResolvedValue('http://localhost:7007/api/kubernetes-actions'),
  getExternalBaseUrl: jest.fn().mockResolvedValue('http://localhost:7007/api/kubernetes-actions'),
};

function renderCard(entity: Entity, fetchImpl: typeof fetch) {
  const fetchApi = mockApis.fetch({ baseImplementation: fetchImpl });
  return render(
    <TestApiProvider
      apis={[
        [discoveryApiRef, mockDiscovery],
        fetchApi,
      ]}
    >
      <EntityProvider entity={entity}>
        <PodActionsCard />
      </EntityProvider>
    </TestApiProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PodActionsCard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows a message when the entity has no kubernetes annotation', () => {
    renderCard(ENTITY_WITHOUT_SELECTOR, () => Promise.reject(new Error('no fetch expected')));

    // The annotation name is in a <code> element; check it directly
    expect(
      screen.getByText('backstage.io/kubernetes-label-selector'),
    ).toBeInTheDocument();
  });

  it('shows a loading indicator while fetching pods', async () => {
    let resolveFetch: ((v: Response) => void) | undefined;
    renderCard(
      ENTITY_WITH_SELECTOR,
      () => new Promise(resolve => { resolveFetch = resolve; }),
    );
    // Progress renders with data-testid="progress" while loading
    // (data-testid is present even in the initially-hidden state)
    await waitFor(() => expect(screen.getByTestId('progress')).toBeInTheDocument());

    // Resolve fetch and wait for loading state to clear
    resolveFetch!(new Response(JSON.stringify(MOCK_POD_LIST)));
    await waitFor(() =>
      expect(screen.queryByTestId('progress')).not.toBeInTheDocument(),
    );
  });

  it('renders a table row for each pod', async () => {
    renderCard(
      ENTITY_WITH_SELECTOR,
      () => Promise.resolve(
        new Response(JSON.stringify(MOCK_POD_LIST), {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await waitFor(() => {
      expect(screen.getByText('my-laravel-app-abc123')).toBeInTheDocument();
      expect(screen.getByText('my-laravel-app-def456')).toBeInTheDocument();
    });

    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('2/2')).toBeInTheDocument();
  });

  it('shows a delete button for each pod', async () => {
    renderCard(
      ENTITY_WITH_SELECTOR,
      () => Promise.resolve(
        new Response(JSON.stringify(MOCK_POD_LIST), {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await waitFor(() =>
      expect(screen.getByText('my-laravel-app-abc123')).toBeInTheDocument(),
    );

    // All buttons = 1 Refresh + 1 delete per pod
    const allButtons = screen.getAllByRole('button');
    expect(allButtons).toHaveLength(MOCK_POD_LIST.items.length + 1);
  });

  it('opens a confirmation dialog when the delete button is clicked', async () => {
    renderCard(
      ENTITY_WITH_SELECTOR,
      () => Promise.resolve(
        new Response(JSON.stringify(MOCK_POD_LIST), {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await waitFor(() =>
      expect(screen.getByText('my-laravel-app-abc123')).toBeInTheDocument(),
    );

    // Skip the first button (Refresh); the rest are delete buttons per pod
    const [, firstDeleteButton] = screen.getAllByRole('button');
    await userEvent.click(firstDeleteButton);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Pod name appears in the table AND in the dialog's <strong>
    expect(screen.getAllByText(/my-laravel-app-abc123/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Kubernetes will automatically restart/i),
    ).toBeInTheDocument();
  });

  it('dismisses the dialog when Cancel is clicked', async () => {
    renderCard(
      ENTITY_WITH_SELECTOR,
      () => Promise.resolve(
        new Response(JSON.stringify(MOCK_POD_LIST), {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await waitFor(() =>
      expect(screen.getByText('my-laravel-app-abc123')).toBeInTheDocument(),
    );

    // Skip the first button (Refresh); the second is the first delete button
    const [, firstDeleteButton] = screen.getAllByRole('button');
    await userEvent.click(firstDeleteButton);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('calls DELETE endpoint and shows success message on confirm', async () => {
    let callCount = 0;
    renderCard(
      ENTITY_WITH_SELECTOR,
      (_url: string | URL | Request, init?: RequestInit) => {
        callCount++;
        if (init?.method === 'DELETE') {
          return Promise.resolve(
            new Response(
              JSON.stringify({ message: 'Pod deleted', pod: 'my-laravel-app-abc123' }),
              { headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify(MOCK_POD_LIST), {
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      },
    );

    await waitFor(() =>
      expect(screen.getByText('my-laravel-app-abc123')).toBeInTheDocument(),
    );

    // Skip the first button (Refresh); the second is the first delete button
    const [, firstDeleteButton] = screen.getAllByRole('button');
    await userEvent.click(firstDeleteButton);
    // Dialog opens — click the "Delete" confirm button in the dialog
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() =>
      expect(screen.getByText(/deleted/i)).toBeInTheDocument(),
    );

    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it('shows an error alert when the API returns an error', async () => {
    renderCard(
      ENTITY_WITH_SELECTOR,
      () => Promise.resolve(
        new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );
  });
});
