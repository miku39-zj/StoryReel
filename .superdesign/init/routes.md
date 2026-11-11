# Routes — Page & Route Structure

## Framework

Next.js 15 App Router. All routes live under `/Users/lizejun/newbee/app/`.

---

## Route Tree

```
app/
├── layout.tsx                    # Root layout — minimal, injects globals.css
├── globals.css                   # Global styles (imported by layout)
├── page.tsx                      # / — Home / Dashboard
├── editor/
│   └── [projectId]/
│       └── page.tsx              # /editor/:projectId — Canvas editor
└── player/
    └── [projectId]/
        └── page.tsx              # /player/:projectId — Standalone story player
```

---

## Route Details

### `/` — Home Page
- File: `app/page.tsx`
- Component: `HomePage` (client component)
- Purpose: Project dashboard and AI story creation entry point
- Key features:
  - Left sidebar navigation (工作台 / 播放 / 素材 / 技能)
  - Category filter tabs (互动剧 / 短剧 / 悬疑 / 爱情 / 科幻 / 奇幻)
  - AI prompt textarea → streams `/api/ai/agent` → generates a story project → redirects to editor
  - Feature cards grid (8 cards, each navigates to editor with a specific workspace)
  - Hot dramas section (4 placeholder cards)
  - Projects list stored in `localStorage` key `storyreel:projects`
- Navigation targets:
  - `/editor/:id#creation` — creation workspace
  - `/editor/:id#canvas` — canvas workspace (default for new project)
  - `/editor/:id` — re-open existing project
  - `/player/:id` — play latest project

### `/editor/:projectId` — Editor Page
- File: `app/editor/[projectId]/page.tsx`
- Component: `EditorPage` (client component)
- Purpose: Main creative workspace with three mode tabs
- Workspace tabs:
  - `creation` — `AICreationPipeline` (6-step AI pipeline)
  - `canvas` — `StoryCanvas` wrapped in `ReactFlowProvider`
  - `preview` — `StoryPlayer` (full-screen inline preview)
- Key UI regions:
  - Floating top bar (logo pill, workspace tabs, node-type add strip, publish button, credits)
  - Right floating toolbar (add video node, canvas/play/check buttons)
  - `NodeDetailPanel` — slides in from right when a canvas node/edge is selected
  - AI Agent bubble — bottom-left, expandable chat input
  - Floating prompt input — bottom-center (visible in canvas + preview modes)
  - Zoom controls — bottom-right (canvas mode only)
- State: reads from `useCanvasStore` (nodes, edges, startNodeId, projectName) and `usePlayerStore`

### `/player/:projectId` — Player Page
- File: `app/player/[projectId]/page.tsx`
- Component: `PlayerPage` → `PlayerContent` (client, wrapped in `Suspense`)
- Purpose: Standalone full-screen interactive story viewer (for sharing/playback outside the editor)
- Data loading:
  - Reads `?data=` query param (base64-encoded JSON of `StoryProject`) OR falls back to `useCanvasStore` state
  - Initializes `usePlayerStore` with nodes, edges, startNodeId
- UI:
  - Full-screen black background
  - `StoryPlayer` component
  - Back-to-editor link (top-left, dev-visible)
  - Loading fallback: "加载中..."
  - Empty state: "项目尚无内容" with link to editor

---

## Root Layout

File: `app/layout.tsx`

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StoryReel — AI 互动影视创作平台",
  description: "从剧本到互动视频的一体化 AI 创作平台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  );
}
```

No shared nav, providers, or wrappers at root level. Each page owns its full layout.

---

## API Routes (referenced but not in `/app/`)

- `POST /api/ai/agent` — AI streaming endpoint
  - Used by: `HomePage` (story generation), `VideoNodeEditor` (video generation)
  - Streams SSE-style `data: {...}` lines
  - Task types: `"story"` (returns JSON outline), `"video"` (returns videoUrl)

---

## Navigation Patterns

- Home → Editor: `window.location.href = /editor/:id#workspace`
- Home → Player: `window.location.href = /player/:id`
- Editor → Player: `setWorkspace("preview")` (inline) or link to `/player/:id`
- Player → Editor: `<Link href="/editor/:id">` back button
- Projects persisted to `localStorage` key `storyreel:projects` as `StoryProject[]`
