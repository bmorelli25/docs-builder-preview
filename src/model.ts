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
}

export interface DeletedHunk {
  oldStartLine: number;
  oldEndLine: number;
  newAnchorLine: number;
  source: string;
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
}

export interface ReviewModel {
  repositoryPath: string;
  baseRef: string;
  mergeBase: string;
  substitutions?: Record<string, string>;
  files: ChangedFile[];
  warnings: string[];
}
