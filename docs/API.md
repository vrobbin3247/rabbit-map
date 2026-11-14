# HTTP API

The contract between the web app and the local server. Base URL: `http://127.0.0.1:8787/api`. Types are from [DATA-MODEL.md](DATA-MODEL.md) and [PROVIDERS.md](PROVIDERS.md).

## 1. Conventions

- Request and response bodies are JSON. Mutating requests must send `Content-Type: application/json`.
- IDs in paths are ULIDs. Anything else is `400 invalid_request`.
- Every request body is validated with zod. Unknown fields are rejected.
- There is no authentication. The server accepts only local requests; see the guards in [ARCHITECTURE.md](ARCHITECTURE.md), section 9. A request that fails a guard gets `403` with code `forbidden`.

### Error shape

```json
{ "error": { "code": "not_found", "message": "Map not found." } }
```

### Error codes

```ts
export type ErrorCode =
  // request
  | 'invalid_request'          // 400
  | 'forbidden'                // 403
  | 'not_found'                // 404
  | 'conflict'                 // 409
  // provider (from ProviderErrorCode)
  | 'provider_not_installed'   // 503
  | 'provider_not_logged_in'   // 503
  | 'provider_api_key_auth'    // 503
  | 'rate_limited'             // 429
  | 'timeout'                  // 504
  | 'aborted'                  // stream only
  | 'empty_output'             // 502
  | 'provider_failed'          // 502
  // server
  | 'storage_failed'           // 500
  | 'internal';                // 500
```

For streaming endpoints, errors found **before** generation starts (validation, missing map, conflict, unusable provider) are returned as a normal JSON error with the status above. Errors **after** the stream has opened arrive as an `error` event.

## 2. Health

### `GET /health`

Returns the state of every provider. Results are cached for 60 seconds; `?refresh=1` forces a re-check.

```json
{
  "providers": [
    { "id": "claude", "installed": true, "version": "2.1.287", "loggedIn": true,
      "auth": "subscription", "plan": "pro", "usable": true, "reason": null, "fix": null,
      "models": ["sonnet", "haiku", "opus"], "streams": true },
    { "id": "codex", "installed": true, "version": "0.144.6", "loggedIn": true,
      "auth": "subscription", "plan": null, "usable": true, "reason": null, "fix": null,
      "models": [], "streams": false }
  ],
  "defaultProvider": "claude"
}
```

`defaultProvider` is the first usable provider in the order claude, codex, or `null`. When `MINDMAPPER_PROVIDER` is set, only that provider is listed.

## 3. Maps

### `GET /maps`

`200` → `{ "maps": MapSummary[] }`, most recently updated first.

### `POST /maps`

```json
{ "topic": "Deep learning", "level": "beginner", "goal": null, "provider": "claude", "model": null }
```

Only `topic` is required. `level` defaults to `beginner`; `provider` defaults to `defaultProvider`.

`201` → `{ "map": MapFile }`. The map has one root node in `stub` state. The client then calls expand on `map.rootId`.

Errors: `invalid_request`; `provider_not_installed` and similar when no provider is usable.

### `GET /maps/:mapId`

`200` → `{ "map": MapFile }`. Errors: `not_found`.

### `PATCH /maps/:mapId`

```json
{ "title": "Deep learning basics", "settings": { "provider": "codex", "model": null, "level": "intermediate", "goal": "exam" } }
```

All fields optional; `settings` is merged field by field. `200` → `{ "map": MapFile }`.

### `DELETE /maps/:mapId`

`204`.

### `PATCH /maps/:mapId/view`

```json
{ "selectedId": "01J…", "anchorId": "01J…", "trail": ["01J…", "01J…"], "viewport": { "x": 0, "y": 0, "zoom": 1 } }
```

All fields optional. Unknown node ids are dropped; `trail` is trimmed to 200. `200` → `{ "view": ViewState }`. Written with a 500 ms debounce.

### `POST /maps/:mapId/export`

Body: `{}`. Writes one Markdown file per node into `<dataDir>/exports/<map title>/`, replacing any earlier export of the same map (see [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md), T6.6).

`200` → `{ "path": "/absolute/path/to/exports/Deep learning", "files": 42 }`.

## 4. Nodes

### `POST /maps/:mapId/nodes`

Opens a concept: returns the existing node for a term, or creates a stub. Makes no model call.

```json
{ "fromNodeId": "01J…", "term": "Pooling", "snippet": "After convolution, pooling operations reduce dimensionality." }
```

`200` → `{ "node": ConceptNode, "created": false }` when the term resolves to an existing node.
`201` → `{ "node": ConceptNode, "created": true }` when a stub was created under `fromNodeId`.

Errors: `invalid_request` (term empty or over 80 characters), `not_found`.

### `PATCH /maps/:mapId/nodes/:nodeId`

```json
{ "title": "Convolutional Layer", "collapsed": true }
```

Both optional. Renaming keeps the old title as an alias. `200` → `{ "node": ConceptNode }`.

Errors: `conflict` when the new title's slug belongs to another node (the message names that node, so the client can offer a merge).

### `DELETE /maps/:mapId/nodes/:nodeId`

Deletes the node and its subtree. `200` → `{ "removedIds": string[], "nodes": ConceptNode[], "view": ViewState }`, where `nodes` are other nodes changed by the clean-up.

Errors: `conflict` for the root or while a job is running in the subtree.

### `POST /maps/:mapId/nodes/:nodeId/merge`

```json
{ "intoId": "01J…" }
```

Merges this node into `intoId`. `200` → `{ "removedIds": string[], "nodes": ConceptNode[], "view": ViewState }`.

Errors: `conflict` when the node is the root, `intoId` is inside its subtree, or either has a job running.

### `DELETE /maps/:mapId/nodes/:nodeId/thread/:messageId`

Removes one thread message. Removing a user message also removes the assistant message that follows it. `200` → `{ "node": ConceptNode }`.

## 5. Generation (streaming)

Both endpoints respond with `Content-Type: text/event-stream`. The client reads the response body with `fetch` (not `EventSource`, because these are POST requests) and stops the generation by aborting the request.

### `POST /maps/:mapId/nodes/:nodeId/expand`

```json
{ "regenerate": false }
```

Explains the node. Errors before the stream opens:

- `conflict` when a job is already running for this node;
- `conflict` when the node is already `ready` and `regenerate` is not true;
- provider codes when the map's provider is not usable.

### `POST /maps/:mapId/nodes/:nodeId/ask`

```json
{ "question": "Why three channels?", "quote": "an RGB image has three channels", "retryMessageId": null }
```

`quote` and `retryMessageId` are optional. With `retryMessageId` (the id of a failed assistant message), the question text is taken from the user message before it and `question` is ignored.

### Events

Each event is `event: <name>` and `data: <json>` followed by a blank line. A comment line `: ping` is sent every 15 seconds to keep the connection open.

| Event | Data | Meaning |
|---|---|---|
| `start` | `{ "nodes": ConceptNode[], "messageId"?: string }` | The job is registered. `nodes` holds the target node in its starting state (`generating`, or with the new thread messages). For ask, `messageId` is the assistant message being written |
| `status` | `{ "phase": "queued" \| "starting" \| "generating" \| "retrying" }` | Progress |
| `delta` | `{ "text": string }` | Next piece of display text, already filtered |
| `done` | `{ "nodes": ConceptNode[] }` | Finished. Every node created or changed, in final state. Last event |
| `error` | `{ "code": ErrorCode, "message": string, "nodes": ConceptNode[] }` | Failed. `nodes` holds the restored state. Last event |

Exactly one of `done` or `error` ends a stream. If the client disconnects first, the server aborts the job and restores the node; nothing more is sent.

The client should build the visible text from `delta` events and then discard it in favour of the node in `done`.

### Example: expand

```
event: start
data: {"nodes":[{"id":"01J…","title":"Convolutional Neural Network","status":"generating", …}]}

event: status
data: {"phase":"starting"}

event: status
data: {"phase":"generating"}

event: delta
data: {"text":"A **Convolutional Neural Network (CNN)** is a specialized "}

event: delta
data: {"text":"[[Deep learning]] architecture designed primarily for "}

event: done
data: {"nodes":[{"id":"01J…","title":"Convolutional Neural Network","status":"ready", …},{"id":"01J…","title":"Convolutional Layers","status":"stub", …}]}
```

With a provider that does not stream (`streams: false`), there is a single `delta` carrying the whole text just before `done`.

## 6. Static files

In production the server also serves the built web app: any `GET` outside `/api` returns the matching file from the web build, or `index.html`.
