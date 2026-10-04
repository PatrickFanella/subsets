#!/usr/bin/env node
import { Manager } from "./manager.js";
import { Store } from "./storage.js";
import { Legacy, backend, editGroup } from "./legacy.js";
import { SubsetsError } from "./types.js";
export const VERSION = "0.2.0-alpha.3";
const HELP = `subsets ${VERSION} — All your skills. Only the set you need.

Usage: subsets [options] [command]

Commands:
  tui                         Interactive manager (default)
  discover [--filter TEXT]    Discover local skill metadata
  roots | groups              List folders or groups
  root add PATH [--owner readonly|unmanaged]
  adopt ROOT_ID               Explicitly adopt an unmanaged folder
  import SKILL --to ROOT_ID   Import into an adopted folder, initially inactive
  group create|add|remove NAME [SKILL ...]
  plan|apply --group NAME [--group NAME ...]
  apply --creative-writing [--dry-run]
  verify | history | rollback TRANSACTION_ID

Options (before or after command):
  --state PATH  --project PATH  --root PATH (repeat)  --no-plugins  --json
  --backend auto|subsets|existing   --help   --version

Examples:
  subsets discover --json
  subsets adopt ROOT_ID
  subsets group create creative-writing poetry editing
  subsets apply --creative-writing --dry-run
  subsets rollback TRANSACTION_ID

Standalone mode requires Node only. The existing backend requires Python 3.
https://subsets.subcult.tv · by SUBCULT · https://support.subcult.tv
`;
export async function main(argv = process.argv.slice(2)) {
  let json = false;
  try {
    const values: Record<string, string[]> = {},
      flags = new Set<string>(),
      positional: string[] = [],
      extras: string[] = [];
    const valueFlags = new Set([
      "state",
      "project",
      "root",
      "group",
      "backend",
      "owner",
      "filter",
      "to",
    ]);
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === "--help" || arg === "-h") {
        console.log(HELP);
        return 0;
      }
      if (arg === "--version") {
        console.log(VERSION);
        return 0;
      }
      if (arg.startsWith("--")) {
        const key = arg.slice(2);
        if (valueFlags.has(key)) {
          const value = argv[++i];
          if (!value || value.startsWith("--"))
            throw new SubsetsError("Missing value for --" + key);
          (values[key] ??= []).push(value);
        } else if (["json", "no-plugins", "dry-run"].includes(key))
          flags.add(key);
        else extras.push(arg);
      } else positional.push(arg);
    }
    json = flags.has("json");
    const command = positional.shift() ?? "tui",
      manager = new Manager(
        new Store(values.state?.[0]),
        undefined,
        values.project?.[0] ?? process.cwd(),
        values.root ?? [],
        !flags.has("no-plugins"),
      ),
      legacy = Legacy.find(manager.home),
      owner = values.backend?.[0] ?? "auto";
    if (!["auto", "subsets", "existing"].includes(owner))
      throw new SubsetsError("Invalid --backend: " + owner);
    const allowed: Record<string, string[]> = {
      discover: ["filter"],
      root: ["owner"],
      import: ["to"],
      group: ["backend"],
      plan: ["backend", "group"],
      apply: ["backend", "group"],
    };
    for (const key of Object.keys(values))
      if (
        !["state", "project", "root"].includes(key) &&
        !(allowed[command] ?? []).includes(key)
      )
        throw new SubsetsError(
          "Option --" + key + " is not valid for " + command,
        );
    if (flags.has("dry-run") && !["plan", "apply"].includes(command))
      throw new SubsetsError(
        "--dry-run is supported by plan/apply; other mutations require their explicit command",
      );
    if (extras.length && !["plan", "apply"].includes(command))
      throw new SubsetsError("Unknown option: " + extras[0]);
    const arity = (min: number, max = min) => {
      if (positional.length < min || positional.length > max)
        throw new SubsetsError(
          "Wrong arguments for " +
            command +
            "; run subsets " +
            command +
            " --help",
        );
    };
    let result: unknown;
    switch (command) {
      case "tui":
        arity(0);
        if (!process.stdin.isTTY || !process.stdout.isTTY)
          throw new SubsetsError(
            "The TUI needs an interactive terminal. Use subsets discover --json",
          );
        await (await import("./tui.js")).launch(manager, legacy);
        return 0;
      case "discover":
      case "roots": {
        arity(0);
        const inventory = manager.inventory(),
          other = legacy?.inventory();
        if (other) {
          inventory.roots.push(
            ...other.roots.filter(
              (r) => !inventory.roots.some((x) => x.path === r.path),
            ),
          );
          inventory.skills.push(
            ...other.skills.filter(
              (s) => !inventory.skills.some((x) => x.id === s.id),
            ),
          );
          inventory.warnings.push(...other.warnings);
        }
        if (command === "roots")
          result = { roots: inventory.roots, warnings: inventory.warnings };
        else {
          const filter = (values.filter?.[0] ?? "").toLowerCase();
          result = {
            skills: inventory.skills.filter((s) =>
              [s.name, s.description, s.owner, s.path]
                .join(" ")
                .toLowerCase()
                .includes(filter),
            ),
            warnings: inventory.warnings,
          };
        }
        break;
      }
      case "groups":
        arity(0);
        result = {
          groups: manager.store.load().groups,
          existingProfiles: legacy?.groups() ?? {},
        };
        break;
      case "root":
        arity(2);
        if (positional[0] !== "add")
          throw new SubsetsError("Use root add PATH");
        {
          const owner = values.owner?.[0] ?? "readonly";
          if (!["readonly", "unmanaged"].includes(owner))
            throw new SubsetsError("Invalid --owner");
          result = manager.configureRoot(positional[1], owner);
        }
        break;
      case "adopt":
        arity(1);
        result = manager.adopt(positional[0]);
        break;
      case "import":
        arity(1);
        if (!values.to?.[0])
          throw new SubsetsError("Import needs --to ROOT_ID");
        result = manager.importSkill(positional[0], values.to[0]);
        break;
      case "group":
        arity(2, 1000);
        if (!["create", "add", "remove"].includes(positional[0]))
          throw new SubsetsError("Use group create|add|remove");
        result = editGroup(
          manager,
          legacy,
          positional[0],
          positional[1],
          positional.slice(2),
          owner,
        );
        break;
      case "plan":
      case "apply": {
        arity(0);
        const available = new Set([
          ...Object.keys(manager.store.load().groups),
          ...Object.keys(legacy?.groups() ?? {}),
        ]);
        for (const extra of extras)
          if (!available.has(extra.slice(2)))
            throw new SubsetsError(
              "Unknown option/group " +
                extra +
                "; list names with subsets groups",
            );
        const groups = [
            ...new Set([
              ...(values.group ?? []),
              ...extras.map((s) => s.slice(2)),
            ]),
          ].sort(),
          target = backend(manager, legacy, groups, owner);
        result =
          command === "plan" || flags.has("dry-run")
            ? target.plan(groups)
            : target.apply(groups);
        if (
          (command === "plan" || flags.has("dry-run")) &&
          result &&
          typeof result === "object" &&
          "operations" in result
        ) {
          const p = result as ReturnType<Manager["plan"]>;
          result = {
            ...p,
            operations: p.operations
              .filter((op) => op.action)
              .map(({ path, action, skill }) => ({ path, action, skill })),
          };
        }
        break;
      }
      case "verify":
        arity(0);
        result = manager.verify();
        break;
      case "history":
        arity(0);
        result = {
          transactions: manager.store
            .history()
            .map(({ id, label, status }) => ({ id, label, status })),
        };
        break;
      case "rollback":
        arity(1);
        result = {
          rolledBack: manager.store.lock(
            () => manager.store.rollback(positional[0]),
            true,
          ),
        };
        break;
      default:
        throw new SubsetsError("Unknown command: " + command);
    }
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      json ? JSON.stringify({ error: message }) : "subsets: " + message,
    );
    return 2;
  }
}
// The npm bin is also importable by tests without starting an interactive session.
import { pathToFileURL } from "node:url";
import fs from "node:fs";
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
)
  process.exitCode = await main();
