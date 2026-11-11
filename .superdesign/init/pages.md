# Pages — Component Dependency Trees

## Home Page (`/`)

File: `app/page.tsx`

```
HomePage
├── useCanvasStore (loadProject)
├── [external] createDemoProject (@/lib/story/demo)
├── [external] outlineToProject (@/lib/story/convert)
├── [external] nanoid
├── Left Sidebar (inline)
│   ├── Logo mark (div gradient)
│   ├── "新建项目" button → handleCreateProject()
│   ├── NAV_ITEMS (home/play/assets/skills buttons)
│   │   └── "play" tab → handlePlay() → /player/:id
│   ├── "我的项目" section
│   │   └── project buttons → openProject() → /editor/:id
│   └── Bottom icons (Settings, User, BookOpen) [decorative]
└── Main area (inline)
    ├── Category filter tabs (CATEGORIES array, 6 items)
    ├── AI Input box (inline)
    │   ├── <textarea> → prompt state
    │   ├── Pill chips (技能/Agent/分支/素材/模板) [decorative]
    │   └── Send button → handleCreateProject("creation")
    │       └── POST /api/ai/agent (streaming)
    │           └── outlineToProject() → loadProject() → /editor/:id#creation
    ├── Feature cards grid (FEATURE_CARDS, 8 items, 4-col)
    │   └── onClick → handleCreateProject(workspace)
    └── Hot dramas grid (HOT_DRAMAS, 4 items, 4-col)
        └── onClick → handleCreateProject("canvas")
```

**State:**
- `projects: StoryProject[]` — from localStorage `storyreel:projects`
- `activeCategory: string` — category filter (display only)
- `activeTab: SideTab` — nav tab active state
- `prompt: string` — AI generation input
- `generating: boolean` — loading state
- `genError: string | null` — error display

---

## Editor Page (`/editor/:projectId`)

File: `app/editor/[projectId]/page.tsx`

```
EditorPage
├── useCanvasStore (projectName, addNode, nodes, edges, startNodeId)
├── usePlayerStore (init, destroy)
├── Floating Top Bar (inline header, absolute z-30)
│   ├── Logo pill (SR icon + projectName + Share2 + MoreHorizontal)
│   ├── Workspace tabs (创作/画布/预览) → setWorkspace()
│   │   └── "预览" tab → handleEnterPreview() → initPlayer()
│   ├── Node type add strip (canvas mode only)
│   │   └── [Film,HelpCircle,GitBranch,GitMerge,Trophy] → addNode(type)
│   ├── "发布" button [decorative]
│   └── Credits pill (Cpu icon + "1,200 FREE")
├── Main content area (absolute inset-0 pt-12)
│   ├── [workspace=canvas] ReactFlowProvider
│   │   └── StoryCanvas (@/components/canvas/StoryCanvas)
│   │       └── [not read — renders all node types + edges]
│   ├── [workspace=creation] AICreationPipeline
│   │   ├── useCreationStore (activeStep, stepStatuses, setActiveStep)
│   │   ├── PIPELINE_STEPS nav sidebar (left 240px)
│   │   │   └── step buttons [story/branch/storyboard/visual/video/validate]
│   │   └── Active panel (right flex-1)
│   │       ├── StoryAgentPanel
│   │       ├── BranchAgentPanel
│   │       ├── StoryboardPanel
│   │       ├── VisualAudioPanel
│   │       ├── VideoGenPanel
│   │       └── ValidationPanel
│   └── [workspace=preview] StoryPlayer
│       ├── usePlayerStore (phase, currentVideoUrl, choices, ending, ...)
│       ├── <video> element (ref)
│       ├── [phase=awaiting] ChoiceOverlay
│       │   └── choice buttons → choose(edgeId)
│       └── [phase=ended] EndingScreen
│           └── "重新开始" button → reset()
├── Right floating toolbar (absolute right-3 mid-Y, canvas only)
│   ├── Pink "+" button → addNode("video")
│   └── Secondary buttons (Grid3x3, Play, CheckCircle)
├── NodeDetailPanel (absolute right-14, canvas only)
│   ├── useCanvasStore (selectedNodeId, selectedEdgeId, nodes, edges, ...)
│   ├── [node.type=video] VideoNodeEditor
│   │   └── "AI 生成视频" → POST /api/ai/agent (streaming)
│   ├── [node.type=choice] ChoiceNodeEditor
│   ├── [node.type=ending] EndingNodeEditor
│   ├── [node.type=merge] MergeNodeEditor
│   ├── [node.type=condition] ConditionNodeEditor
│   └── [edge selected] EdgeDetailPanel
├── AI Agent bubble (absolute left-4 bottom-4)
│   └── [expanded] chat input → Send [decorative]
├── Floating prompt input (absolute bottom center, canvas+preview modes)
│   ├── Model selector (SR Pro)
│   ├── 风格/比例 option pills [decorative]
│   └── Send button → addNode("video") [prototype behavior]
└── Zoom controls (absolute right-3 bottom-4, canvas only)
    └── ZoomIn / ZoomOut / Maximize2 [decorative]
```

**State:**
- `workspace: "creation" | "canvas" | "preview"`
- `agentExpanded: boolean`
- `promptText: string`
- `selectedModel: string` — "SR Pro" (static)

---

## Player Page (`/player/:projectId`)

File: `app/player/[projectId]/page.tsx`

```
PlayerPage
└── Suspense (fallback: loading spinner)
    └── PlayerContent
        ├── useSearchParams → ?data= param
        ├── useCanvasStore (nodes, edges, startNodeId, projectName, projectId, loadProject)
        ├── usePlayerStore (init, destroy)
        ├── [has data] loadProject(decoded) → init(nodes, edges, startNodeId)
        ├── [no data] init(nodes, edges, startNodeId) from store
        ├── [empty state] "项目尚无内容" + Link to /editor/:id
        └── [has content] full-screen wrapper
            ├── StoryPlayer
            │   ├── usePlayerStore (phase, currentVideoUrl, choices, ending, ...)
            │   ├── <video> element
            │   ├── [phase=awaiting] ChoiceOverlay
            │   └── [phase=ended] EndingScreen
            └── Back link (absolute top-4 left-4)
                └── <Link href="/editor/:id"> ← ArrowLeft + projectName
```

---

## Node Canvas (StoryCanvas — not fully read)

File: `components/canvas/StoryCanvas.tsx` (not read in this pass)

Expected structure based on usage in EditorPage:
```
StoryCanvas (ReactFlowProvider required by parent)
└── ReactFlow
    ├── nodeTypes map:
    │   ├── video → VideoNode
    │   ├── choice → ChoiceNode
    │   ├── condition → ConditionNode
    │   ├── merge → MergeNode
    │   └── ending → EndingNode
    ├── nodes / edges / onNodesChange / onEdgesChange from useCanvasStore
    └── Controls / MiniMap (styled via globals.css)
```

---

## Data Flow Summary

```
localStorage (storyreel:projects)
    ↓ loadProject()
useCanvasStore { nodes, edges, startNodeId, projectName, projectId }
    ↓ init()
usePlayerStore { phase, currentVideoUrl, currentVideoStart, interactionAt, choices, ending }
    ↓
StoryPlayer (renders video + overlays based on phase)
```

```
User types prompt on HomePage
    ↓ POST /api/ai/agent { task: "story", context: { prompt, genre, numBranches } }
    ↓ stream SSE → parse JSON outline
    ↓ outlineToProject(outline, id, title)
    ↓ loadProject(project) + localStorage.setItem
    ↓ window.location.href = /editor/:id#creation
```
