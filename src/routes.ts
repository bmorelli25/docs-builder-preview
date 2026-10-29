export function sourcePathToRoute(path: string): string | null {
  const segments = path.replaceAll("\\", "/").split("/").filter(Boolean);

  if (
    segments.includes("_snippets") ||
    segments.length === 0 ||
    !segments.at(-1)?.endsWith(".md")
  ) {
    return null;
  }

  const fileName = segments.pop()!;
  const stem = fileName.slice(0, -3);
  if (stem !== "index") {
    segments.push(stem);
  }

  const route = `/${segments.map(encodeURIComponent).join("/")}`;
  return stem === "index" && segments.length > 0 ? `${route}/` : route;
}
