export const ROOT_PREVIEW_HREF = "/?preview=1";

interface Tag {
  name: string;
  closing: boolean;
  start: number;
  end: number;
}

interface Attribute {
  name: string;
  value: string;
  start: number;
  end: number;
  quoted: boolean;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

const rawTextElements = new Set(["script", "style", "textarea", "title"]);

export function openingTagEnd(source: string, start: number): number | undefined {
  let quote: "'" | '"' | undefined;
  for (let index = start; index < source.length; index++) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return undefined;
}

function* tags(html: string): Generator<Tag> {
  const tagName = /<(\/?)([A-Za-z][A-Za-z0-9:-]*)/y;
  let cursor = 0;
  while (cursor < html.length) {
    const open = html.indexOf("<", cursor);
    if (open === -1) return;
    if (html.startsWith("<!--", open)) {
      const close = html.indexOf("-->", open + 4);
      if (close === -1) return;
      cursor = close + 3;
      continue;
    }
    tagName.lastIndex = open;
    const match = tagName.exec(html);
    if (!match) {
      cursor = open + 1;
      continue;
    }
    const end = openingTagEnd(html, open);
    if (end === undefined) return;
    const tag: Tag = {
      name: match[2].toLowerCase(),
      closing: match[1] === "/",
      start: open,
      end: end + 1,
    };
    yield tag;
    cursor = tag.end;
    if (!tag.closing && rawTextElements.has(tag.name)) {
      const close = new RegExp(`</${tag.name}\\s*>`, "gi");
      close.lastIndex = cursor;
      cursor = close.exec(html)?.index ?? html.length;
    }
  }
}

const namedEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeAttribute(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));?/gi,
    (entity, decimal?: string, hex?: string, name?: string) => {
      if (name) return namedEntities[name.toLowerCase()];
      const codePoint = Number.parseInt(decimal ?? hex!, decimal ? 10 : 16);
      return codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    },
  );
}

function attributes(html: string, tag: Tag): Attribute[] {
  const bodyStart = tag.start + 1 + (tag.closing ? 1 : 0) + tag.name.length;
  const body = html.slice(bodyStart, tag.end - 1);
  const pattern =
    /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/dg;
  const result: Attribute[] = [];
  for (const match of body.matchAll(pattern)) {
    const group = [2, 3, 4].find((index) => match[index] !== undefined);
    const [start, end] = group === undefined
      ? [match.indices![0][1], match.indices![0][1]]
      : match.indices![group]!;
    result.push({
      name: match[1].toLowerCase(),
      value: decodeAttribute(group === undefined ? "" : match[group]),
      start: bodyStart + start,
      end: bodyStart + end,
      quoted: group === 2 || group === 3,
    });
  }
  return result;
}

function attribute(html: string, tag: Tag, name: string): Attribute | undefined {
  return attributes(html, tag).find((candidate) => candidate.name === name);
}

function applyEdits(html: string, edits: Edit[]): string {
  const ordered = [...edits].sort((left, right) => left.start - right.start);
  let result = "";
  let cursor = 0;
  for (const edit of ordered) {
    result += html.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return result + html.slice(cursor);
}

function replaceValue(target: Attribute, value: string): Edit {
  const escaped = value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  return {
    start: target.start,
    end: target.end,
    text: target.quoted ? escaped : `"${escaped}"`,
  };
}

function navActivePath(html: string, pathname: string): string {
  for (const tag of tags(html)) {
    if (tag.name === "body" || (tag.closing && tag.name === "head")) break;
    if (tag.closing || tag.name !== "meta") continue;
    if (attribute(html, tag, "name")?.value !== "docs:nav-active") continue;
    const content = attribute(html, tag, "content");
    if (content) return content.value;
  }
  return pathname.replace(/\/$/, "");
}

function addCurrentClass(html: string, tag: Tag): Edit | undefined {
  const classes = attribute(html, tag, "class");
  if (!classes) {
    const position = tag.start + 1 + tag.name.length;
    return { start: position, end: position, text: ' class="current"' };
  }
  if (classes.value.split(/\s+/).includes("current")) return undefined;
  return replaceValue(
    classes,
    classes.value ? `${classes.value} current` : "current",
  );
}

function addChecked(html: string, tag: Tag): Edit | undefined {
  if (attribute(html, tag, "checked")) return undefined;
  const selfClosing = html[tag.end - 2] === "/";
  const position = tag.end - (selfClosing ? 2 : 1);
  return { start: position, end: position, text: " checked" };
}

/**
 * docs-builder normally applies this state in `main.js`, which the proxy
 * strips. Links to the active page get `current`, and the first checkbox of
 * every enclosing list item is checked so the CSS-driven tree opens to it.
 */
export function markCurrentNavigation(html: string, pathname: string): string {
  const active = navActivePath(html, pathname);
  const wanted = new Set([active, `${active}/`]);
  interface ListItem {
    firstInput?: Tag;
  }
  const stack: Array<{ name: string; item?: ListItem }> = [];
  const current: Tag[] = [];
  const expanded = new Set<ListItem>();
  let navDepth = 0;

  for (const tag of tags(html)) {
    if (navDepth === 0) {
      if (
        !tag.closing &&
        tag.name === "nav" &&
        attribute(html, tag, "id")?.value === "pages-nav"
      ) {
        navDepth = 1;
      }
      continue;
    }
    if (tag.name === "nav") {
      navDepth += tag.closing ? -1 : 1;
      if (navDepth === 0) break;
      continue;
    }
    if (tag.name === "li" || tag.name === "ul" || tag.name === "ol") {
      if (tag.closing) {
        for (let index = stack.length - 1; index >= 0; index--) {
          if (stack[index].name === tag.name) {
            stack.length = index;
            break;
          }
        }
      } else {
        if (tag.name === "li" && stack.at(-1)?.name === "li") stack.pop();
        stack.push(
          tag.name === "li" ? { name: "li", item: {} } : { name: tag.name },
        );
      }
      continue;
    }
    if (tag.closing) continue;
    if (tag.name === "input") {
      for (const entry of stack) {
        if (entry.item && !entry.item.firstInput) entry.item.firstInput = tag;
      }
    } else if (tag.name === "a") {
      const href = attribute(html, tag, "href");
      if (href && wanted.has(href.value)) {
        current.push(tag);
        for (const entry of stack) if (entry.item) expanded.add(entry.item);
      }
    }
  }

  const edits: Edit[] = [];
  for (const tag of current) {
    const edit = addCurrentClass(html, tag);
    if (edit) edits.push(edit);
  }
  for (const item of expanded) {
    const edit = item.firstInput && addChecked(html, item.firstInput);
    if (edit) edits.push(edit);
  }
  return applyEdits(html, edits);
}

function navRouteKey(href: string): string {
  let path = href.split(/[?#]/, 1)[0];
  try {
    path = decodeURI(path);
  } catch {
    // Keep malformed escapes as written.
  }
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function insertAttribute(tag: Tag, name: string, value: string): Edit {
  const position = tag.start + 1 + tag.name.length;
  const escaped = value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  return { start: position, end: position, text: ` ${name}="${escaped}"` };
}

/**
 * Marks nav links to changed pages with their status, and each folder's own
 * link with the number of changed pages beneath it, so collapsed folders still
 * show where changes are.
 */
export function markChangedNavigation(
  html: string,
  changedRoutes: ReadonlyMap<string, string>,
): string {
  if (changedRoutes.size === 0) return html;
  const statuses = new Map(
    [...changedRoutes].map(([route, status]) => [navRouteKey(route), status]),
  );
  const stack: Array<{
    name: string;
    count: number;
    folder: boolean;
    firstLink?: Tag;
  }> = [];
  const edits: Edit[] = [];
  const marked = new Set<string>();
  let navDepth = 0;

  for (const tag of tags(html)) {
    if (navDepth === 0) {
      if (
        !tag.closing &&
        tag.name === "nav" &&
        attribute(html, tag, "id")?.value === "pages-nav"
      ) {
        navDepth = 1;
      }
      continue;
    }
    if (tag.name === "nav") {
      navDepth += tag.closing ? -1 : 1;
      if (navDepth === 0) break;
      continue;
    }
    if (tag.name === "li" || tag.name === "ul" || tag.name === "ol") {
      if (tag.closing) {
        for (let index = stack.length - 1; index >= 0; index--) {
          if (stack[index].name === tag.name) {
            for (const entry of stack.splice(index)) {
              if (entry.folder && entry.firstLink && entry.count > 0) {
                edits.push(
                  insertAttribute(entry.firstLink, "data-review-contains", String(entry.count)),
                );
              }
            }
            break;
          }
        }
      } else {
        const parent = stack.at(-1);
        if (tag.name !== "li" && parent?.name === "li") parent.folder = true;
        stack.push({ name: tag.name, count: 0, folder: false });
      }
      continue;
    }
    if (tag.closing || tag.name !== "a") continue;
    for (const entry of stack) {
      if (entry.name === "li" && !entry.firstLink) entry.firstLink = tag;
    }
    const href = attribute(html, tag, "href");
    if (!href?.value.startsWith("/")) continue;
    const key = navRouteKey(href.value);
    const status = statuses.get(key);
    if (!status) continue;
    edits.push(insertAttribute(tag, "data-review-change", status));
    if (marked.has(key)) continue;
    marked.add(key);
    for (const entry of stack) if (entry.name === "li") entry.count++;
  }
  return applyEdits(html, edits);
}

/**
 * The dashboard owns `/`, so docs links to the docs root must use the preview
 * alias or they would load the dashboard inside the preview frame.
 */
export function rewriteDashboardRootLinks(html: string): string {
  const edits: Edit[] = [];
  for (const tag of tags(html)) {
    if (tag.closing || (tag.name !== "a" && tag.name !== "area")) continue;
    const href = attribute(html, tag, "href");
    if (!href || (href.value !== "/" && !href.value.startsWith("/#"))) continue;
    edits.push(replaceValue(href, ROOT_PREVIEW_HREF + href.value.slice(1)));
  }
  return applyEdits(html, edits);
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * docs-builder's `applies_to` badges are `<applies-to-popover>` custom
 * elements that its scripts fill in. With scripts stripped they render empty,
 * so the proxy writes the badge label from the element's attributes.
 */
export function renderAppliesBadges(html: string): string {
  const edits: Edit[] = [];
  for (const tag of tags(html)) {
    if (tag.closing || tag.name !== "applies-to-popover") continue;
    const value = (name: string) => attribute(html, tag, name)?.value ?? "";
    const label = [
      value("badge-key"),
      value("show-lifecycle-name") === "true" ? value("lifecycle-name") : "",
      value("show-version") === "true" ? value("badge-version") : "",
    ].filter(Boolean).join(" ");
    if (!label) continue;
    const lifecycle = value("lifecycle-class").replace(/[^\w-]/g, "");
    edits.push({
      start: tag.end,
      end: tag.end,
      text: `<span class="review-applies-badge" data-lifecycle="${lifecycle}">${escapeText(label)}</span>`,
    });
  }
  return applyEdits(html, edits);
}

function linkReviewStyles(html: string): string {
  for (const tag of tags(html)) {
    if (tag.closing && tag.name === "head") {
      return applyEdits(html, [{
        start: tag.start,
        end: tag.start,
        text: '<link rel="stylesheet" href="/_review/highlight.css" data-docs-review-styles>',
      }]);
    }
  }
  return html;
}

export function rewritePreviewHtml(
  html: string,
  pathname: string,
  changedRoutes: ReadonlyMap<string, string> = new Map(),
): string {
  return linkReviewStyles(
    renderAppliesBadges(
      rewriteDashboardRootLinks(
        markChangedNavigation(markCurrentNavigation(html, pathname), changedRoutes),
      ),
    ),
  );
}
