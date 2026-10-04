# Source provenance

Subsets began as the Skilldeck application in the codex-skills authoring repository. This standalone project imports the application from commit `88d665b`, preserving the original implementation in that repository’s history. Private machine reports and generated runtime artifacts are excluded from this repository.

Subsets owns its application code, packaging, discovery rules, and tests. The codex-skills repository continues to own its skill collection, profiles, and deployment helpers. The optional bridge calls those helpers rather than taking ownership of their folders.
