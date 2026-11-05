/* Gateflow checkout widget v1. Usage:
 *   <script src="https://<gateflow relay>/js/v1/gateflow.js"></script>
 *   Gateflow.open(42, { onStatus: function (e) { console.log(e.invoice, e.status); } });
 * Status events are for your UI only: fulfil orders from the webhook or GET /api/v1/invoices/<id>.
 * The v1 interface (open, close, onStatus) stays compatible for as long as /js/v1/ is served.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  var relay = script && script.src ? new URL(script.src).origin : location.origin;
  var current = null;

  /// Only messages from this relay's own iframe, tagged by the checkout page.
  function accepts(e, relayOrigin, frameWindow) {
    return !!e && e.origin === relayOrigin && !!frameWindow && e.source === frameWindow && !!e.data && e.data.source === "gateflow";
  }

  var CSS =
    ".bd{position:fixed;inset:0;z-index:2147483647;background:rgba(10,12,16,.55);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}" +
    ".box{position:relative;width:100%;max-width:960px;height:min(720px,100%);background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.35)}" +
    "iframe{border:0;width:100%;height:100%;display:block}" +
    ".x{position:absolute;top:10px;right:10px;width:32px;height:32px;border:0;border-radius:16px;background:rgba(0,0,0,.06);font:20px/32px system-ui,sans-serif;color:#333;cursor:pointer}" +
    ".x:hover{background:rgba(0,0,0,.12)}" +
    "@media (max-width:479px){.bd{padding:0}.box{max-width:none;height:100%;border-radius:0}}";

  function close() {
    if (!current) return;
    var c = current;
    current = null;
    window.removeEventListener("message", c.listener);
    document.removeEventListener("keydown", c.onKey);
    c.host.remove();
    if (c.onStatus) c.onStatus({ invoice: c.id, status: "closed" });
  }

  function open(invoiceId, options) {
    var id = Number(invoiceId);
    if (!Number.isSafeInteger(id) || id < 0) throw new Error("Gateflow.open: invoice must be an id");
    close();
    var opts = options || {};
    var host = document.createElement("div");
    var root = host.attachShadow({ mode: "closed" });
    var style = document.createElement("style");
    style.textContent = CSS;
    var backdrop = document.createElement("div");
    backdrop.className = "bd";
    var box = document.createElement("div");
    box.className = "box";
    var frame = document.createElement("iframe");
    frame.title = "Gateflow checkout";
    frame.allow = "clipboard-write";
    frame.src = relay + "/pay/" + id + "?embed=1&parent=" + encodeURIComponent(location.origin);
    var x = document.createElement("button");
    x.className = "x";
    x.type = "button";
    x.setAttribute("aria-label", "Close checkout");
    x.textContent = "×";
    x.onclick = close;
    backdrop.onclick = function (e) {
      if (e.target === backdrop) close();
    };
    box.appendChild(frame);
    box.appendChild(x);
    backdrop.appendChild(box);
    root.appendChild(style);
    root.appendChild(backdrop);
    document.body.appendChild(host);

    var c = { id: id, host: host, onStatus: typeof opts.onStatus === "function" ? opts.onStatus : null };
    c.listener = function (e) {
      if (!accepts(e, relay, frame.contentWindow) || e.data.invoice !== id) return;
      if (c.onStatus) c.onStatus({ invoice: id, status: String(e.data.status) });
    };
    c.onKey = function (e) {
      if (e.key === "Escape") close();
    };
    window.addEventListener("message", c.listener);
    document.addEventListener("keydown", c.onKey);
    current = c;
    x.focus();
  }

  window.Gateflow = { open: open, close: close, _accepts: accepts };
})();
