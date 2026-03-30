# backstage-plugin-kubernetes-actions-backend

Backend plugin for [`backstage-plugin-kubernetes-actions`](../kubernetes-actions/README.md).

Exposes two authenticated REST endpoints that proxy pod operations to your Kubernetes cluster using a service account:

| Method   | Path                                   | Description                    |
|----------|----------------------------------------|--------------------------------|
| `GET`    | `/api/kubernetes-actions/pods`         | List pods by label selector    |
| `DELETE` | `/api/kubernetes-actions/pods/:ns/:name` | Delete a specific pod         |

All operations require an authenticated Backstage user. Deletions are audit-logged with the caller's Backstage entity ref.

## Installation

### 1. Install the package

```bash
yarn workspace backend add backstage-plugin-kubernetes-actions-backend
```

### 2. Register in your backend

In `packages/backend/src/index.ts`:

```ts
backend.add(import('backstage-plugin-kubernetes-actions-backend'));
```

### 3. Create a Kubernetes service account

```bash
# Create service account
kubectl create serviceaccount backstage -n default

# Grant read + delete access on pods
kubectl create clusterrole backstage-pod-manager \
  --verb=get,list,watch,delete \
  --resource=pods,pods/log

kubectl create clusterrolebinding backstage-pod-manager \
  --clusterrole=backstage-pod-manager \
  --serviceaccount=default:backstage

# Create a long-lived token (Kubernetes 1.24+)
kubectl apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: backstage-token
  namespace: default
  annotations:
    kubernetes.io/service-account.name: backstage
type: kubernetes.io/service-account-token
EOF

# Get the token
kubectl get secret backstage-token -n default \
  -o jsonpath='{.data.token}' | base64 -d
```

### 4. Configure app-config.yaml

The plugin reads from the same `kubernetes` config block used by `@backstage/plugin-kubernetes-backend`:

```yaml
kubernetes:
  serviceLocatorMethod:
    type: 'multiTenant'
  clusterLocatorMethods:
    - type: 'config'
      clusters:
        - name: my-cluster
          url: https://<cluster-api-url>
          authProvider: serviceAccount
          serviceAccountToken: <token-from-step-3>
          skipTLSVerify: false   # set true only for local dev
```

> **Tip for local Docker Desktop:** set `url: https://127.0.0.1:<port>` and `skipTLSVerify: true`.
> The port is shown by `kubectl cluster-info`.

## Security

- All endpoints require a valid Backstage user Bearer token
- The service account should be scoped to the minimum required namespaces
- Deletion operations are written to the Backstage backend logger with the user's entity ref:
  ```
  [kubernetes-actions] DELETE pod default/my-app-abc123 by user:default/alice
  [kubernetes-actions] Pod default/my-app-abc123 deleted by user:default/alice
  ```
- Consider adding `@backstage/plugin-permission-framework` guards for production use to restrict deletion to pod owners

## API Reference

### `GET /api/kubernetes-actions/pods`

Query parameters:

| Parameter       | Required | Default   | Description                        |
|-----------------|----------|-----------|------------------------------------|
| `labelSelector` | No       | `""`      | Kubernetes label selector string   |
| `namespace`     | No       | `default` | Kubernetes namespace               |

Returns a Kubernetes `PodList` object.

### `DELETE /api/kubernetes-actions/pods/:namespace/:name`

Path parameters:

| Parameter   | Description              |
|-------------|--------------------------|
| `namespace` | Kubernetes namespace     |
| `name`      | Pod name to delete       |

Returns:

```json
{
  "message": "Pod my-app-abc123 deleted successfully",
  "pod": "my-app-abc123",
  "namespace": "default",
  "deletedBy": "user:default/alice"
}
```

## Related

- [`backstage-plugin-kubernetes-actions`](../kubernetes-actions/README.md) — frontend plugin
- [Backstage Kubernetes Plugin](https://backstage.io/docs/features/kubernetes/) — official read-only k8s views
