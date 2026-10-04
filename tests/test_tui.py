import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

from textual.widgets import DataTable, Input, SelectionList, TabbedContent

from subsets.manager import Manager
from subsets.storage import Store
from subsets.tui import SubsetsApp, GroupEditor, Preview
from test_manager import make_skill


class TuiWorkflow(unittest.IsolatedAsyncioTestCase):
    async def test_search_adopt_group_preview_apply_and_resize(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict("os.environ", {}, clear=True):
            temporary = Path(directory)
            home = temporary / "home"
            root = home / ".agents/skills"
            make_skill(root, "poetry"); make_skill(root, "database")
            manager = Manager(Store(temporary / "state"), home=home, plugins=False)
            app = SubsetsApp(manager)
            async with app.run_test(size=(120, 40)) as pilot:
                await pilot.pause()
                await app.workers.wait_for_complete()
                self.assertEqual(app.query_one("#skills", DataTable).row_count, 2)
                app.query_one("#filter", Input).value = "poetry"
                await pilot.pause()
                self.assertEqual(app.query_one("#skills", DataTable).row_count, 1)
                # Folder selection and adoption run through the same worker as the button.
                app.query_one("#tabs", TabbedContent).active = "roots-tab"
                await pilot.pause()
                await pilot.click("#adopt")
                await pilot.pause()
                await pilot.click("#confirm")
                await pilot.pause()
                await app.workers.wait_for_complete()
                self.assertEqual(len(manager.store.load()["skills"]), 2)
                app.query_one("#tabs", TabbedContent).active = "skills-tab"
                await pilot.pause()
                table = app.query_one("#skills", DataTable)
                table.focus()
                await pilot.press("enter")
                self.assertEqual(len(app.selected_skills), 1)
                await pilot.click("#edit-group")
                await pilot.pause()
                self.assertIsInstance(app.screen, GroupEditor)
                app.screen.query_one("#group-name", Input).value = "creative-writing"
                await pilot.click("#create")
                await pilot.pause()
                await app.workers.wait_for_complete()
                self.assertEqual(len(manager.store.load()["groups"]["creative-writing"]), 1)
                groups = app.query_one("#groups", SelectionList)
                groups.deselect_all()
                groups.select("local:creative-writing")
                await pilot.click("#preview")
                await pilot.pause()
                await app.workers.wait_for_complete()
                self.assertIsInstance(app.screen, Preview)
                self.assertTrue((root / "database").exists())
                await pilot.click("#confirm")
                await pilot.pause()
                await app.workers.wait_for_complete()
                self.assertFalse((root / "database").exists())
                self.assertTrue((root / "poetry").exists())
                await pilot.resize_terminal(80, 24)
                await pilot.pause()
                self.assertGreaterEqual(app.query_one("#skills", DataTable).region.height, 5)
                self.assertLessEqual(app.query_one("#rollback").region.right, 80)
