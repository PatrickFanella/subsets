"""Interactive discovery, grouping, preview and recovery."""
from __future__ import annotations

import asyncio
import json

from rich.text import Text
from textual import on, work
from textual.app import App, ComposeResult
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.screen import ModalScreen
from textual.widgets import (Button, DataTable, Footer, Header, Input, Label,
                             SelectionList, Static, TabbedContent, TabPane)

from .cli import backend_for, edit_group, printable_plan
from .storage import DeckError


class Confirm(ModalScreen[bool]):
    def __init__(self, title, description):
        super().__init__()
        self.heading, self.description = title, description

    def compose(self) -> ComposeResult:
        with Vertical(classes="dialog"):
            yield Label(self.heading, classes="dialog-title")
            with VerticalScroll():
                yield Static(self.description, markup=False)
            with Horizontal(classes="dialog-buttons"):
                yield Button("Cancel", id="cancel")
                yield Button("Continue", variant="primary", id="confirm")

    def on_button_pressed(self, event):
        self.dismiss(event.button.id == "confirm")


class GroupEditor(ModalScreen[tuple[str, str] | None]):
    def __init__(self, count):
        super().__init__()
        self.count = count

    def compose(self):
        with Vertical(classes="dialog small-dialog"):
            yield Label("Organize selected skills", classes="dialog-title")
            yield Static(f"{self.count} selected skills. Managed skills edit Subsets groups; eligible library skills edit existing profiles.")
            yield Input(placeholder="creative-writing", id="group-name")
            with Horizontal(classes="dialog-buttons"):
                yield Button("Cancel", id="cancel")
                yield Button("Create", variant="primary", id="create")
                yield Button("Add", id="add")
                yield Button("Remove", id="remove")

    def on_mount(self):
        self.query_one("#group-name", Input).focus()

    def on_button_pressed(self, event):
        if event.button.id == "cancel":
            self.dismiss(None)
        else:
            self.dismiss((event.button.id, self.query_one("#group-name", Input).value.strip()))


class Preview(ModalScreen[bool]):
    def __init__(self, proposal):
        super().__init__()
        self.proposal = proposal

    def compose(self):
        with Vertical(classes="dialog"):
            yield Label("Review this selection", classes="dialog-title")
            yield Static("Only listed owned skill paths will change. Start a fresh agent session after applying.")
            with VerticalScroll():
                yield Static(json.dumps(printable_plan(self.proposal), indent=2), markup=False)
            with Horizontal(classes="dialog-buttons"):
                yield Button("Cancel", id="cancel")
                yield Button("Apply selection", variant="primary", id="confirm")

    def on_button_pressed(self, event):
        self.dismiss(event.button.id == "confirm")


class SubsetsApp(App):
    TITLE = "Subsets"
    SUB_TITLE = "Discover · Group · Apply"
    CSS = """
    Screen { background: #111820; }
    Header { background: #203340; }
    #summary { height: 2; padding: 0 2; color: #90cbbd; }
    #main { height: 1fr; }
    #sidebar { width: 30; border-right: solid #30404d; padding: 1; }
    .section-title { color: #90cbbd; text-style: bold; margin-bottom: 1; }
    #groups { height: 1fr; }
    SelectionList { background: #16232e; }
    SelectionList > .selection-list--button,
    SelectionList > .selection-list--button-highlighted { color: #16232e; background: #16232e; }
    SelectionList > .selection-list--button-selected,
    SelectionList > .selection-list--button-selected-highlighted { color: #90cbbd; background: #16232e; }
    #sidebar-note { height: auto; color: #9baab7; margin: 1 0; }
    #workspace { width: 1fr; padding: 0 1; }
    #filter { margin-bottom: 1; }
    TabbedContent { height: 1fr; }
    TabPane { padding: 0; }
    DataTable { height: 1fr; }
    #detail { height: 7; border-top: solid #30404d; padding: 1; }
    #status { height: 2; padding: 0 2; color: #d2dce4; }
    #actions { height: 3; }
    #actions Button { margin-right: 1; min-width: 12; }
    .compact #sidebar { width: 24; }
    .compact #sidebar-note { display: none; }
    .compact #summary, .compact #status { height: 1; }
    .compact #detail { height: 4; padding: 0 1; }
    .compact #filter { margin-bottom: 0; }
    .compact #actions Button { min-width: 9; padding: 0 1; margin-right: 0; }
    .dialog { width: 85%; height: 85%; margin: 2 4; padding: 1 2; background: #20303d; border: thick #90cbbd; }
    .small-dialog { height: 18; }
    .dialog-title { text-style: bold; color: #90cbbd; margin-bottom: 1; }
    .dialog-buttons { height: 3; margin-top: 1; }
    .dialog-buttons Button { margin-right: 1; }
    Confirm, GroupEditor, Preview { align: center middle; background: #000000 65%; }
    """
    BINDINGS = [("q", "quit", "Quit"), ("ctrl+r", "rescan", "Rescan"),
                ("ctrl+g", "group", "Group skills"), ("ctrl+p", "preview", "Preview"),
                ("ctrl+f", "search", "Search")]

    def __init__(self, manager, legacy=None):
        super().__init__()
        self.manager, self.legacy = manager, legacy
        self.skills, self.roots, self.warnings = [], [], []
        self.selected_skills = set()
        self.selected_root = None
        self.selected_transaction = None
        self.current_proposal = None
        self.notice = None

    def compose(self):
        yield Header()
        yield Static("Scanning known skill folders…", id="summary")
        with Horizontal(id="main"):
            with Vertical(id="sidebar"):
                yield Label("SELECT GROUPS", classes="section-title")
                yield SelectionList(id="groups")
                yield Static("Core is included automatically. Existing profiles keep their current backend.", id="sidebar-note")
            with Vertical(id="workspace"):
                yield Input(placeholder="Search name, description, owner or path…", id="filter")
                with TabbedContent(id="tabs"):
                    with TabPane("Skills", id="skills-tab"):
                        yield DataTable(id="skills", cursor_type="row")
                    with TabPane("Folders", id="roots-tab"):
                        yield DataTable(id="roots", cursor_type="row")
                    with TabPane("Recovery", id="history-tab"):
                        yield DataTable(id="history", cursor_type="row")
                yield Static("Enter toggles a skill for group editing. Select a folder to inspect its owner.", id="detail", markup=False)
                with Horizontal(id="actions"):
                    yield Button("Adopt folder", id="adopt")
                    yield Button("Edit group", id="edit-group")
                    yield Button("Preview", variant="primary", id="preview")
                    yield Button("Rollback", id="rollback")
        yield Static("Discovery reads metadata. Nothing is adopted automatically.", id="status", markup=False)
        yield Footer()

    def on_mount(self):
        table = self.query_one("#skills", DataTable)
        for label, width in [("Pick", 4), ("Skill", 28), ("Client", 8), ("Owner", 22), ("Description", 80)]:
            table.add_column(label, width=width)
        self.query_one("#roots", DataTable).add_columns("Root ID", "Client", "Scope", "Owner", "Path")
        self.query_one("#history", DataTable).add_columns("Transaction", "Status", "Operation")
        self.action_rescan()

    def on_resize(self, event):
        self.screen.set_class(event.size.width < 100 or event.size.height < 32, "compact")

    def status(self, message):
        self.query_one("#status", Static).update(str(message))

    @work(exclusive=True, group="scan")
    async def action_rescan(self):
        try:
            self.roots, self.skills, self.warnings = await asyncio.to_thread(self.manager.inventory)
            if self.legacy:
                roots, skills, warnings = await asyncio.to_thread(self.legacy.inventory)
                visible = {skill.id for skill in self.skills}
                self.roots += [root for root in roots if root.path not in {r.path for r in self.roots}]
                self.skills += [skill for skill in skills if skill.id not in visible]
                self.warnings += warnings
            self.render_inventory()
            folders = self.query_one("#roots", DataTable)
            folders.clear()
            for root in self.roots:
                folders.add_row(root.id, root.client, root.scope, root.owner, Text(root.path), key=root.id)
            history = self.query_one("#history", DataTable)
            history.clear()
            for record in self.manager.store.history():
                history.add_row(record["id"], record["status"], record["label"], key=record["id"])
            selector = self.query_one("#groups", SelectionList)
            chosen = set(selector.selected)
            selector.clear_options()
            data = self.manager.store.load()
            for name, members in data["groups"].items():
                if name != "core":
                    value = "local:" + name
                    selector.add_option((f"{name} ({len(members)})", value,
                                         value in chosen or (not chosen and name in data["activeGroups"])))
            if self.legacy:
                active = self.legacy.active_groups(self.manager.home) if not data["roots"] else []
                for name, members in self.legacy.groups().items():
                    if name != "core":
                        value = "legacy:" + name
                        selector.add_option((f"{name} · existing", value,
                                             value in chosen or (not chosen and name in active)))
            self.query_one("#summary", Static).update(
                f"{len(self.skills)} detected skills  ·  {len(self.roots)} folders  ·  "
                f"{len(data['skills'])} managed  ·  {len(self.selected_skills)} picked")
            self.status(self.notice or (self.warnings[0] if self.warnings else "Ready. Select groups and preview their changes."))
        except (DeckError, OSError, ValueError) as exc:
            self.status(exc)

    def render_inventory(self):
        table = self.query_one("#skills", DataTable)
        table.clear()
        query = self.query_one("#filter", Input).value.casefold()
        for skill in self.skills:
            if query and query not in " ".join([skill.name, skill.description, skill.owner, skill.path]).casefold():
                continue
            label = skill.name + (" !" if skill.issue else "")
            table.add_row("●" if skill.id in self.selected_skills else "○", Text(label), skill.client,
                          Text(skill.owner), Text(skill.description[:160]), key=skill.id)

    @on(Input.Changed, "#filter")
    def filter_changed(self):
        self.render_inventory()

    @on(DataTable.RowSelected, "#skills")
    def pick_skill(self, event):
        identifier = event.row_key.value
        if identifier in self.selected_skills:
            self.selected_skills.remove(identifier)
        else:
            self.selected_skills.add(identifier)
        row = event.cursor_row
        self.render_inventory()
        self.query_one("#skills", DataTable).move_cursor(row=row)
        self.status(f"{len(self.selected_skills)} skills picked. Ctrl+G edits their group membership.")

    @on(DataTable.RowHighlighted, "#skills")
    def show_skill(self, event):
        skill = next((s for s in self.skills if s.id == event.row_key.value), None)
        if skill and self.query_one("#tabs", TabbedContent).active == "skills-tab":
            memberships = [name for name, members in self.manager.store.load()["groups"].items() if skill.id in members]
            self.query_one("#detail", Static).update(
                f"{skill.id}\n{skill.path}\nOwner: {skill.owner} · Scope: {skill.scope} · "
                f"Groups: {', '.join(memberships) or 'none'}\n{skill.issue or skill.description}")

    @on(DataTable.RowHighlighted, "#roots")
    def choose_root(self, event):
        self.selected_root = event.row_key.value
        root = next((r for r in self.roots if r.id == self.selected_root), None)
        if root and self.query_one("#tabs", TabbedContent).active == "roots-tab":
            self.query_one("#detail", Static).update(
                f"{root.path}\nOwner: {root.owner} · Scope: {root.scope}\n"
                "Adoption preserves the current files and creates a private canonical library. "
                "Existing installers, linked sources, system skills and plugins retain ownership.")

    @on(DataTable.RowHighlighted, "#history")
    def choose_transaction(self, event):
        self.selected_transaction = event.row_key.value

    @on(Button.Pressed, "#adopt")
    def adopt_folder(self):
        if not self.selected_root:
            self.query_one("#tabs", TabbedContent).active = "roots-tab"
            self.status("Select the folder you want Subsets to manage.")
            return
        root = next(r for r in self.roots if r.id == self.selected_root)
        if root.owner != "unmanaged":
            self.status(f"{root.owner} owns this folder. Use its existing backend.")
            return
        reference = root.id
        self.push_screen(Confirm("Adopt this skill folder?", root.path + "\n\n"
            "Subsets will preserve all existing skills, copy eligible sources to its private library, "
            "and record ownership. Invalid entries and externally owned links are preserved. "
            "Future selections can deactivate only the registered skill paths."),
            lambda approved: self.perform_adopt(reference) if approved else None)

    @work(exclusive=True, group="mutation")
    async def perform_adopt(self, reference):
        try:
            result = await asyncio.to_thread(self.manager.adopt, reference)
            self.notice = "Adopted folder. Receipt: " + result.get("transaction", "already managed")
            self.action_rescan()
        except (DeckError, OSError, ValueError) as exc:
            self.status(exc)

    @on(Button.Pressed, "#edit-group")
    def edit_group_button(self):
        self.action_group()

    def action_group(self):
        self.push_screen(GroupEditor(len(self.selected_skills)), self.save_group)

    @work(exclusive=True, group="mutation")
    async def save_group(self, result):
        if result:
            try:
                action, name = result
                await asyncio.to_thread(edit_group, self.manager, self.legacy, action, name, sorted(self.selected_skills))
                self.notice = "Saved group " + name + ". Select it in the sidebar, then preview."
                self.selected_skills.clear()
                self.action_rescan()
            except (DeckError, OSError, ValueError) as exc:
                self.status(exc)

    @on(Button.Pressed, "#preview")
    def preview_button(self):
        self.action_preview()

    @work(exclusive=True, group="preview")
    async def action_preview(self):
        try:
            values = self.query_one("#groups", SelectionList).selected
            owners = {value.split(":", 1)[0] for value in values}
            if len(owners) > 1:
                raise DeckError("Select Subsets groups or existing profiles for one apply, not both owners.")
            groups = sorted(value.split(":", 1)[1] for value in values)
            owner = "existing" if owners == {"legacy"} else "subsets" if owners == {"local"} else "auto"
            backend = backend_for(self.manager, groups, self.legacy, owner)
            proposal = await asyncio.to_thread(backend.plan, groups)
            self.current_proposal = proposal
            self.push_screen(Preview(proposal),
                             lambda approved: self.perform_apply(backend, groups, proposal) if approved else None)
        except (DeckError, OSError, ValueError) as exc:
            self.status(exc)

    @work(exclusive=True, group="mutation")
    async def perform_apply(self, backend, groups, proposal):
        try:
            result = await asyncio.to_thread(backend.apply, groups, reviewed=proposal)
            self.notice = "Applied " + ", ".join(groups or ["core"]) + ". Start a fresh agent session. Receipt: " + str(result.get("transaction", result.get("claudeReceipt", "unchanged")))
            self.action_rescan()
        except (DeckError, OSError, ValueError) as exc:
            self.status(exc)

    @on(Button.Pressed, "#rollback")
    def rollback_button(self):
        if not self.selected_transaction:
            self.query_one("#tabs", TabbedContent).active = "history-tab"
            self.status("Select a transaction from Recovery.")
            return
        identifier = self.selected_transaction
        self.push_screen(Confirm("Restore this transaction?", identifier + "\n\n"
            "Restore the recorded before-state. Rollback stops if a touched skill or registry has later edits."),
            lambda approved: self.perform_rollback(identifier) if approved else None)

    @work(exclusive=True, group="mutation")
    async def perform_rollback(self, identifier):
        def rollback():
            with self.manager.store.lock(allow_pending=True):
                return self.manager.store.rollback(identifier)
        try:
            await asyncio.to_thread(rollback)
            self.notice = "Restored transaction " + identifier
            self.action_rescan()
        except (DeckError, OSError, ValueError) as exc:
            self.status(exc)

    def action_search(self):
        self.query_one("#filter", Input).focus()
