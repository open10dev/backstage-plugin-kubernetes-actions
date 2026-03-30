import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@material-ui/core';
import DeleteIcon from '@material-ui/icons/Delete';
import RefreshIcon from '@material-ui/icons/Refresh';
import { Alert } from '@material-ui/lab';
import {
  InfoCard,
  Progress,
} from '@backstage/core-components';
import { useApi, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';

interface PodStatus {
  name: string;
  namespace: string;
  phase: string;
  ready: string;
  restarts: number;
  age: string;
  podIP: string;
}

function podPhaseColor(phase: string): 'default' | 'primary' | 'secondary' {
  if (phase === 'Running') return 'primary';
  if (phase === 'Succeeded') return 'default';
  return 'secondary'; // Pending, Failed, Unknown
}

function formatAge(createdAt: string): string {
  const diff = Date.now() - new Date(createdAt).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function parsePods(k8sResponse: any): PodStatus[] {
  if (!k8sResponse?.items) return [];
  return k8sResponse.items.map((pod: any) => {
    const cs = pod.status?.containerStatuses ?? [];
    const readyCount = cs.filter((c: any) => c.ready).length;
    const restarts = cs.reduce((sum: number, c: any) => sum + (c.restartCount ?? 0), 0);
    return {
      name: pod.metadata.name,
      namespace: pod.metadata.namespace ?? 'default',
      phase: pod.status?.phase ?? 'Unknown',
      ready: `${readyCount}/${(cs.length || pod.spec?.containers?.length) ?? 0}`,
      restarts,
      age: formatAge(pod.metadata.creationTimestamp),
      podIP: pod.status?.podIP ?? '—',
    };
  });
}

export function PodActionsCard() {
  const { entity } = useEntity();
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);

  const labelSelector =
    entity.metadata?.annotations?.['backstage.io/kubernetes-label-selector'] ?? '';
  const namespace = 'default';

  const [pods, setPods] = useState<PodStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PodStatus | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);

  const fetchPods = useCallback(async () => {
    if (!labelSelector) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const baseUrl = await discoveryApi.getBaseUrl('kubernetes-actions');
      const qs = new URLSearchParams({ labelSelector, namespace }).toString();
      const res = await fetchApi.fetch(`${baseUrl}/pods?${qs}`);
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setPods(parsePods(await res.json()));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [discoveryApi, fetchApi, labelSelector, namespace]);

  useEffect(() => { fetchPods(); }, [fetchPods]);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(confirmDelete.name);
    setConfirmDelete(null);
    try {
      const baseUrl = await discoveryApi.getBaseUrl('kubernetes-actions');
      const res = await fetchApi.fetch(
        `${baseUrl}/pods/${confirmDelete.namespace}/${confirmDelete.name}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setDeleteSuccess(`Pod "${confirmDelete.name}" deleted — Kubernetes will restart it.`);
      setTimeout(() => { setDeleteSuccess(null); fetchPods(); }, 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeleting(null);
    }
  };

  if (!labelSelector) {
    return (
      <InfoCard title="Pod Management">
        <Typography variant="body2" color="textSecondary">
          No <code>backstage.io/kubernetes-label-selector</code> annotation on this entity.
        </Typography>
      </InfoCard>
    );
  }

  return (
    <>
      <InfoCard
        title="Pod Management"
        action={
          <Tooltip title="Refresh">
            <IconButton size="small" onClick={fetchPods} disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        }
      >
        {loading && <Progress />}

        {error && (
          <Box mb={1}>
            <Alert severity="error">{error}</Alert>
          </Box>
        )}

        {deleteSuccess && (
          <Box mb={1}>
            <Alert severity="success">{deleteSuccess}</Alert>
          </Box>
        )}

        {!loading && !error && pods.length === 0 && (
          <Typography variant="body2" color="textSecondary">
            No pods found for selector: <code>{labelSelector}</code>
          </Typography>
        )}

        {pods.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Pod</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Ready</TableCell>
                <TableCell>Restarts</TableCell>
                <TableCell>Age</TableCell>
                <TableCell align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pods.map(pod => (
                <TableRow key={pod.name}>
                  <TableCell>
                    <Typography variant="body2" style={{ fontFamily: 'monospace' }}>
                      {pod.name}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={pod.phase}
                      size="small"
                      color={podPhaseColor(pod.phase)}
                    />
                  </TableCell>
                  <TableCell>{pod.ready}</TableCell>
                  <TableCell>{pod.restarts}</TableCell>
                  <TableCell>{pod.age}</TableCell>
                  <TableCell align="right">
                    <Tooltip title={`Delete pod (Kubernetes will restart it)`}>
                      <span>
                        <IconButton
                          size="small"
                          color="secondary"
                          disabled={deleting === pod.name}
                          onClick={() => setConfirmDelete(pod)}
                        >
                          {deleting === pod.name
                            ? <CircularProgress size={16} />
                            : <DeleteIcon fontSize="small" />}
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </InfoCard>

      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>Delete Pod?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete pod{' '}
            <strong>{confirmDelete?.name}</strong>?
            <br />
            Kubernetes will automatically restart it via the Deployment.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button onClick={handleDelete} color="secondary" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
