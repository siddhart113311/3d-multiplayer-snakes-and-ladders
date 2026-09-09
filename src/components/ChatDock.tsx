"use client";

import { memo, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Flame, MessageSquare, Send, X } from "lucide-react";
import { TAUNTS } from "@/game/engine";
import { sfx } from "@/game/sounds";

export interface ChatMsg {
  id: string;
  playerId: string;
  name: string;
  color: string;
  text: string;
  at: number;
  taunt?: boolean;
}

export default memo(function ChatDock({
  messages,
  myId,
  onSend,
  disabled,
  compact = false,
}: {
  messages: ChatMsg[];
  myId: string;
  onSend: (text: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [showTaunts, setShowTaunts] = useState(false);
  const [unread, setUnread] = useState(0);
  const seenRef = useRef<number>(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // track unread + play a blip when someone talks smack
  useEffect(() => {
    const count = messages.length;
    if (count > seenRef.current) {
      const fresh = messages.slice(seenRef.current);
      const fromOthers = fresh.filter((m) => m.playerId !== myId);
      if (open) {
        seenRef.current = count;
      } else if (fromOthers.length) {
        setUnread((u) => u + fromOthers.length);
        seenRef.current = count;
        sfx.turnDing();
      } else {
        seenRef.current = count;
      }
    }
  }, [messages, myId, open]);

  useEffect(() => {
    if (open) {
      setUnread(0);
      requestAnimationFrame(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      });
    }
  }, [open, messages.length]);

  // "T" opens chat and focuses the field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "KeyT") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 60);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const send = (value: string) => {
    const clean = value.replace(/\s+/g, " ").trim().slice(0, 140);
    if (!clean || disabled) return;
    onSend(clean);
    setText("");
    sfx.click();
  };

  return (
    <>
      {/* launcher */}
      <button
        onClick={() => {
          setOpen((o) => !o);
          sfx.click();
        }}
        className={`pointer-events-auto relative border border-white/10 bg-black/40 text-white/80 backdrop-blur-md transition hover:bg-white/10 ${
          compact ? "rounded-xl p-2" : "rounded-2xl p-2.5"
        }`}
        aria-label="Toggle chat"
      >
        {open ? <X className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
        {!open && unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-black text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className={
              compact
                ? "pointer-events-auto fixed inset-x-2 bottom-2 z-40 flex h-[58vh] flex-col overflow-hidden rounded-3xl border border-white/15 bg-slate-950/95 shadow-2xl backdrop-blur-xl"
                : "pointer-events-auto absolute bottom-16 right-3 z-30 flex h-[22rem] w-[19rem] flex-col overflow-hidden rounded-3xl border border-white/15 bg-slate-950/90 shadow-2xl backdrop-blur-xl md:bottom-20 md:right-5 md:h-[24rem] md:w-[21rem]"
            }
            style={compact ? { paddingBottom: "env(safe-area-inset-bottom)" } : undefined}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
              <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.25em] text-white/70">
                <MessageSquare className="h-3.5 w-3.5 text-emerald-300" /> Trash Talk
              </span>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
              {messages.length === 0 && (
                <p className="mt-8 text-center text-xs leading-relaxed text-white/35">
                  No smack talk yet.
                  <br />
                  Someone&apos;s ego is still intact 😇
                </p>
              )}
              {messages.map((m) => {
                const mine = m.playerId === myId;
                return (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, x: mine ? 14 : -14 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
                  >
                    <span className="px-1 text-[9px] font-bold uppercase tracking-wider" style={{ color: m.color }}>
                      {mine ? "You" : m.name}
                    </span>
                    <div
                      className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-[13px] leading-snug ${
                        mine
                          ? "rounded-br-sm bg-emerald-400/20 text-emerald-50"
                          : m.taunt
                            ? "rounded-bl-sm border border-rose-400/25 bg-rose-500/15 text-rose-100"
                            : "rounded-bl-sm bg-white/10 text-white/90"
                      }`}
                    >
                      {m.text}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            <AnimatePresence>
              {showTaunts && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden border-t border-white/10 bg-black/30"
                >
                  <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto p-2.5">
                    {TAUNTS.map((t) => (
                      <button
                        key={t}
                        onClick={() => {
                          send(t);
                          setShowTaunts(false);
                        }}
                        className="rounded-full border border-rose-400/25 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-200 transition hover:bg-rose-500/25"
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center gap-1.5 border-t border-white/10 p-2.5">
              <button
                onClick={() => setShowTaunts((s) => !s)}
                className={`rounded-xl border p-2 transition ${
                  showTaunts ? "border-rose-400/50 bg-rose-500/25 text-rose-200" : "border-white/10 bg-white/5 text-white/60 hover:text-white"
                }`}
                title="Quick taunts"
              >
                <Flame className="h-4 w-4" />
              </button>
              <input
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 140))}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") send(text);
                  if (e.key === "Escape") setOpen(false);
                }}
                placeholder="Destroy an ego…"
                disabled={disabled}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white outline-none transition focus:border-emerald-400/60 disabled:opacity-50"
              />
              <button
                onClick={() => send(text)}
                disabled={!text.trim() || disabled}
                className="rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 p-2 text-slate-950 transition hover:brightness-110 disabled:opacity-30"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
});
