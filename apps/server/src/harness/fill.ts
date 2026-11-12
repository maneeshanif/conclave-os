/**
 * Fills `{{name}}` slots in template text. No logic, no helpers, no HTML escaping:
 * templates are prose for agents, not web pages. A slot with no value is an error,
 * so a missing parameter can never render as an empty string.
 */
export class MissingParamError extends Error {
  constructor(public readonly param: string, where: string) {
    super(`missing template parameter "${param}" in ${where}`);
    this.name = 'MissingParamError';
  }
}

export function fill(text: string, values: Readonly<Record<string, string | undefined>>, where: string): string {
  return text.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (_, name: string) => {
    const v = values[name];
    if (v === undefined) throw new MissingParamError(name, where);
    return v;
  });
}
