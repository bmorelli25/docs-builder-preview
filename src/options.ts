import { Command, InvalidArgumentError } from "commander";

export interface CliOptions {
  repositoryPath: string;
  base?: string;
  docsPort?: number;
  port: number;
  fetch: boolean;
  open: boolean;
}

function parsePort(option: "--docs-port" | "--port") {
  return (value: string): number => {
    const port = Number(value);

    if (!/^\d+$/.test(value) || port < 1 || port > 65535) {
      throw new InvalidArgumentError(
        `${option} must be a decimal integer between 1 and 65535 (received "${value}")`,
      );
    }

    return port;
  };
}

export function parseOptions(argv: string[]): CliOptions {
  const program = new Command()
    .name("docs-builder-preview")
    .argument("[repository-path]")
    .option("--base <ref>")
    .option(
      "--docs-port <port>",
      "use an existing docs-builder server",
      parsePort("--docs-port"),
    )
    .option("--port <port>", "set the review app port", parsePort("--port"), 4173)
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
