import { useEffect, useRef, useState, type UIEvent } from "react";
import type { ChatMsg, Task, ToolRun } from "../types";

export function useScroll(deps: {
  chat: ChatMsg[];
  selectedTask: Task | null;
  progressByTask: Record<string, ToolRun>;
  stickToBottom: boolean;
  setStickToBottom: (stick: boolean) => void;
}) {
  const { chat, selectedTask, progressByTask, stickToBottom, setStickToBottom } = deps;
  const [showJump, setShowJump] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!stickToBottom) {
      setShowJump(true);
      return;
    }
    // Smooth scrolling for each streamed token queues overlapping animations.
    // Follow the latest message at most once per paint instead.
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = requestAnimationFrame(() => {
      chatEndRef.current?.scrollIntoView({ behavior: "auto" });
      scrollFrameRef.current = null;
    });
    setShowJump(false);
    return () => {
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    };
  }, [chat, selectedTask, progressByTask, stickToBottom]);

  const onTranscriptScroll = (ev: UIEvent<HTMLDivElement>) => {
    const el = ev.currentTarget;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setStickToBottom(nearBottom);
    setShowJump(!nearBottom);
  };

  const onJumpLatest = () => {
    setStickToBottom(true);
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowJump(false);
  };

  return {
    showJump,
    chatEndRef,
    transcriptRef,
    onTranscriptScroll,
    onJumpLatest,
  };
}
