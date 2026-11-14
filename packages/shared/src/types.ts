import type { z } from 'zod';
import type {
  ConceptNodeSchema,
  ErrorCodeSchema,
  ErrorInfoSchema,
  GenerationSchema,
  LevelSchema,
  MapFileSchema,
  MapSettingsSchema,
  MapSummarySchema,
  NodeStatusSchema,
  OriginSchema,
  ProviderIdSchema,
  ThreadMessageSchema,
  ViewStateSchema,
} from './schemas';

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type ProviderId = z.infer<typeof ProviderIdSchema>;
export type Level = z.infer<typeof LevelSchema>;
export type NodeStatus = z.infer<typeof NodeStatusSchema>;
export type ErrorInfo = z.infer<typeof ErrorInfoSchema>;
export type Generation = z.infer<typeof GenerationSchema>;
export type Origin = z.infer<typeof OriginSchema>;
export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;
export type ConceptNode = z.infer<typeof ConceptNodeSchema>;
export type ViewState = z.infer<typeof ViewStateSchema>;
export type MapSettings = z.infer<typeof MapSettingsSchema>;
export type MapFile = z.infer<typeof MapFileSchema>;
export type MapSummary = z.infer<typeof MapSummarySchema>;

export interface ProviderStatus {
  id: ProviderId;
  installed: boolean;
  version: string | null;
  loggedIn: boolean;
  auth: 'subscription' | 'api_key' | 'unknown' | null;
  plan: string | null;
  usable: boolean;
  reason: string | null;
  fix: string | null;
  models: string[];
  streams: boolean;
}

export interface HealthResponse {
  providers: ProviderStatus[];
  defaultProvider: ProviderId | null;
}

export type StreamPhase = 'queued' | 'starting' | 'generating' | 'retrying';

export type StreamEvent =
  | { event: 'start'; data: { nodes: ConceptNode[]; messageId?: string } }
  | { event: 'status'; data: { phase: StreamPhase } }
  | { event: 'delta'; data: { text: string } }
  | { event: 'done'; data: { nodes: ConceptNode[] } }
  | { event: 'error'; data: { code: ErrorCode; message: string; nodes: ConceptNode[] } };
