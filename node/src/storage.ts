import * as fs from "node:fs";
import * as path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  SubsetsError,
  type Tree,
  type Registry,
  type Operation,
  type Journal,
} from "./types.js";
export const equal = isDeepStrictEqual;
export const absolute = (p: string) =>
  path.resolve(
    p === "~"
      ? os.homedir()
      : p.startsWith("~/")
        ? path.join(os.homedir(), p.slice(2))
        : p,
  );
export const inside = (p: string, root: string) =>
  p === root || p.startsWith(root + path.sep);
export function exists(p: string) {
  try {
    fs.lstatSync(p);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
export function read<T>(p: string, fallback: T): T {
  return exists(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as T) : fallback;
}
export function safeParents(p: string) {
  for (let q = absolute(p); ; q = path.dirname(q)) {
    if (exists(q) && fs.lstatSync(q).isSymbolicLink())
      throw new SubsetsError("Refusing a symlink destination or parent: " + q);
    if (path.dirname(q) === q) break;
  }
}
export function save(p: string, value: unknown) {
  safeParents(p);
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  const tmp = p + ".tmp-" + randomUUID();
  const fd = fs.openSync(tmp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, p);
  const dir = fs.openSync(path.dirname(p), "r");
  try {
    fs.fsyncSync(dir);
  } finally {
    fs.closeSync(dir);
  }
}
export function snapshot(p: string, budget = { count: 0 }, depth = 0): Tree {
  if (++budget.count > 20000 || depth > 64)
    throw new SubsetsError("Tree exceeds 20000 entries or 64 levels: " + p);
  if (!exists(p)) return null;
  const st = fs.lstatSync(p),
    mode = st.mode & 0o7777;
  if (st.isSymbolicLink())
    return { type: "link", target: fs.readlinkSync(p), mode };
  if (st.isFile()) {
    const h = createHash("sha256"),
      fd = fs.openSync(p, "r"),
      buffer = Buffer.alloc(1024 * 1024);
    try {
      let size;
      while ((size = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0)
        h.update(buffer.subarray(0, size));
    } finally {
      fs.closeSync(fd);
    }
    return { type: "file", sha256: h.digest("hex"), mode };
  }
  if (st.isDirectory()) {
    const entries: Record<string, Tree> = {};
    for (const name of fs.readdirSync(p).sort())
      entries[name] = snapshot(path.join(p, name), budget, depth + 1);
    return { type: "directory", mode, entries };
  }
  throw new SubsetsError("Unsupported file type: " + p);
}
export function copy(source: string, target: string) {
  const tree = snapshot(source);
  if (!tree) throw new SubsetsError("Missing source: " + source);
  const walk = (s: string, t: string, node: NonNullable<Tree>) => {
    if (node.type === "link") fs.symlinkSync(node.target, t);
    else if (node.type === "file") {
      fs.copyFileSync(s, t, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(t, node.mode);
    } else {
      fs.mkdirSync(t, { mode: 0o700 });
      for (const [name, child] of Object.entries(node.entries))
        if (child) walk(path.join(s, name), path.join(t, name), child);
      fs.chmodSync(t, node.mode);
    }
  };
  walk(source, target, tree);
}
export function remove(p: string) {
  if (exists(p)) fs.rmSync(p, { recursive: true, force: false });
}
export function textOperation(
  p: string,
  expected: Tree,
  payload: string,
  mode = 0o600,
): Operation {
  return {
    path: p,
    expected,
    desired: {
      type: "file",
      sha256: createHash("sha256").update(payload).digest("hex"),
      mode,
    },
    payload,
  };
}
export function payloadOperation(p: string, expected: Tree, value: unknown) {
  return textOperation(p, expected, JSON.stringify(value, null, 2) + "\n");
}
export class Store {
  readonly path: string;
  readonly registry: string;
  constructor(p?: string) {
    this.path = absolute(
      p ??
        process.env.SUBSETS_HOME ??
        path.join(
          process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local/share"),
          "subsets",
          "node",
        ),
    );
    this.registry = path.join(this.path, "registry.json");
  }
  load(): Registry {
    safeParents(this.registry);
    const data = read<Registry>(this.registry, {
      version: 2,
      roots: {},
      skills: {},
      groups: { core: [] },
      activeGroups: [],
      searchRoots: {},
    });
    if (
      data.version !== 2 ||
      !data.roots ||
      !data.skills ||
      !data.groups ||
      !Array.isArray(data.activeGroups)
    )
      throw new SubsetsError(
        "Expected a native Node registry (version 2); use a separate --state directory for the Python app",
      );
    for (const [name, members] of Object.entries(data.groups)) {
      if (
        !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name) ||
        !Array.isArray(members) ||
        !members.every((id) => typeof id === "string")
      )
        throw new SubsetsError("Invalid group in registry: " + name);
    }
    for (const [id, root] of Object.entries(data.roots)) {
      if (
        !root ||
        !path.isAbsolute(root.path) ||
        !root.baseline ||
        !root.protected ||
        !root.marker ||
        root.id !== id
      )
        throw new SubsetsError("Invalid managed root in registry: " + id);
    }
    for (const [id, skill] of Object.entries(data.skills)) {
      if (
        !skill ||
        !/^[a-z0-9][a-z0-9-]{0,63}$/.test(skill.name) ||
        !path.isAbsolute(skill.source) ||
        !data.roots[skill.rootId] ||
        id !== skill.rootId + ":" + skill.name
      )
        throw new SubsetsError("Invalid managed skill in registry: " + id);
    }
    data.searchRoots ??= {};
    return data;
  }
  lock<T>(fn: () => T, allowPending = false): T {
    safeParents(this.path);
    fs.mkdirSync(this.path, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.path, 0o700);
    const lock = path.join(this.path, "node-lock");
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST")
        throw new SubsetsError(
          "Another operation owns " +
            lock +
            ". If its recorded process has stopped, remove only this lock directory before recovery.",
        );
      throw e;
    }
    save(path.join(lock, "owner.json"), {
      pid: process.pid,
      host: os.hostname(),
      started: new Date().toISOString(),
    });
    try {
      if (!allowPending) {
        const pending = this.history().find((j) =>
          ["applying", "rolling-back", "failed"].includes(j.status),
        );
        if (pending)
          throw new SubsetsError(
            "Recover the unfinished transaction with rollback: " + pending.id,
          );
      }
      return fn();
    } finally {
      remove(lock);
    }
  }
  transaction(
    operations: Operation[],
    label: string,
    fault?: (index: number) => void,
  ) {
    for (const op of operations) {
      safeParents(path.dirname(op.path));
      if (!equal(snapshot(op.path), op.expected))
        throw new SubsetsError(
          "Destination changed; preserve edits: " + op.path,
        );
      if (op.source && !equal(snapshot(op.source), op.desired))
        throw new SubsetsError("Source changed: " + op.source);
    }
    const id = randomUUID().replaceAll("-", ""),
      run = path.join(this.path, "transactions", id),
      file = path.join(run, "journal.json");
    fs.mkdirSync(run, { recursive: true, mode: 0o700 });
    const journal: Journal = { id, label, status: "applying", operations };
    save(file, journal);
    try {
      for (const [i, op] of operations.entries()) {
        const backup = path.join(run, "backups", String(i));
        fs.mkdirSync(path.dirname(backup), { recursive: true, mode: 0o700 });
        if (!equal(snapshot(op.path), op.expected))
          throw new SubsetsError(
            "Destination changed during apply: " + op.path,
          );
        if (op.expected) copy(op.path, backup);
        if (!equal(snapshot(backup), op.expected))
          throw new SubsetsError("Backup verification failed: " + op.path);
        op.phase = "backed-up";
        save(file, journal);
        if (!equal(op.desired, op.expected)) {
          fs.mkdirSync(path.dirname(op.path), { recursive: true });
          const stage = path.join(
            path.dirname(op.path),
            ".subsets-stage-" + id + "-" + i,
          );
          if (exists(stage))
            throw new SubsetsError("Unexpected staging path: " + stage);
          if (op.desired) {
            if (op.payload !== undefined) {
              fs.writeFileSync(stage, op.payload, { flag: "wx", mode: 0o600 });
              fs.chmodSync(stage, op.desired.mode);
            } else if (op.source) copy(op.source, stage);
            else throw new SubsetsError("Missing operation source");
            if (!equal(snapshot(stage), op.desired))
              throw new SubsetsError("Staged source changed: " + op.path);
          }
          if (!equal(snapshot(op.path), op.expected))
            throw new SubsetsError(
              "Destination changed before replacement: " + op.path,
            );
          op.stage = stage;
          op.phase = "replacing";
          save(file, journal);
          remove(op.path);
          fault?.(i);
          if (op.desired) fs.renameSync(stage, op.path);
        }
        if (!equal(snapshot(op.path), op.desired))
          throw new SubsetsError(
            "Installation verification failed: " + op.path,
          );
        op.phase = "complete";
        save(file, journal);
      }
      journal.status = "complete";
      save(file, journal);
      return id;
    } catch (e) {
      journal.status = "failed";
      save(file, journal);
      throw e;
    }
  }
  rollback(id: string) {
    if (!/^[a-f0-9]{32}$/.test(id))
      throw new SubsetsError("Use the transaction ID shown by history");
    const run = path.join(this.path, "transactions", id),
      file = path.join(run, "journal.json");
    safeParents(file);
    const j = read<Journal | null>(file, null);
    if (!j) throw new SubsetsError("Unknown transaction: " + id);
    if (j.status === "rolled-back") return id;
    for (const [i, op] of j.operations.entries()) {
      if (!op.phase) continue;
      safeParents(path.dirname(op.path));
      const permitted = [op.expected, op.desired];
      if (["replacing", "restoring"].includes(op.phase)) permitted.push(null);
      if (!permitted.some((tree) => equal(tree, snapshot(op.path))))
        throw new SubsetsError("Rollback preserves later edits at " + op.path);
      if (!equal(snapshot(path.join(run, "backups", String(i))), op.expected))
        throw new SubsetsError("Rollback backup changed: " + op.path);
    }
    j.status = "rolling-back";
    save(file, j);
    for (let i = j.operations.length - 1; i >= 0; i--) {
      const op = j.operations[i]!;
      if (!op.phase) continue;
      if (!equal(snapshot(op.path), op.expected)) {
        const stage = path.join(
          path.dirname(op.path),
          ".subsets-restore-" + id + "-" + i,
        );
        if (op.expected && !exists(stage))
          copy(path.join(run, "backups", String(i)), stage);
        if (op.expected && !equal(snapshot(stage), op.expected))
          throw new SubsetsError("Rollback staging changed: " + op.path);
        op.phase = "restoring";
        save(file, j);
        remove(op.path);
        if (op.expected) fs.renameSync(stage, op.path);
      }
      if (!equal(snapshot(op.path), op.expected))
        throw new SubsetsError("Rollback verification failed: " + op.path);
      if (op.stage && equal(snapshot(op.stage), op.desired)) remove(op.stage);
    }
    j.status = "rolled-back";
    save(file, j);
    return id;
  }
  history(): Journal[] {
    const base = path.join(this.path, "transactions");
    if (!exists(base)) return [];
    safeParents(base);
    return fs
      .readdirSync(base)
      .filter((n) => /^[a-f0-9]{32}$/.test(n))
      .map((n) => path.join(base, n, "journal.json"))
      .filter(exists)
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      .map((p) => {
        safeParents(p);
        return read<Journal>(p, {
          id: "",
          status: "",
          label: "",
          operations: [],
        });
      });
  }
}
