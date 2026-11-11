# Extractable Components

Components and patterns currently inlined in page files that could be extracted into reusable shared components.

---

## High Priority — Repeated Patterns

### 1. LeftSidebar
- **Current location:** Inline in `app/page.tsx` (lines 143–281)
- **Why extractable:** 140 lines of sidebar markup including logo, nav items, project list, bottom icons. This is a complete, self-contained layout component.
- **Props it would need:** `navItems`, `projects`, `activeTab`, `onTabChange`, `onProjectClick`, `onNewProject`
- **Reuse potential:** Could be shared between Home page and a future assets/skills page.

### 2. TopBar (Editor)
- **Current location:** Inline in `app/editor/[projectId]/page.tsx` (lines 72–141)
- **Why extractable:** A floating header bar with logo pill, workspace tabs, node-type strip, publish button, and credits pill. Self-contained, stateful via props.
- **Props it would need:** `projectName`, `workspace`, `onWorkspaceChange`, `nodeTypeButtons`, `onAddNode`, `onPublish`
- **Reuse potential:** Used in editor only, but extracting cleans up the page component significantly (70 lines → 1 line).

### 3. FloatingToolbar
- **Current location:** Inline in `app/editor/[projectId]/page.tsx` (lines 184–208)
- **Why extractable:** Right-side floating button column with primary action + secondary tools. Pattern could be reused in other full-screen views.
- **Props it would need:** `primaryAction`, `secondaryActions` (array of `{ icon, onClick, label }`)

### 4. AIAgentBubble
- **Current location:** Inline in `app/editor/[projectId]/page.tsx` (lines 220–265)
- **Why extractable:** Expandable chat bubble with header + input. Self-contained with internal `expanded` state.
- **Props it would need:** `title`, `placeholder`, `onSend`, `greetingText`
- **Reuse potential:** Could appear on any page that has AI assistance.

### 5. FloatingPromptInput
- **Current location:** Inline in `app/editor/[projectId]/page.tsx` (lines 268–325)
- **Why extractable:** 58-line prompt input with header pills, textarea, model selector, option pills, and send button. Complete self-contained component.
- **Props it would need:** `value`, `onChange`, `onSubmit`, `modelName`, `optionPills`, `creditsCost`
- **Reuse potential:** Could be used on Home page (where a similar prompt textarea exists) and in the editor.

### 6. ZoomControls
- **Current location:** Inline in `app/editor/[projectId]/page.tsx` (lines 328–347)
- **Why extractable:** Simple zoom control button column. Pure presentational.
- **Props it would need:** `onZoomIn`, `onZoomOut`, `onFullscreen`, `zoomLevel`

---

## Medium Priority — Shared Sub-Editors

### 7. FormField (Label + Input)
- **Current location:** Inline in `components/panels/NodeDetailPanel.tsx` (Label component + repeated inputClass/inputStyle pattern)
- **Why extractable:** Every sub-editor (VideoNodeEditor, ChoiceNodeEditor, etc.) repeats the same `Label` + `inputClass` + `inputStyle` pattern. A `FormField` component would consolidate this.
- **Props it would need:** `label`, `value`, `onChange`, `placeholder`, `type` (text/number/textarea/select)
- **Reuse potential:** Used 15+ times across the 5 sub-editors.

### 8. AIButton
- **Current location:** Inline in `NodeDetailPanel.tsx` VideoNodeEditor (lines 244–261) and Home page send button (lines 333–340)
- **Why extractable:** The pink CTA button with glow shadow is used in multiple places with identical styling.
- **Props it would need:** `onClick`, `disabled`, `loading`, `children`
- **Current pattern:**
  ```tsx
  style={{ background: "#e91e8c", boxShadow: "0 2px 8px rgba(233,30,140,0.4)" }}
  ```

### 9. PillChip
- **Current location:** Repeated across Home page (lines 321–331) and editor prompt input (lines 275–283)
- **Why extractable:** Small rounded-full chip with `bg-white/[0.06]` and hover state. Used for tags, model selectors, option pills.
- **Props it would need:** `label`, `onClick?`, `active?`

---

## Lower Priority — Potential Extractions

### 10. FeatureCard
- **Current location:** Inline in `app/page.tsx` (lines 353–385)
- **Why extractable:** 8 identical feature cards rendered in a grid. Each card has an icon, label, and hover state. Already data-driven via `FEATURE_CARDS` array.
- **Props it would need:** `label`, `icon`, `onClick`

### 11. HotDramaCard
- **Current location:** Inline in `app/page.tsx` (lines 400–446)
- **Why extractable:** 4 identical drama cards rendered in a grid. Each has a badge, cover placeholder, title, and tag.
- **Props it would need:** `title`, `tag`, `onClick`

### 12. CategoryTabs
- **Current location:** Inline in `app/page.tsx` (lines 287–301)
- **Why extractable:** Pill-style tab selector used for category filtering. Pattern is generic enough for any tab-based UI.
- **Props it would need:** `items`, `activeItem`, `onSelect`

### 13. NodeCard (base for all canvas nodes)
- **Current location:** Pattern repeated across all 5 node components (VideoNode, ChoiceNode, ConditionNode, MergeNode, EndingNode)
- **Why extractable:** All 5 node components share the same structure: rounded-2xl container, accent-colored border (selected vs. unselected), icon circle, Handle components. A base `NodeCard` with `accentColor`, `selected`, `children`, `hasSource` props would reduce duplication.
- **Current shared pattern:**
  ```tsx
  style={{
    background: accentBg,
    border: `1.5px solid ${selected ? `${accent}cc` : `${accent}30`}`,
    boxShadow: selected
      ? `0 0 0 3px ${accent}20, 0 4px 20px rgba(0,0,0,0.6)`
      : "0 2px 12px rgba(0,0,0,0.5)",
  }}
  ```

### 14. StepNavItem (AICreationPipeline)
- **Current location:** Inline in `components/creation/AICreationPipeline.tsx` (lines 64–131)
- **Why extractable:** Each pipeline step row is a self-contained unit with status circle, connecting line, title, and description. Could be extracted as a `PipelineStep` component.
- **Props it would need:** `step`, `index`, `isActive`, `status`, `accent`, `onClick`, `isLast`

---

## Not Recommended for Extraction

- **StoryPlayer** — already a clean, single-purpose component. No benefit in further decomposition.
- **ChoiceOverlay** — 20 lines, already minimal. Good as-is.
- **EndingScreen** — 30 lines, already minimal. Good as-is.
- **VideoNode** — complex but cohesive. The status badge, thumbnail, and info area are tightly coupled to the video node's specific data shape.
