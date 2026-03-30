# backstage-plugin-kubernetes-actions

Backstage plugin pair that adds **live Kubernetes pod visibility and safe pod management** directly on catalog entity pages — no `kubectl` access required.

| Package | Description | npm |
|---------|-------------|-----|
| [kubernetes-actions](./plugins/kubernetes-actions) | Frontend card — pod table + delete UI | [![npm](https://img.shields.io/npm/v/backstage-plugin-kubernetes-actions)](https://www.npmjs.com/package/backstage-plugin-kubernetes-actions) |
| [kubernetes-actions-backend](./plugins/kubernetes-actions-backend) | Backend REST proxy — authenticated k8s calls + audit log | [![npm](https://img.shields.io/npm/v/backstage-plugin-kubernetes-actions-backend)](https://www.npmjs.com/package/backstage-plugin-kubernetes-actions-backend) |

## Quick start

```bash
# Frontend
yarn workspace app add backstage-plugin-kubernetes-actions

# Backend
yarn workspace backend add backstage-plugin-kubernetes-actions-backend
```

See each package's README for full installation and configuration:

- [Frontend plugin README](./plugins/kubernetes-actions/README.md)
- [Backend plugin README](./plugins/kubernetes-actions-backend/README.md)

## Development

```bash
# Install dependencies
yarn install

# Run all tests
yarn test

# Build all packages
yarn build
```

## License

Apache 2.0
