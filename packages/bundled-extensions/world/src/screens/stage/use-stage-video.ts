import { useCallback, useEffect, useState, type RefObject } from 'react';

// A long silence after the stream starts means delivery is blocked (often a VPN or Private Relay).
const STALL_TIMEOUT_MS = 10000;

export function useStageVideo(
  stageRef: RefObject<HTMLDivElement | null>,
  started: boolean
) {
  const [playing, setPlaying] = useState(false);
  const [stalled, setStalled] = useState(false);

  // Force-mute to satisfy WKWebView autoplay; the playing/pause listeners own `playing`.
  const tryPlay = useCallback(async () => {
    const video = stageRef.current?.querySelector('video');
    if (!video) return;
    video.muted = true;
    // iOS gates muted autoplay on the attribute, not the property, unlike desktop.
    video.setAttribute('muted', '');
    // Without playsinline, WKWebView forces fullscreen and pause-on-dismiss resets us.
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    try {
      await video.play();
      setPlaying(true);
    } catch {
      // The stream was re-attached mid-play; the retry effect recovers.
    }
  }, [stageRef]);

  // Reconcile `playing` with the element's real state, whoever wins the play race.
  useEffect(() => {
    const video = stageRef.current?.querySelector('video');
    if (!video) return;
    const sync = () => setPlaying(!video.paused);
    video.addEventListener('playing', sync);
    video.addEventListener('pause', sync);
    return () => {
      video.removeEventListener('playing', sync);
      video.removeEventListener('pause', sync);
    };
  }, [stageRef, started]);

  // A single play() can be aborted by a stream re-attach; retry until it sticks.
  useEffect(() => {
    if (!started || playing) return;
    void tryPlay();
    const id = setInterval(() => void tryPlay(), 800);
    return () => clearInterval(id);
  }, [started, playing, tryPlay]);

  // Flag a stall when the stream has started but no frame plays within the grace window.
  useEffect(() => {
    if (!started || playing) {
      setStalled(false);
      return;
    }
    const id = setTimeout(() => setStalled(true), STALL_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [started, playing]);

  return { playing, stalled, tryPlay };
}
