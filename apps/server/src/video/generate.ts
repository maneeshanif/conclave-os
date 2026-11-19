/**
 * The generation connector (SPEC 8): "a connector that makes an image or a clip from a description". Which generator it is
 * (Google Flow, Veo through an API, another) is the founder's choice and is not decided here; the pipeline needs only this slot.
 * Each call spends credits, so the executor calls it once per asset, never retries, and stops at the approved total.
 */
export interface GenerationRequest {
  kind: 'image' | 'clip';
  description: string;
  seconds?: number | undefined;
}
export interface GeneratedAsset {
  content: Buffer;
  mime: string;
  /** What this asset cost, as the generator reports it. */
  credits: number;
}
export interface GenerationConnector {
  readonly name: string;
  generate(req: GenerationRequest): Promise<GeneratedAsset>;
}
