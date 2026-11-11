"use client";

import { useRef, useEffect, useState } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { ChoiceOverlay } from "./ChoiceOverlay";
import { EndingScreen } from "./EndingScreen";
import { Loader2, Film, AlertCircle } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";

export function StoryPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioError, setAudioError] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const phase = usePlayerStore((s) => s.phase);
  const revision = usePlayerStore((s) => s.revision);
  const currentVideoUrl = usePlayerStore((s) => s.currentVideoUrl);
  const currentAudioUrl = usePlayerStore((s) => s.currentAudioUrl);
  const currentVideoEnd = usePlayerStore((s) => s.currentVideoEnd);
  const interactionAt = usePlayerStore((s) => s.interactionAt);
  const choices = usePlayerStore((s) => s.choices);
  const question = usePlayerStore((s) => s.question);
  const timeoutSecs = usePlayerStore((s) => s.timeoutSecs);
  const ending = usePlayerStore((s) => s.ending);
  const error = usePlayerStore((s) => s.error);
  const onInteractionPoint = usePlayerStore((s) => s.onInteractionPoint);
  const choose = usePlayerStore((s) => s.choose);
  const reset = usePlayerStore((s) => s.reset);

  // Like branchreel's nodeEndHandled guard: timeupdate and ended only advance once.
  // Revision also resets playback when consecutive nodes reuse the same video URL.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      if (currentAudioUrl) {
        audio.src = currentAudioUrl;
        audio.load();
      }
    }
    setAudioError(false);
    const syncAudio = () => {
      if (!audio || !currentAudioUrl) return;
      if (Math.abs(audio.currentTime - video.currentTime) > 0.3)
        audio.currentTime = video.currentTime;
      audio.muted = video.muted;
      audio.volume = video.volume;
      audio.playbackRate = video.playbackRate;
    };
    const playAudio = () => {
      if (audio && currentAudioUrl) {
        syncAudio();
        audio.play().catch(() => setAudioError(true));
      }
    };
    const pauseAudio = () => audio?.pause();
    video.addEventListener("play", playAudio);
    video.addEventListener("playing", playAudio);
    video.addEventListener("pause", pauseAudio);
    video.addEventListener("waiting", pauseAudio);
    video.addEventListener("seeking", syncAudio);
    video.addEventListener("volumechange", syncAudio);
    let active = true,
      handled = false;
    setVideoError(false);
    setBlocked(false);
    video.pause();

    const complete = () => {
      if (handled || usePlayerStore.getState().phase !== "playing") return;
      handled = true;
      video.pause();
      onInteractionPoint(revision);
    };
    const timeupdate = () => {
      syncAudio();
      if (
        (interactionAt !== undefined && video.currentTime >= interactionAt) ||
        (currentVideoEnd !== undefined && video.currentTime >= currentVideoEnd)
      )
        complete();
    };
    video.addEventListener("timeupdate", timeupdate);
    video.addEventListener("ended", complete);
    if (currentVideoUrl) video.src = currentVideoUrl;
    else video.removeAttribute("src");
    video.load();
    video.currentTime = 0;
    if (currentVideoUrl && usePlayerStore.getState().phase === "playing") {
      video.play().catch((error) => {
        if (active && error.name === "NotAllowedError") setBlocked(true);
      });
    }
    return () => {
      active = false;
      video.pause();
      audio?.pause();
      video.removeEventListener("play", playAudio);
      video.removeEventListener("playing", playAudio);
      video.removeEventListener("pause", pauseAudio);
      video.removeEventListener("waiting", pauseAudio);
      video.removeEventListener("seeking", syncAudio);
      video.removeEventListener("volumechange", syncAudio);
      video.removeEventListener("timeupdate", timeupdate);
      video.removeEventListener("ended", complete);
    };
  }, [
    revision,
    currentVideoUrl,
    currentAudioUrl,
    currentVideoEnd,
    interactionAt,
    onInteractionPoint,
  ]);

  useEffect(() => {
    const video = videoRef.current;
    if (video && phase !== "playing") video.pause();
  }, [phase]);

  useEffect(() => {
    const urls = usePlayerStore.getState().runtime?.preloadVideoUrls() ?? [];
    const hosts = urls.map((url) => {
      const host = document.createElement("video");
      host.preload = "auto";
      host.muted = true;
      host.src = url;
      host.load();
      return host;
    });
    return () =>
      hosts.forEach((host) => {
        host.pause();
        host.removeAttribute("src");
        host.load();
      });
  }, [revision]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#101012]">
      <audio ref={audioRef} aria-hidden="true" onError={() => setAudioError(true)} />
      {audioError && currentAudioUrl && (
        <p
          role="status"
          className="absolute right-3 top-3 z-30 rounded bg-black/80 px-3 py-2 text-xs text-white"
        >
          配音暂时无法播放
        </p>
      )}
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        playsInline
        controls={!!currentVideoUrl && !videoError && phase === "playing"}
        aria-hidden={!currentVideoUrl || videoError || phase !== "playing"}
        tabIndex={currentVideoUrl && phase === "playing" ? 0 : -1}
        aria-label="互动故事视频"
        onError={() => setVideoError(true)}
        onPlay={() => setBlocked(false)}
      />
      {phase === "idle" && (
        <div
          role="status"
          className="absolute inset-0 flex items-center justify-center gap-2 bg-oii-surface text-sm text-white/50"
        >
          <Loader2 size={20} className="animate-spin text-brand-accent" />
          正在准备播放…
        </div>
      )}
      {blocked && phase === "playing" && !videoError && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Button
            variant="primary"
            onClick={() => videoRef.current?.play().catch(() => setVideoError(true))}
          >
            开始观看
          </Button>
        </div>
      )}
      {phase === "playing" && (!currentVideoUrl || videoError) && (
        <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-[#101012]">
          <EmptyState
            className="w-full max-w-lg min-h-0 py-6 sm:py-8"
            icon={videoError ? <AlertCircle size={25} /> : <Film size={25} />}
            title={videoError ? "视频暂时无法播放" : "这个场景还没有视频"}
            description="请检查视频素材，或跳过片段查看后续路线。"
          >
            <Button variant="secondary" onClick={() => onInteractionPoint(revision)}>
              继续体验剧情
            </Button>
          </EmptyState>
        </div>
      )}
      {phase === "error" && (
        <div
          role="alert"
          className="absolute inset-0 flex items-center justify-center bg-[#101012]"
        >
          <EmptyState
            icon={<AlertCircle size={25} />}
            title="播放中断"
            description={error ?? "剧情暂时无法继续"}
          >
            <Button onClick={reset}>重新体验</Button>
          </EmptyState>
        </div>
      )}
      {phase === "awaiting" && choices.length > 0 && (
        <ChoiceOverlay
          key={revision}
          choices={choices}
          question={question}
          timeoutSecs={timeoutSecs}
          onChoose={choose}
        />
      )}
      {phase === "ended" && <EndingScreen ending={ending} onRestart={reset} />}
    </div>
  );
}
