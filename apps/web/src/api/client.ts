import type {
  ConceptNode,
  ErrorCode,
  HealthResponse,
  MapFile,
  MapSummary,
  ViewState,
} from '@mindmapper/shared';

export class ApiError extends Error {
  constructor(
    public code: ErrorCode | 'network',
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network', 'Could not reach the Mindmapper server. Is it running?');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const e = (json as { error?: { code: ErrorCode; message: string } } | null)?.error;
    throw new ApiError(e?.code ?? 'internal', e?.message ?? `Request failed (${res.status}).`, res.status);
  }
  return json as T;
}

export interface Changes {
  removedIds: string[];
  nodes: ConceptNode[];
  view: ViewState;
}

export const api = {
  health: (refresh = false) => req<HealthResponse>('GET', `/health${refresh ? '?refresh=1' : ''}`),
  listMaps: () => req<{ maps: MapSummary[]; unreadable: { id: string; message: string }[] }>('GET', '/maps'),
  createMap: (b: { topic: string; level?: string; goal?: string | null; provider?: string; model?: string | null }) =>
    req<{ map: MapFile }>('POST', '/maps', b),
  getMap: (id: string) => req<{ map: MapFile }>('GET', `/maps/${id}`),
  patchMap: (id: string, b: object) => req<{ map: MapFile }>('PATCH', `/maps/${id}`, b),
  deleteMap: (id: string) => req<void>('DELETE', `/maps/${id}`),
  patchView: (id: string, b: object) => req<{ view: ViewState }>('PATCH', `/maps/${id}/view`, b),
  exportMap: (id: string) => req<{ path: string; files: number }>('POST', `/maps/${id}/export`, {}),
  patchPositions: (id: string, b: { positions?: Record<string, { x: number; y: number } | null>; reset?: boolean }) =>
    req<{ nodes: ConceptNode[] }>('PATCH', `/maps/${id}/positions`, b),
  openConcept: (id: string, b: { fromNodeId: string; term: string; snippet?: string }) =>
    req<{ node: ConceptNode; created: boolean }>('POST', `/maps/${id}/nodes`, b),
  patchNode: (id: string, nodeId: string, b: { title?: string; collapsed?: boolean }) =>
    req<{ node: ConceptNode }>('PATCH', `/maps/${id}/nodes/${nodeId}`, b),
  deleteNode: (id: string, nodeId: string) => req<Changes>('DELETE', `/maps/${id}/nodes/${nodeId}`),
  mergeNode: (id: string, nodeId: string, intoId: string) =>
    req<Changes>('POST', `/maps/${id}/nodes/${nodeId}/merge`, { intoId }),
  deleteMessage: (id: string, nodeId: string, messageId: string) =>
    req<{ node: ConceptNode }>('DELETE', `/maps/${id}/nodes/${nodeId}/thread/${messageId}`),
};
