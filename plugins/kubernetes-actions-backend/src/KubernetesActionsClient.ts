import { Agent } from 'undici';

/** Minimal cluster configuration read from app-config.yaml */
export interface ClusterConfig {
  name: string;
  url: string;
  token: string;
  skipTLSVerify: boolean;
}

/** Slim representation of a Kubernetes Pod returned by the API */
export interface KubernetesPod {
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp: string;
    labels?: Record<string, string>;
  };
  status: {
    phase: string;
    podIP?: string;
    containerStatuses?: Array<{
      name: string;
      ready: boolean;
      restartCount: number;
      state: Record<string, unknown>;
    }>;
  };
  spec: {
    containers: Array<{ name: string }>;
  };
}

export interface PodList {
  kind: 'PodList';
  items: KubernetesPod[];
}

/**
 * Thin wrapper around the Kubernetes REST API.
 * Only reads and deletes pods — no write access beyond that.
 */
export class KubernetesActionsClient {
  private readonly dispatcher: Agent;

  constructor(private readonly cluster: ClusterConfig) {
    this.dispatcher = new Agent({
      connect: { rejectUnauthorized: !cluster.skipTLSVerify },
    });
  }

  async listPods(namespace: string, labelSelector: string): Promise<PodList> {
    const qs = labelSelector
      ? `?labelSelector=${encodeURIComponent(labelSelector)}`
      : '';
    return this.request<PodList>(
      `/api/v1/namespaces/${namespace}/pods${qs}`,
    );
  }

  async deletePod(namespace: string, name: string): Promise<void> {
    await this.request(`/api/v1/namespaces/${namespace}/pods/${name}`, {
      method: 'DELETE',
    });
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.cluster.url}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.cluster.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.headers ?? {}),
      },
      // @ts-ignore - undici Dispatcher for TLS config in Node 22+
      dispatcher: this.dispatcher,
    } as any);

    const body = await res.json() as any;

    if (!res.ok) {
      const message =
        body?.message ?? body?.reason ?? `Kubernetes API error ${res.status}`;
      throw new Error(message);
    }

    return body as T;
  }
}

/** Parse the kubernetes config block and return all configured clusters */
export function readClustersFromConfig(config: {
  getConfigArray(key: string): any[];
}): ClusterConfig[] {
  try {
    const methods = config.getConfigArray('kubernetes.clusterLocatorMethods');
    return methods.flatMap((method: any) => {
      if (method.getString('type') !== 'config') return [];
      return method.getConfigArray('clusters').map((c: any) => ({
        name: c.getString('name'),
        url: c.getString('url'),
        token: c.getString('serviceAccountToken'),
        skipTLSVerify: c.getOptionalBoolean('skipTLSVerify') ?? false,
      }));
    });
  } catch {
    return [];
  }
}
