"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useLocalParticipant,
  useParticipants,
  useSpeakingParticipants,
} from "@livekit/components-react";
import { Mic, MicOff, PhoneCall, PhoneOff, Volume2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface VoiceChatProps {
  roomCode: string;
  playerName: string;
  playerId: string;
  compact?: boolean;
  onSpeakingChange?: (speakingPlayerIds: string[]) => void;
}

interface TokenResponse {
  token: string;
  url: string;
}

export default function VoiceChat({
  roomCode,
  playerName,
  playerId,
  compact = false,
  onSpeakingChange,
}: VoiceChatProps) {
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectVoice = useCallback(async () => {
    if (loading || connected) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/voice/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room: roomCode.toUpperCase(),
          username: playerName,
          identity: playerId,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to connect to voice chat");
      }

      const data: TokenResponse = await res.json();
      setToken(data.token);
      setServerUrl(data.url);
      setConnected(true);
    } catch (err) {
      console.error("[VoiceChat] connection error:", err);
      setError((err as Error).message || "Voice chat unavailable");
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, [roomCode, playerName, playerId, loading, connected]);

  const disconnectVoice = useCallback(() => {
    setConnected(false);
    setToken(null);
    onSpeakingChange?.([]);
  }, [onSpeakingChange]);

  if (!connected || !token || !serverUrl) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => void connectVoice()}
          disabled={loading}
          title="Join Voice Chat (WebRTC)"
          className={`flex items-center gap-1.5 font-bold tracking-wide transition border backdrop-blur-md ${
            compact
              ? "rounded-xl border-white/10 bg-black/40 px-2.5 py-2 text-[10px] text-white/80 active:bg-white/15"
              : "rounded-2xl border-white/10 bg-black/40 px-3 py-2 text-xs text-white/80 hover:bg-emerald-500/20 hover:border-emerald-400/40 hover:text-emerald-300"
          }`}
        >
          <PhoneCall className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          <span>{loading ? "Connecting..." : "Voice"}</span>
        </button>
        {error && (
          <span className="text-[10px] text-red-400 bg-red-950/60 px-2 py-0.5 rounded-lg border border-red-500/20">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <LiveKitRoom
      token={token}
      serverUrl={serverUrl}
      connect={connected}
      audio={false}
      video={false}
      onDisconnected={disconnectVoice}
      onError={(err) => {
        console.warn("[VoiceChat] LiveKit room error:", err);
      }}
      className="flex items-center"
    >
      <RoomAudioRenderer />
      <VoiceControls
        compact={compact}
        onDisconnect={disconnectVoice}
        onSpeakingChange={onSpeakingChange}
      />
    </LiveKitRoom>
  );
}

function VoiceControls({
  compact,
  onDisconnect,
  onSpeakingChange,
}: {
  compact: boolean;
  onDisconnect: () => void;
  onSpeakingChange?: (speakingPlayerIds: string[]) => void;
}) {
  const { isMicrophoneEnabled, localParticipant } = useLocalParticipant();
  const speakingParticipants = useSpeakingParticipants();
  const allParticipants = useParticipants();

  // Notify parent of speaking identities
  useEffect(() => {
    const ids = speakingParticipants.map((p) => p.identity);
    onSpeakingChange?.(ids);
  }, [speakingParticipants, onSpeakingChange]);

  const toggleMic = useCallback(async () => {
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    } catch (e) {
      console.warn("Failed to toggle microphone:", e);
    }
  }, [localParticipant, isMicrophoneEnabled]);

  const isLocalSpeaking = speakingParticipants.some((p) => p.isLocal);
  const otherSpeakers = speakingParticipants.filter((p) => !p.isLocal);

  return (
    <div className="flex items-center gap-1.5">
      {/* Mic toggle */}
      <button
        onClick={() => void toggleMic()}
        title={isMicrophoneEnabled ? "Mute Microphone" : "Unmute Microphone"}
        className={`relative flex items-center gap-1.5 font-bold transition border backdrop-blur-md ${
          compact
            ? "rounded-xl px-2.5 py-2 text-[10px]"
            : "rounded-2xl px-3 py-2 text-xs"
        } ${
          isMicrophoneEnabled
            ? isLocalSpeaking
              ? "border-emerald-400 bg-emerald-500/30 text-emerald-200 shadow-[0_0_12px_rgba(52,211,153,0.5)]"
              : "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
            : "border-red-500/40 bg-red-500/15 text-red-300 hover:bg-red-500/25"
        }`}
      >
        {isMicrophoneEnabled ? (
          <Mic className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        ) : (
          <MicOff className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        )}
        <span>{isMicrophoneEnabled ? (isLocalSpeaking ? "Talking" : "Mute") : "Unmuted"}</span>
        {isLocalSpeaking && (
          <span className="absolute -top-1 -right-1 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
        )}
      </button>

      {/* Speaking badge if another player is speaking */}
      <AnimatePresence>
        {otherSpeakers.length > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="flex items-center gap-1 rounded-xl border border-cyan-400/40 bg-cyan-950/60 px-2 py-1 text-[10px] text-cyan-200 backdrop-blur-md"
          >
            <Volume2 className="h-3 w-3 animate-pulse text-cyan-400" />
            <span className="max-w-[70px] truncate font-semibold">
              {otherSpeakers.map((s) => s.name || s.identity).join(", ")}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Disconnect button */}
      <button
        onClick={onDisconnect}
        title="Leave Voice Chat"
        className={`flex items-center justify-center rounded-xl border border-white/10 bg-black/40 p-2 text-white/60 transition hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/30 active:bg-white/15 ${
          compact ? "p-1.5" : "p-2"
        }`}
      >
        <PhoneOff className="h-3.5 w-3.5" />
      </button>

      {/* Connected participant count pill */}
      {!compact && (
        <span className="rounded-lg bg-white/5 border border-white/10 px-1.5 py-0.5 text-[9px] font-mono text-white/50">
          {allParticipants.length} in voice
        </span>
      )}
    </div>
  );
}
