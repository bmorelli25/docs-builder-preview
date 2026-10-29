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
}

export interface DeletedHunk {
  oldStartLine: number;
  oldEndLine: number;
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
  files: ChangedFile[];
  warnings: string[];
}
