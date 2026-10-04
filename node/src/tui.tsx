import React, { useState } from "react";
import { render, Box, Text, useInput, useApp, useStdout } from "ink";
import { Manager } from "./manager.js";
import { Legacy, backend, editGroup } from "./legacy.js";
import type { Plan } from "./types.js";
const clean = (s: string) => s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
type Prompt =
  | { kind: "adopt"; ref: string }
  | { kind: "apply"; groups: string[]; owner: string; plan: unknown }
  | { kind: "rollback"; id: string };
export function SubsetsApp({
  manager,
  legacy,
}: {
  manager: Manager;
  legacy?: Legacy;
}) {
  const { exit } = useApp(),
    { stdout } = useStdout();
  const [tick, setTick] = useState(0),
    [view, setView] = useState("skills"),
    [cursor, setCursor] = useState(0),
    [picked, setPicked] = useState<string[]>([]),
    [groups, setGroups] = useState<string[]>(
      manager.store.load().activeGroups.map((n) => "local:" + n),
    ),
    [notice, setNotice] = useState(
      "Discovery is read-only. Adopt an unmanaged folder to begin.",
    ),
    [query, setQuery] = useState(""),
    [entry, setEntry] = useState<"search" | "group" | null>(null),
    [text, setText] = useState(""),
    [prompt, setPrompt] = useState<Prompt | null>(null);
  void tick;
  const inventory = manager.inventory(),
    other = legacy?.inventory();
  if (other) {
    inventory.skills.push(
      ...other.skills.filter(
        (s) => !inventory.skills.some((x) => x.id === s.id),
      ),
    );
    inventory.roots.push(
      ...other.roots.filter(
        (r) => !inventory.roots.some((x) => x.path === r.path),
      ),
    );
  }
  const skills = inventory.skills.filter((s) =>
      [s.name, s.description, s.path]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
    ),
    groupRows = [
      ...Object.entries(manager.store.load().groups)
        .sort()
        .map(([n, m]) => ({
          id: "local:" + n,
          name: n,
          count: m.length,
          owner: "subsets",
        })),
      ...Object.entries(legacy?.groups() ?? {})
        .sort()
        .map(([n, m]) => ({
          id: "existing:" + n,
          name: n,
          count: m.length,
          owner: "existing",
        })),
    ],
    history = manager.store.history(),
    rows =
      view === "skills"
        ? skills
        : view === "roots"
          ? inventory.roots
          : view === "groups"
            ? groupRows
            : history;
  const selected = Math.min(cursor, Math.max(0, rows.length - 1)),
    limit = Math.max(3, Math.min(14, (stdout.rows ?? 24) - 12)),
    start = Math.max(0, selected - limit + 1);
  const refresh = () => {
    setTick((n) => n + 1);
  };
  const perform = (fn: () => unknown) => {
    try {
      const result = fn();
      setNotice(
        JSON.stringify(result) +
          " — restart the agent client after changing active skills.",
      );
      refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    if (entry) {
      if (key.escape) {
        setEntry(null);
        return;
      }
      if (key.return) {
        if (entry === "search") {
          setQuery(text);
          setCursor(0);
        } else
          perform(() => editGroup(manager, legacy, "create", text, picked));
        setEntry(null);
        setText("");
        return;
      }
      if (key.backspace || key.delete) setText((s) => s.slice(0, -1));
      else if (!key.ctrl && !key.meta) setText((s) => s + input);
      return;
    }
    if (prompt) {
      if (input === "n" || key.escape) {
        setPrompt(null);
        return;
      }
      if (input === "y") {
        const p = prompt;
        setPrompt(null);
        perform(() => {
          if (p.kind === "adopt") return manager.adopt(p.ref);
          if (p.kind === "rollback")
            return manager.store.lock(() => manager.store.rollback(p.id), true);
          const target = backend(manager, legacy, p.groups, p.owner);
          return target instanceof Manager
            ? target.apply(p.groups, p.plan as Plan)
            : target.apply(p.groups, p.plan);
        });
      }
      return;
    }
    if (input === "q") {
      exit();
      return;
    }
    if (["1", "2", "3", "4"].includes(input)) {
      setView(
        (
          { 1: "skills", 2: "roots", 3: "groups", 4: "history" } as Record<
            string,
            string
          >
        )[input],
      );
      setCursor(0);
      return;
    }
    if (key.upArrow) setCursor((n) => Math.max(0, n - 1));
    if (key.downArrow) setCursor((n) => Math.min(rows.length - 1, n + 1));
    if (input === "r") {
      refresh();
      setNotice("Rescanned folders and metadata.");
    }
    if (input === "/") {
      setEntry("search");
      setText(query);
      setView("skills");
    }
    if (input === "g") {
      if (!picked.length) {
        setNotice("Pick skills with Space before creating a group.");
        return;
      }
      setEntry("group");
      setText("");
    }
    if (input === " " || key.return) {
      if (view === "skills" && skills[selected]) {
        const id = skills[selected].id;
        setPicked((s) =>
          s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
        );
      }
      if (view === "groups" && groupRows[selected]) {
        const id = groupRows[selected].id;
        setGroups((s) =>
          s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
        );
      }
    }
    if (input === "a" && view === "roots" && inventory.roots[selected])
      setPrompt({ kind: "adopt", ref: inventory.roots[selected].id });
    if (input === "u" && view === "history" && history[selected])
      setPrompt({ kind: "rollback", id: history[selected].id });
    if (input === "p")
      try {
        const owners = new Set(groups.map((g) => g.split(":")[0]));
        if (owners.size > 1)
          throw Error(
            "Select local groups or existing profiles for one apply; they have different owners.",
          );
        const names = groups.map((g) => g.slice(g.indexOf(":") + 1)),
          owner = owners.has("existing")
            ? "existing"
            : owners.has("local")
              ? "subsets"
              : "auto",
          plan = backend(manager, legacy, names, owner).plan(names);
        setPrompt({ kind: "apply", groups: names, owner, plan });
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      }
  });
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        SUBSETS <Text color="gray"> · discover / group / apply</Text>
      </Text>
      <Text color="gray">
        1 Skills 2 Folders 3 Groups 4 Recovery / Search r Rescan q Quit
      </Text>
      <Text>
        Selected groups:{" "}
        <Text color="green">
          {clean(
            groups.map((s) => s.slice(s.indexOf(":") + 1)).join(", ") ||
              "core (always included)",
          )}
        </Text>
      </Text>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={1}
      >
        <Text bold>
          {view.toUpperCase()} · {rows.length} entries
          {query && view === "skills" ? " · " + clean(query) : ""}
        </Text>
        {rows.slice(start, start + limit).map((row, i) => {
          const index = start + i;
          let label: string;
          if (view === "skills") {
            const s = skills[index];
            label =
              (picked.includes(s.id) ? "[x] " : "[ ] ") +
              s.name +
              " · " +
              s.owner +
              (s.issue ? " · needs review" : "");
          } else if (view === "roots") {
            const r = inventory.roots[index];
            label = r.id + " · " + r.owner + " · " + r.path;
          } else if (view === "groups") {
            const g = groupRows[index];
            label =
              (groups.includes(g.id) ? "[x] " : "[ ] ") +
              g.name +
              " · " +
              g.count +
              " skills · " +
              g.owner;
          } else {
            const j = history[index];
            label = j.id + " · " + j.status + " · " + j.label;
          }
          return (
            <Text key={index} color={index === selected ? "cyan" : undefined}>
              {index === selected ? "› " : "  "}
              {clean(label)}
            </Text>
          );
        })}
        {!rows.length && <Text color="gray">No entries in this view.</Text>}
      </Box>
      {view === "skills" && skills[selected] && (
        <Text color="gray">
          {clean(skills[selected].description)}
          {skills[selected].issue ? " — " + clean(skills[selected].issue) : ""}
        </Text>
      )}
      <Text color="gray">
        Space Pick/toggle · g Create group · a Adopt folder · p Preview/apply ·
        u Rollback
      </Text>
      {entry && (
        <Text color="yellow">
          {entry === "search" ? "Search" : "New group name"}: {clean(text)}▌
          (Enter saves, Esc cancels)
        </Text>
      )}
      {prompt && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow">
          <Text bold color="yellow">
            {prompt.kind === "adopt"
              ? "Adopt this folder? Existing skills stay in place; eligible sources are backed up."
              : prompt.kind === "rollback"
                ? "Rollback this transaction? Later edits will stop recovery."
                : "Apply this reviewed selection?"}
          </Text>
          <Text>
            {clean(
              prompt.kind === "apply"
                ? JSON.stringify(
                    prompt.plan instanceof Object && "operations" in prompt.plan
                      ? {
                          ...(prompt.plan as Plan),
                          operations: (prompt.plan as Plan).operations
                            .filter((o) => o.action)
                            .map((o) => ({ action: o.action, skill: o.skill })),
                        }
                      : prompt.plan,
                  )
                : prompt.kind === "adopt"
                  ? prompt.ref
                  : prompt.id,
            )}
          </Text>
          <Text>y Confirm · n Cancel</Text>
        </Box>
      )}
      <Text color="green">{clean(notice)}</Text>
      {!!inventory.warnings.length && (
        <Text color="yellow">{clean(inventory.warnings.join("; "))}</Text>
      )}
    </Box>
  );
}
export async function launch(manager: Manager, legacy?: Legacy) {
  const app = render(<SubsetsApp manager={manager} legacy={legacy} />);
  await app.waitUntilExit();
}
