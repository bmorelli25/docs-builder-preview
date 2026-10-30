import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse } from "yaml";

export type DocsetSubstitutions = Record<string, string>;

export async function loadDocsetSubstitutions(
  repositoryPath: string,
): Promise<DocsetSubstitutions> {
  const docsetPath = join(repositoryPath, "docset.yml");
  let source: string;
  try {
    source = await readFile(docsetPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }

  let docset: unknown;
  try {
    docset = parse(source);
  } catch (error) {
    throw new Error(
      `Could not parse ${docsetPath} as YAML: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }

  if (
    !docset ||
    typeof docset !== "object" ||
    Array.isArray(docset) ||
    !("subs" in docset)
  ) {
    return {};
  }
  const substitutions = (docset as { subs?: unknown }).subs;
  if (
    !substitutions ||
    typeof substitutions !== "object" ||
    Array.isArray(substitutions)
  ) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(substitutions).flatMap(([key, value]) =>
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
        ? [[key, String(value)]]
        : [],
    ),
  );
}
