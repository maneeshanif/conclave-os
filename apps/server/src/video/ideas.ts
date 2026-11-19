/**
 * Video ideas (SPEC 8): a line, a link or a voice note dropped into the inbox, from a phone or the desk. A voice note is kept as
 * its transcript. Nothing is generated from an idea until a brief is approved (S5-8), because generation costs credits.
 */
export const IDEA_KINDS = ['line', 'link', 'voice'] as const;
export type IdeaKind = (typeof IDEA_KINDS)[number];
export const IDEA_STAGES = ['idea', 'shelved', 'brief', 'assets', 'render', 'review', 'published'] as const;
export type IdeaStage = (typeof IDEA_STAGES)[number];

/** A text that is only a web address is a link; a transcript the person marked as spoken is a voice note; anything else is a line. */
export function classifyIdea(text: string, hint?: IdeaKind): { kind: IdeaKind; url: string | null } {
  const t = text.trim();
  if (hint === 'voice') return { kind: 'voice', url: null };
  if (/^https?:\/\/\S+$/i.test(t) && URL.canParse(t)) return { kind: 'link', url: t };
  return { kind: 'line', url: null };
}

export interface IdeaRow {
  id: string;
  idea: string;
  kind: IdeaKind;
  url: string | null;
  source: string;
  stage: IdeaStage;
  hook_id: string | null;
  created_at: Date;
}

export const ideaView = (r: IdeaRow) => ({ id: r.id, idea: r.idea, kind: r.kind, url: r.url, source: r.source, stage: r.stage, hookId: r.hook_id, createdAt: r.created_at.toISOString() });
