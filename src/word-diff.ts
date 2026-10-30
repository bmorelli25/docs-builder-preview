import { generatedTextGap } from "./markdown.js";
import type { WordDiffPart } from "./model.js";

/**
 * Words keep inner apostrophes, periods, and hyphens (`don't`, `9.4`,
 * `AI-powered`); every other visible symbol is its own token. The browser
 * highlighter tokenizes rendered text with the same pattern.
 */
export const wordTokenSource =
  "[\\p{L}\\p{N}_]+(?:['’.\\-][\\p{L}\\p{N}_]+)*|[^\\s\\p{L}\\p{N}_\\uFFFC]";

const maxCells = 4_000_000;

interface Token {
  value: string;
  start: number;
  end: number;
}

function tokenize(text: string): Token[] {
  return [...text.matchAll(new RegExp(wordTokenSource, "gu"))].map(
    (match) => ({
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
    }),
  );
}

const isWord = (value: string) => /[\p{L}\p{N}]/u.test(value);

type Op = "equal" | "delete" | "insert";

function lcsOps(left: Token[], right: Token[]): Op[] | undefined {
  const rows = left.length + 1;
  const columns = right.length + 1;
  if (rows * columns > maxCells) return undefined;
  const table = new Uint32Array(rows * columns);
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      table[i * columns + j] =
        left[i].value === right[j].value
          ? table[(i + 1) * columns + j + 1] + 1
          : Math.max(table[(i + 1) * columns + j], table[i * columns + j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (
      i < left.length &&
      j < right.length &&
      left[i].value === right[j].value
    ) {
      ops.push("equal");
      i++;
      j++;
    } else if (
      j >= right.length ||
      (i < left.length &&
        table[(i + 1) * columns + j] >= table[i * columns + j + 1])
    ) {
      ops.push("delete");
      i++;
    } else {
      ops.push("insert");
      j++;
    }
  }
  return ops;
}

interface Run {
  op: Op;
  length: number;
}

function runsOf(ops: Op[]): Run[] {
  const runs: Run[] = [];
  for (const op of ops) {
    const last = runs.at(-1);
    if (last?.op === op) last.length++;
    else runs.push({ op, length: 1 });
  }
  return runs;
}

/** Orders each change group as deletions then insertions. */
function regroup(runs: Run[]): Run[] {
  const result: Run[] = [];
  let deleted = 0;
  let inserted = 0;
  const flush = () => {
    if (deleted) result.push({ op: "delete", length: deleted });
    if (inserted) result.push({ op: "insert", length: inserted });
    deleted = inserted = 0;
  };
  for (const run of runs) {
    if (run.op === "equal") {
      flush();
      const last = result.at(-1);
      if (last?.op === "equal") last.length += run.length;
      else result.push({ ...run });
    } else if (run.op === "delete") {
      deleted += run.length;
    } else {
      inserted += run.length;
    }
  }
  flush();
  return result;
}

/**
 * Folds a lone shared token into the surrounding change when both neighbors
 * are larger replacements, so rewritten phrases read as one replacement
 * instead of alternating fragments. A token between pure insertions stays,
 * since it anchors where the new words went.
 */
function absorbShortEqualities(runs: Run[]): Run[] {
  let current = regroup(runs);
  for (let changed = true; changed; ) {
    changed = false;
    const replacementAround = (index: number, step: number) => {
      let size = 0;
      const ops = new Set<Op>();
      for (
        let cursor = index + step;
        current[cursor] && current[cursor].op !== "equal";
        cursor += step
      ) {
        size += current[cursor].length;
        ops.add(current[cursor].op);
      }
      return ops.size === 2 && size > 2;
    };
    for (let index = 1; index < current.length - 1; index++) {
      const run = current[index];
      if (
        run.op === "equal" &&
        run.length === 1 &&
        replacementAround(index, -1) &&
        replacementAround(index, 1)
      ) {
        current = regroup([
          ...current.slice(0, index),
          { op: "delete", length: 1 },
          { op: "insert", length: 1 },
          ...current.slice(index + 1),
        ]);
        changed = true;
        break;
      }
    }
  }
  return current;
}

export interface WordDiffResult {
  parts: WordDiffPart[];
  /** Dice coefficient over tokens, from 0 (nothing shared) to 1 (identical). */
  similarity: number;
  /** Shared tokens as a share of the shorter side. */
  overlap: number;
}

/**
 * Diffs two visible-text strings at word level. Returns undefined when either
 * side is empty, nothing changed, no word is shared, or the input is too large.
 */
export function diffWords(
  oldText: string,
  newText: string,
): WordDiffResult | undefined {
  const left = tokenize(oldText);
  const right = tokenize(newText);
  if (left.length === 0 || right.length === 0) return undefined;
  const ops = lcsOps(left, right);
  if (!ops) return undefined;
  const runs = absorbShortEqualities(runsOf(ops));
  if (runs.every((run) => run.op === "equal")) return undefined;

  const parts: WordDiffPart[] = [];
  let i = 0;
  let j = 0;
  let sharesWord = false;
  for (const run of runs) {
    if (run.op === "delete") {
      const first = left[i];
      const last = left[i + run.length - 1];
      parts.push({
        kind: "delete",
        text: oldText
          .slice(first.start, last.end)
          .replaceAll(generatedTextGap, "…"),
        spaceBefore: /\s/.test(oldText[first.start - 1] ?? ""),
        spaceAfter: /\s/.test(oldText[last.end] ?? ""),
      });
      i += run.length;
    } else {
      const first = right[j];
      const last = right[j + run.length - 1];
      parts.push({ kind: run.op, text: newText.slice(first.start, last.end) });
      if (run.op === "equal") {
        sharesWord ||= right.slice(j, j + run.length).some(({ value }) =>
          isWord(value),
        );
        i += run.length;
      }
      j += run.length;
    }
  }
  if (!sharesWord) return undefined;
  const equal = runs
    .filter((run) => run.op === "equal")
    .reduce((sum, run) => sum + run.length, 0);
  return {
    parts,
    similarity: (2 * equal) / (left.length + right.length),
    overlap: equal / Math.min(left.length, right.length),
  };
}
