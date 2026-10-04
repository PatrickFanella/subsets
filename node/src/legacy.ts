import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  exists,
  read,
  snapshot,
  textOperation,
  Store,
  equal,
} from "./storage.js";
import { root, scan } from "./discovery.js";
import { groupName } from "./manager.js";
import { SubsetsError } from "./types.js";
export class Legacy {
  constructor(
    readonly source: string,
    readonly home: string,
  ) {}
  static find(home: string) {
    const link = path.join(home, ".agents/bin/skill-profile");
    if (!exists(link) || !fs.lstatSync(link).isSymbolicLink()) return undefined;
    const source = path.dirname(path.dirname(fs.realpathSync(link)));
    if (
      ![
        "scripts/skill-profile",
        "scripts/optional-clients.py",
        "catalog/qualification.json",
      ].every((p) => exists(path.join(source, p)))
    )
      return undefined;
    return new Legacy(source, home);
  }
  groups() {
    const dir = path.join(this.source, "profiles");
    return Object.fromEntries(
      fs
        .readdirSync(dir)
        .sort()
        .filter((n) => n.endsWith(".txt"))
        .map((n) => [
          n.slice(0, -4),
          fs
            .readFileSync(path.join(dir, n), "utf8")
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter((s) => s && !s.startsWith("#")),
        ]),
    );
  }
  inventory() {
    const reserved = new Set(
      Object.keys(
        read<Record<string, unknown>>(
          path.join(this.source, "catalog/retired-names.json"),
          {},
        ),
      ),
    );
    for (const row of read<Array<{ name: string; scope?: string }>>(
      path.join(this.source, "catalog/proposed-catalog.json"),
      [],
    ))
      if (row.scope !== "optional") reserved.add(row.name);
    for (const name of Object.keys(
      read<Record<string, unknown>>(
        path.join(this.source, "catalog/local-owners.json"),
        {},
      ),
    ))
      reserved.add(name);
    for (const row of read<{ files: Array<{ source: string }> }>(
      path.join(this.source, "catalog/vault-agents.json"),
      { files: [] },
    ).files)
      if (
        path.basename(row.source) === "SKILL.md" &&
        row.source.split("/").includes("skills")
      )
        reserved.add(path.basename(path.dirname(row.source)));
    for (const folder of [
      path.join(this.home, ".codex/skills/.system"),
      path.join(this.source, "shared"),
    ])
      if (exists(folder))
        for (const n of fs.readdirSync(folder))
          if (exists(path.join(folder, n, "SKILL.md"))) reserved.add(n);
    const qualification = read<{ skills: Record<string, { status: string }> }>(
      path.join(this.source, "catalog/qualification.json"),
      { skills: {} },
    );
    for (const [name, row] of Object.entries(qualification.skills))
      if (row.status === "blocked") reserved.add(name);
    const roots = [
        root(
          path.join(this.source, "library/skills"),
          "shared",
          "optional",
          "codex-skills source",
        ),
      ],
      result = scan(roots);
    return {
      roots,
      skills: result.skills.filter((s) => !reserved.has(s.name)),
      warnings: result.warnings,
    };
  }
  editGroup(store: Store, action: string, name: string, refs: string[]) {
    groupName(name);
    if (name === "core")
      throw new SubsetsError("The existing core retains its canonical owners");
    const selected = new Set<string>();
    for (const ref of refs) {
      const rows = this.inventory().skills.filter(
        (s) => s.id === ref || s.name === ref,
      );
      if (rows.length !== 1 || rows[0].issue)
        throw new SubsetsError(
          "Existing profiles require eligible optional skills: " + ref,
        );
      selected.add(rows[0].name);
    }
    return store.lock(() => {
      const groups = this.groups();
      if (action === "create" ? !!groups[name] : !groups[name])
        throw new SubsetsError(
          "Existing profile already exists or is unknown: " + name,
        );
      const p = path.join(this.source, "profiles", name + ".txt"),
        before = snapshot(p),
        members = new Set(groups[name] ?? []);
      for (const n of selected)
        if (action === "remove") members.delete(n);
        else members.add(n);
      const comments = exists(p)
        ? fs
            .readFileSync(p, "utf8")
            .split(/\r?\n/)
            .filter((s) => s.trimStart().startsWith("#"))
        : ["# Profile: " + name];
      const payload = [...comments, ...[...members].sort()].join("\n") + "\n";
      return {
        group: name,
        members: [...members].sort(),
        backend: "codex-skills",
        source: p,
        transaction: store.transaction(
          [textOperation(p, before, payload, before?.mode ?? 0o644)],
          action + " existing profile " + name,
        ),
      };
    });
  }
  command(script: string, args: string[]) {
    const result = spawnSync(
      process.env.SUBSETS_PYTHON ?? "python3",
      ["-B", path.join(this.source, "scripts", script), ...args],
      {
        cwd: this.source,
        encoding: "utf8",
        timeout: 120000,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    if (result.error)
      throw new SubsetsError(
        "Existing backend needs Python 3 and its dependencies; inspect its receipts before retrying: " +
          result.error.message,
      );
    if (result.status !== 0)
      throw new SubsetsError(
        "Existing backend stopped (" +
          script +
          "): " +
          (result.stderr || result.stdout).trim(),
      );
    return result.stdout.trim();
  }
  plan(groups: string[]) {
    for (const n of groups)
      if (!this.groups()[n])
        throw new SubsetsError("Unknown existing profile: " + n);
    const names = groups.filter((n) => n !== "core"),
      flags = names.flatMap((n) => ["--profile", n]);
    return {
      backend: "codex-skills",
      source: this.source,
      groups: groups.length ? groups : ["core"],
      codex: JSON.parse(
        this.command("skill-profile", ["plan", ...names]),
      ) as unknown,
      claude: JSON.parse(
        this.command("optional-clients.py", ["plan", ...flags]),
      ) as unknown,
      restartRequired: true,
    };
  }
  apply(groups: string[], reviewed?: unknown) {
    const plan = this.plan(groups);
    if (reviewed && !equal(plan, reviewed))
      throw new SubsetsError("Existing backend plan changed; preview again");
    const names = groups.filter((n) => n !== "core"),
      flags = names.flatMap((n) => ["--profile", n]),
      codex = this.command("skill-profile", ["activate", ...names]);
    try {
      const claudeReceipt = this.command("optional-clients.py", [
          "apply",
          ...flags,
        ]),
        claudeVerification = JSON.parse(
          this.command("optional-clients.py", ["verify", ...flags]),
        ) as unknown;
      return {
        backend: "codex-skills",
        codex,
        claudeReceipt,
        claudeVerification,
        restartRequired: true,
      };
    } catch (e) {
      throw new SubsetsError(
        "Codex selection changed; Claude did not finish. Preserve backend receipt/state. " +
          String(e),
      );
    }
  }
}
export function backend(
  manager: import("./manager.js").Manager,
  legacy: Legacy | undefined,
  groups: string[],
  owner = "auto",
) {
  if (owner === "existing") {
    if (!legacy) throw new SubsetsError("No existing backend detected");
    return legacy;
  }
  if (owner === "subsets") return manager;
  const local = manager.store.load().groups,
    custom = groups.filter((n) => n !== "core");
  if (custom.length && custom.every((n) => local[n])) return manager;
  if (
    legacy &&
    custom.every((n) => legacy.groups()[n]) &&
    !custom.some((n) => local[n])
  )
    if (custom.length || !Object.keys(manager.store.load().roots).length)
      return legacy;
  return manager;
}
export function editGroup(
  manager: import("./manager.js").Manager,
  legacy: Legacy | undefined,
  action: string,
  name: string,
  refs: string[],
  owner = "auto",
) {
  if (owner === "auto") {
    const skills = manager.store.load().skills;
    owner =
      legacy &&
      !refs.some(
        (ref) =>
          skills[ref] || Object.values(skills).some((s) => s.name === ref),
      ) &&
      (refs.length || !Object.keys(manager.store.load().roots).length)
        ? "existing"
        : "subsets";
  }
  if (owner === "existing") {
    if (!legacy) throw new SubsetsError("No existing backend detected");
    return legacy.editGroup(manager.store, action, name, refs);
  }
  return manager.editGroup(action, name, refs);
}
