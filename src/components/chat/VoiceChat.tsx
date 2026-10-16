"use client";

import { useEffect, useRef, useState } from "react";
import { experimental_useRealtime } from "@ai-sdk/react";
import { gateway } from "ai";
import { MicIcon, SquareIcon } from "lucide-react";

import { REALTIME_MODEL, voiceSessionConfig } from "@/lib/realtime/config";
import type { UiLanguage } from "@/lib/types";

import { uiText } from "./i18n";

// Module scope: the hook replaces its session if these change identity.
const model = gateway.experimental_realtime(REALTIME_MODEL);
const api = { token: "/api/realtime/token" };

/** Composer mic button + live voice panel (prototype; transcripts are not saved). */
export function VoiceChat({ language }: { language: UiLanguage }) {
  const text = uiText(language).chat.voice;
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturingRef = useRef(false);
  const attemptRef = useRef(0); // bumped by stop/unmount/start; a stale start must not touch state

  const realtime = experimental_useRealtime({
    model,
    api,
    sessionConfig: voiceSessionConfig,
    onToolCall: async ({ toolCall }) => {
      if (toolCall.toolName !== "semantic_search") return;
      const response = await fetch("/api/realtime/tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toolCall.args),
      });
      if (!response.ok) throw new Error(`Voice search failed (${response.status})`);
      return response.json();
    },
    onError: () => setError(text.error),
  });
  const { status, connect, disconnect, startAudioCapture } = realtime;

  const releaseStream = () => {
    attemptRef.current++;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    capturingRef.current = false;
  };

  const stop = () => {
    disconnect();
    releaseStream();
    setStarting(false);
    setActive(false);
  };

  const start = async () => {
    if (starting) return;
    const attempt = ++attemptRef.current;
    setError(null);
    setStarting(true);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (attempt === attemptRef.current) {
        setStarting(false);
        setError(text.micDenied);
      }
      return;
    }
    if (attempt !== attemptRef.current) return stream.getTracks().forEach((track) => track.stop());
    streamRef.current = stream;
    setActive(true);
    setStarting(false);
    try {
      await connect();
    } catch {
      if (attempt === attemptRef.current) stop();
    }
  };

  // Feed the mic to the session once it is ready.
  useEffect(() => {
    if (status === "connected" && streamRef.current && !capturingRef.current) {
      capturingRef.current = true;
      startAudioCapture(streamRef.current);
    }
    if (status === "error") stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Unmount: the hook disposes its own session; hook controls throw by now, so only release our stream.
  useEffect(() => releaseStream, []); // eslint-disable-line react-hooks/exhaustive-deps

  const label =
    status === "connecting" || (active && status !== "connected")
      ? text.connecting
      : realtime.isPlaying
        ? text.speaking
        : text.listening;

  return (
    <>
      <button
        type="button"
        onClick={active ? stop : start}
        disabled={starting}
        aria-label={text.start}
        title={text.start}
        aria-pressed={active}
        className={`inline-flex size-8 items-center justify-center rounded-full border transition-colors ${
          active
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
        }`}
      >
        <MicIcon size={14} />
      </button>
      {(active || error) && (
        <div className="absolute inset-x-0 bottom-full mb-2 rounded-2xl border border-border bg-card p-3 text-sm shadow-lg">
          {error && <p className="text-destructive">{error}</p>}
          {active && (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{label}</span>
                <button
                  type="button"
                  onClick={stop}
                  aria-label={text.stop}
                  title={text.stop}
                  className="inline-flex size-8 items-center justify-center rounded-full bg-foreground text-background hover:opacity-85"
                >
                  <SquareIcon size={12} className="fill-current" />
                </button>
              </div>
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {realtime.messages.map((message) => (
                  <p key={message.id}>
                    <span className="text-muted-foreground">
                      {message.role === "user" ? text.you : "ChatLDS"}:{" "}
                    </span>
                    {message.parts.map((part) => (part.type === "text" ? part.text : "")).join("")}
                  </p>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
