import * as fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import * as discovery from "./discovery.js";
import {
  Store,
  absolute,
  inside,
  exists,
  snapshot,
  copy,
  safeParents,
  payloadOperation,
  equal,
} from "./storage.js";
import {
  SubsetsError,
  type Root,
  type Skill,
  type Plan,
  type Operation,
  type Tree,
} from "./types.js";
export function groupName(name: string) {
  if (!discovery.NAME.test(name))
    throw new SubsetsError(
      "Group names use lowercase letters, digits and hyphens (1–64 characters)",
    );
  if (
    [
      "group",
      "dry-run",
      "json",
      "help",
      "version",
      "state",
      "project",
      "root",
      "no-plugins",
      "backend",
    ].includes(name)
  )
    throw new SubsetsError("Group name conflicts with a CLI option: " + name);
}
export class Manager {
  constructor(
    readonly store = new Store(),
    readonly home = os.homedir(),
    readonly project?: string,
    readonly extra: string[] = [],
    readonly plugins = true,
  ) {}
  inventory() {
    const d = this.store.load(),
      roots = discovery.roots(
        this.home,
        this.project,
        [...this.extra, ...Object.keys(d.searchRoots)],
        this.plugins,
      );
    for (const r of Object.values(d.roots))
      if (!roots.some((x) => x.path === r.path))
        roots.push(discovery.root(r.path, r.client, r.scope));
    for (const r of roots) {
      if (d.searchRoots[r.path] === "readonly" && r.owner === "unmanaged")
        r.owner = "declared read-only";
      if (d.roots[r.id]) r.owner = "subsets";
    }
    const { skills, warnings } = discovery.scan(roots);
    for (const [id, s] of Object.entries(d.skills))
      if (!skills.some((x) => x.id === id)) {
        const r = d.roots[s.rootId];
        if (!r) throw new SubsetsError("Missing root for " + id);
        skills.push({
          id,
          name: s.name,
          description: s.description,
          path: s.source,
          root: r.path,
          client: r.client,
          scope: r.scope,
          owner: "subsets",
          issue: "",
        });
      }
    return { roots, skills, warnings };
  }
  findRoot(ref: string) {
    const matches = this.inventory().roots.filter(
      (r) => r.id === ref || r.path === absolute(ref),
    );
    if (matches.length !== 1)
      throw new SubsetsError(
        "Unknown root; run subsets roots or pass --root PATH",
      );
    return matches[0];
  }
  configureRoot(p: string, owner = "readonly") {
    p = absolute(p);
    if (!exists(p) || !fs.statSync(p).isDirectory())
      throw new SubsetsError("Search root must be an existing skill directory");
    return this.store.lock(() => {
      const d = this.store.load();
      if (Object.values(d.roots).some((r) => r.path === p))
        throw new SubsetsError("This folder is already managed");
      d.searchRoots[p] = owner;
      return {
        path: p,
        owner,
        transaction: this.store.transaction(
          [
            payloadOperation(
              this.store.registry,
              snapshot(this.store.registry),
              d,
            ),
          ],
          "register search root " + p,
        ),
      };
    });
  }
  canonical(skill: Skill) {
    if (skill.issue)
      throw new SubsetsError("Cannot import invalid skill: " + skill.issue);
    if (fs.lstatSync(skill.path).isSymbolicLink())
      throw new SubsetsError("Linked skills retain their source owner");
    const tree = snapshot(skill.path);
    if (!tree) throw new SubsetsError("Missing skill source");
    const walk = (p: string, t: Tree) => {
      if (t?.type === "link") {
        if (
          path.isAbsolute(t.target) ||
          !inside(fs.realpathSync(p), fs.realpathSync(skill.path))
        )
          throw new SubsetsError(
            "External resource symlink requires author review: " + p,
          );
      }
      if (t?.type === "directory")
        for (const [n, c] of Object.entries(t.entries))
          walk(path.join(p, n), c);
    };
    walk(skill.path, tree);
    const digest = createHash("sha256")
        .update(JSON.stringify(tree))
        .digest("hex"),
      source = path.join(this.store.path, "library", skill.id, digest);
    safeParents(source);
    if (!exists(source)) {
      fs.mkdirSync(path.dirname(source), { recursive: true, mode: 0o700 });
      copy(skill.path, source);
    }
    if (!equal(snapshot(skill.path), tree) || !equal(snapshot(source), tree))
      throw new SubsetsError("Source changed while importing: " + skill.path);
    return { source, tree };
  }
  adopt(ref: string) {
    return this.store.lock(() => {
      const r = this.findRoot(ref),
        d = this.store.load();
      if (d.roots[r.id]) {
        this.validateRoot(d.roots[r.id]);
        return { root: r.id, alreadyManaged: true };
      }
      safeParents(r.path);
      if (r.owner !== "unmanaged")
        throw new SubsetsError(
          r.owner + " owns " + r.path + "; use its backend",
        );
      if (inside(this.store.path, r.path) || inside(r.path, this.store.path))
        throw new SubsetsError("Skill root and private state must not overlap");
      for (const other of Object.values(d.roots))
        if (inside(r.path, other.path) || inside(other.path, r.path))
          throw new SubsetsError("Managed roots must not overlap");
      const marker = path.join(r.path, ".subsets-owner.json");
      if (exists(marker))
        throw new SubsetsError("Folder already has an ownership marker");
      const { skills, warnings } = discovery.scan([r]),
        baseline: Record<string, Tree> = {},
        protectedSkills: Record<string, Tree> = {},
        adopted: string[] = [];
      for (const skill of skills) {
        if (skill.owner !== "unmanaged" || skill.issue) {
          protectedSkills[skill.name] = snapshot(skill.path);
          warnings.push(
            "Preserved " + skill.name + ": " + (skill.issue || skill.owner),
          );
          continue;
        }
        const { source, tree } = this.canonical(skill);
        d.skills[skill.id] = {
          name: skill.name,
          description: skill.description,
          rootId: r.id,
          source,
          origin: skill.path,
        };
        adopted.push(skill.id);
        baseline[skill.name] = tree;
      }
      const op = payloadOperation(marker, null, {
          version: 2,
          store: this.store.path,
          root: r.id,
        }),
        current = "current-" + r.id;
      if (d.groups[current])
        throw new SubsetsError("Adoption group already exists");
      d.roots[r.id] = {
        ...r,
        owner: "subsets",
        baseline,
        protected: protectedSkills,
        marker: op.desired,
      };
      d.groups[current] = adopted;
      d.activeGroups = [...new Set([...d.activeGroups, current])].sort();
      for (const [name, tree] of Object.entries({
        ...baseline,
        ...protectedSkills,
      }))
        if (!equal(snapshot(path.join(r.path, name)), tree))
          throw new SubsetsError("Skill changed during adoption: " + name);
      return {
        root: r.id,
        adopted,
        preserved: Object.keys(protectedSkills),
        warnings,
        transaction: this.store.transaction(
          [
            op,
            payloadOperation(
              this.store.registry,
              snapshot(this.store.registry),
              d,
            ),
          ],
          "adopt " + r.path,
        ),
      };
    });
  }
  validateRoot(r: ReturnType<Store["load"]>["roots"][string]) {
    safeParents(r.path);
    if (!equal(snapshot(path.join(r.path, ".subsets-owner.json")), r.marker))
      throw new SubsetsError("Ownership marker changed: " + r.path);
    if (
      !["unmanaged", "subsets registry"].includes(
        discovery.rootOwner(r.path, this.home),
      )
    )
      throw new SubsetsError("Another installer has claimed " + r.path);
    for (const [name, tree] of Object.entries({
      ...r.baseline,
      ...r.protected,
    }))
      if (!equal(snapshot(path.join(r.path, name)), tree))
        throw new SubsetsError(
          "Skill drift; preserve edits before applying: " +
            path.join(r.path, name),
        );
  }
  resolve(ref: string) {
    const matches = Object.entries(this.store.load().skills).filter(
      ([id, s]) => id === ref || s.name === ref,
    );
    if (matches.length !== 1)
      throw new SubsetsError(
        (matches.length
          ? "Ambiguous skill name; use root-qualified ID: "
          : "Unknown skill: ") + ref,
      );
    return matches[0][0];
  }
  importSkill(ref: string, target: string) {
    return this.store.lock(() => {
      const matches = this.inventory().skills.filter(
        (s) => s.id === ref || s.name === ref,
      );
      if (matches.length !== 1)
        throw new SubsetsError("Unknown or ambiguous source skill: " + ref);
      const skill = matches[0],
        r = this.findRoot(target),
        d = this.store.load();
      if (!d.roots[r.id]) throw new SubsetsError("Adopt the target root first");
      this.validateRoot(d.roots[r.id]);
      if (
        ["package", "plugin"].includes(skill.owner) ||
        ["plugin", "system"].includes(skill.scope)
      )
        throw new SubsetsError("Package/plugin skills retain their owners");
      const id = r.id + ":" + skill.name;
      if (d.skills[id] || exists(path.join(r.path, skill.name)))
        throw new SubsetsError("Destination already exists: " + skill.name);
      const { source } = this.canonical(skill);
      d.skills[id] = {
        name: skill.name,
        description: skill.description,
        rootId: r.id,
        source,
        origin: skill.path,
      };
      d.roots[r.id].baseline[skill.name] = null;
      return {
        skill: id,
        active: false,
        transaction: this.store.transaction(
          [
            payloadOperation(
              this.store.registry,
              snapshot(this.store.registry),
              d,
            ),
          ],
          "import " + id,
        ),
      };
    });
  }
  editGroup(action: string, name: string, refs: string[]) {
    groupName(name);
    return this.store.lock(() => {
      const d = this.store.load();
      if (action === "create" ? !!d.groups[name] : !d.groups[name])
        throw new SubsetsError(
          action === "create"
            ? "Group already exists: " + name
            : "Unknown group: " + name,
        );
      const members = new Set(d.groups[name] ?? []);
      for (const ref of refs) {
        const id = this.resolve(ref);
        if (action === "remove") members.delete(id);
        else members.add(id);
      }
      d.groups[name] = [...members].sort();
      return {
        group: name,
        members: d.groups[name],
        transaction: this.store.transaction(
          [
            payloadOperation(
              this.store.registry,
              snapshot(this.store.registry),
              d,
            ),
          ],
          action + " group " + name,
        ),
      };
    });
  }
  plan(groups: string[]): Plan {
    const d = this.store.load();
    if (!Object.keys(d.roots).length)
      throw new SubsetsError(
        "No managed roots. Run subsets roots, then subsets adopt ROOT_ID",
      );
    const requested = [...new Set(["core", ...groups])].sort();
    for (const n of requested)
      if (!d.groups[n]) throw new SubsetsError("Unknown group: " + n);
    const selected = new Set(requested.flatMap((n) => d.groups[n]));
    for (const id of selected)
      if (!d.skills[id])
        throw new SubsetsError("Group references missing managed skills");
    for (const r of Object.values(d.roots)) this.validateRoot(r);
    const operations: Operation[] = [];
    for (const [id, s] of Object.entries(d.skills).sort()) {
      const r = d.roots[s.rootId];
      if (!inside(s.source, path.join(this.store.path, "library")))
        throw new SubsetsError("Canonical source escapes library");
      safeParents(s.source);
      const checked = discovery.inspect(
        s.source,
        discovery.root(path.dirname(s.source), r.client, r.scope),
        s.name,
      );
      if (checked.issue)
        throw new SubsetsError(
          "Canonical source needs repair: " + checked.issue,
        );
      const tree = snapshot(s.source);
      if (!tree) throw new SubsetsError("Canonical source is missing");
      const desired = selected.has(id) ? tree : null,
        expected = r.baseline[s.name] ?? null;
      operations.push({
        path: path.join(r.path, s.name),
        ...(desired ? { source: s.source } : {}),
        expected,
        desired,
        action: equal(expected, desired)
          ? "unchanged"
          : desired
            ? "activate"
            : "deactivate",
        skill: id,
      });
      r.baseline[s.name] = desired;
    }
    d.activeGroups = requested;
    operations.push(
      payloadOperation(this.store.registry, snapshot(this.store.registry), d),
    );
    return {
      groups: requested,
      selected: [...selected].sort(),
      operations,
      restartRequired: true,
    };
  }
  apply(groups: string[], reviewed?: Plan, fault?: (index: number) => void) {
    return this.store.lock(() => {
      const plan = this.plan(groups);
      if (reviewed && !equal(plan, reviewed))
        throw new SubsetsError("Plan changed since preview; review it again");
      if (plan.operations.every((op) => equal(op.expected, op.desired)))
        return { changed: 0, groups: plan.groups, restartRequired: true };
      const transaction = this.store.transaction(
        plan.operations,
        "apply " + groups.join(","),
        fault,
      );
      return {
        transaction,
        changed: plan.operations.filter(
          (op) => op.action && op.action !== "unchanged",
        ).length,
        groups: plan.groups,
        restartRequired: true,
      };
    });
  }
  verify() {
    const d = this.store.load();
    for (const r of Object.values(d.roots)) this.validateRoot(r);
    return {
      roots: Object.keys(d.roots).length,
      skills: Object.keys(d.skills).length,
      activeGroups: d.activeGroups,
      verified: true,
    };
  }
}
