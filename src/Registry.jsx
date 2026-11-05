import { useState, useEffect } from "react";

/* =========================================================
   GIFT REGISTRY
   Guests reserve gifts the couple has added in admin, then buy
   them from the shop. Who can see it: src/registryRules.js
   (enforced again in functions/api/registry.js).
   ========================================================= */

export const REGISTRY_CSS = `
.reg-items{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}
@media(min-width:640px){.reg-items{grid-template-columns:repeat(3,minmax(0,1fr));}}
.reg-item{border:1px solid var(--gold-soft);background:#fff;display:flex;flex-direction:column;position:relative;min-width:0;}
.reg-img{aspect-ratio:1/1;background:var(--paper-2);display:flex;align-items:center;justify-content:center;overflow:hidden;}
.reg-img img{width:100%;height:100%;object-fit:contain;background:#fff;}
.reg-img .ph{font-family:var(--display);font-size:42px;color:var(--gold-soft);}
.reg-body{padding:10px 10px 12px;display:flex;flex-direction:column;gap:3px;flex:1;min-width:0;}
.reg-shop{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--gold);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.reg-name{font-family:var(--display);font-size:17px;font-weight:600;line-height:1.15;overflow-wrap:anywhere;}
.reg-price{font-size:13px;color:var(--ink-soft);}
.reg-note{font-size:12px;color:var(--ink-soft);font-style:italic;line-height:1.35;}
.reg-qty{font-size:12px;color:var(--sage-dark);}
.reg-foot{margin-top:auto;padding-top:8px;}
.reg-foot .btn{width:100%;padding:11px 10px;font-size:13px;}
.reg-status{font-size:12.5px;color:var(--sage-dark);font-weight:600;line-height:1.35;}
.reg-item.taken .reg-img,.reg-item.taken .reg-shop,.reg-item.taken .reg-name,.reg-item.taken .reg-price,.reg-item.taken .reg-note{opacity:.45;}
.reg-ribbon{position:absolute;top:8px;left:8px;background:var(--gold);color:#fff;font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:3px 7px;font-weight:600;z-index:1;}
.reg-filters{display:flex;gap:8px;overflow-x:auto;padding:2px 0 6px;margin-bottom:12px;scrollbar-width:none;-webkit-overflow-scrolling:touch;}
.reg-filters::-webkit-scrollbar{display:none;}
.reg-chip{flex:none;min-height:36px;border:1px solid var(--gold-soft);background:#fff;color:var(--ink-soft);font-size:13px;padding:0 14px;border-radius:18px;}
.reg-chip.on{background:var(--ink);border-color:var(--ink);color:var(--paper);}
.reg-mine-btn{display:flex;justify-content:center;margin:0 0 16px;}
.reg-mine-btn .btn{flex:none;padding:10px 18px;}
.reg-empty{text-align:center;padding:40px 16px;color:var(--ink-soft);}
.reg-empty .em-ic{font-family:var(--display);font-size:40px;color:var(--gold-soft);margin-bottom:8px;}
.reg-mine{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;border:1px solid var(--gold-soft);background:#fff;padding:12px;margin-bottom:10px;}
.reg-thumb{width:60px;height:60px;flex:none;background:var(--paper-2);display:flex;align-items:center;justify-content:center;overflow:hidden;}
.reg-thumb img{width:100%;height:100%;object-fit:contain;background:#fff;}
.reg-thumb .ph{font-family:var(--display);font-size:26px;color:var(--gold-soft);}
.reg-mine-info{flex:1;min-width:0;}
.reg-mine-info b{display:block;font-family:var(--display);font-size:17px;line-height:1.2;overflow-wrap:anywhere;}
.reg-mine-info small{display:block;color:var(--ink-soft);font-size:12.5px;margin-top:2px;}
.reg-mine-acts{flex-basis:100%;display:flex;flex-wrap:wrap;gap:0 18px;border-top:1px solid var(--paper-2);padding-top:4px;margin-top:-2px;}
.reg-mine-acts .btn-link{padding:8px 0;min-height:40px;display:inline-flex;align-items:center;}
.reg-pill{flex:none;font-size:11px;font-weight:600;padding:3px 9px;border-radius:10px;background:var(--paper-2);color:var(--sage-dark);white-space:nowrap;}
.reg-pill.bought{background:var(--sage);color:#fff;}
/* Bottom sheet on phones, a centred dialog on wider screens */
.reg-scrim{position:fixed;inset:0;background:rgba(32,43,34,.45);z-index:70;touch-action:none;}
.reg-sheet{position:fixed;left:0;right:0;bottom:0;z-index:71;background:#fff;border-radius:18px 18px 0 0;max-height:88vh;max-height:90dvh;display:flex;flex-direction:column;box-shadow:0 -10px 30px rgba(0,0,0,.18);}
.reg-sheet-head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 10px 6px 18px;}
.reg-sheet-head h3{font-family:var(--display);font-size:24px;font-weight:600;margin:0;}
.reg-sheet-close{flex:none;width:44px;height:44px;border-radius:50%;border:none;background:var(--paper-2);color:var(--ink);font-size:17px;line-height:1;}
.reg-sheet-body{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:4px 18px calc(22px + env(safe-area-inset-bottom, 0px));}
@media(min-width:700px){
  .reg-sheet{left:50%;right:auto;bottom:auto;top:50%;transform:translate(-50%,-50%);width:520px;border-radius:14px;max-height:86vh;}
}
.reg-sheet-item{display:flex;gap:14px;align-items:center;margin:4px 0 16px;}
.reg-sheet-item .reg-thumb{width:76px;height:76px;}
.reg-steps{list-style:none;margin:0 0 18px;padding:0;counter-reset:s;}
.reg-steps li{counter-increment:s;display:flex;gap:10px;font-size:14px;line-height:1.45;color:var(--ink-soft);margin-bottom:10px;}
.reg-steps li::before{content:counter(s);flex:none;width:22px;height:22px;border-radius:50%;border:1px solid var(--gold-soft);display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--gold);}
.reg-stepper{display:flex;align-items:center;gap:12px;margin:0 0 16px;}
.reg-stepper button{width:44px;height:44px;border:1px solid var(--gold-soft);background:#fff;font-size:20px;color:var(--ink);}
.reg-stepper span{font-family:var(--display);font-variant-numeric:lining-nums;font-size:26px;font-weight:600;min-width:28px;text-align:center;}
.reg-stack{display:grid;gap:10px;}
.reg-stack .btn{width:100%;text-align:center;text-decoration:none;display:block;}
a.btn{box-sizing:border-box;}
.reg-done{text-align:center;padding:4px 0 10px;}
.reg-done .tick{width:56px;height:56px;border-radius:50%;background:#E4EBDF;color:var(--sage-dark);display:flex;align-items:center;justify-content:center;font-size:26px;margin:0 auto 10px;}
.reg-error{background:#F4E2DE;color:var(--error);font-size:13px;padding:10px 12px;border-radius:8px;margin-bottom:12px;}
/* Admin › Registry */
.reg-admin-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px;}
.reg-admin-stats div{background:var(--paper-2);border-radius:10px;padding:10px;text-align:center;}
.reg-admin-stats b{display:block;font-family:var(--display);font-variant-numeric:lining-nums;font-size:26px;color:var(--sage-dark);line-height:1.1;}
.reg-admin-stats span{font-size:12px;color:var(--ink-soft);}
.reg-add-row{display:flex;gap:8px;margin-bottom:6px;}
.reg-add-row .settings-input{flex:1;min-width:0;}
.reg-add-row .btn{flex:none;border-radius:10px;padding:0 18px;min-height:46px;}
.reg-arow{display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-top:1px solid var(--paper-2);}
.reg-arow .reg-thumb{width:56px;height:56px;border-radius:8px;}
.reg-arow-info{flex:1;min-width:0;}
.reg-arow-info b{display:block;font-size:14.5px;line-height:1.3;overflow-wrap:anywhere;}
.reg-arow-info small{display:block;font-size:12.5px;color:var(--ink-soft);line-height:1.45;}
.reg-arow-info .st{color:var(--sage-dark);font-weight:600;}
.reg-arow-edit{flex:none;min-height:40px;padding:0 14px;border:1px solid var(--gold-soft);border-radius:10px;background:#fff;color:var(--ink);font-size:13px;font-weight:600;}
.reg-res{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink);margin-top:4px;flex-wrap:wrap;}
.reg-res .x{border:none;background:none;color:var(--ink-soft);text-decoration:underline;font-size:12px;padding:4px 2px;min-height:28px;}
.reg-fetched{font-size:12.5px;padding:9px 11px;border-radius:8px;margin-bottom:12px;background:#E4EBDF;color:var(--sage-dark);}
.reg-fetched.warn{background:#F7EFDD;color:#7A5B21;}
.reg-photo-row{display:flex;gap:12px;align-items:center;margin-bottom:14px;}
.reg-photo-row .reg-thumb{width:72px;height:72px;border-radius:8px;}
.reg-two{display:grid;grid-template-columns:1fr 1fr;gap:0 10px;}
.reg-reach{font-size:13px;color:var(--ink-soft);background:var(--paper-2);border-radius:10px;padding:10px 12px;margin-top:4px;line-height:1.5;}
.reg-reach strong{color:var(--ink);}
.reg-del{color:var(--error);}
`;

/* ---------- helpers ---------- */
export function formatPrice(n) {
  if (n == null || n === "") return "";
  const v = Number(n);
  return v.toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
}

function Thumb({ src, className = "reg-thumb" }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  return (
    <div className={className}>
      {src && !broken
        ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        : <span className="ph">❦</span>}
    </div>
  );
}

function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const html = document.documentElement, prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); html.style.overflow = prev; };
  }, [onClose]);
  return (
    <>
      <div className="reg-scrim" aria-hidden="true" onClick={onClose} />
      <div className="reg-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="reg-sheet-head">
          <h3>{title}</h3>
          <button type="button" className="reg-sheet-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="reg-sheet-body">{children}</div>
      </div>
    </>
  );
}

/* ---------- guest API ---------- */
async function apiGetRegistry(code) {
  const res = await fetch(`/api/registry?code=${encodeURIComponent(code)}`);
  if (!res.ok) throw new Error("load failed");
  return await res.json();
}
async function apiRegistry(code, body) {
  const res = await fetch("/api/registry", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, ...body })
  });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok && !data?.items) throw new Error(data?.error || "request failed");
  return data;
}

/* =========================================================
   GUEST: registry list + "My gifts"
   ========================================================= */
export function GuestRegistry({ state, actions, eventName }) {
  const code = state.inviteCode;
  const [data, setData] = useState(null); // null = loading; { visible, items, mine, events }
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState("list"); // list | mine
  const [filter, setFilter] = useState("all");
  const [sheet, setSheet] = useState(null); // { itemId, qty, done?, error? }
  const [busy, setBusy] = useState(false);

  const load = () => apiGetRegistry(code).then(d => { setData(d); setFailed(false); }).catch(() => setFailed(true));
  useEffect(() => { load(); }, [code]);
  useEffect(() => { window.scrollTo(0, 0); }, [page]);

  const back = () => actions.patch({ view: "guest-menu" });
  const items = data?.items || [];
  const mine = data?.mine || [];
  const mineByItem = Object.fromEntries(mine.map(m => [m.itemId, m]));
  const itemById = Object.fromEntries(items.map(i => [i.id, i]));
  const categories = [...new Set(items.map(i => i.category).filter(Boolean))];

  async function mutate(body, okMsg) {
    if (state.previewMode) { actions.showToast("This is preview mode, so reservations aren't saved."); return false; }
    setBusy(true);
    try {
      const d = await apiRegistry(code, body);
      setData(d);
      setBusy(false);
      if (d.error) { actions.showToast(d.error); return false; }
      if (okMsg) actions.showToast(okMsg);
      return true;
    } catch (e) {
      setBusy(false);
      actions.showToast("Something went wrong. Please try again.");
      return false;
    }
  }

  async function reserve() {
    const ok = await mutate({ action: "reserve", itemId: sheet.itemId, quantity: sheet.qty });
    if (ok) setSheet(s => ({ ...s, done: true }));
    else setSheet(null);
  }

  const eyebrow = data?.events?.length === 1 ? eventName(data.events[0]) : state.currentRecord?.householdName;

  if (failed) {
    return (
      <div className="stage"><div className="card"><div className="card-inner">
        <h2>Gift Registry</h2>
        <div className="reg-empty"><div className="em-ic">❦</div>We couldn't load the registry. Please try again.</div>
        <div className="reg-stack"><button className="btn btn-primary" onClick={load}>Try again</button><button className="btn btn-ghost" onClick={back}>Back</button></div>
      </div></div></div>
    );
  }

  if (data && !data.visible) {
    return (
      <div className="stage"><div className="card"><div className="card-inner">
        <h2>Gift Registry</h2>
        <div className="reg-empty"><div className="em-ic">❦</div>
          {data.access === "needs-rsvp" ? "Our gift registry opens once you've RSVP'd." : "The gift registry isn't open right now."}
        </div>
        <div className="reg-stack"><button className="btn btn-ghost" onClick={back}>Back</button></div>
      </div></div></div>
    );
  }

  const sheetItem = sheet && itemById[sheet.itemId];

  if (page === "mine") {
    return (
      <div className="stage"><div className="card"><div className="card-inner">
        <div className="card-eyebrow eyebrow">{state.currentRecord?.householdName}</div>
        <h2>Your Gifts</h2>
        <p className="lede">{mine.length ? "Thank you so much! Here's what you've reserved." : "You haven't reserved anything yet."}</p>
        {mine.map(m => {
          const it = itemById[m.itemId];
          if (!it) return null;
          return (
            <div className="reg-mine" key={m.id}>
              <Thumb src={it.imageUrl} />
              <div className="reg-mine-info">
                <b>{it.name}</b>
                <small>{m.quantity > 1 ? `${m.quantity} × ` : ""}{formatPrice(it.price)}{it.shop ? `${it.price != null ? " · " : ""}${it.shop}` : ""}</small>
              </div>
              <span className={`reg-pill ${m.bought ? "bought" : ""}`}>{m.bought ? "Bought" : "Reserved"}</span>
              <div className="reg-mine-acts">
                  {it.url && <a className="btn-link" href={it.url} target="_blank" rel="noopener noreferrer">{it.shop || "Shop"} ↗</a>}
                  <button className="btn-link" disabled={busy} onClick={() => mutate({ action: "set-bought", reservationId: m.id, bought: !m.bought }, m.bought ? "Marked as not bought yet." : "Marked as bought. Thank you!")}>
                    {m.bought ? "Not bought yet" : "Mark as bought"}
                  </button>
                  <button className="btn-link" disabled={busy} onClick={() => {
                    if (window.confirm(`Release "${it.name}" so another guest can reserve it?`)) mutate({ action: "release", reservationId: m.id }, "Released, so other guests can pick it up.");
                  }}>Release it</button>
              </div>
            </div>
          );
        })}
        <div className="reg-stack" style={{ marginTop: 18 }}>
          <button className="btn btn-primary" onClick={() => setPage("list")}>{mine.length ? "Back to the registry" : "Browse the registry"}</button>
        </div>
      </div></div></div>
    );
  }

  const shown = items.filter(it =>
    filter === "all" ? true : filter === "avail" ? it.remaining > 0 && !mineByItem[it.id] : it.category === filter);

  return (
    <div className="stage"><div className="card"><div className="card-inner">
      {eyebrow && <div className="card-eyebrow eyebrow">{eyebrow}</div>}
      <h2>Gift Registry</h2>
      <p className="lede">Your company is the best gift of all. If you'd like to bring something, here are a few things we'd love. Reserve it here so nobody doubles up, then buy it from the shop.</p>
      {data === null && <p className="helptext" style={{ textAlign: "center" }}>Loading…</p>}
      {data && items.length === 0 && <div className="reg-empty"><div className="em-ic">❦</div>We're still putting our list together. Check back soon!</div>}
      {mine.length > 0 && (
        <div className="reg-mine-btn"><button className="btn btn-ghost" onClick={() => setPage("mine")}>My gifts ({mine.length})</button></div>
      )}
      {items.length > 0 && (
        <div className="reg-filters" role="group" aria-label="Filter gifts">
          {[["all", "All"], ...categories.map(c => [c, c]), ["avail", "Still available"]].map(([k, label]) => (
            <button key={k} type="button" className={`reg-chip ${filter === k ? "on" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
      )}
      {data && items.length > 0 && shown.length === 0 && <div className="reg-empty">Nothing here right now.</div>}
      <div className="reg-items">
        {shown.map(it => {
          const m = mineByItem[it.id];
          const taken = !m && it.remaining <= 0;
          return (
            <div className={`reg-item ${taken ? "taken" : ""}`} key={it.id}>
              {it.mostWanted && !taken && <div className="reg-ribbon">Most wanted</div>}
              <Thumb src={it.imageUrl} className="reg-img" />
              <div className="reg-body">
                {it.shop && <div className="reg-shop">{it.shop}</div>}
                <div className="reg-name">{it.name}</div>
                {it.price != null && <div className="reg-price">{formatPrice(it.price)}{it.quantity > 1 ? " each" : ""}</div>}
                {it.note && <div className="reg-note">{it.note}</div>}
                {it.quantity > 1 && !taken && <div className="reg-qty">{it.remaining} of {it.quantity} still needed</div>}
                <div className="reg-foot">
                  {m ? <div className="reg-status">✓ You reserved {m.quantity > 1 ? m.quantity : "this"}</div>
                    : taken ? <div className="reg-status">{it.allBought ? "Bought, thank you!" : "Reserved by another guest"}</div>
                    : <button className="btn btn-primary" onClick={() => setSheet({ itemId: it.id, qty: 1 })}>Reserve</button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ textAlign: "center", marginTop: 22 }}>
        <button className="btn-link" onClick={back}>&larr; Back</button>
      </div>

      {sheet && sheetItem && (
        <Sheet title={sheet.done ? "Reserved!" : "Reserve this gift"} onClose={() => setSheet(null)}>
          {sheet.done ? (
            <>
              <div className="reg-done">
                <div className="tick">✓</div>
                <p className="lede" style={{ margin: "0 0 6px" }}>
                  {sheet.qty > 1 ? `${sheet.qty} × ` : ""}<strong>{sheetItem.name}</strong> is yours. Other guests will see it's taken.
                </p>
                <p className="helptext" style={{ margin: 0 }}>Once you've bought it, mark it as bought under My gifts.</p>
              </div>
              <div className="reg-stack">
                {sheetItem.url && <a className="btn btn-primary" href={sheetItem.url} target="_blank" rel="noopener noreferrer" onClick={() => setSheet(null)}>Go to {sheetItem.shop || "the shop"} ↗</a>}
                <button className="btn btn-ghost" onClick={() => setSheet(null)}>Done</button>
              </div>
            </>
          ) : (
            <>
              <div className="reg-sheet-item">
                <Thumb src={sheetItem.imageUrl} />
                <div style={{ minWidth: 0 }}>
                  {sheetItem.shop && <div className="reg-shop">{sheetItem.shop}</div>}
                  <div className="reg-name" style={{ fontSize: 19 }}>{sheetItem.name}</div>
                  {sheetItem.price != null && <div className="reg-price">{formatPrice(sheetItem.price)}{sheetItem.quantity > 1 ? " each" : ""}</div>}
                </div>
              </div>
              {sheetItem.remaining > 1 && (
                <>
                  <div className="helptext" style={{ marginBottom: 8 }}>How many? ({sheetItem.remaining} still needed)</div>
                  <div className="reg-stepper">
                    <button type="button" aria-label="One fewer" onClick={() => setSheet(s => ({ ...s, qty: Math.max(1, s.qty - 1) }))}>−</button>
                    <span aria-live="polite">{sheet.qty}</span>
                    <button type="button" aria-label="One more" onClick={() => setSheet(s => ({ ...s, qty: Math.min(sheetItem.remaining, s.qty + 1) }))}>+</button>
                  </div>
                </>
              )}
              <ol className="reg-steps">
                <li><span>Reserve it here, so other guests see it's taken.</span></li>
                <li><span>Buy it from {sheetItem.shop || "the shop"}{sheetItem.url ? ". We'll give you the link" : ""}.</span></li>
                <li><span>Bring it along or have it sent to us, then mark it as bought under <strong>My gifts</strong>.</span></li>
              </ol>
              <div className="reg-stack">
                <button className="btn btn-primary" disabled={busy} onClick={reserve}>
                  {busy ? <><span className="spinner" />Reserving…</> : `Reserve${sheet.qty > 1 ? ` ${sheet.qty}` : ""}`}
                </button>
                <button className="btn btn-ghost" onClick={() => setSheet(null)}>Not now</button>
              </div>
            </>
          )}
        </Sheet>
      )}
    </div></div></div>
  );
}

/* =========================================================
   ADMIN › Registry
   ========================================================= */
const EMPTY_ITEM = { id: "", name: "", shop: "", url: "", imageUrl: "", price: "", category: "", quantity: 1, note: "", mostWanted: false };

export function AdminRegistry({ state, actions, reach }) {
  const reg = state.registry;
  const [link, setLink] = useState("");
  const [fetching, setFetching] = useState(false);
  const [editor, setEditor] = useState(null); // { draft, fetched: null | "ok" | "partial" | "failed" }
  useEffect(() => { actions.loadRegistry(); }, []);

  if (!reg) return <div className="settings-page"><p className="helptext">Loading the registry…</p></div>;
  const s = reg.settings;
  const items = reg.items;
  const reservedUnits = items.reduce((n, i) => n + i.reserved, 0);
  const boughtUnits = items.reduce((n, i) => n + i.reservations.filter(r => r.bought).reduce((a, r) => a + r.quantity, 0), 0);
  const categories = [...new Set(items.map(i => i.category).filter(Boolean))];

  const saveSetting = change => actions.registryAdmin("registry-save-settings", change, "Registry settings saved.");

  async function addFromLink() {
    const url = link.trim();
    if (!url) { setEditor({ draft: { ...EMPTY_ITEM }, fetched: null }); return; }
    if (!/^https?:\/\//i.test(url)) { actions.showToast("Paste the full link, starting with https://"); return; }
    setFetching(true);
    const info = await actions.fetchProductLink(url);
    setFetching(false);
    const draft = { ...EMPTY_ITEM, url, name: info?.name || "", shop: info?.shop || "", imageUrl: info?.imageUrl || "", price: info?.price ?? "" };
    const fetched = !info?.ok ? "failed" : info.name && info.imageUrl && info.price != null ? "ok" : "partial";
    setEditor({ draft, fetched });
    setLink("");
  }

  const audienceText = s.audience === "replied" ? "Anyone who has replied to that event, even if they can't come." : "Only households where at least one person is coming to that event.";
  const eventText = { engagement: "Households invited to the engagement, including those invited to both.", wedding: "Households invited to the wedding, including those invited to both.", both: "Every invited household, whichever event they're invited to." }[s.event];

  return (
    <div className="settings-page">
      <div className="settings-intro">
        <h3>Gift registry</h3>
        <p>Guests see the registry only when it's switched on, they're invited to the event it's attached to, and they've RSVP'd.</p>
      </div>

      <div className="settings-card">
        <div className="switch-row" style={{ marginBottom: 16 }}>
          <label className="switch-text" htmlFor="reg-enabled">
            <span className="switch-title">Show registry to guests</span>
            <span className="helptext" style={{ marginTop: 3, display: "block" }}>{s.enabled ? "On: guests who qualify can see it now." : "Off: no guest can see the registry."}</span>
          </label>
          <input id="reg-enabled" type="checkbox" role="switch" className="switch" checked={s.enabled} disabled={state.loading}
            onChange={e => saveSetting({ enabled: e.target.checked })} />
        </div>
        <div className="field" style={{ marginBottom: 4 }}>
          <label>Attach to</label>
          <div className="segmented" role="group" aria-label="Attach to" style={{ marginBottom: 6 }}>
            {[["engagement", "Engagement"], ["wedding", "Wedding"], ["both", "Both"]].map(([k, label]) => (
              <button key={k} type="button" className={s.event === k ? "on" : ""} aria-pressed={s.event === k} disabled={state.loading} onClick={() => s.event !== k && saveSetting({ event: k })}>{label}</button>
            ))}
          </div>
          <div className="helptext" style={{ marginBottom: 12 }}>{eventText}</div>
        </div>
        <div className="field" style={{ marginBottom: 4 }}>
          <label>Who can see it</label>
          <div className="segmented" role="group" aria-label="Who can see it" style={{ marginBottom: 6 }}>
            {[["replied", "Everyone who replied"], ["attending", "Attending only"]].map(([k, label]) => (
              <button key={k} type="button" className={s.audience === k ? "on" : ""} aria-pressed={s.audience === k} disabled={state.loading} onClick={() => s.audience !== k && saveSetting({ audience: k })}>{label}</button>
            ))}
          </div>
          <div className="helptext">{audienceText}</div>
        </div>
        {reach && (
          <div className="reg-reach">
            {s.enabled
              ? <><strong>{reach.visible}</strong> household{reach.visible === 1 ? "" : "s"} can see it now{reach.waiting ? <>, and <strong>{reach.waiting}</strong> more will once they RSVP</> : ""}.</>
              : <>When switched on, <strong>{reach.visible}</strong> household{reach.visible === 1 ? "" : "s"} would see it now{reach.waiting ? <>, and <strong>{reach.waiting}</strong> more once they RSVP</> : ""}.</>}
          </div>
        )}
      </div>

      <div className="settings-card">
        <div className="reg-admin-stats">
          <div><b>{items.length}</b><span>gift{items.length === 1 ? "" : "s"}</span></div>
          <div><b>{reservedUnits}</b><span>reserved</span></div>
          <div><b>{boughtUnits}</b><span>bought</span></div>
        </div>
        <div className="field" style={{ marginBottom: 8 }}>
          <label htmlFor="reg-link">Add a gift</label>
          <div className="reg-add-row">
            <input id="reg-link" className="settings-input" type="url" inputMode="url" placeholder="Paste a product link…" value={link}
              onChange={e => setLink(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addFromLink(); }} />
            <button className="btn btn-primary" disabled={fetching} onClick={addFromLink}>{fetching ? <><span className="spinner" />Reading…</> : "Add"}</button>
          </div>
          <div className="helptext">We'll fill in the name, photo and price from the shop's page. <button className="btn-link" style={{ padding: 0 }} onClick={() => setEditor({ draft: { ...EMPTY_ITEM }, fetched: null })}>Add without a link</button></div>
        </div>

        {items.length === 0 && <div className="reg-empty" style={{ padding: "24px 8px" }}>No gifts yet. Paste a link above to add your first one.</div>}
        {items.map(it => (
          <div className="reg-arow" key={it.id}>
            <Thumb src={it.imageUrl} />
            <div className="reg-arow-info">
              <b>{it.mostWanted ? "★ " : ""}{it.name}</b>
              <small>{[it.shop, it.price != null ? formatPrice(it.price) + (it.quantity > 1 ? " each" : "") : "", it.category].filter(Boolean).join(" · ")}</small>
              <small className="st">{it.reserved} of {it.quantity} reserved</small>
              {it.reservations.map(r => (
                <div className="reg-res" key={r.id}>
                  <span>{r.quantity > 1 ? `${r.quantity} × ` : ""}{r.householdName}{r.bought ? " · bought" : ""}</span>
                  <button className="x" disabled={state.loading} onClick={() => {
                    if (window.confirm(`Remove ${r.householdName}'s reservation of "${it.name}"? It goes back on the list for other guests.`))
                      actions.registryAdmin("registry-remove-reservation", { id: r.id }, "Reservation removed.");
                  }}>Remove</button>
                </div>
              ))}
            </div>
            <button className="reg-arow-edit" onClick={() => setEditor({ draft: { ...EMPTY_ITEM, ...it, price: it.price ?? "" }, fetched: null })}>Edit</button>
          </div>
        ))}
      </div>

      {editor && (
        <ItemEditor key={editor.draft.id || "new"} editor={editor} categories={categories} state={state} actions={actions} onClose={() => setEditor(null)} />
      )}
    </div>
  );
}

function ItemEditor({ editor, categories, state, actions, onClose }) {
  const [d, setD] = useState(editor.draft);
  const [nameErr, setNameErr] = useState(false);
  const set = (k, v) => { setD(x => ({ ...x, [k]: v })); if (k === "name") setNameErr(false); };
  const isNew = !d.id;
  const existing = state.registry.items.find(i => i.id === d.id);
  const minQty = existing?.reserved || 1;

  async function save() {
    if (!d.name.trim()) { setNameErr(true); document.getElementById("reg-name")?.focus(); return; }
    const ok = await actions.registryAdmin("registry-save-item", { ...d, quantity: Number(d.quantity) || 1 }, isNew ? "Added to the registry." : "Gift saved.");
    if (ok) onClose();
  }
  async function remove() {
    const n = existing?.reserved || 0;
    if (!window.confirm(`Delete "${d.name}" from the registry?${n ? ` ${n} reservation${n === 1 ? "" : "s"} will be removed too.` : ""}`)) return;
    const ok = await actions.registryAdmin("registry-delete-item", { id: d.id }, "Gift deleted.");
    if (ok) onClose();
  }

  const host = (() => { try { return new URL(d.url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  return (
    <Sheet title={isNew ? "Add gift" : "Edit gift"} onClose={onClose}>
      {editor.fetched === "ok" && <div className="reg-fetched">✓ Filled in from {host}. Check it and change anything you like.</div>}
      {editor.fetched === "partial" && <div className="reg-fetched warn">We got some details from {host}. Fill in anything missing.</div>}
      {editor.fetched === "failed" && <div className="reg-fetched warn">{host || "That shop"} didn't let us read the page, so please fill in the details.</div>}
      <div className="reg-photo-row">
        <Thumb src={d.imageUrl} />
        <div className="field" style={{ flex: 1, margin: 0 }}>
          <label htmlFor="reg-img">Photo link</label>
          <input id="reg-img" className="settings-input" type="url" inputMode="url" placeholder="https://… (optional)" value={d.imageUrl} onChange={e => set("imageUrl", e.target.value)} />
        </div>
      </div>
      <div className={`field ${nameErr ? "has-err" : ""}`}>
        <label htmlFor="reg-name">Name</label>
        <input id="reg-name" className="settings-input" type="text" maxLength={150} value={d.name} aria-invalid={nameErr} onChange={e => set("name", e.target.value)} />
        {nameErr && <div className="err">Give the gift a name.</div>}
      </div>
      <div className="reg-two">
        <div className="field">
          <label htmlFor="reg-price">Price (AUD)</label>
          <input id="reg-price" className="settings-input" type="text" inputMode="decimal" placeholder="Optional" value={d.price} onChange={e => set("price", e.target.value.replace(/[^0-9.]/g, ""))} />
        </div>
        <div className="field">
          <label htmlFor="reg-qty">How many</label>
          <input id="reg-qty" className="settings-input" type="number" inputMode="numeric" min={minQty} max={99} value={d.quantity} onChange={e => set("quantity", e.target.value)} />
        </div>
      </div>
      <div className="reg-two">
        <div className="field">
          <label htmlFor="reg-shop">Shop</label>
          <input id="reg-shop" className="settings-input" type="text" maxLength={60} value={d.shop} onChange={e => set("shop", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="reg-cat">Category</label>
          <input id="reg-cat" className="settings-input" type="text" maxLength={40} list="reg-cats" placeholder="e.g. Kitchen" value={d.category} onChange={e => set("category", e.target.value)} />
          <datalist id="reg-cats">{categories.map(c => <option key={c} value={c} />)}</datalist>
        </div>
      </div>
      <div className="field">
        <label htmlFor="reg-url">Shop link</label>
        <input id="reg-url" className="settings-input" type="url" inputMode="url" placeholder="https://… (optional)" value={d.url} onChange={e => set("url", e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="reg-note">Note for guests</label>
        <input id="reg-note" className="settings-input" type="text" maxLength={300} placeholder="e.g. in Sage, if possible (optional)" value={d.note} onChange={e => set("note", e.target.value)} />
      </div>
      <div className="switch-row" style={{ marginBottom: 18 }}>
        <label className="switch-text" htmlFor="reg-top">
          <span className="switch-title">Most wanted</span>
          <span className="helptext" style={{ marginTop: 3, display: "block" }}>Shows it first, with a ribbon.</span>
        </label>
        <input id="reg-top" type="checkbox" role="switch" className="switch" checked={!!d.mostWanted} onChange={e => set("mostWanted", e.target.checked)} />
      </div>
      <div className="reg-stack">
        <button className="btn btn-primary" disabled={state.loading} onClick={save}>{state.loading ? <><span className="spinner" />Saving…</> : isNew ? "Add to registry" : "Save changes"}</button>
        {!isNew && <button className="btn btn-ghost reg-del" disabled={state.loading} onClick={remove}>Delete gift</button>}
      </div>
    </Sheet>
  );
}
