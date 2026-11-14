# Product requirements

## 1. Problem

Learning a subject through an AI chat produces a chain of ever-deeper questions. Each answer introduces new terms, each term prompts another question, and after a few steps:

- the learner cannot find their way back to the point they started from,
- the AI has also drifted, because the chat history is one long line,
- the same concept (for example "channels") gets re-explained in several places,
- the learner loses interest.

## 2. Who it is for

One person, on their own computer, who already pays for a Claude and/or ChatGPT subscription and is learning a technical subject. There are no accounts, teams or sharing.

## 3. Goals

| ID | Goal |
|---|---|
| G1 | **Never lose the thread.** At any depth, the learner can see how they got here and return in one click. |
| G2 | **Depth on demand.** Any concept can be opened and questioned without disturbing the rest. |
| G3 | **One node per concept.** A concept reached from several places is a single shared node. |
| G4 | **No extra cost.** Works on existing subscriptions, with no API key. |
| G5 | **The learner owns the result.** Maps are local files and survive restarts. |

## 4. Out of scope for v1

- Hosting, accounts, multi-user, sync, mobile layout.
- Any use of model APIs or API keys.
- Using the providers' own chat interfaces or their built-in tools (search, browsing, file reading).
- Answers grounded in uploaded documents or the web.
- Sharing concepts across different maps.
- Generating content in the background before the learner asks for it.
- Windows support.
- Quizzes, flashcards, spaced repetition.

## 5. Vocabulary

| Term | Meaning |
|---|---|
| Map | One learning workspace, rooted at a topic |
| Node | One concept in a map |
| Stub | A node that has a title and a one-line summary but no explanation yet |
| Path | The chain of parents from the root to a node |
| Link | A `[[term]]` in an explanation that points at a node that exists |
| Ghost link | A `[[term]]` that has no node yet; clicking it creates one |
| Thread | The questions and answers attached to one node |
| Trail | The list of nodes visited, in order |
| Anchor | The node the learner has marked as "where I really am"; the root by default |

Precise definitions are in [DATA-MODEL.md](DATA-MODEL.md).

## 6. User stories

| ID | Story |
|---|---|
| US-1 | I type "Deep learning" and get an overview with the main parts laid out as nodes. |
| US-2 | I click the "CNN" node and get an explanation of CNNs written in the context of deep learning. |
| US-3 | In that explanation I click "pooling", a term with no node yet, and a new node appears under CNN and is explained. |
| US-4 | Later, under "Image basics", the explanation mentions channels. That link takes me to the Channels node I already opened under CNN, instead of writing a second one. |
| US-5 | On the Channels node I ask "why three?" and the answer is saved on that node. |
| US-6 | I select a phrase I do not understand and choose **Explain this** or **Ask about this**. |
| US-7 | Six levels deep, I press **Back to anchor** and I am on CNN again with everything I opened still there. |
| US-8 | I see the path "Deep learning › CNN › Convolutional Layer › Channel" above the canvas and can click any part of it. |
| US-9 | I close the app, reopen it tomorrow, and my map, threads and position are as I left them. |
| US-10 | I switch a map from Claude to ChatGPT and keep exploring the same map. |
| US-11 | If my CLI is not installed or not logged in, the app tells me exactly what to run. |

## 7. Functional requirements

### Maps

- **FR-1.1** Create a map from a topic (1 to 200 characters), with a learner level (beginner, intermediate, advanced; default beginner) and an optional goal.
- **FR-1.2** List, open, rename and delete maps.
- **FR-1.3** Each map records its provider and model; both can be changed at any time.

### Nodes and explanations

- **FR-2.1** Creating a map creates a root node and explains it with an overview and 4 to 7 starter child nodes.
- **FR-2.2** Explaining a stub produces a Markdown explanation, a one-line summary, alternative names, and 3 to 5 suggested child stubs.
- **FR-2.3** An explanation is written for the node's path: it uses the path and the sentence that introduced the node as context.
- **FR-2.4** Explanations stream into the panel as they are generated when the provider supports it; otherwise a progress state with elapsed time is shown.
- **FR-2.5** A generation can be cancelled. Cancelling leaves the node as it was.
- **FR-2.6** A node can be regenerated. Its existing children and thread are kept.
- **FR-2.7** Explanations render Markdown, code blocks and LaTeX math.

### Links and shared concepts

- **FR-3.1** Terms marked by the model render as links.
- **FR-3.2** A term that matches an existing node (by name or alternative name, ignoring case and plural) links to that node. Clicking it selects the node, centres it and adds it to the trail.
- **FR-3.3** A term with no node renders as a ghost link. Clicking it creates a node under the current node and explains it.
- **FR-3.4** A suggested child that matches an existing node is not created again; it is recorded as a cross-link.
- **FR-3.5** Each node lists **Mentioned in** (nodes that link to it) and **See also** (its cross-links).
- **FR-3.6** Cross-links are drawn on the canvas for the selected node; a toggle shows all of them.
- **FR-3.7** The model is given the names of existing nodes so that it reuses them.

### Questions

- **FR-4.1** Ask a free-text question on any node. The answer uses the node's explanation, its path and the earlier questions on that node.
- **FR-4.2** Questions and answers are saved on the node in order.
- **FR-4.3** Answers contain links and ghost links that behave as in FR-3.
- **FR-4.4** Selecting text in an explanation or answer offers **Explain this** (open the selection as a concept) and **Ask about this** (quote it in the question box).

### Finding the way back

- **FR-5.1** A breadcrumb shows the path of the selected node; each part is clickable.
- **FR-5.2** Back and Forward step through the trail.
- **FR-5.3** A trail list shows visited nodes in order; each is clickable.
- **FR-5.4** The learner can set any node as the anchor. **Back to anchor** is always visible when the selected node is not the anchor.
- **FR-5.5** A depth indicator shows how many levels the selected node is from the root.
- **FR-5.6** Search finds any node by name or alternative name.
- **FR-5.7** Nodes on the current path are highlighted on the canvas; visited nodes are visually distinct from unvisited ones.

### Providers

- **FR-6.1** Detect which CLIs are installed and logged in, and with what kind of authentication.
- **FR-6.2** Generate only through a CLI logged in with a subscription. Refuse API-key authentication with a clear message.
- **FR-6.3** Show an actionable message when no provider is usable, including the command to run.
- **FR-6.4** Make exactly one model call per learner action.
- **FR-6.5** Surface rate-limit and plan-limit errors in the provider's own words.

### Persistence

- **FR-7.1** Save every change to disk as it happens.
- **FR-7.2** Restore the selected node, anchor, trail and viewport when a map is reopened.
- **FR-7.3** A crash during generation never leaves a node stuck in the generating state.

### Management

- **FR-8.1** Delete a node together with its subtree. The root cannot be deleted.
- **FR-8.2** Rename a node; old links keep working.
- **FR-8.3** Merge one node into another when two names mean the same concept.
- **FR-8.4** Collapse and expand a subtree on the canvas.
- **FR-8.5** Export a map as a folder of Markdown files with `[[wikilinks]]`.

### Board

- **FR-9.1** The learner can drag any node to place it. Placement is saved with the map and survives a reload.
- **FR-9.2** Nodes the learner has not placed follow their parent when it moves.
- **FR-9.3** **Tidy up** returns every node to automatic layout.
- **FR-9.4** The board shows a dotted background, sticky-note nodes coloured by depth, and floating tools, zoom and trail.

## 8. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | With Claude, first words appear within 5 seconds and a node completes within 12 seconds on a normal connection. Measured on 2026-11-14 with Haiku: 3.0 s and 7.2 s. |
| NFR-2 | With a non-streaming provider, a node completes within 20 seconds. Measured with Codex: 10 to 16 s. |
| NFR-3 | A map of 500 nodes opens in under 1 second and the canvas stays responsive. |
| NFR-4 | The server listens on `127.0.0.1` only and rejects requests from other origins. |
| NFR-5 | No data leaves the machine except the prompt sent through the chosen CLI. |
| NFR-6 | Existing maps can be read and navigated with no network. |
| NFR-7 | Model output is rendered with raw HTML disabled. |

## 9. Success criteria

v1 is successful when this walkthrough works end to end with a real provider:

1. Create a map "Deep learning".
2. Open CNN, then Convolutional Layer, then Channel, using a mix of child nodes and ghost links.
3. Go back to the root, open a different branch, and reach an explanation that mentions channels. Its link opens the existing Channel node.
4. Ask a question on Channel and get an answer in context.
5. Press **Back to anchor** from five levels deep and land on the anchor.
6. Restart the app. Everything is still there, including the position.

## 10. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| A provider changes how subscription logins work with its CLI | That provider stops working | Adapters are isolated; two providers are supported; health check explains the failure |
| `claude -p` makes `--bare` the default | Subscription login is ignored | Documented in PROVIDERS.md; adapter will need the opt-out flag that release ships |
| Near-duplicate concepts ("Convolution", "Convolutional Layer") | Graph fragments | Existing names are sent to the model; alternative names; manual merge |
| Plan limits are reached during a long session | Generation fails | One call per action; small prompts; errors shown in the provider's words |
| The model ignores the output format | Children are missing | Parser falls back to the links in the text |

## 11. Later

Antigravity (Gemini) provider, pre-warmed CLI processes, concepts shared across maps, answers grounded in the learner's own documents, quizzes on visited nodes.
