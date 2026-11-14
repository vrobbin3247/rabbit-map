import { z } from 'zod';
import { LIMITS } from './limits';

export const ErrorCodeSchema = z.enum([
  'invalid_request',
  'forbidden',
  'not_found',
  'conflict',
  'provider_not_installed',
  'provider_not_logged_in',
  'provider_api_key_auth',
  'rate_limited',
  'timeout',
  'aborted',
  'empty_output',
  'provider_failed',
  'storage_failed',
  'internal',
]);

export const ProviderIdSchema = z.enum(['claude', 'codex', 'fake']);
export const LevelSchema = z.enum(['beginner', 'intermediate', 'advanced']);
export const NodeStatusSchema = z.enum(['stub', 'generating', 'ready', 'error']);

export const ErrorInfoSchema = z.object({ code: ErrorCodeSchema, message: z.string() });

export const GenerationSchema = z.object({
  provider: ProviderIdSchema,
  model: z.string().nullable(),
  at: z.string(),
  durationMs: z.number(),
  metaRecovered: z.boolean(),
});

export const PositionSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

export const OriginSchema = z.object({ nodeId: z.string(), snippet: z.string() });

export const ThreadMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  quote: z.string().nullable(),
  status: z.enum(['ready', 'generating', 'error']),
  error: ErrorInfoSchema.nullable(),
  generatedBy: GenerationSchema.nullable(),
  createdAt: z.string(),
});

export const ConceptNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  aliases: z.array(z.string()),
  parentId: z.string().nullable(),
  summary: z.string(),
  body: z.string().nullable(),
  status: NodeStatusSchema,
  error: ErrorInfoSchema.nullable(),
  origin: OriginSchema.nullable(),
  related: z.array(z.string()),
  thread: z.array(ThreadMessageSchema),
  collapsed: z.boolean(),
  /** Where the learner dragged this node on the board. Absent or null means automatic layout. */
  position: PositionSchema.nullable().optional(),
  /** A colour chosen for this card (0 to 5, see TONE_NAMES). Absent or null means the colour follows depth. */
  color: z.number().int().min(0).max(5).nullable().optional(),
  generatedBy: GenerationSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ViewportSchema = z.object({ x: z.number(), y: z.number(), zoom: z.number() });

export const ViewStateSchema = z.object({
  selectedId: z.string().nullable(),
  anchorId: z.string(),
  trail: z.array(z.string()),
  viewport: ViewportSchema.nullable(),
});

export const MapSettingsSchema = z.object({
  level: LevelSchema,
  goal: z.string().nullable(),
  provider: ProviderIdSchema,
  model: z.string().nullable(),
});

export const MapFileSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  settings: MapSettingsSchema,
  rootId: z.string(),
  nodes: z.record(z.string(), ConceptNodeSchema),
  view: ViewStateSchema,
});

export const MapSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  nodeCount: z.number(),
});

// ---- Request bodies (shared by web and server) ----

export const CreateMapBodySchema = z
  .object({
    topic: z.string().trim().min(1).max(LIMITS.topicMax),
    level: LevelSchema.optional(),
    goal: z.string().trim().max(500).nullable().optional(),
    provider: ProviderIdSchema.optional(),
    model: z.string().nullable().optional(),
  })
  .strict();

export const PatchMapBodySchema = z
  .object({
    title: z.string().trim().min(1).max(LIMITS.topicMax).optional(),
    settings: MapSettingsSchema.partial().optional(),
  })
  .strict();

export const PatchViewBodySchema = z
  .object({
    selectedId: z.string().nullable().optional(),
    anchorId: z.string().optional(),
    trail: z.array(z.string()).optional(),
    viewport: ViewportSchema.nullable().optional(),
  })
  .strict();

export const OpenConceptBodySchema = z
  .object({
    fromNodeId: z.string(),
    term: z.string().trim().min(1).max(LIMITS.titleMax),
    snippet: z.string().max(LIMITS.snippetMax).optional(),
  })
  .strict();

export const PatchNodeBodySchema = z
  .object({
    title: z.string().trim().min(1).max(LIMITS.titleMax).optional(),
    collapsed: z.boolean().optional(),
    color: z.number().int().min(0).max(5).nullable().optional(),
  })
  .strict();

/** Set (object) or clear (null) manual positions; `reset: true` clears every one ("Tidy up"). */
export const PatchPositionsBodySchema = z
  .object({
    positions: z.record(z.string(), PositionSchema.nullable()).optional(),
    reset: z.boolean().optional(),
  })
  .strict();

/** Add cards for the concepts a card mentions but has no card for. `terms` limits it to some; omit for all. */
export const AdoptBodySchema = z.object({ terms: z.array(z.string().max(80)).max(30).optional() }).strict();

export const UndoBodySchema = z.object({ undoId: z.string() }).strict();

export const MergeBodySchema = z.object({ intoId: z.string() }).strict();

export const ExpandBodySchema = z.object({ regenerate: z.boolean().optional() }).strict();

export const AskBodySchema = z
  .object({
    question: z.string().trim().max(LIMITS.questionMax).optional(),
    quote: z.string().max(LIMITS.quoteMax).nullable().optional(),
    retryMessageId: z.string().nullable().optional(),
  })
  .strict();

// ---- Model metadata (the JSON after ===META===) ----

export const MetaSchema = z.object({
  summary: z.string().default(''),
  aliases: z.array(z.string()).default([]),
  children: z
    .array(z.object({ title: z.string(), summary: z.string().default('') }))
    .default([]),
});
