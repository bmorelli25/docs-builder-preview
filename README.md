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

The command starts or reuses docs-builder, starts the review app on
`127.0.0.1`, and opens it in the default browser. It watches the repository,
rebuilds review data after changes, and refreshes connected previews. Press
Ctrl+C to stop services started by the command. A docs-builder server that was
already running is never stopped.

### Options

```text
--base <ref>        Compare against this Git ref
--docs-port <port>  Use docs-builder on this port (default: 3000)
--port <port>       Run the review app on this port (default: 4173)
--no-fetch          Do not refresh the selected remote base
--no-open           Do not open a browser
-h, --help          Show command help
```

By default, the comparison base is the current pull request base when `gh` can
resolve it, then `origin/main`, then `main`.
