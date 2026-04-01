import { useCallback, useEffect, useRef, useState } from 'react';
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
  FormControl,
  FormControlLabel,
  IconButton,
  LinearProgress,
  MenuItem,
  Select,
  Switch,
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
import SubjectIcon from '@material-ui/icons/Subject';
import { Alert } from '@material-ui/lab';
import {
  InfoCard,
  Progress,
} from '@backstage/core-components';
import { useApi, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PodStatus {
  name: string;
  namespace: string;
  phase: string;
  ready: string;
  restarts: number;
  age: string;
  podIP: string;
  containers: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
      containers: pod.spec?.containers?.map((c: any) => c.name) ?? [],
    };
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PodActionsCard() {
  const { entity } = useEntity();
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);

  const labelSelector =
    entity.metadata?.annotations?.['backstage.io/kubernetes-label-selector'] ?? '';
  const namespace = 'default';

  // ── Pod list state ──────────────────────────────────────────────────────────
  const [pods, setPods] = useState<PodStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PodStatus | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);

  // ── Log viewer state ────────────────────────────────────────────────────────
  const [logsDialog, setLogsDialog] = useState<{ pod: PodStatus; container: string } | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // ── Pod list actions ────────────────────────────────────────────────────────

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

  // ── Log viewer actions ──────────────────────────────────────────────────────

  const stopStream = useCallback(() => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
  }, []);

  const fetchLogs = useCallback(async (pod: PodStatus, container: string) => {
    setLogsLoading(true);
    setLogsError(null);
    try {
      const baseUrl = await discoveryApi.getBaseUrl('kubernetes-actions');
      const qs = new URLSearchParams({ container, tail: '100' });
      const res = await fetchApi.fetch(`${baseUrl}/pods/${pod.namespace}/${pod.name}/logs?${qs}`);
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setLogLines(data.lines ?? []);
    } catch (e: any) {
      setLogsError(e.message);
    } finally {
      setLogsLoading(false);
    }
  }, [discoveryApi, fetchApi]);

  const startStream = useCallback(async (pod: PodStatus, container: string) => {
    stopStream();
    const controller = new AbortController();
    streamAbortRef.current = controller;

    try {
      const baseUrl = await discoveryApi.getBaseUrl('kubernetes-actions');
      const qs = new URLSearchParams({ container, tail: '50', follow: 'true' });
      const res = await fetchApi.fetch(
        `${baseUrl}/pods/${pod.namespace}/${pod.name}/logs?${qs}`,
        { signal: controller.signal },
      );

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      controller.signal.addEventListener('abort', () => reader.cancel());

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          if (part.startsWith('data: ')) {
            try {
              const line = JSON.parse(part.slice(6));
              if (typeof line === 'string') {
                setLogLines(prev => [...prev.slice(-1000), line]);
              }
            } catch { /* ignore malformed SSE */ }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setLogsError(err.message);
        setIsLive(false);
      }
    }
  }, [discoveryApi, fetchApi, stopStream]);

  const openLogs = useCallback((pod: PodStatus) => {
    setLogsDialog({ pod, container: pod.containers[0] ?? '' });
    setLogLines([]);
    setLogsError(null);
    setIsLive(false);
  }, []);

  const closeLogsDialog = useCallback(() => {
    stopStream();
    setIsLive(false);
    setLogsDialog(null);
    setLogLines([]);
    setLogsError(null);
  }, [stopStream]);

  const toggleLive = useCallback(() => {
    if (!logsDialog) return;
    if (isLive) {
      stopStream();
      setIsLive(false);
    } else {
      setIsLive(true);
      startStream(logsDialog.pod, logsDialog.container);
    }
  }, [isLive, logsDialog, startStream, stopStream]);

  // Fetch static logs when dialog opens or container changes
  useEffect(() => {
    if (logsDialog) {
      fetchLogs(logsDialog.pod, logsDialog.container);
    }
  }, [logsDialog?.pod.name, logsDialog?.container]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logLines]);

  // Stop stream on unmount
  useEffect(() => () => stopStream(), [stopStream]);

  // ── Render ──────────────────────────────────────────────────────────────────

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
                <TableCell align="right">Actions</TableCell>
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
                    <Tooltip title="View logs">
                      <IconButton
                        size="small"
                        onClick={() => openLogs(pod)}
                        aria-label="view logs"
                      >
                        <SubjectIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete pod (Kubernetes will restart it)">
                      <span>
                        <IconButton
                          size="small"
                          color="secondary"
                          disabled={deleting === pod.name}
                          onClick={() => setConfirmDelete(pod)}
                          aria-label="delete pod"
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

      {/* ── Delete confirmation dialog ────────────────────────────────────── */}
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

      {/* ── Log viewer dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!logsDialog} onClose={closeLogsDialog} fullWidth maxWidth="md">
        <DialogTitle>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Typography variant="h6" style={{ fontFamily: 'monospace', fontSize: 14 }}>
              {logsDialog?.pod.name}
            </Typography>
            {logsDialog && logsDialog.pod.containers.length > 1 && (
              <FormControl size="small" style={{ minWidth: 140 }}>
                <Select
                  value={logsDialog.container}
                  onChange={e =>
                    setLogsDialog(prev =>
                      prev ? { ...prev, container: String(e.target.value) } : null,
                    )
                  }
                >
                  {logsDialog.pod.containers.map(c => (
                    <MenuItem key={c} value={c}>{c}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Box>
        </DialogTitle>

        <DialogContent style={{ padding: 0 }}>
          {logsLoading && <LinearProgress />}
          {logsError && (
            <Alert severity="error" style={{ margin: 8 }}>{logsError}</Alert>
          )}
          <Box
            component="pre"
            style={{
              backgroundColor: '#1e1e1e',
              color: '#d4d4d4',
              fontFamily: '"Fira Mono", "Consolas", "Menlo", monospace',
              fontSize: 12,
              lineHeight: 1.6,
              padding: 16,
              margin: 0,
              overflowY: 'auto',
              maxHeight: 440,
              minHeight: 200,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {logLines.length === 0 && !logsLoading && !logsError ? (
              <span style={{ color: '#6e7681' }}>No logs found.</span>
            ) : (
              logLines.map((line, i) => (
                <div key={i}>
                  <span style={{ color: '#4d5566', userSelect: 'none', marginRight: 12 }}>
                    {String(i + 1).padStart(4, ' ')}
                  </span>
                  {line}
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </Box>
        </DialogContent>

        <DialogActions>
          <Box display="flex" alignItems="center" style={{ flex: 1, paddingLeft: 8 }}>
            <Typography variant="body2" color="textSecondary" style={{ marginRight: 16 }}>
              {logLines.length} lines
            </Typography>
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={isLive}
                  onChange={toggleLive}
                  color="primary"
                />
              }
              label={<Typography variant="body2">Live</Typography>}
            />
            {isLive && (
              <CircularProgress size={14} style={{ marginLeft: 8 }} />
            )}
          </Box>
          <Button
            onClick={() => logsDialog && fetchLogs(logsDialog.pod, logsDialog.container)}
            disabled={logsLoading}
          >
            Refresh
          </Button>
          <Button onClick={closeLogsDialog}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
