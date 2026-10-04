export type Tree =
  | null
  | { type: "file"; sha256: string; mode: number }
  | { type: "link"; target: string; mode: number }
  | { type: "directory"; mode: number; entries: Record<string, Tree> };
export interface Root {
  id: string;
  path: string;
  client: string;
  scope: string;
  owner: string;
}
export interface Skill {
  id: string;
  name: string;
  description: string;
  path: string;
  root: string;
  client: string;
  scope: string;
  owner: string;
  issue: string;
}
export interface ManagedRoot extends Root {
  baseline: Record<string, Tree>;
  protected: Record<string, Tree>;
  marker: Tree;
}
export interface ManagedSkill {
  name: string;
  description: string;
  rootId: string;
  source: string;
  origin: string;
}
export interface Registry {
  version: 2;
  roots: Record<string, ManagedRoot>;
  skills: Record<string, ManagedSkill>;
  groups: Record<string, string[]>;
  activeGroups: string[];
  searchRoots: Record<string, string>;
}
export interface Operation {
  path: string;
  expected: Tree;
  desired: Tree;
  source?: string;
  payload?: string;
  action?: string;
  skill?: string;
  phase?: string;
  stage?: string;
}
export interface Journal {
  id: string;
  label: string;
  status: string;
  operations: Operation[];
}
export interface Plan {
  groups: string[];
  selected: string[];
  operations: Operation[];
  restartRequired: true;
}
export class SubsetsError extends Error {}
