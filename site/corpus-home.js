"use strict";
// Preserve bookmarked case links when the site root is now the landing page.
const previous = new URL(location.href);
if (previous.searchParams.has("case") && previous.searchParams.get("view") !== "home") {
  const target = new URL("workbench-v6.html", location.href);
  target.search = previous.search;
  target.hash = previous.hash;
  location.replace(target.href);
}
