import { Command } from "commander";

export interface CliOptions {
  repositoryPath: string;
  base?: string;
  docsPort?: number;
  port: number;
  fetch: boolean;
  open: boolean;
}

function parsePort(value: string): number {
  return Number.parseInt(value, 10);
}

export function parseOptions(argv: string[]): CliOptions {
  const program = new Command()
    .name("docs-builder-preview")
    .argument("[repository-path]")
    .option("--base <ref>")
    .option("--docs-port <port>", "use an existing docs-builder server", parsePort)
    .option("--port <port>", "set the review app port", parsePort, 4173)
    .option("--no-fetch")
    .option("--no-open");

  program.parse(argv, { from: "user" });

  const [repositoryPath = process.cwd()] = program.args;
  const options = program.opts<{
    base?: string;
    docsPort?: number;
    port: number;
    fetch: boolean;
    open: boolean;
  }>();

  return {
    repositoryPath,
    base: options.base,
    docsPort: options.docsPort,
    port: options.port,
    fetch: options.fetch,
    open: options.open,
  };
}
