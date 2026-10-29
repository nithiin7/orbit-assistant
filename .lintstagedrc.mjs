// Runs targeted checks on staged files only. Full checks run in CI.
const WEB_DIR = "apps/web/";
const ESLINT_EXTENSIONS = /\.(?:[cm]?js|tsx?)$/;

const quote = (files) => files.map((file) => JSON.stringify(file)).join(" ");

export default {
  "*": (files) => {
    const relative = (file) => file.slice(process.cwd().length + 1);
    const webScripts = files.filter(
      (file) => relative(file).startsWith(WEB_DIR) && ESLINT_EXTENSIONS.test(file),
    );
    const python = files.filter((file) => file.endsWith(".py"));

    const commands = [];
    if (webScripts.length > 0) {
      commands.push(
        `pnpm --filter @orbit/web exec eslint --fix --max-warnings=0 --no-warn-ignored ${quote(webScripts)}`,
      );
    }
    commands.push(`prettier --write --ignore-unknown ${quote(files)}`);
    if (python.length > 0) {
      commands.push(`uv run --package orbit-api ruff check --fix ${quote(python)}`);
      commands.push(`uv run --package orbit-api ruff format ${quote(python)}`);
    }
    return commands;
  },
};
