import express from 'express';
import request from 'supertest';
import { createRouter } from '../router';
import { KubernetesActionsClient } from '../KubernetesActionsClient';
import { mockServices } from '@backstage/backend-test-utils';
import { ConfigReader } from '@backstage/config';

// ── Mock the k8s client ───────────────────────────────────────────────────────

jest.mock('../KubernetesActionsClient', () => ({
  KubernetesActionsClient: jest.fn(),
  readClustersFromConfig: jest.fn().mockReturnValue([
    {
      name: 'test-cluster',
      url: 'https://k8s.local:6443',
      token: 'test-token',
      skipTLSVerify: true,
    },
  ]),
}));

const mockListPods = jest.fn();
const mockDeletePod = jest.fn();
const mockGetPodLogs = jest.fn();

(KubernetesActionsClient as jest.Mock).mockImplementation(() => ({
  listPods: mockListPods,
  deletePod: mockDeletePod,
  getPodLogs: mockGetPodLogs,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_POD_LIST = {
  kind: 'PodList',
  items: [
    {
      metadata: {
        name: 'my-app-abc123',
        namespace: 'default',
        creationTimestamp: '2024-01-01T00:00:00Z',
      },
      status: { phase: 'Running', containerStatuses: [{ ready: true, restartCount: 0 }] },
      spec: { containers: [{ name: 'app' }] },
    },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function buildApp(overrideCredentials = true) {
  const logger = mockServices.logger.mock();
  const config = new ConfigReader({
    kubernetes: {
      clusterLocatorMethods: [
        {
          type: 'config',
          clusters: [
            {
              name: 'test-cluster',
              url: 'https://k8s.local:6443',
              serviceAccountToken: 'test-token',
              skipTLSVerify: true,
            },
          ],
        },
      ],
    },
  });

  // Mock httpAuth to succeed for all requests (simulates logged-in user)
  const httpAuth = {
    credentials: overrideCredentials
      ? jest.fn().mockResolvedValue({ principal: { type: 'user', userEntityRef: 'user:default/alice' } })
      : jest.fn().mockRejectedValue(new Error('Unauthenticated')),
    issueUserCookie: jest.fn(),
  };

  const userInfo = {
    getUserInfo: jest.fn().mockResolvedValue({ userEntityRef: 'user:default/alice' }),
  };

  const router = await createRouter({
    config: config as any,
    logger,
    httpAuth: httpAuth as any,
    userInfo: userInfo as any,
  });

  const app = express();
  app.use(express.json());
  app.use(router);
  return { app, httpAuth, userInfo };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /pods', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 with pod list for authenticated user', async () => {
    mockListPods.mockResolvedValue(MOCK_POD_LIST);
    const { app } = await buildApp();

    const res = await request(app)
      .get('/pods?labelSelector=app%3Dmy-app&namespace=default');

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('PodList');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].metadata.name).toBe('my-app-abc123');
  });

  it('returns 401 when user is not authenticated', async () => {
    const { app } = await buildApp(false);
    const res = await request(app).get('/pods?labelSelector=app%3Dmy-app');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Authentication required');
  });

  it('passes the correct labelSelector and namespace to the k8s client', async () => {
    mockListPods.mockResolvedValue(MOCK_POD_LIST);
    const { app } = await buildApp();

    await request(app).get('/pods?labelSelector=app%3Dtest&namespace=staging');

    expect(mockListPods).toHaveBeenCalledWith('staging', 'app=test');
  });

  it('returns 500 when the k8s client throws', async () => {
    mockListPods.mockRejectedValue(new Error('k8s connection refused'));
    const { app } = await buildApp();

    const res = await request(app).get('/pods?labelSelector=app%3Dmy-app');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('k8s connection refused');
  });
});

describe('DELETE /pods/:namespace/:name', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 and audit info when pod is deleted', async () => {
    mockDeletePod.mockResolvedValue(undefined);
    const { app, userInfo } = await buildApp();

    const res = await request(app).delete('/pods/default/my-app-abc123');

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);
    expect(res.body.pod).toBe('my-app-abc123');
    expect(res.body.deletedBy).toBe('user:default/alice');
    expect(userInfo.getUserInfo).toHaveBeenCalled();
  });

  it('returns 401 when user is not authenticated', async () => {
    const { app } = await buildApp(false);
    const res = await request(app).delete('/pods/default/my-app-abc123');
    expect(res.status).toBe(401);
  });

  it('calls k8s client with correct namespace and pod name', async () => {
    mockDeletePod.mockResolvedValue(undefined);
    const { app } = await buildApp();

    await request(app).delete('/pods/staging/my-app-xyz');

    expect(mockDeletePod).toHaveBeenCalledWith('staging', 'my-app-xyz');
  });

  it('returns 500 when the k8s client throws on deletion', async () => {
    mockDeletePod.mockRejectedValue(new Error('Pod not found'));
    const { app } = await buildApp();

    const res = await request(app).delete('/pods/default/missing-pod');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Pod not found');
  });
});

describe('GET /pods/:namespace/:name/logs', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 with log lines for authenticated user', async () => {
    mockGetPodLogs.mockResolvedValue('line one\nline two\nline three\n');
    const { app } = await buildApp();

    const res = await request(app).get('/pods/default/my-app-abc123/logs');

    expect(res.status).toBe(200);
    expect(res.body.lines).toEqual(['line one', 'line two', 'line three']);
  });

  it('returns 401 when user is not authenticated', async () => {
    const { app } = await buildApp(false);
    const res = await request(app).get('/pods/default/my-app-abc123/logs');
    expect(res.status).toBe(401);
  });

  it('passes container and tail params to the k8s client', async () => {
    mockGetPodLogs.mockResolvedValue('log line\n');
    const { app } = await buildApp();

    await request(app).get('/pods/staging/my-app-abc123/logs?container=nginx&tail=50');

    expect(mockGetPodLogs).toHaveBeenCalledWith('staging', 'my-app-abc123', {
      container: 'nginx',
      tailLines: 50,
    });
  });

  it('returns 500 when the k8s client throws', async () => {
    mockGetPodLogs.mockRejectedValue(new Error('container not found'));
    const { app } = await buildApp();

    const res = await request(app).get('/pods/default/my-app-abc123/logs');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('container not found');
  });

  it('caps tail at 1000 lines', async () => {
    mockGetPodLogs.mockResolvedValue('line\n');
    const { app } = await buildApp();

    await request(app).get('/pods/default/my-app-abc123/logs?tail=9999');

    expect(mockGetPodLogs).toHaveBeenCalledWith(
      'default',
      'my-app-abc123',
      expect.objectContaining({ tailLines: 1000 }),
    );
  });
});

describe('KubernetesActionsClient', () => {
  it('still responds with 503 when no cluster is configured', async () => {
    const { readClustersFromConfig } = jest.requireMock('../KubernetesActionsClient');
    readClustersFromConfig.mockReturnValueOnce([]);

    const logger = mockServices.logger.mock();
    const httpAuth = {
      credentials: jest.fn().mockResolvedValue({ principal: { type: 'user' } }),
    };
    const userInfo = { getUserInfo: jest.fn() };
    const config = new ConfigReader({});

    const router = await createRouter({
      config: config as any,
      logger,
      httpAuth: httpAuth as any,
      userInfo: userInfo as any,
    });

    const app = express();
    app.use(express.json());
    app.use(router);

    const res = await request(app).get('/pods');
    expect(res.status).toBe(503);
  });
});
