import { GameState } from "./engine";

export interface CachedGame {
  id: string;
  code: string;
  state: GameState;
  updatedAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __serpentia_game_cache: Map<string, CachedGame> | undefined;
  // eslint-disable-next-line no-var
  var __serpentia_code_to_id: Map<string, string> | undefined;
}

const cache = globalThis.__serpentia_game_cache ?? new Map<string, CachedGame>();
globalThis.__serpentia_game_cache = cache;

const codeToId = globalThis.__serpentia_code_to_id ?? new Map<string, string>();
globalThis.__serpentia_code_to_id = codeToId;

/** Retrieve game from in-memory cache by UUID or 6-character room code. */
export function getCachedGame(idOrCode: string): CachedGame | null {
  if (!idOrCode) return null;
  const direct = cache.get(idOrCode);
  if (direct) return direct;

  const resolvedId = codeToId.get(idOrCode.toUpperCase());
  if (resolvedId) {
    return cache.get(resolvedId) ?? null;
  }
  return null;
}

/** Store or update an active game in the in-memory cache. */
export function setCachedGame(id: string, code: string, state: GameState): CachedGame {
  const normCode = code.toUpperCase();
  const entry: CachedGame = {
    id,
    code: normCode,
    state,
    updatedAt: Date.now(),
  };
  cache.set(id, entry);
  codeToId.set(normCode, id);
  return entry;
}

/** Remove a game from the in-memory cache (e.g. upon termination). */
export function removeCachedGame(idOrCode: string): void {
  if (!idOrCode) return;
  const game = getCachedGame(idOrCode);
  if (game) {
    cache.delete(game.id);
    codeToId.delete(game.code);
  } else {
    cache.delete(idOrCode);
    codeToId.delete(idOrCode.toUpperCase());
  }
}
