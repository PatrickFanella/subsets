const output = document.getElementById("terminal-output");
const buttons = [...document.querySelectorAll("[data-view]")];
let capture;
function selectView(view) {
  output.textContent = capture.frames[view];
  buttons.forEach((button) =>
    button.setAttribute("aria-pressed", String(button.dataset.view === view)),
  );
}
fetch("assets/tui-capture.json")
  .then((response) => {
    if (!response.ok) throw new Error("Capture unavailable");
    return response.json();
  })
  .then((data) => {
    capture = data;
    selectView("skills");
    document.querySelector(".capture-version").textContent = data.version;
  })
  .catch(() => {
    output.textContent =
      "The terminal capture could not be loaded.\nOpen the source guide to see the TUI workflow.";
    buttons.forEach((button) => (button.disabled = true));
  });
buttons.forEach((button) =>
  button.addEventListener("click", () => {
    if (capture) selectView(button.dataset.view);
  }),
);
document.getElementById("copy-install").addEventListener("click", async () => {
  const status = document.getElementById("copy-status");
  try {
    await navigator.clipboard.writeText(
      document.getElementById("install-commands").textContent.trim(),
    );
    status.textContent = "Commands copied.";
  } catch {
    status.textContent = "Select the commands above and copy them manually.";
  }
});
