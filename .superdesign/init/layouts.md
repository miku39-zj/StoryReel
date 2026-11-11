# Layouts — Layout Components (Full Source)

StoryReel has no shared layout components extracted into separate files. Each page owns its full layout. The patterns are documented here with full inline source so they can be extracted.

---

## Root Layout

File: `/Users/lizejun/newbee/app/layout.tsx`

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

Minimal — no providers, no shared chrome. All layout is page-level.

---

## Home Page Layout (Left Sidebar + Main)

Source location: inline in `app/page.tsx`

```
┌──────────────────────────────────────────────────────────────┐
│ Left Sidebar (168px fixed)  │  Main scrollable area          │
│  ─────────────────          │  ─────────────────────         │
│  Logo (S + StoryReel)       │  Category tabs                 │
│  + 新建项目 button          │  AI prompt textarea box        │
│  Nav items (home/play/      │  Feature cards grid (4 col)    │
│    assets/skills)           │  Hot dramas grid (4 col)       │
│  "我的项目" section         │                                │
│  Bottom icons (settings/    │                                │
│    user/docs)               │                                │
└─────────────────────────────┴────────────────────────────────┘
```

**Outer shell:**
```tsx
<div className="flex h-screen text-white overflow-hidden" style={{ background: "#080808" }}>
  <aside className="w-[168px] shrink-0 flex flex-col h-full"
    style={{ borderRight: "1px solid rgba(255,255,255,0.05)", position: "relative", zIndex: 10, background: "#080808" }}>
    {/* ... sidebar content ... */}
  </aside>
  <main className="flex-1 flex flex-col h-full overflow-y-auto"
    style={{ position: "relative", zIndex: 5 }}>
    {/* ... main content ... */}
  </main>
</div>
```

### Left Sidebar Structure

```tsx
<aside className="w-[168px] shrink-0 flex flex-col h-full"
  style={{ borderRight: "1px solid rgba(255,255,255,0.05)", position: "relative", zIndex: 10, background: "#080808" }}>

  {/* Logo row */}
  <div className="flex items-center gap-2.5 px-4 pt-[18px] pb-3">
    <div className="w-6 h-6 rounded-[8px] flex items-center justify-center text-white shrink-0"
      style={{ background: "linear-gradient(135deg,#e91e8c,#9c27b0)", fontSize: 10, fontWeight: 800 }}>
      S
    </div>
    <span style={{ fontSize: 13, fontWeight: 600, color: "#fff", letterSpacing: "-0.01em" }}>StoryReel</span>
  </div>

  {/* Nav */}
  <nav className="flex flex-col px-2 mt-0.5" style={{ gap: 1 }}>
    {/* 新建项目 button — gradient tinted */}
    <button className="flex items-center gap-2 px-3 active:scale-[0.98]"
      style={{
        height: 32, borderRadius: 10, fontSize: 12, fontWeight: 500,
        color: "rgba(255,255,255,0.88)",
        background: "linear-gradient(135deg,rgba(233,30,140,0.15),rgba(156,39,176,0.15))",
        border: "1px solid rgba(233,30,140,0.2)",
      }}>
      <Plus size={13} style={{ color: "#e91e8c", flexShrink: 0 }} />
      新建项目
    </button>

    <div style={{ height: 4 }} />

    {/* Nav items — active state has white/6 bg, inactive is transparent */}
    {NAV_ITEMS.map(({ id, icon, label, onClick }) => {
      const isActive = activeTab === id;
      return (
        <button key={id} onClick={onClick}
          className="flex items-center gap-2 px-3 active:scale-[0.98]"
          style={{
            height: 30, borderRadius: 8, fontSize: 12,
            fontWeight: isActive ? 500 : 400,
            color: isActive ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.40)",
            background: isActive ? "rgba(255,255,255,0.06)" : "transparent",
            transition: "color 120ms, background 120ms",
          }}>
          <span style={{ color: isActive ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.3)", flexShrink: 0 }}>
            {icon}
          </span>
          {label}
        </button>
      );
    })}
  </nav>

  {/* My projects list */}
  <div className="mt-4 px-2 flex-1 overflow-y-auto">
    <p className="px-3 mb-1"
      style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
      我的项目
    </p>
    {projects.map((p) => (
      <button key={p.id} onClick={() => openProject(p)}
        className="w-full text-left flex items-center gap-2 px-3 active:scale-[0.98]"
        style={{ height: 28, borderRadius: 8, fontSize: 11, color: "rgba(255,255,255,0.38)", transition: "color 120ms, background 120ms" }}>
        <Folder size={10} style={{ color: "rgba(255,255,255,0.25)", flexShrink: 0 }} />
        <span className="truncate">{p.name}</span>
      </button>
    ))}
  </div>

  {/* Bottom icon row */}
  <div className="flex items-center gap-1 px-3 py-3"
    style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
    {[<Settings key="s" size={13} />, <User key="u" size={13} />, <BookOpen key="b" size={13} />].map((icon, i) => (
      <button key={i} className="w-7 h-7 flex items-center justify-center rounded-lg active:scale-95"
        style={{ color: "rgba(255,255,255,0.24)", transition: "color 120ms, background 120ms" }}>
        {icon}
      </button>
    ))}
  </div>
</aside>
```

---

## Editor Page Layout (Full-Screen, Absolute Overlay)

Source location: inline in `app/editor/[projectId]/page.tsx`

```
┌──────────────────────────────────────────────────────────────────┐
│ TOP BAR (absolute, z-30, 48px h)                                 │
│  [Logo pill + project name]  [Tabs]  [Node types + Publish]      │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MAIN CONTENT AREA (absolute inset-0, pt-12)                    │
│  ─ canvas workspace: <StoryCanvas> (full area)                   │
│  ─ creation workspace: <AICreationPipeline> (full area)          │
│  ─ preview workspace: <StoryPlayer> (full area)                  │
│                                                                  │
├──────────────────────────────────┬───────────────────────────────┤
│  RIGHT FLOATING TOOLBAR          │  RIGHT PANEL (NodeDetailPanel)│
│  (absolute right-3, mid-Y, z-20) │  (absolute right-14, z-10)   │
├──────────────────────────────────┴───────────────────────────────┤
│ BOTTOM-LEFT: AI Agent bubble (absolute left-4 bottom-4, z-20)    │
│ BOTTOM-CENTER: Prompt input (absolute centered bottom-4, z-20)   │
│ BOTTOM-RIGHT: Zoom controls (absolute right-3 bottom-4, z-20)    │
└──────────────────────────────────────────────────────────────────┘
```

**Outer shell:**
```tsx
<div className="relative flex h-screen w-screen bg-[#080808] text-white overflow-hidden">
```

### Floating Top Bar

```tsx
<header className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-4 h-12 pointer-events-none">

  {/* Left: logo pill + project name */}
  <div className="flex items-center gap-2 pointer-events-auto">
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#141414] border border-white/[0.07] shadow-[0_2px_12px_rgba(0,0,0,0.5)]">
      <div className="w-5 h-5 rounded-md flex items-center justify-center text-white text-[9px] font-extrabold shrink-0 tracking-tight"
        style={{ background: "linear-gradient(135deg,#e91e8c,#9c27b0)" }}>
        SR
      </div>
      <span className="text-[13px] font-medium text-white/80 max-w-[140px] truncate">
        {projectName || "未命名项目"}
      </span>
      <div className="h-3 w-px bg-white/10" />
      <button className="text-white/30 hover:text-white/70 transition-colors duration-150"><Share2 size={12} /></button>
      <button className="text-white/30 hover:text-white/70 transition-colors duration-150"><MoreHorizontal size={12} /></button>
    </div>
  </div>

  {/* Center: workspace tabs */}
  <div className="flex items-center gap-0.5 p-0.5 rounded-full bg-[#141414] border border-white/[0.07] shadow-[0_2px_12px_rgba(0,0,0,0.5)] pointer-events-auto">
    {WORKSPACE_TABS.map(({ id, label }) => (
      <button key={id}
        onClick={() => id === "preview" ? handleEnterPreview() : setWorkspace(id)}
        className={`px-5 py-1.5 rounded-full text-[13px] font-medium transition-all duration-150 ${
          workspace === id ? "bg-white text-[#080808] shadow-sm" : "text-white/45 hover:text-white/80"
        }`}>
        {label}
      </button>
    ))}
  </div>

  {/* Right: node type strip + publish + credits */}
  <div className="flex items-center gap-2 pointer-events-auto">
    {workspace === "canvas" && (
      <div className="flex items-center gap-0.5 px-2 py-1 rounded-full bg-[#141414] border border-white/[0.07] shadow-[0_2px_12px_rgba(0,0,0,0.5)]">
        {NODE_TYPE_BUTTONS.map(({ type, icon, label }) => (
          <button key={type} onClick={() => handleAddNode(type)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium text-white/40 hover:text-white hover:bg-white/[0.07] transition-all duration-150">
            {icon}
            <span className="hidden lg:inline">{label}</span>
          </button>
        ))}
      </div>
    )}
    <button className="px-4 py-1.5 rounded-full text-[13px] font-semibold text-white hover:opacity-90 transition-all duration-150 shadow-[0_2px_12px_rgba(233,30,140,0.35)]"
      style={{ background: "#e91e8c" }}>
      发布
    </button>
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#141414] border border-white/[0.07] shadow-[0_2px_12px_rgba(0,0,0,0.5)]">
      <Cpu size={11} className="text-[#e91e8c]" />
      <span className="text-[12px] text-white/50">1,200</span>
      <span className="text-[11px] text-white/20">FREE</span>
    </div>
  </div>
</header>
```

### Right Floating Toolbar (canvas mode only)

```tsx
<div className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-1.5">
  {/* Primary pink add button */}
  <button onClick={() => handleAddNode("video")}
    className="w-9 h-9 flex items-center justify-center rounded-xl border border-white/[0.07] text-white shadow-[0_2px_12px_rgba(233,30,140,0.3)] hover:opacity-90 transition-all duration-150"
    style={{ background: "#e91e8c" }}>
    <Plus size={15} />
  </button>
  {/* Secondary tool buttons */}
  {[
    { icon: <Grid3x3 size={14} />, onClick: () => setWorkspace("canvas") },
    { icon: <Play size={14} />, onClick: handleEnterPreview },
    { icon: <CheckCircle size={14} />, onClick: () => {} },
  ].map(({ icon, onClick }, i) => (
    <button key={i} onClick={onClick}
      className="w-9 h-9 flex items-center justify-center rounded-xl border border-white/[0.07] text-white/40 hover:text-white transition-all duration-150"
      style={{ background: "rgba(20,20,20,0.9)", backdropFilter: "blur(8px)" }}>
      {icon}
    </button>
  ))}
</div>
```

### NodeDetailPanel Slot

```tsx
{workspace === "canvas" && (
  <aside className="absolute right-14 top-14 bottom-0 w-72 z-10 pointer-events-none">
    <div className="h-full pointer-events-auto">
      <NodeDetailPanel />
    </div>
  </aside>
)}
```

### AI Agent Bubble (bottom-left)

```tsx
<div className="absolute left-4 bottom-4 z-20 w-64 shadow-[0_4px_16px_rgba(0,0,0,0.6)]">
  <div className="rounded-2xl bg-[#141414] border border-white/[0.07] overflow-hidden"
    style={{ backdropFilter: "blur(12px)" }}>
    <button onClick={() => setAgentExpanded(!agentExpanded)}
      className="flex items-center justify-between w-full px-4 py-2.5 hover:bg-white/[0.04] transition-colors duration-150">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-extrabold text-white shrink-0"
          style={{ background: "linear-gradient(135deg,#e91e8c,#9c27b0)" }}>AI</div>
        <span className="text-[12px] font-medium text-white/60"
          style={{ textShadow: "0 0 8px rgba(233,30,140,0.3)" }}>AI Agent</span>
      </div>
      <ChevronDown size={12} className={`text-white/25 transition-transform duration-200 ${agentExpanded ? "rotate-180" : ""}`} />
    </button>
    {agentExpanded && (
      <div className="px-4 pb-3 border-t border-white/[0.06]">
        <p className="text-[11px] text-white/35 mt-2.5 mb-3 leading-relaxed">
          你好！我可以帮你创作和编排互动剧情。
        </p>
        <div className="flex gap-2">
          <input placeholder="向 Agent 提问..."
            className="flex-1 bg-white/[0.05] rounded-lg px-3 py-1.5 text-[12px] text-white/60 placeholder-white/20 outline-none border border-white/[0.06] focus:border-white/[0.12] transition-colors" />
          <button className="w-7 h-7 flex items-center justify-center rounded-lg text-white transition-colors hover:opacity-90 shrink-0"
            style={{ background: "#e91e8c" }}>
            <Send size={11} />
          </button>
        </div>
      </div>
    )}
  </div>
</div>
```

### Floating Prompt Input (bottom-center, canvas + preview modes)

```tsx
<div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-[540px] max-w-[calc(100vw-220px)] shadow-[0_4px_20px_rgba(0,0,0,0.7)]">
  <div className="rounded-2xl bg-[#141414] border border-white/[0.07] overflow-hidden">
    {/* Header row */}
    <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
      <span className="text-[12px] font-semibold text-white/50">提示词</span>
      <div className="flex items-center gap-1 ml-1">
        {["智能引用", "模板", "提示词助手"].map((pill) => (
          <span key={pill}
            className="px-2.5 py-0.5 rounded-full text-[10px] bg-white/[0.06] text-white/30 cursor-pointer hover:bg-white/[0.10] transition-colors duration-150">
            {pill}
          </span>
        ))}
      </div>
    </div>
    {/* Textarea */}
    <div className="px-4 pb-1.5">
      <textarea value={promptText} onChange={(e) => setPromptText(e.target.value)}
        placeholder="描述你想创建的剧情节点..." rows={2}
        className="w-full bg-transparent text-[13px] text-white/80 placeholder-white/20 resize-none outline-none leading-relaxed" />
    </div>
    {/* Bottom bar */}
    <div className="flex items-center justify-between px-4 pb-3 pt-1 border-t border-white/[0.05]">
      <div className="flex items-center gap-1">
        <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.05] text-[11px] text-white/40 hover:bg-white/[0.09] transition-colors duration-150">
          <Cpu size={10} />{selectedModel}<ChevronDown size={9} />
        </button>
        {["风格", "比例"].map((opt) => (
          <button key={opt} className="px-2.5 py-1 rounded-lg bg-white/[0.05] text-[11px] text-white/40 hover:bg-white/[0.09] transition-colors duration-150">{opt}</button>
        ))}
      </div>
      <div className="flex items-center gap-2.5">
        <span className="text-[11px] text-white/20">100 积分</span>
        <button onClick={() => handleAddNode("video")}
          className="w-7 h-7 flex items-center justify-center rounded-full text-white hover:opacity-90 transition-all duration-150 shadow-[0_2px_8px_rgba(233,30,140,0.4)]"
          style={{ background: "#e91e8c" }}>
          <Send size={12} />
        </button>
      </div>
    </div>
  </div>
</div>
```

### Zoom Controls (bottom-right, canvas mode only)

```tsx
<div className="absolute right-3 bottom-4 z-20 flex flex-col gap-1 shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
  {[
    { icon: <ZoomIn size={13} />, label: "zoom in" },
    { icon: <ZoomOut size={13} />, label: "zoom out" },
    { icon: <Maximize2 size={13} />, label: "fullscreen" },
  ].map(({ icon, label }) => (
    <button key={label} aria-label={label}
      className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#141414] border border-white/[0.07] text-white/35 hover:text-white hover:bg-[#1c1c1c] transition-all duration-150">
      {icon}
    </button>
  ))}
  <div className="flex items-center justify-center py-0.5">
    <span className="text-[10px] text-white/20">100%</span>
  </div>
</div>
```

---

## Player Page Layout (Full-Screen)

Source location: inline in `app/player/[projectId]/page.tsx`

```
┌──────────────────────────────────────────────────────────────────┐
│  Back button (absolute top-4 left-4, z-50)                       │
│                                                                  │
│  StoryPlayer (fills entire screen)                               │
│   ├─ <video> (h-full w-full object-contain)                      │
│   ├─ ChoiceOverlay (absolute inset, when phase=awaiting)         │
│   └─ EndingScreen (absolute inset, when phase=ended)             │
└──────────────────────────────────────────────────────────────────┘
```

**Outer shell:**
```tsx
<div className="relative h-screen w-full bg-black">
  <StoryPlayer />
  <Link href={`/editor/${currentProjectId ?? "demo"}`}
    className="absolute top-4 left-4 z-50 flex items-center gap-1.5 rounded-lg bg-black/50 backdrop-blur-sm border border-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/10 transition-colors">
    <ArrowLeft size={14} />
    {currentProjectName}
  </Link>
</div>
```

---

## AICreationPipeline Layout (Left Nav + Right Panel)

Source location: inline in `components/creation/AICreationPipeline.tsx`

```
┌──────────────────────────────────────────────────────────────────┐
│  Step nav sidebar (240px)  │  Active panel (flex-1)             │
│  ─────────────────          │  ──────────────────────────        │
│  "AI 创作链路" label        │  <StoryAgentPanel> /               │
│  Step 1 (story)             │  <BranchAgentPanel> /              │
│  Step 2 (branch)            │  <StoryboardPanel> /               │
│  Step 3 (storyboard)        │  <VisualAudioPanel> /              │
│  Step 4 (visual)            │  <VideoGenPanel> /                 │
│  Step 5 (video)             │  <ValidationPanel>                 │
│  Step 6 (validate)          │                                    │
└──────────────────────────────┴───────────────────────────────────┘
```

Outer shell:
```tsx
<div className="flex h-full min-h-0 bg-[#0a0a0a]">
  <aside className="w-60 shrink-0 flex flex-col py-5 overflow-y-auto"
    style={{ borderRight: "1px solid rgba(255,255,255,0.05)" }}>
    {/* step list */}
  </aside>
  <div className="flex-1 min-w-0 overflow-hidden">
    <ActivePanel />
  </div>
</div>
```

---

## Reusable Pattern: "Pill Card" (used in Top Bar)

A rounded-full pill with dark bg, subtle border, and shadow. Used extensively for the top bar segments, workspace tabs, and node-type strip.

```tsx
// Container pill
<div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#141414] border border-white/[0.07] shadow-[0_2px_12px_rgba(0,0,0,0.5)]">
  {/* content */}
</div>
```

## Reusable Pattern: "Glass Card" (used in AI Agent bubble, prompt input)

Rounded-2xl, dark bg, very subtle border, backdrop-blur.

```tsx
<div className="rounded-2xl bg-[#141414] border border-white/[0.07] overflow-hidden"
  style={{ backdropFilter: "blur(12px)" }}>
  {/* content */}
</div>
```
