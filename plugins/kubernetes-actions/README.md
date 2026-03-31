# backstage-plugin-kubernetes-actions

A [Backstage](https://backstage.io) plugin pair that gives developers **live pod visibility and safe pod management** directly on catalog entity pages — no `kubectl` access required.

> **Packages**
> | Package | Role | npm |
> |---------|------|-----|
> | `backstage-plugin-kubernetes-actions` | Frontend card (this package) | [![npm](https://img.shields.io/npm/v/backstage-plugin-kubernetes-actions)](https://www.npmjs.com/package/backstage-plugin-kubernetes-actions) |
> | [`backstage-plugin-kubernetes-actions-backend`](../kubernetes-actions-backend/README.md) | Backend REST proxy | [![npm](https://img.shields.io/npm/v/backstage-plugin-kubernetes-actions-backend)](https://www.npmjs.com/package/backstage-plugin-kubernetes-actions-backend) |

---

## What it does

The **Pod Management** card appears on a component's Overview tab and shows every pod that belongs to the entity (matched by a label selector). Developers can:

- See **real-time pod status** — phase, ready containers, restart count, and age
- **Delete a pod** via a confirmation dialog; Kubernetes reschedules it automatically through the Deployment
- **Refresh** on demand with a single click
- Trust that every delete is **audit-logged** on the backend with the caller's Backstage identity

```
┌─────────────────────────────────────────────────────┐
│  Pod Management                               ↺     │
├──────────────────┬────────┬───────┬──────┬────┬────┤
│ Pod              │ Status │ Ready │ Rest │ Age│    │
├──────────────────┼────────┼───────┼──────┼────┼────┤
│ my-app-abc123    │Running │  2/2  │  0   │ 2h │ 🗑 │
│ my-app-def456    │Pending │  0/1  │  3   │ 5m │ 🗑 │
└──────────────────┴────────┴───────┴──────┴────┴────┘
```

---

## Requirements

| Requirement | Version |
|-------------|---------|
| Backstage | ≥ 1.30 (new declarative frontend system) |
| Node.js | 20 or 22 |
| Kubernetes | 1.24+ (long-lived service account tokens) |
| `backstage-plugin-kubernetes-actions-backend` | workspace peer |

---

## Quick start

Install both packages, wire them up, annotate your entities. Done.

```bash
# Frontend
yarn workspace app add backstage-plugin-kubernetes-actions

# Backend
yarn workspace backend add backstage-plugin-kubernetes-actions-backend
```

---

## Installation

### 1. Frontend — add to `App.tsx`

```tsx
// packages/app/src/App.tsx
import kubernetesActionsPlugin from 'backstage-plugin-kubernetes-actions';

export default createApp({
  features: [
    // ... existing plugins
    kubernetesActionsPlugin,
  ],
});
```

### 2. Backend — add to `index.ts`

```ts
// packages/backend/src/index.ts
backend.add(import('backstage-plugin-kubernetes-actions-backend'));
```

### 3. Create a Kubernetes service account

The backend communicates with your cluster using a dedicated service account. Run these commands against each cluster you want to expose:

```bash
# 1. Create the service account
kubectl create serviceaccount backstage -n default

# 2. Grant get, list, watch, and delete on pods
kubectl create clusterrole backstage-pod-manager \
  --verb=get,list,watch,delete \
  --resource=pods,pods/log

kubectl create clusterrolebinding backstage-pod-manager \
  --clusterrole=backstage-pod-manager \
  --serviceaccount=default:backstage

# 3. Create a long-lived token (Kubernetes 1.24+)
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

# 4. Copy the token
kubectl get secret backstage-token -n default \
  -o jsonpath='{.data.token}' | base64 -d
```

### 4. Configure `app-config.yaml`

The plugin reuses the same `kubernetes` block as `@backstage/plugin-kubernetes-backend`:

```yaml
kubernetes:
  serviceLocatorMethod:
    type: 'multiTenant'
  clusterLocatorMethods:
    - type: 'config'
      clusters:
        - name: production
          url: https://<your-cluster-api-server>
          authProvider: serviceAccount
          serviceAccountToken: ${K8S_SA_TOKEN}
          skipTLSVerify: false
```

> **Local development (Docker Desktop)**
>
> ```yaml
> clusters:
>   - name: docker-desktop
>     url: https://127.0.0.1:<port>   # from: kubectl cluster-info
>     authProvider: serviceAccount
>     serviceAccountToken: <token>
>     skipTLSVerify: true
> ```

Store the token in `app-config.local.yaml` (git-ignored) or as an environment variable — never commit it.

### 5. Annotate your entities

Add the label selector annotation to any `Component` entity you want to expose:

```yaml
# catalog-info.yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: my-service
  annotations:
    backstage.io/kubernetes-label-selector: 'app=my-service'
spec:
  type: service
  lifecycle: production
  owner: team-platform
```

Entities without this annotation will show a friendly "no annotation" message instead of an empty card.

---

## Usage

Navigate to **Catalog → [your component] → Overview tab**.

The **Pod Management** card displays:

| Column | Description |
|--------|-------------|
| Pod | Full pod name (monospace) |
| Status | Phase chip — green for Running, yellow for Pending, red for Failed |
| Ready | `n/n` ready containers out of total |
| Restarts | Cumulative restart count across all containers |
| Age | Human-readable time since pod creation (e.g. `2h`, `5d`) |
| Action | Delete button — opens a confirmation dialog before sending the request |

### Deleting a pod

1. Click the **delete icon** on the pod row
2. A confirmation dialog appears showing the pod name and a warning that Kubernetes will restart it
3. Click **Delete** to confirm — or **Cancel** to abort
4. On success, a green banner confirms the deletion and the list auto-refreshes after 3 seconds
5. The deletion is logged on the backend with your Backstage user identity

---

## Configuration reference

### Frontend (`app-config.yaml`)

No additional frontend configuration is required. The card is enabled by default for all `Component` entities.

To explicitly enable or configure the card extension:

```yaml
app:
  extensions:
    - entity-card:kubernetes-actions/pod-actions
```

### Backend environment variables

| Variable | Description |
|----------|-------------|
| `K8S_SA_TOKEN` | Kubernetes service account token (recommended over inline config) |

---

## API reference

The backend plugin exposes two endpoints under `/api/kubernetes-actions`:

### `GET /api/kubernetes-actions/pods`

Lists pods matching a label selector.

**Query parameters**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `labelSelector` | No | `""` | Kubernetes label selector (e.g. `app=my-app,env=prod`) |
| `namespace` | No | `default` | Kubernetes namespace to query |

**Response** — Kubernetes `PodList` object (passthrough from the cluster API).

**Example**

```
GET /api/kubernetes-actions/pods?labelSelector=app%3Dmy-app&namespace=default
Authorization: Bearer <backstage-token>
```

---

### `DELETE /api/kubernetes-actions/pods/:namespace/:name`

Deletes a specific pod. Kubernetes will reschedule it via the Deployment controller.

**Path parameters**

| Parameter | Description |
|-----------|-------------|
| `namespace` | Kubernetes namespace |
| `name` | Pod name |

**Response**

```json
{
  "message": "Pod my-app-abc123 deleted successfully",
  "pod": "my-app-abc123",
  "namespace": "default",
  "deletedBy": "user:default/alice"
}
```

**Both endpoints require a valid Backstage Bearer token** (`Authorization: Bearer <token>`). Unauthenticated requests receive `401 Authentication required`.

---

## Security

### Authentication
Every request to the backend endpoints must carry a valid Backstage user session token. The backend validates this token using `httpAuth.credentials()` before hitting the cluster.

### Authorization
The Kubernetes service account should follow the principle of least privilege. The ClusterRole created in the installation steps grants only `get`, `list`, `watch`, and `delete` on `pods` and `pods/log`. Scope it further with a `Role` + `RoleBinding` if you want to restrict access to specific namespaces.

### Audit logging
Every pod deletion produces two log lines on the backend:

```
[kubernetes-actions] DELETE pod default/my-app-abc123 by user:default/alice
[kubernetes-actions] Pod default/my-app-abc123 deleted by user:default/alice
```

### Production hardening
- Store the service account token as a Kubernetes Secret or a secrets manager value — never commit it to source control
- Consider adding `@backstage/plugin-permission-framework` guards to restrict deletion to entity owners
- Use a `Role` + `RoleBinding` scoped to specific namespaces instead of a `ClusterRoleBinding`
- Enable TLS verification (`skipTLSVerify: false`) for all non-local clusters

---

## Development

```bash
# Run the full Backstage dev server (frontend + backend)
yarn dev

# Run frontend tests
yarn workspace backstage-plugin-kubernetes-actions test

# Run backend tests
yarn workspace backstage-plugin-kubernetes-actions-backend test

# Lint
yarn workspace backstage-plugin-kubernetes-actions lint
yarn workspace backstage-plugin-kubernetes-actions-backend lint
```

### Project structure

```
plugins/
├── kubernetes-actions/                   # Frontend plugin
│   ├── src/
│   │   ├── components/
│   │   │   └── PodActionsCard/
│   │   │       ├── PodActionsCard.tsx    # Main card component
│   │   │       └── PodActionsCard.test.tsx
│   │   ├── plugin.tsx                    # EntityCardBlueprint registration
│   │   ├── index.ts
│   │   └── setupTests.ts
│   ├── package.json
│   └── README.md
│
└── kubernetes-actions-backend/           # Backend plugin
    ├── src/
    │   ├── KubernetesActionsClient.ts    # Typed k8s REST client (undici)
    │   ├── router.ts                     # Express router with auth + audit
    │   ├── plugin.ts                     # createBackendPlugin wiring
    │   ├── index.ts
    │   └── __tests__/
    │       └── router.test.ts
    ├── package.json
    └── README.md
```

---

## Related packages

| Package | Purpose |
|---------|---------|
| [`backstage-plugin-kubernetes-actions-backend`](../kubernetes-actions-backend/README.md) | Required backend REST proxy |
| [`@backstage/plugin-kubernetes`](https://github.com/backstage/backstage/tree/master/plugins/kubernetes) | Official Backstage Kubernetes plugin (read-only cluster views) |
| [`@backstage/plugin-kubernetes-backend`](https://github.com/backstage/backstage/tree/master/plugins/kubernetes-backend) | Official Backstage Kubernetes backend |

---

## License

Apache 2.0 — see [LICENSE](../../LICENSE) for details.
