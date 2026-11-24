/* Verified PDF/native JSON navigation without a server API or location shim. */
(async function () {
  "use strict";
  const status = document.getElementById("replay-status"), params = new URLSearchParams(location.search);
  document.getElementById("replay-return").href = PublicReplay.siteURL("/workbench-v6.html");
  try {
    if (params.has("unavailable")) throw new Error(params.get("unavailable"));
    const request = params.get("request");
    if (!request) throw new Error("No public saved packet was selected");
    const value = await PublicReplay.verified(request);
    const back = params.get("return_to");
    if (back) document.getElementById("replay-return").href = PublicReplay.siteURL(back);
    const blob = new Blob([value.decoded], {type: value.entry.mime}), url = URL.createObjectURL(blob);
    const download = document.getElementById("replay-download");
    const filename = value.entry.path || new URL(value.entry.external_url).pathname;
    download.href = url; download.download = filename.split("/").pop().replace(/\.gz$/, ""); download.hidden = false;
    if (value.entry.mime.startsWith("application/pdf")) {
      const fragment = new URLSearchParams(location.hash.slice(1)), pages = fragment.getAll("page");
      const page = pages.length === 1 && /^[1-9]\d{0,6}$/.test(pages[0]) && Number(pages[0]) <= 1000000
        ? "#page=" + pages[0] : "";
      const frame = document.getElementById("replay-pdf"); frame.src = url + page; frame.hidden = false;
    } else {
      const text = new TextDecoder("utf-8", {fatal: true}).decode(value.decoded), pre = document.getElementById("replay-json");
      pre.textContent = value.entry.mime.startsWith("application/json") ? JSON.stringify(JSON.parse(text), null, 2) : text; pre.hidden = false;
    }
    window.addEventListener("pagehide", () => URL.revokeObjectURL(url), {once: true});
    status.textContent = "Saved public file verified by SHA-256. No live API or inference was called.";
    status.dataset.state = "verified";
  } catch (error) {
    status.textContent = "Unavailable in this public export: " + error.message;
    status.dataset.state = "unavailable";
  }
})();
