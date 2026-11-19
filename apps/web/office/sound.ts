/**
 * Sound in the office (S6B-5). Everything is made in the browser (no sound files to track), starts off, and is remembered. Which
 * sound goes with what happens, and what may be read aloud, are pure and tested; the playing itself is a few lines of Web Audio.
 */
export type SoundName = 'step' | 'door' | 'blip' | 'pop' | 'ping';
const BY_EVENT: Record<string, SoundName> = { step: 'step', 'enter-room': 'door', chat: 'blip', emote: 'pop', 'needs-you': 'ping' };

export function soundFor(event: string): SoundName | null {
  return Object.hasOwn(BY_EVENT, event) ? BY_EVENT[event]! : null;
}

export interface SoundSettings {
  /** Footsteps, door chimes, blips and pops. */
  effects: boolean;
  /** Read chat aloud with the browser's own voice. Nothing leaves the machine. */
  voice: boolean;
}
const KEY = 'conclave.sound';

export function readSoundSettings(store: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): SoundSettings {
  try {
    const v = JSON.parse(store?.getItem(KEY) ?? 'null') as Partial<SoundSettings> | null;
    return { effects: v?.effects === true, voice: v?.voice === true };
  } catch {
    return { effects: false, voice: false };
  }
}

export function writeSoundSettings(s: SoundSettings, store: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try {
    store?.setItem(KEY, JSON.stringify({ effects: s.effects, voice: s.voice }));
  } catch {
    // Not saved: it is silent again next time.
  }
}

/** What to say aloud for a chat line, or null when voice is off or there is nothing to say. Markup and control characters are taken out. */
export function speakable(name: string, text: string, s: SoundSettings): string | null {
  if (!s.voice) return null;
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return `${name} says: ${clean}`.slice(0, 160);
}

let ctx: AudioContext | null = null;

/** Plays one sound, if effects are on and the browser can. A short, soft tone each; nothing is loaded from anywhere. */
export function play(name: SoundName, s: SoundSettings): void {
  if (!s.effects || typeof window === 'undefined') return;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    const audio = ctx;
    const t = audio.currentTime;
    const tone = (freq: number, start: number, len: number, vol: number, type: OscillatorType = 'sine') => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t + start);
      g.gain.setValueAtTime(0.0001, t + start);
      g.gain.exponentialRampToValueAtTime(vol, t + start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + start + len);
      o.connect(g).connect(audio.destination);
      o.start(t + start);
      o.stop(t + start + len + 0.02);
    };
    if (name === 'step') tone(120, 0, 0.05, 0.03, 'triangle');
    else if (name === 'door') {
      tone(660, 0, 0.18, 0.06);
      tone(880, 0.12, 0.25, 0.05);
    } else if (name === 'blip') tone(740, 0, 0.09, 0.05, 'square');
    else if (name === 'pop') tone(520, 0, 0.1, 0.06, 'triangle');
    else if (name === 'ping') {
      tone(988, 0, 0.12, 0.05);
      tone(1318, 0.1, 0.2, 0.05);
    }
  } catch {
    // No sound: the office carries on.
  }
}

/** Says a line with the browser's own voice. Cancels what it was saying, so lines never pile up. */
export function speak(line: string): void {
  try {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(line);
    u.rate = 1.05;
    window.speechSynthesis.speak(u);
  } catch {
    // No voice: the line is still in the chat.
  }
}
