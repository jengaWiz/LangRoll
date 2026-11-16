// F (or a double-click) toggles full screen so the slide fills the projector.
const hint = document.getElementById("hint");

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
}

document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "f" && !e.metaKey && !e.ctrlKey && !e.altKey) toggleFullscreen();
});
document.addEventListener("dblclick", toggleFullscreen);

setTimeout(() => hint.classList.add("gone"), 6000);
