import { EMOTES, EMOTE_SHOWN_MS } from '@conclave/shared';

/** Who has a quick reaction over their head, and until when (S6-18). Pure: it takes the map and gives back another. */
export type EmoteMap = Map<string, { emote: string; until: number }>;

/** Shows an emoji over someone, dropping any that have run out. An emoji not on the list is ignored. */
export function showEmote(map: EmoteMap, id: string, emote: string, now: number): EmoteMap {
  const next: EmoteMap = new Map([...map].filter(([, v]) => v.until > now));
  if ((EMOTES as readonly string[]).includes(emote)) next.set(id, { emote, until: now + EMOTE_SHOWN_MS });
  return next;
}

/** The emoji over someone right now, or null. */
export function currentEmote(map: EmoteMap, id: string, now: number): string | null {
  const e = map.get(id);
  return e && e.until > now ? e.emote : null;
}
