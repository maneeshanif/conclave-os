/**
 * Quick reactions (S6-18): an emoji shown over your head for a few seconds to the people near you. One short list, used by the server
 * (which drops anything else) and by the page (which offers exactly these).
 */
export const EMOTES = ['👋', '👍', '👏', '😂', '❤️', '🎉', '🤔', '😮'] as const;
export type Emote = (typeof EMOTES)[number];
/** An emoji is seen by people this many tiles away, a little further than chat. */
export const EMOTE_RANGE = 14;
/** How long one stays over a head, in milliseconds. */
export const EMOTE_SHOWN_MS = 4000;
