# User experience

Requirement IDs (FR-x.y) refer to [PRD.md](PRD.md). Data names refer to [DATA-MODEL.md](DATA-MODEL.md).

## 1. Screens

There are two screens: **Home** and **Map**.

### Home

- A single large input: "What do you want to learn?" with a level selector (beginner, intermediate, advanced) and an optional goal field.
- A list of existing maps: title, node count, last opened. Each row opens the map; a menu offers rename and delete.
- A provider status chip for each CLI: usable, not installed, not logged in, or API-key login (refused). Clicking an unusable chip shows the command to run.
- If no provider is usable, the input is disabled and the reason is shown above it.

### Map

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ‹ Maps   Deep learning                              Claude · sonnet ▾  ⌘K │
│ [←] [→]  Deep learning › CNN › Convolutional Layer   depth 2  [⚓ CNN]     │
├───────────┬─────────────────────────────────────────┬─────────────────────┤
│ TRAIL     │                                         │ Convolutional Layer │
│ Deep lear…│   [Deep learning]─┬─[CNN]─┬─[Conv Layer]│ also: conv layer    │
│  CNN      │                   │       ├─[Pooling]   │ ─────────────────── │
│   Conv La…│                   │       └┄[Channel]   │ explanation with    │
│  Transfor…│                   └─[Transformer]       │ links and ghost     │
│           │                                         │ links               │
│           │                                         │ Mentioned in · See  │
│           │              canvas                     │ also                │
│           │                                         │ ── Questions ────── │
│           │                                         │ Q / A …             │
│           │                                         │ [ Ask about this… ] │
└───────────┴─────────────────────────────────────────┴─────────────────────┘
```

| Region | Contents |
|---|---|
| Top bar, row 1 | Back to Home, map title, provider and model picker, level picker, search |
| Top bar, row 2 | Back, Forward, breadcrumb, depth indicator, anchor button |
| Left rail (collapsible) | Trail |
| Canvas | The map |
| Right panel (resizable) | The selected node |

## 2. Canvas

The canvas is a whiteboard: a dotted board, sticky-note nodes, arrowed connectors and floating controls.

- **Layout** starts automatic (left to right, built from each node's parent). The learner can **drag any node** anywhere; it stays where it was dropped and is saved with the map.
- **A moved node takes its unplaced branch with it.** Nodes the learner has not moved follow their parent, so dragging a node does not stretch its edges. A node that was moved on its own stays where it is.
- **Tidy up** releases every moved node back to automatic layout. It is disabled when nothing has been moved.
- A click selects; a drag (more than 4 px) moves. Pan by dragging the background, zoom with the wheel or pinch.
- Selecting a node centres it only if it is off-screen.

### Floating controls

| Control | Where | What it does |
|---|---|---|
| Board tools | Left, vertical | Fit the whole map, centre on selection, Tidy up, show all cross-links, show or hide the minimap |
| Zoom pill | Bottom centre | Zoom out, current zoom (click to reset to 100%), zoom in |
| Trail | Top left, beside the tools | The visited nodes (section 5). Slightly translucent so nodes behind it stay visible. Collapses to a "Trail »" button |
| Minimap | Bottom right | Off by default, because it sits on top of nodes near the corner. The choice is remembered in this browser |

### Node appearance

Nodes are sticky notes. The fill colour cycles with depth (yellow, blue, green, pink, orange, purple), so a level reads at a glance. Light and dark themes each have their own set.

| State | Appearance |
|---|---|
| `stub` | Dashed outline in the depth colour on a plain card, with the title and one-line summary |
| `generating` | Filled, pulsing, "Writing…" |
| `ready` | Filled with a soft shadow, title and one-line summary |
| `error` | Warning-coloured outline and fill, "Could not write this" |

Modifiers, combined with any state:

- **Selected**: accent ring.
- **On the current path**: accent outline, and the connectors along the path are accent-coloured.
- **Visited** (appears in the trail): title in a heavier weight than unvisited ones.
- **Anchor**: small anchor badge.
- **Has questions**: small count badge.
- **Collapsed**: a "+N" badge showing hidden descendants.
- **Being dragged**: lifted shadow.

### Connectors

- **Tree connector** (parent to child): a smooth grey curve with an arrowhead.
- **Cross-link** (a node mentions another node elsewhere in the tree): dashed, joining the left sides of the two nodes so it draws a clean arc between stacked nodes. Drawn only for the selected node. The "show all cross-links" tool draws every one.
- Ghost links are never drawn; they exist only in text.

## 3. Node panel

From top to bottom:

1. **Header**: title; alternative names ("also: CNN, ConvNet"); a menu with Set as anchor, Regenerate, Rename, Merge into…, Collapse subtree, Delete.
2. **Body**:
   - `stub`: the one-line summary and a primary **Explain** button.
   - `generating`: the text as it streams, with a **Stop** button. For a provider that does not stream, a skeleton with an elapsed-seconds counter.
   - `ready`: the explanation.
   - `error`: the message from the provider and a **Try again** button.
3. **Next concepts**: the node's children as chips; stubs are dashed. Clicking a chip selects that node.
4. **Mentioned in**: nodes whose text links here.
5. **See also**: cross-links recorded for this node.
6. **Questions**: the thread, oldest first.
7. **Ask box**: pinned to the bottom of the panel. Placeholder: "Ask about {title}…". Enter sends, Shift+Enter adds a line.

### Links in text

| Kind | Looks like | Click |
|---|---|---|
| Link to an existing node | Solid underline, accent colour | Select that node, centre it, add to trail |
| Ghost link | Dotted underline, muted colour | Create the node under the current node, select it, start explaining it |

Hovering a link to an existing node shows its one-line summary. Hovering a ghost link shows "Not opened yet. Click to add."

### Selecting text

Selecting text inside an explanation or an answer shows a small popover:

- **Explain this**: opens the selection as a concept (resolves to an existing node if one matches, otherwise creates one under the current node). Available when the selection is 1 to 80 characters.
- **Ask about this**: puts the selection into the ask box as a quote.

## 4. Interactions

| Action | Result |
|---|---|
| Click a node | Select it; panel shows it; trail gains an entry |
| Double-click a stub, or press Enter on it | Explain it |
| Click **Explain** | Explain the stub (one model call) |
| Click a link | Navigate to that node |
| Click a ghost link | Create and explain the new node, navigate to it |
| Send a question | Question appears at once; answer streams below it |
| Click **Stop** | Cancel; the node or thread returns to its previous state |
| Click a breadcrumb part | Navigate to that ancestor |
| **Back** / **Forward** | Step through the trail |
| **Set as anchor** | Mark the selected node as the anchor |
| **Back to anchor** | Navigate to the anchor |
| Click a trail entry | Navigate to it |
| Search, pick a result | Navigate to it |
| Collapse / expand | Hide or show a node's descendants |

Selecting a stub does not explain it automatically. The learner presses **Explain** (or double-clicks), so a stray click never spends plan quota.

## 5. Finding the way back

This is the reason the product exists. All four tools are visible at all times on the Map screen.

- **Breadcrumb** answers "where is this node in the subject?". It shows the path through parents, not the route the learner took. Long paths collapse the middle into "…".
- **Trail** answers "how did I get here?". It lists visited nodes in visit order, indented by depth. The current entry is highlighted. It keeps the last 200 entries.
- **Back / Forward** move through the trail like a browser.
- **Anchor** answers "where was I really trying to be?". It starts as the root. The button reads "⚓ {anchor title}" and is highlighted whenever the selected node is not the anchor.
- **Depth indicator** reads "depth 4". At depth 5 or more it changes colour, as a gentle sign of a rabbit hole.

## 6. Search

`Cmd/Ctrl+K` opens a palette. It matches node titles and alternative names as the learner types, shows each result with its path, and navigates on Enter.

## 7. States and messages

| Situation | What the learner sees |
|---|---|
| New map, root being written | Root node pulsing; panel streaming the overview |
| No provider usable | Banner with the reason and the command to run (`claude` then `/login`, or `codex login`) |
| CLI is logged in with an API key | "Mindmapper only uses subscription logins so that it never bills per token. Log in with your plan." |
| Rate or plan limit | The provider's own message, and a **Try again** button |
| Generation timed out (90 s) | "This took too long and was stopped." and **Try again** |
| Output had no usable metadata | Explanation is shown normally; children come from the links in the text; no error |
| Queued behind other generations | "Waiting…" on the node |
| Save failed | Persistent banner: "Could not save to disk" with the path |

## 8. Keyboard

| Key | Action |
|---|---|
| `Cmd/Ctrl+K` | Search |
| `Alt+←` / `Alt+→` | Back / Forward |
| `Enter` on a selected stub | Explain |
| `/` | Focus the ask box |
| `Esc` | Close popover or palette; stop a running generation in the panel |
| `A` | Go to anchor |
| Arrow keys on the canvas | Move selection to parent (←), first child (→), previous or next sibling (↑ ↓) |

Shortcuts made of a single letter are disabled while a text field has focus.

## 9. Visual rules

- Light and dark themes following the system setting.
- One accent colour for selection, the current path and links. State is never shown by colour alone: stubs are dashed, errors carry an icon.
- Node size is fixed (220 × 72) so the layout is stable; long titles truncate with the full title in a tooltip.
- Explanation text is set at a comfortable reading width inside the panel; the panel scrolls, the ask box does not.
- Motion is limited to the generating pulse and short canvas pans, and is removed when the system asks for reduced motion.

## 10. Accessibility

- Every action is reachable by keyboard.
- Nodes are buttons with a label made of title, state and summary.
- Streaming text is announced politely, once, when it completes.
- Focus moves to the panel heading when a node is selected by keyboard.
