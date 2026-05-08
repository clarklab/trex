// Shared site behaviors: see-all-forms pop-swap, same-document fade
// transitions when both browser supports them and another page is being
// navigated to inside the site.

import { initChat } from "/js/chat.js";

initChat();

// "See all 47 forms" pop-swap to "Coming soon!"
document.querySelectorAll(".see-all-forms").forEach((el) => {
  el.addEventListener("click", (e) => {
    e.preventDefault();
    if (el.dataset.swapped === "1") return;
    el.dataset.swapped = "1";
    const original = el.textContent;
    el.classList.add("popped");
    el.textContent = "Coming soon!";
    setTimeout(() => {
      el.classList.remove("popped");
    }, 600);
    setTimeout(() => {
      el.textContent = original;
      el.dataset.swapped = "";
    }, 2400);
  });
});

// Same-origin link interception → use View Transitions API for a buttery
// fade between pages on browsers that support it. Falls through to a
// regular navigation everywhere else.
function isSameOriginLink(a) {
  try {
    const url = new URL(a.href, window.location.href);
    return (
      url.origin === window.location.origin &&
      a.target !== "_blank" &&
      !a.hasAttribute("download") &&
      !a.href.startsWith("mailto:") &&
      !a.href.startsWith("tel:")
    );
  } catch {
    return false;
  }
}

document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest("a");
  if (!a) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (e.button !== 0) return;
  if (!isSameOriginLink(a)) return;
  const url = new URL(a.href, window.location.href);
  if (url.pathname === window.location.pathname && url.hash) return;

  // Cross-document View Transitions are activated automatically via the
  // CSS @view-transition rule when the browser supports it. For browsers
  // that only support same-document transitions (or none), we fall back
  // to a manual fade. Either way the navigation still happens.
  if (
    document.startViewTransition &&
    !("ViewTransition" in window === false)
  ) {
    // Browsers with cross-doc view transitions handle this automatically.
    // Don't intercept.
    return;
  }

  // Older Safari/FF: do a quick CSS fade-out before navigating to feel
  // less abrupt. ~140ms — short enough to not feel like a delay.
  e.preventDefault();
  document.documentElement.classList.add("nav-fading");
  setTimeout(() => {
    window.location.href = a.href;
  }, 140);
});
