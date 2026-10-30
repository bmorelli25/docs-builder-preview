# docs-builder-preview

Review every documentation change on the current branch in a local
docs-builder preview.

## Requirements

- Node.js 20 or later
- Git
- `docs-builder` on `PATH`, unless you use `--docs-port`

## Install

From this repository:

```sh
npm install
npm run build
npm link
```

This installs the `docs-builder-preview` command globally through npm.

## Usage

Run the command in a docs repository:

```sh
docs-builder-preview
```

Or pass the repository path:

```sh
docs-builder-preview /path/to/docs-content
```

The command starts the review dashboard first, then starts or reuses
docs-builder on port 3000. It recognizes a running docs-builder by its HTML
live-reload marker. If another service occupies port 3000, it launches
docs-builder on a free port instead.

The review app listens on `127.0.0.1` and opens in the default browser. If its
requested port is occupied, it selects a free localhost port and prints the
actual URL. The dashboard stays available while docs-builder starts and after
a startup or build failure, where it shows recent builder output and preview
requests return HTTP 503.

The command watches the repository, rebuilds review data after changes, and
refreshes connected previews. Press Ctrl+C to stop services started by the
command. A docs-builder server that was already running is never stopped.

Pass `--docs-port` only to use an existing compatible docs-builder server on a
specific port. The dashboard reports a clear failure if that server is absent
or incompatible. The command never launches a new docs-builder process when
this option is present.

### Options

```text
--base <ref>        Compare against this Git ref
--docs-port <port>  Require an existing docs-builder server on this port
--port <port>       Run the review app on this port (default: 4173)
--no-fetch          Do not refresh the selected remote base
--no-open           Do not open a browser
-h, --help          Show command help
```

By default, the comparison base is the current pull request base when `gh` can
resolve it, then `origin/main`, then `main`.
