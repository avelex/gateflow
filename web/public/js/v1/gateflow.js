/* Gateflow checkout widget v1. Usage:
 *   <script src="https://<gateflow relay>/js/v1/gateflow.js"></script>
 *   Gateflow.open(42, { onStatus: function (e) { console.log(e.invoice, e.status); } });
 *   Gateflow.button("#pay", 42);  // branded "Pay with crypto" button that opens invoice 42
 * Status events are for your UI only: fulfil orders from the webhook or GET /api/v1/invoices/<id>.
 * The v1 interface (open, close, button, onStatus) stays compatible for as long as /js/v1/ is served.
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

  var BUTTON_CSS =
    ":host{display:block}" +
    ".ink,.auto{--bg:#0A0C10;--fg:#fff;--hover:#232830}" +
    ".white{--bg:#fff;--fg:#0A0C10;--hover:#E9EBEE}" +
    "@media (prefers-color-scheme:dark){.auto{--bg:#fff;--fg:#0A0C10;--hover:#E9EBEE}}" +
    "button{all:unset;box-sizing:border-box;width:100%;height:48px;display:flex;align-items:center;justify-content:center;gap:10px;border-radius:10px;background:var(--bg);color:var(--fg);font-size:16px;font-weight:600;line-height:1;cursor:pointer;transition:background .12s,transform .12s}" +
    "button:hover:not(:disabled){background:var(--hover)}" +
    "button:active:not(:disabled){transform:scale(.985)}" +
    "button:focus-visible{box-shadow:0 0 0 2px #fff,0 0 0 4px #0072CE}" +
    "button:disabled{opacity:.45;cursor:default}" +
    "span{display:inline-flex}" +
    "img{width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 0 0 2px var(--bg)}" +
    "img+img{margin-left:-6px}" +
    ".via{margin-top:8px;text-align:center;font-size:12px;opacity:.7}" +
    "b{font-weight:800;letter-spacing:-.035em}" +
    "b::after{content:'';display:inline-block;width:.3em;height:.3em;margin-left:.08em;border-radius:.07em;background:#383CFE}";

  function invoiceId(invoice) {
    var id = Number(invoice);
    if (!Number.isSafeInteger(id) || id < 0) throw new Error("Gateflow: invoice must be an id");
    return id;
  }

  /// Renders the branded "Pay with crypto" button at the end of `target` (an element or a selector).
  /// `invoice` is the invoice id to open on click, or a function to run on click instead (for example, create the
  /// order first). The button stays disabled until a promise the function returns settles.
  /// options: everything Gateflow.open takes, plus theme "ink" (default), "white" for dark sites, or "auto".
  /// Returns the <button>, so the page can disable it.
  function button(target, invoice, options) {
    var onClick = typeof invoice === "function" ? invoice : null;
    if (!onClick) invoiceId(invoice);
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) throw new Error("Gateflow.button: target not found");
    var opts = options || {};
    var host = document.createElement("div");
    var root = host.attachShadow({ mode: "open" });
    var style = document.createElement("style");
    style.textContent = BUTTON_CSS;
    var wrap = document.createElement("div");
    wrap.className = { white: "white", auto: "auto" }[opts.theme] || "ink";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Pay with crypto";
    var icons = document.createElement("span");
    icons.setAttribute("aria-hidden", "true");
    ["usdc", "near", "ethereum", "bitcoin"].forEach(function (name) {
      var img = document.createElement("img");
      img.src = relay + "/img/chain-" + name + ".png";
      img.alt = "";
      icons.appendChild(img);
    });
    btn.appendChild(icons);
    btn.onclick = function () {
      if (!onClick) return open(invoice, opts);
      btn.disabled = true;
      Promise.resolve()
        .then(onClick)
        .finally(function () {
          btn.disabled = false;
        });
    };
    var via = document.createElement("div");
    via.className = "via";
    via.appendChild(document.createTextNode("secured by "));
    via.appendChild(document.createElement("b")).textContent = "gateflow";
    wrap.appendChild(btn);
    wrap.appendChild(via);
    root.appendChild(style);
    root.appendChild(wrap);
    el.appendChild(host);
    return btn;
  }

  function close() {
    if (!current) return;
    var c = current;
    current = null;
    window.removeEventListener("message", c.listener);
    document.removeEventListener("keydown", c.onKey);
    c.host.remove();
    if (c.onStatus) c.onStatus({ invoice: c.id, status: "closed" });
  }

  function open(invoice, options) {
    var id = invoiceId(invoice);
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

  window.Gateflow = { open: open, close: close, button: button, _accepts: accepts };
})();
