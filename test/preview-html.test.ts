import { describe, expect, it } from "vitest";

import {
  markCurrentNavigation,
  renderAppliesBadges,
  rewriteDashboardRootLinks,
  rewritePreviewHtml,
} from "../src/preview-html.js";

describe("renderAppliesBadges", () => {
  it("writes visible labels into applies_to popovers", () => {
    const html = [
      "<html><head></head><body>",
      '<p class="applies applies-block">',
      '<applies-to-popover badge-key="Stack" badge-version="9.4&#x2B;" lifecycle-class="ga" lifecycle-name="GA" show-lifecycle-name="true" show-version="true"></applies-to-popover>',
      '<applies-to-popover badge-key="Serverless <Security>" lifecycle-class="preview" lifecycle-name="Preview" show-lifecycle-name="false" show-version="false"></applies-to-popover>',
      "</p></body></html>",
    ].join("");

    const result = renderAppliesBadges(html);

    expect(result).toContain(
      '<span class="review-applies-badge" data-lifecycle="ga">Stack GA 9.4+</span>',
    );
    expect(result).toContain(
      '<span class="review-applies-badge" data-lifecycle="preview">Serverless &lt;Security&gt;</span>',
    );
    expect(result).toContain(
      '<link rel="stylesheet" href="/_review/highlight.css" data-docs-review-styles></head>',
    );
  });

  it("leaves pages without badges unchanged", () => {
    const html = "<html><head></head><body><p>Text</p></body></html>";
    expect(renderAppliesBadges(html)).toBe(html);
  });
});

const folder = (id: string, href: string, label: string, children: string) => `
  <li class="nav-folder mt-4">
    <div class="peer grid">
      <a href="${href}" class="sidebar-link nav-folder-link"><span>${label}</span></a>
      <label for="${id}" class="group/label"><input id="${id}" type="checkbox" class="hidden" aria-hidden="true"></label>
    </div>
    <ul class="nav-subtree">${children}</ul>
  </li>`;
const leaf = (href: string, label: string) =>
  `<li class="flex group/li"><a href="${href}" class="sidebar-link nav-link"><span>${label}</span></a></li>`;

const page = (head = "") => `<!doctype html><html><head>${head}</head><body>
  <nav id="toc-nav"><ul><li><a href="/guide/install">On this page</a><input id="toc" type="checkbox"></li></ul></nav>
  <main><a href="/guide/install">Body link</a></main>
  <aside><nav id="pages-nav" class="sidebar-nav">
    <div id="pages-dropdown"><a class="pages-dropdown_active" href="/">Elastic Docs</a>
      <ul><li class="block"><a class="block" href="/guide">Guide</a></li></ul>
    </div>
    <ul>
      ${folder("F1", "/guide", "Guide", `
        ${leaf("/guide/intro", "Intro")}
        ${folder("F2", "/guide/setup", "Setup", `
          ${leaf("/guide/install", "Install")}
          ${leaf("/guide/upgrade", "Upgrade")}
        `)}
      `)}
      ${folder("F3", "/reference", "Reference", leaf("/reference/api", "API"))}
    </ul>
  </nav></aside>
</body></html>`;

const checkedIds = (html: string) =>
  [...html.matchAll(/<input id="([^"]+)"[^>]*\bchecked\b/g)].map((match) => match[1]);
const currentHrefs = (html: string) =>
  [...html.matchAll(/<a href="([^"]+)"[^>]*class="[^"]*\bcurrent\b/g)].map(
    (match) => match[1],
  );

describe("markCurrentNavigation", () => {
  it("expands every ancestor folder and marks the current page", () => {
    const html = markCurrentNavigation(page(), "/guide/install");

    expect(checkedIds(html)).toEqual(["F1", "F2"]);
    expect(currentHrefs(html)).toEqual(["/guide/install"]);
    expect(html).toContain(
      '<a href="/guide/install" class="sidebar-link nav-link current">',
    );
  });

  it("leaves the TOC, page body, and unrelated folders untouched", () => {
    const html = markCurrentNavigation(page(), "/guide/install");

    expect(html).toContain('<a href="/guide/install">On this page</a>');
    expect(html).toContain('<input id="toc" type="checkbox">');
    expect(html).toContain('<a href="/guide/install">Body link</a>');
    expect(html).not.toMatch(/id="F3"[^>]*checked/);
  });

  it("opens a folder page itself, like docs-builder's expandAllParents", () => {
    const html = markCurrentNavigation(page(), "/guide/setup/");

    expect(checkedIds(html)).toEqual(["F1", "F2"]);
    expect(currentHrefs(html)).toEqual(["/guide/setup"]);
  });

  it("marks every matching link, including the section dropdown", () => {
    const html = markCurrentNavigation(page(), "/guide");

    expect(html).toContain('<a class="block current" href="/guide">Guide</a>');
    expect(currentHrefs(html)).toEqual(["/guide"]);
    expect(checkedIds(html)).toEqual(["F1"]);
  });

  it("prefers the docs:nav-active meta over the request path", () => {
    const html = markCurrentNavigation(
      page('<meta name="docs:nav-active" content="/reference/api">'),
      "/hidden/page",
    );

    expect(checkedIds(html)).toEqual(["F3"]);
    expect(currentHrefs(html)).toEqual(["/reference/api"]);
  });

  it("returns the document unchanged when nothing matches", () => {
    const html = page();
    expect(markCurrentNavigation(html, "/not/in/nav")).toBe(html);
    const noNav = "<html><body><ul><li><a href=\"/a\">A</a></li></ul></body></html>";
    expect(markCurrentNavigation(noNav, "/a")).toBe(noNav);
  });

  it("handles missing class attributes, entities, and existing state", () => {
    const html = markCurrentNavigation(
      `<nav id='pages-nav'><ul><li><input checked type=checkbox />
        <ul><li><a href="/a&amp;b">A</a></li><li><a href=/c class=current>C</a></li></ul>
      </li></ul></nav>`,
      "/a&b",
    );

    expect(html).toContain('<a class="current" href="/a&amp;b">A</a>');
    expect(html).toContain("<input checked type=checkbox />");
    expect(html.match(/checked/g)).toHaveLength(1);
  });

  it("ignores markup inside comments and raw-text elements", () => {
    const html = `<nav id="pages-nav"><ul>
      <!-- <li><input id="commented"><a href="/x">X</a></li> -->
      <script type="application/json">"<li><input id=\\"script\\"><a href=\\"/x\\">"</script>
      <li><input id="real" type="checkbox"><ul><li><a href="/x">X</a></li></ul></li>
    </ul></nav>`;
    const result = markCurrentNavigation(html, "/x");

    expect(result).toContain('<input id="real" type="checkbox" checked>');
    expect(result).toContain('<!-- <li><input id="commented"><a href="/x">X</a></li> -->');
    expect(result).toContain('<input id=\\"script\\"><a href=\\"/x\\">');
  });

  it("recovers from implicitly closed list items", () => {
    const html = markCurrentNavigation(
      `<nav id="pages-nav"><ul>
        <li><input id="A"><a href="/a">A</a>
        <li><input id="B"><ul><li><a href="/b/c">C</a></ul>
      </ul></nav>`,
      "/b/c",
    );

    expect(html).toContain('<input id="B" checked>');
    expect(html).toContain('<input id="A">');
  });
});

describe("rewriteDashboardRootLinks", () => {
  it("routes docs-root links to the preview alias instead of the dashboard", () => {
    const html = rewriteDashboardRootLinks(
      `<a href="/">Home</a><a href='/#top'>Top</a><a href=/>Bare</a>` +
        `<a href="/guide">Guide</a><a href="//evil.example/">X</a>` +
        `<link rel="canonical" href="/">`,
    );

    expect(html).toBe(
      `<a href="/?preview=1">Home</a><a href='/?preview=1#top'>Top</a>` +
        `<a href="/?preview=1">Bare</a><a href="/guide">Guide</a>` +
        `<a href="//evil.example/">X</a><link rel="canonical" href="/">`,
    );
  });
});

describe("rewritePreviewHtml", () => {
  it("marks the root page before rewriting its links", () => {
    const html = rewritePreviewHtml(
      '<nav id="pages-nav"><ul><li><a href="/">Docs</a></li></ul></nav>',
      "/",
    );

    expect(html).toBe(
      '<nav id="pages-nav"><ul><li><a class="current" href="/?preview=1">Docs</a></li></ul></nav>',
    );
  });
});
