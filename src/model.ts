export type FileStatus =
  | "added"
  | "copied"
  | "modified"
  | "renamed"
  | "deleted";

export interface ChangedBlock {
  kind: "added" | "modified";
  startLine: number;
  endLine: number;
  source: string;
  /** Zero-based position among blocks in the file with identical visible text. */
  occurrence?: number;
  occurrences?: number;
  /** For `{applies_to}` directives, which rendered badge row to match. */
  appliesTo?: { headingSource?: string; index: number };
  /** For directive fence lines, a content block inside the directive. */
  container?: { neighborSource: string; title?: string };
  /** For image `:alt:` option lines, the raw alt text. */
  imageAlt?: string;
  /** For modified blocks, the merge-base lines this block replaced. */
  previous?: { startLine: number; endLine: number; source: string };
  /** Word-level diff of the previous visible text against the current one. */
  wordDiff?: WordDiffPart[];
}

export type WordDiffPart =
  | { kind: "equal" | "insert"; text: string }
  | { kind: "delete"; text: string; spaceBefore: boolean; spaceAfter: boolean };

export interface DeletedHunk {
  oldStartLine: number;
  oldEndLine: number;
  newAnchorLine: number;
  source: string;
}

export interface FrontmatterChange {
  kind: "added" | "modified";
  blocks: ChangedBlock[];
  deletedHunks: DeletedHunk[];
}

export interface ChangedFile {
  path: string;
  previousPath?: string;
  status: FileStatus;
  route: string | null;
  consumers?: string[];
  addedLines: number;
  deletedLines: number;
  blocks: ChangedBlock[];
  deletedHunks: DeletedHunk[];
  frontmatter?: FrontmatterChange;
}

export interface ReviewModel {
  repositoryPath: string;
  baseRef: string;
  mergeBase: string;
  substitutions?: Record<string, string>;
  files: ChangedFile[];
  warnings: string[];
}
