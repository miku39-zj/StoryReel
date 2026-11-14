"use client";
import { CharacterLibrary } from "@/components/creation/CharacterLibrary";
import { StoryCastPicker } from "@/components/creation/StoryCastPicker";
import { addCharacterToProject, type CharacterAsset } from "@/lib/characters";
import { initializeCharacterAssets } from "@/lib/story/character-design";
import NextImage from "next/image";

import { useState, useEffect } from "react";
import { useCanvasStore } from "@/stores/canvas-store";
import { newProject } from "@/lib/story/new-project";
import { PlaybackLibrary } from "@/components/player/PlaybackLibrary";
import { AssetLibrary } from "@/components/AssetLibrary";
import type { LibraryAsset } from "@/lib/assets";
import { attachCreationReferences } from "@/lib/story/creation-references";
import { creationBriefSchema, storySource, type CreationBrief } from "@/lib/story/creation-brief";
import {
  CreationReferenceList,
  CreationReferencePicker,
} from "@/components/creation/CreationReferences";
import { useCreationRequest } from "@/components/creation/useCreationRequest";
import { storyOutlineSchema } from "@/lib/story/creation-schema";
import { outlineToProject } from "@/lib/story/convert";
import { nanoid } from "nanoid";
import type { StoryProject } from "@/lib/story/types";
import {
  cachedProjects,
  cachedProject,
  renameCachedProject,
  mergeProjectLists,
} from "@/lib/story/project-cache";
import {
  Pencil,
  Plus,
  Layers,
  Wand2,
  BookOpen,
  Home,
  Settings,
  User,
  Folder,
  Film,
  Trophy,
  GitBranch,
  ImageIcon,
  Clapperboard,
  Bell,
  Search,
  FolderOpen,
  Trash2,
  ChevronRight,
  ArrowRight,
  Play,
  Sparkles,
  Loader2,
} from "lucide-react";
import { Button, Textarea, ConfirmDialog, Select } from "@/components/ui";

import { ProjectRenameDialog } from "@/components/editor/ProjectRenameDialog";
import { FeatureCard } from "@/components/creation/FeatureCard";

const CATEGORIES = ["互动剧", "短剧", "悬疑", "爱情", "科幻", "奇幻"];

type FeatureWorkspace = "creation" | "canvas" | "preview";
type FeatureTool =
  | "story"
  | "video"
  | "storyboard"
  | "visual"
  | "canvas-free"
  | "canvas-branch"
  | "canvas-scene"
  | "canvas-character"
  | "canvas-ending";
type ApiKeyReq = "text" | "image" | "video" | null;

const FEATURE_CARDS: Array<{
  label: string;
  desc: string;
  workspace: FeatureWorkspace;
  tool: FeatureTool;
  requiresKey: ApiKeyReq;
  icon: React.ReactNode;
  iconColor: string;
}> = [
  {
    label: "剧本创作",
    desc: "从创意生成故事大纲与场景",
    workspace: "creation",
    tool: "story",
    requiresKey: "text",
    icon: <Wand2 size={20} />,
    iconColor: "#ff715b",
  },
  {
    label: "自由画布",
    desc: "非线性叙事，可视化结构图创作",
    workspace: "canvas",
    tool: "canvas-free",
    requiresKey: null,
    icon: <Layers size={20} />,
    iconColor: "#ff715b",
  },
  {
    label: "互动剧情编排",
    desc: "复杂的逻辑判断与分支路径控制",
    workspace: "canvas",
    tool: "canvas-branch",
    requiresKey: null,
    icon: <GitBranch size={20} />,
    iconColor: "#ff715b",
  },
  {
    label: "视频生成",
    desc: "AI 驱动的高质感短视频自动合成",
    workspace: "creation",
    tool: "video",
    requiresKey: "video",
    icon: <Film size={20} />,
    iconColor: "#ff715b",
  },
  {
    label: "故事板",
    desc: "精细化管理每一帧的视觉表现",
    workspace: "creation",
    tool: "storyboard",
    requiresKey: "text",
    icon: <BookOpen size={20} />,
    iconColor: "#ff715b",
  },
  {
    label: "角色设计",
    desc: "创建角色参考图片与视觉提示词",
    workspace: "canvas",
    tool: "canvas-character",
    requiresKey: "image",
    icon: <User size={20} />,
    iconColor: "#ff715b",
  },
  {
    label: "场景设计",
    desc: "创建场景参考图片与视觉提示词",
    workspace: "canvas",
    tool: "canvas-scene",
    requiresKey: "image",
    icon: <ImageIcon size={20} />,
    iconColor: "#ff715b",
  },
  {
    label: "分支结局",
    desc: "编辑故事结局与结果说明",
    workspace: "canvas",
    tool: "canvas-ending",
    requiresKey: null,
    icon: <Trophy size={20} />,
    iconColor: "#ff715b",
  },
];

type SideTab = "home" | "projects" | "play" | "assets" | "skills" | "characters";

type KeyStatus = { text: boolean; image: boolean; video: boolean; audio: boolean };

export default function HomePage() {
  const { request: requestDraft, cancel: cancelDraft } = useCreationRequest();
  const [projects, setProjects] = useState<StoryProject[]>([]);
  const [activeCategory, setActiveCategory] = useState("自动");
  const [activeTab, setActiveTab] = useState<SideTab>("home");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [keyStatus, setKeyStatus] = useState<KeyStatus>({
    text: false,
    image: false,
    video: false,
    audio: false,
  });
  const [pendingFeature, setPendingFeature] = useState<(typeof FEATURE_CARDS)[number] | null>(null);
  const [keyPrompt, setKeyPrompt] = useState<ApiKeyReq>(null);
  const [search, setSearch] = useState("");
  const [creationMode, setCreationMode] = useState("互动剧");
  const [characters, setCharacters] = useState<CharacterAsset[]>([]);
  const [references, setReferences] = useState<CreationBrief["references"]>([]);
  const [selectingReference, setSelectingReference] = useState(false);
  const [galleryFilter, setGalleryFilter] = useState("精选");
  const [gallerySearch, setGallerySearch] = useState("");
  const [showNotifications, setShowNotifications] = useState(false);
  const loadProject = useCanvasStore((s) => s.loadProject);

  /** Map UI mode label → brief. Tool modes keep legacy mode; work types add workType. */
  const composerBrief = (mode = creationMode): CreationBrief => {
    const modeMap: Record<string, { mode: string; workType?: string }> = {
      互动剧: { mode: "interactive", workType: "interactive" },
      单集短剧: { mode: "linear", workType: "single-episode" },
      短剧: { mode: "linear", workType: "single-episode" },
      多集连续剧: { mode: "linear", workType: "multi-episode" },
      角色: { mode: "character" },
      场景: { mode: "scene" },
      分镜: { mode: "storyboard" },
    };
    const mapped = modeMap[mode] ?? { mode: "interactive", workType: "interactive" };
    return creationBriefSchema.parse({
      mode: mapped.mode,
      workType: mapped.workType,
      genre: activeCategory,
      characters,
      references,
    });
  };
  const rename = async (project: StoryProject, name: string) => {
    const saved = await renameCachedProject(project, name);
    setProjects((previous) => previous.map((p) => (p.id === saved.id ? saved : p)));
  };

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "play" || tab === "characters") setActiveTab(tab);
  }, []);

  // Check API key status on mount
  useEffect(() => {
    fetch("/api/config/check")
      .then((r) => r.json())
      .then((s: KeyStatus) => setKeyStatus(s))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Migrate the last active canvas before rendering dashboard projects.
    const local = cachedProjects().map((p) => cachedProject(p.id) ?? p);
    localStorage.setItem("storyreel:projects", JSON.stringify(local));
    setProjects(local);
    let active = true;
    fetch("/api/projects", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((remote: StoryProject[]) => {
        if (!active) return;
        const projects = mergeProjectLists(local, remote);
        localStorage.setItem("storyreel:projects", JSON.stringify(projects));
        setProjects(projects);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Create a demo project, persist, and navigate to editor with tool anchor
  const createAndNavigate = (workspace: FeatureWorkspace, tool?: FeatureTool) => {
    const project = newProject(
      tool,
      prompt,
      composerBrief(
        tool === "storyboard"
          ? "分镜"
          : tool === "canvas-character"
            ? "角色"
            : tool === "canvas-scene"
              ? "场景"
              : creationMode,
      ),
    );
    const updated = [project, ...projects];
    setProjects(updated);
    localStorage.setItem("storyreel:projects", JSON.stringify(updated));
    loadProject(project);
    window.location.href = `/editor/${project.id}#${tool ? `${workspace}:${tool}` : workspace}`;
  };

  // Handle a feature card click with optional API key gating
  const handleFeatureCard = (card: (typeof FEATURE_CARDS)[number]) => {
    if (generating) return;
    if (card.requiresKey && !keyStatus[card.requiresKey]) {
      setPendingFeature(card);
      setKeyPrompt(card.requiresKey);
      return;
    }
    if (card.tool === "storyboard" && prompt.trim()) {
      void handleCreateProject(card.workspace, card.tool);
      return;
    }
    createAndNavigate(card.workspace, card.tool);
  };

  const handleCreateProject = async (
    workspace: FeatureWorkspace = "canvas",
    tool?: FeatureTool,
  ) => {
    if (generating) return;
    if (prompt.trim()) {
      setGenerating(true);
      setGenError(null);
      try {
        const outline = storyOutlineSchema.parse(
          await requestDraft("/api/ai/script", {
            prompt,
            brief: composerBrief(tool === "storyboard" ? "分镜" : creationMode),
          }),
        );
        const id = nanoid(10);
        const project = attachCreationReferences(
          outlineToProject(outline, id, outline.title || prompt.slice(0, 20)),
          composerBrief(tool === "storyboard" ? "分镜" : creationMode),
        );
        project.creation = {
          appliedStorySource: storySource(
            prompt,
            composerBrief(tool === "storyboard" ? "分镜" : creationMode),
          ),
          brief: composerBrief(tool === "storyboard" ? "分镜" : creationMode),
          activeStep:
            tool === "storyboard" ? "storyboard" : creationMode === "互动剧" ? "branch" : "visual",
          stepStatuses: {
            story: "done",
            branch: "idle",
            storyboard: "idle",
            visual: "idle",
            video: "idle",
            validate: "idle",
          },
          userPrompt: prompt,
          storyOutline: outline,
          branchDesign: null,
          storyboardShots: [],
          assets: [],
          assetLibrary: [],
        };
        const updated = [project, ...projects];
        setProjects(updated);
        localStorage.setItem("storyreel:projects", JSON.stringify(updated));
        loadProject(initializeCharacterAssets(project));
        window.location.href = `/editor/${project.id}#${tool ? `${workspace}:${tool}` : workspace}`;
      } catch (err) {
        console.error(err);
        setGenError(
          err instanceof Error && err.name === "AbortError"
            ? "已取消生成"
            : err instanceof Error
              ? err.message
              : "生成失败",
        );
        setGenerating(false);
      }
    } else {
      createAndNavigate(workspace, tool);
    }
  };

  const startComposer = () => {
    const tool = (
      { 角色: "canvas-character", 场景: "canvas-scene", 分镜: "storyboard" } as Record<
        string,
        FeatureTool
      >
    )[creationMode];
    if (tool) handleFeatureCard(FEATURE_CARDS.find((card) => card.tool === tool)!);
    else void handleCreateProject("creation");
  };
  const openProject = (project: StoryProject) => {
    window.location.href = `/editor/${project.id}`;
  };

  const designCharacter = (asset?: CharacterAsset) => {
    let project = newProject(asset ? "canvas-free" : "canvas-character");
    project.name = asset ? `${asset.name} · 角色设计` : "角色设计";
    if (asset) project = addCharacterToProject(project, asset);
    const updated = [project, ...projects];
    setProjects(updated);
    localStorage.setItem("storyreel:projects", JSON.stringify(updated));
    loadProject(project);
    window.location.href = `/editor/${project.id}#canvas`;
  };

  const NAV_ITEMS: Array<{
    id: SideTab;
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
  }> = [
    { id: "home", icon: <Home size={20} />, label: "工作台", onClick: () => setActiveTab("home") },
    {
      id: "projects",
      icon: <Folder size={22} />,
      label: "项目",
      onClick: () => setActiveTab("projects"),
    },
    {
      id: "assets",
      icon: <Layers size={20} />,
      label: "素材库",
      onClick: () => setActiveTab("assets"),
    },
    {
      id: "skills",
      icon: <Wand2 size={20} />,
      label: "技能中心",
      onClick: () => setActiveTab("skills"),
    },
    {
      id: "characters",
      icon: <User size={22} />,
      label: "角色库",
      onClick: () => setActiveTab("characters"),
    },
    { id: "play", icon: <Play size={22} />, label: "播放", onClick: () => setActiveTab("play") },
  ];

  const createFromAsset = (asset: LibraryAsset) => {
    const project = newProject("canvas-free", prompt);
    project.name = asset.name;
    const id = nanoid(10);
    project.nodes = [
      {
        id,
        type: asset.type === "image" ? "image" : "video",
        position: { x: 250, y: 180 },
        data:
          asset.type === "image"
            ? {
                nodeType: "image",
                title: asset.name,
                imageUrl: asset.url,
                prompt,
                generationStatus: "done",
              }
            : {
                nodeType: "video",
                title: asset.name,
                scenePrompt: prompt,
                ...(asset.type === "video" ? { videoUrl: asset.url } : { audioUrl: asset.url }),
                generationStatus: "idle",
              },
      },
    ];
    if (asset.type !== "image") project.startNodeId = id;
    loadProject(project);
    window.location.href = `/editor/${project.id}#canvas`;
  };

  const openComposerTool = (label: string) => {
    if (label === "技能") setActiveTab("skills");
    else if (label === "素材") setActiveTab("assets");
    else if (label === "分支") handleFeatureCard(FEATURE_CARDS[2]);
    else if (label === "模板") createAndNavigate("canvas");
    else handleFeatureCard(FEATURE_CARDS[0]);
  };

  return (
    <div className="studio-shell">
      <aside className="studio-rail" aria-label="主导航">
        <button
          className="studio-mark"
          aria-label="StoryReel 工作台"
          onClick={() => setActiveTab("home")}
        >
          <Clapperboard size={25} strokeWidth={1.6} />
          <span>StoryReel</span>
        </button>
        <button
          className="studio-new"
          aria-label="新建项目"
          onClick={() => handleCreateProject("canvas")}
        >
          <Plus size={17} />
          <span>新建项目</span>
        </button>
        <nav>
          {NAV_ITEMS.map(({ id, icon, label, onClick }) => (
            <button
              key={id}
              onClick={onClick}
              aria-label={label}
              aria-current={activeTab === id ? "page" : undefined}
              className={`studio-rail-item ${activeTab === id ? "is-active" : ""}`}
            >
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="studio-sidebar-projects">
          <button className="studio-project-nav" onClick={() => setActiveTab("projects")}>
            <Folder size={16} />
            <span>我的项目</span>
            <ChevronRight size={15} />
          </button>
          {projects.slice(0, 4).map((project) => (
            <button key={project.id} onClick={() => openProject(project)}>
              <Folder size={15} />
              <span>{project.name}</span>
            </button>
          ))}
        </div>
        <button
          className="studio-rail-item studio-profile"
          onClick={() => setActiveTab("projects")}
          aria-label="我的项目"
        >
          <span className="studio-avatar">N</span>
          <span>我的</span>
        </button>
      </aside>
      <main className="studio-main">
        <header className="studio-topbar">
          <span className="studio-view-title">
            {activeTab === "home"
              ? ""
              : activeTab === "projects"
                ? "我的项目"
                : activeTab === "assets"
                  ? "素材库"
                  : activeTab === "play"
                    ? "播放"
                    : activeTab === "characters"
                      ? "角色库"
                      : "技能中心"}
          </span>
          <div className="studio-top-actions">
            <label className="studio-search">
              <Search size={17} />
              <input
                aria-label="搜索项目"
                placeholder="搜索你的项目…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  if (e.target.value) setActiveTab("projects");
                }}
              />
            </label>
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                aria-label="通知"
                aria-expanded={showNotifications}
                onClick={() => setShowNotifications(!showNotifications)}
              >
                <Bell size={21} />
              </Button>
              {showNotifications && (
                <div className="studio-notifications" role="status">
                  暂无新通知
                </div>
              )}
            </div>
            <button
              className="studio-avatar"
              aria-label="我的项目"
              onClick={() => setActiveTab("projects")}
            >
              N
            </button>
          </div>
        </header>
        {/* ── 技能中心 view — 专注工具卡片 ── */}
        {activeTab === "skills" && (
          <div className="studio-skills-page">
            {/* 说明 */}
            <div className="studio-library-heading">
              <h2 className="text-base font-semibold text-white mb-1">创作工具箱</h2>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
                从故事构思到成片，选择你需要的工具。
              </p>
            </div>
            <div className="studio-tools grid grid-cols-1 sm:grid-cols-2 gap-3">
              {FEATURE_CARDS.map((card) => (
                <FeatureCard
                  key={card.label}
                  {...card}
                  needsConfiguration={!!card.requiresKey && !keyStatus[card.requiresKey]}
                  onClick={() => handleFeatureCard(card)}
                />
              ))}
            </div>

            {/* API Key 状态说明 */}
            <div
              className="studio-config-summary mt-5 rounded-xl p-4"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <p className="text-xs mb-3 font-medium" style={{ color: "rgba(255,255,255,0.4)" }}>
                API 配置状态
              </p>
              <div className="flex flex-wrap items-center gap-4">
                {[
                  { key: "text", label: "文本生成服务", configured: keyStatus.text },
                  { key: "image", label: "图片生成服务", configured: keyStatus.image },
                  { key: "video", label: "视频生成服务", configured: keyStatus.video },
                  { key: "audio", label: "配音服务", configured: keyStatus.audio },
                ].map(({ key, label, configured }) => (
                  <div key={key} className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ background: configured ? "#22c55e" : "rgba(255,255,255,0.15)" }}
                    />
                    <span
                      className="text-xs"
                      style={{
                        color: configured ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.25)",
                      }}
                    >
                      {label}
                    </span>
                    {!configured && (
                      <span className="text-[10px]" style={{ color: "rgba(255,113,91,0.7)" }}>
                        未配置
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "play" && <PlaybackLibrary />}
        {activeTab === "characters" && (
          <div className="px-5 py-6 lg:px-8">
            <CharacterLibrary
              onDesign={designCharacter}
              onSelect={(asset) => {
                setCharacters((previous) =>
                  previous.some((c) => c.id === asset.id)
                    ? previous
                    : [...previous, asset].slice(0, 20),
                );
                setActiveTab("home");
                setCreationMode("互动剧");
              }}
            />
          </div>
        )}

        {activeTab === "assets" && (
          <div className="px-5 lg:px-8 pt-6 pb-8 flex-1">
            <AssetLibrary onSelect={createFromAsset} />
          </div>
        )}

        {activeTab === "projects" && (
          <section className="studio-project-page">
            <div className="studio-project-heading">
              <div>
                <h1>我的项目</h1>
                <p>继续打磨你的故事，或开启下一幕。</p>
              </div>
              <Button variant="primary" onClick={() => handleCreateProject("canvas")}>
                <Plus size={17} />
                新建项目
              </Button>
            </div>
            <div className="studio-project-toolbar">
              <span>{projects.length} 个项目 · 最近更新</span>
              <label className="studio-gallery-search">
                <Search size={15} />
                <input
                  aria-label="筛选我的项目"
                  placeholder="搜索项目…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
            </div>
            <div className="studio-project-list">
              {projects.length === 0 ? (
                <div className="studio-project-empty">
                  <FolderOpen size={28} />
                  <strong>开始你的第一个项目</strong>
                  <span>点击右上方「新建项目」，把灵感变成故事。</span>
                </div>
              ) : (
                [...projects]
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                  .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
                  .map((p) => (
                    <div key={p.id} className="studio-project-row">
                      <button className="studio-project-open" onClick={() => openProject(p)}>
                        <span className="studio-project-symbol">
                          <Clapperboard size={21} />
                        </span>
                        <span className="studio-project-info">
                          <strong>{p.name || "未命名项目"}</strong>
                          <span>
                            {p.nodes?.length ?? 0} 个节点 · {p.edges?.length ?? 0} 条连接
                          </span>
                        </span>
                        <time className="studio-project-date" dateTime={p.updatedAt}>
                          {new Date(p.updatedAt).toLocaleDateString("zh-CN")} 更新
                        </time>
                        <ArrowRight size={16} className="studio-project-open-arrow" />
                      </button>
                      <ProjectRenameDialog name={p.name} onRename={(name) => rename(p, name)}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`重命名 ${p.name}`}
                          title="重命名项目"
                        >
                          <Pencil size={15} />
                        </Button>
                      </ProjectRenameDialog>
                      <ConfirmDialog
                        title="确认删除？"
                        onConfirm={async () => {
                          try {
                            const response = await fetch(
                              `/api/projects/${encodeURIComponent(p.id)}`,
                              { method: "DELETE" },
                            );
                            if (!response.ok && response.status !== 404)
                              throw new Error("删除失败，请重试");
                            const updated = projects.filter((x) => x.id !== p.id);
                            setProjects(updated);
                            localStorage.setItem("storyreel:projects", JSON.stringify(updated));
                            const active = JSON.parse(
                              localStorage.getItem("storyreel:canvas") ?? "null",
                            );
                            if (active?.projectId === p.id)
                              localStorage.removeItem("storyreel:canvas");
                          } catch {
                            setGenError("删除失败，项目仍然保留，请重试");
                          }
                        }}
                      >
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="studio-project-delete shrink-0"
                          aria-label={`删除项目 ${p.name}`}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </ConfirmDialog>
                    </div>
                  ))
              )}
              {projects.length > 0 &&
                !projects.some((p) => p.name.toLowerCase().includes(search.toLowerCase())) && (
                  <p className="p-6 text-sm text-white/60">没有找到“{search}”相关的项目。</p>
                )}
            </div>
          </section>
        )}
        {activeTab === "home" && (
          <div
            className="studio-home"
            onPointerMove={(event) => {
              if (event.pointerType === "touch") return;
              const surface = event.currentTarget;
              const bounds = surface.getBoundingClientRect();
              surface.style.setProperty("--glow-x", `${event.clientX - bounds.left}px`);
              surface.style.setProperty("--glow-y", `${event.clientY - bounds.top}px`);
              surface.dataset.glow = "active";
            }}
            onPointerLeave={(event) => {
              delete event.currentTarget.dataset.glow;
            }}
            onPointerCancel={(event) => {
              delete event.currentTarget.dataset.glow;
            }}
          >
            <div className="studio-workspace">
              <section className="studio-focus" aria-labelledby="studio-heading">
                <h1 id="studio-heading">
                  让灵感，成为<span>下一幕</span>
                </h1>
                <div className="studio-wordmark">
                  StoryReel <Play size={17} fill="currentColor" />
                </div>
                <div className="studio-create-dock">
                  <NextImage
                    loading="eager"
                    width={128}
                    height={128}
                    className="studio-projector"
                    src="/images/projector-ice.png"
                    alt=""
                  />
                  <div className="studio-mode-tabs" aria-label="创作类型">
                    {["单集短剧", "多集连续剧", "互动剧", "角色", "场景", "分镜"].map((mode) => (
                      <button
                        key={mode}
                        aria-pressed={creationMode === mode}
                        disabled={generating}
                        onClick={() => {
                          setCreationMode(mode);
                        }}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                  <div className="studio-composer">
                    <Textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && prompt.trim()) {
                          e.preventDefault();
                          startComposer();
                        }
                      }}
                      placeholder={
                        creationMode === "互动剧" || creationMode === "短剧"
                          ? "描述你的故事，或上传一张参考图…"
                          : `描述你想创作的${creationMode}…`
                      }
                      disabled={generating}
                      aria-label="故事创意"
                    />
                    <div className="studio-compose-actions">
                      <div className="studio-attachments">
                        <Button variant="ghost" onClick={() => setSelectingReference(true)}>
                          <ImageIcon size={19} />
                          添加参考
                        </Button>
                        <StoryCastPicker
                          value={characters}
                          onChange={setCharacters}
                          disabled={generating}
                        />
                        <Select
                          ariaLabel="故事题材"
                          size="sm"
                          className="studio-genre-select"
                          contentClassName="studio-genre-menu"
                          value={
                            CATEGORIES.includes(activeCategory) &&
                            !["互动剧", "短剧"].includes(activeCategory)
                              ? activeCategory
                              : "自动"
                          }
                          onChange={setActiveCategory}
                          options={["自动", "悬疑", "爱情", "科幻", "奇幻"]}
                        />
                        <Button variant="ghost" onClick={() => openComposerTool("技能")}>
                          <Sparkles size={18} />
                          技能
                        </Button>
                      </div>
                      <Button
                        variant="primary"
                        className="studio-generate"
                        aria-label="开始创作"
                        disabled={generating}
                        onClick={() => {
                          startComposer();
                        }}
                      >
                        {generating ? (
                          <Loader2 size={18} className="animate-spin" />
                        ) : (
                          <ArrowRight size={20} />
                        )}
                        <span>开始创作</span>
                      </Button>
                    </div>
                    <CreationReferenceList value={references} onChange={setReferences} />
                    {generating && (
                      <Button variant="ghost" onClick={cancelDraft}>
                        取消生成
                      </Button>
                    )}
                    {genError && (
                      <p className="studio-error" role="alert">
                        {genError}
                      </p>
                    )}
                  </div>
                </div>
                <div className="studio-shortcuts" aria-label="创作工具">
                  {[1, 0, 4, 3].map((index) => {
                    const card = FEATURE_CARDS[index];
                    return (
                      <button key={card.label} onClick={() => handleFeatureCard(card)}>
                        {card.icon}
                        <strong>{card.label === "全自动生成" ? "剧本创作" : card.label}</strong>
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
            <section className="studio-recent" aria-labelledby="recent-heading">
              <div className="studio-section-title">
                <h2 id="recent-heading">最近项目</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setActiveTab("projects");
                  }}
                >
                  查看全部
                  <ChevronRight size={14} />
                </Button>
              </div>
              {projects.length ? (
                <div className="studio-recent-grid">
                  {[...projects]
                    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                    .slice(0, 3)
                    .map((project) => {
                      const cover = project.nodes
                        ?.map((node) => node.data.thumbnailUrl || node.data.imageUrl)
                        .find((url) => typeof url === "string" && url.length > 0);
                      const updated = new Date(project.updatedAt);
                      return (
                        <div className="studio-recent-card" key={project.id}>
                          <button
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                            onClick={() => openProject(project)}
                            aria-label={`继续编辑 ${project.name}`}
                          >
                            <span className="studio-recent-cover">
                              {typeof cover === "string" ? (
                                <NextImage
                                  unoptimized
                                  width={640}
                                  height={360}
                                  src={cover}
                                  alt=""
                                  loading="lazy"
                                  onError={(e) => {
                                    e.currentTarget.style.display = "none";
                                  }}
                                />
                              ) : null}
                              <Clapperboard size={23} aria-hidden="true" />
                            </span>
                            <span className="studio-recent-info">
                              <strong>{project.name || "未命名项目"}</strong>
                              <span>
                                {Number.isNaN(updated.getTime()) ? (
                                  "继续创作"
                                ) : (
                                  <time dateTime={project.updatedAt}>
                                    {updated
                                      .toLocaleDateString("zh-CN", {
                                        year: "numeric",
                                        month: "2-digit",
                                        day: "2-digit",
                                      })
                                      .replaceAll("/", "-")}{" "}
                                    更新
                                  </time>
                                )}
                              </span>
                            </span>
                            <ArrowRight
                              className="studio-recent-arrow"
                              size={16}
                              aria-hidden="true"
                            />
                          </button>
                          <ProjectRenameDialog
                            name={project.name}
                            onRename={(name) => rename(project, name)}
                          >
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`重命名 ${project.name}`}
                              title="重命名项目"
                            >
                              <Pencil size={14} />
                            </Button>
                          </ProjectRenameDialog>
                        </div>
                      );
                    })}
                </div>
              ) : (
                <div className="studio-recent-empty">
                  <FolderOpen size={19} />
                  <span>还没有项目，从上方开始你的第一个故事</span>
                </div>
              )}
            </section>
            <section className="studio-inspiration" aria-labelledby="inspiration-heading">
              <div className="studio-section-title">
                <div className="studio-gallery-tabs" aria-label="灵感分类">
                  {["精选", "悬疑", "奇幻", "爱情"].map((x) => (
                    <button
                      key={x}
                      aria-pressed={galleryFilter === x}
                      onClick={() => setGalleryFilter(x)}
                    >
                      {x}
                    </button>
                  ))}
                </div>
                <label className="studio-gallery-search">
                  <Search size={17} />
                  <input
                    aria-label="搜索灵感作品"
                    placeholder="搜索作品…"
                    value={gallerySearch}
                    onChange={(e) => setGallerySearch(e.target.value)}
                  />
                </label>
              </div>
              <h2 id="inspiration-heading" className="sr-only">
                灵感精选
              </h2>
              <div className="studio-inspiration-grid">
                {[
                  {
                    title: "长安谍影",
                    genre: "悬疑",
                    image: "/images/inspiration-palace.png",
                    idea: "长安灯会中，你收到一封密信，必须在身份暴露前找出潜伏的密探。",
                  },
                  {
                    title: "灵狐之约",
                    genre: "奇幻",
                    image: "/images/inspiration-fox.png",
                    idea: "你与一只灵狐踏入会改变记忆的森林，选择相信它，还是寻找回家的路？",
                  },
                  {
                    title: "潮汐之下",
                    genre: "爱情",
                    image: "/images/inspiration-anime.png",
                    idea: "在海边重逢的两人，发现每次日落都能重新选择一段过去。",
                  },
                ]
                  .filter(
                    (item) =>
                      (galleryFilter === "精选" || item.genre === galleryFilter) &&
                      item.title.includes(gallerySearch),
                  )
                  .map((item) => (
                    <button
                      className="studio-inspiration-card"
                      key={item.title}
                      onClick={() => {
                        setPrompt(item.idea);
                        setActiveCategory(item.genre);
                        document
                          .querySelector<HTMLTextAreaElement>('[aria-label="故事创意"]')
                          ?.focus();
                      }}
                    >
                      <NextImage
                        width={640}
                        height={360}
                        sizes="(max-width: 700px) 100vw, 50vw"
                        src={item.image}
                        alt={item.title}
                        loading="lazy"
                      />
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.genre}</small>
                      </span>
                    </button>
                  ))}
              </div>
            </section>
          </div>
        )}
      </main>
      <CreationReferencePicker
        open={selectingReference}
        onClose={() => setSelectingReference(false)}
        value={references}
        onChange={setReferences}
      />
      {/* ── API Key config prompt modal ── */}
      {keyPrompt && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
          onClick={() => setKeyPrompt(null)}
        >
          <div
            className="glass-panel rounded-2xl p-6 max-w-md w-full mx-4"
            style={{ background: "#222224", border: "1px solid rgba(255,255,255,0.1)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(234,179,8,0.15)" }}
              >
                <Settings size={18} style={{ color: "#EAB308" }} />
              </div>
              <div>
                <p className="text-base font-semibold text-white">需要配置 API Key</p>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                  {keyPrompt === "image"
                    ? "请配置图片服务的 Base URL、Key 和模型"
                    : keyPrompt === "video"
                      ? "请配置视频服务的 Base URL、Key 和模型"
                      : "请配置文本服务的 Base URL、Key 和模型"}
                </p>
              </div>
            </div>

            <div
              className="rounded-xl p-4 mb-4"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <p className="text-xs mb-2" style={{ color: "rgba(255,255,255,0.5)" }}>
                配置步骤：
              </p>
              <ol className="text-xs space-y-1.5" style={{ color: "rgba(255,255,255,0.6)" }}>
                <li>
                  1. 在项目根目录创建或编辑{" "}
                  <code className="px-1 py-0.5 rounded bg-white/10 text-white/80">.env.local</code>{" "}
                  文件
                </li>
                <li>
                  2. 添加：
                  <code className="block mt-1 px-2 py-1 rounded bg-black/40 text-white/70 text-[11px]">
                    {`${keyPrompt.toUpperCase()}_BASE_URL=服务地址；${keyPrompt.toUpperCase()}_API_KEY=密钥；${keyPrompt.toUpperCase()}_MODEL=模型名称`}
                  </code>
                </li>
                <li>
                  3. 重启 Web 和 Worker；开发服务器{" "}
                  <code className="px-1 py-0.5 rounded bg-white/10 text-white/80">npm run dev</code>
                </li>
              </ol>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setKeyPrompt(null)} className="flex-1">
                稍后配置
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setKeyPrompt(null);
                  if (pendingFeature)
                    createAndNavigate(pendingFeature.workspace, pendingFeature.tool);
                }}
                className="flex-1"
              >
                仍然进入
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
