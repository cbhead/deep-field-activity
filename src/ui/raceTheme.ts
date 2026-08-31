/**
 * The deep-field race chrome, shared by the lobby and results screens: one
 * injected stylesheet (scoped under .race-screen), the top bar, the pilot
 * hexagon, and the two pilot colours. Extracted from lobbyScreen so the
 * results screen is the same design rather than an imitation of it.
 */

const STYLE = `
/* Scrolls rather than clips. At 1024x600 — an ordinary landscape tablet — the
   lobby form is taller than the viewport, and with overflow:hidden and no
   scrollable ancestor the Join button was simply unreachable. This is also the
   precondition for iOS scrolling a focused field out from behind the on-screen
   keyboard: given nothing to scroll, Safari leaves the field covered. --kb is
   the keyboard's height, published by ui/viewport.ts. */
.race-screen{position:absolute;inset:0;z-index:10;
  overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;
  overscroll-behavior:contain;
  padding-bottom:calc(env(safe-area-inset-bottom, 0px) + var(--kb, 0px));
  background:#0b0c16;
  color:#e9e9ed;font:400 14px/1.5 Inter,system-ui,sans-serif}
.race-screen .lb-glow{position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(circle at 50% 46%,rgba(145,132,217,.14),rgba(6,7,13,.6) 62%)}
.race-screen .lb-bar{position:relative;display:flex;align-items:center;gap:14px;height:52px;padding:0 40px}
.race-screen .lb-brand{font:600 10.5px/1 Inter,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#9184d9}
.race-screen .lb-sep{width:1px;height:14px;background:rgba(233,233,237,.16)}
.race-screen .lb-sub{font:400 10.5px/1 Inter,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#75798c}
.race-screen .lb-conn{margin-left:auto;display:flex;align-items:center;gap:7px;font:400 10.5px/1 Inter,sans-serif;color:#9397ab}
.race-screen .lb-dot{width:6px;height:6px;border-radius:50%;background:#b5abfc;box-shadow:0 0 8px rgba(181,171,252,.8)}
.race-screen .lb-dot.bad{background:#e06d6d;box-shadow:0 0 8px rgba(224,109,109,.8)}
.race-screen .lb-body{position:relative;display:flex;gap:72px;justify-content:center;align-items:flex-start;
  padding:56px 64px;flex-wrap:wrap}
.race-screen .lb-col{display:flex;flex-direction:column;gap:26px;width:min(452px,90vw)}
.race-screen .lb-kicker{font:600 10px/1 Inter,sans-serif;letter-spacing:.24em;text-transform:uppercase;color:#b5abfc}
.race-screen .lb-kicker.bad{color:#e06d6d}
.race-screen .lb-title{font:500 56px/1.05 Inter,sans-serif;letter-spacing:-.03em;margin:0}
.race-screen .lb-lede{font:400 14px/1.7 Inter,sans-serif;color:#9397ab;max-width:420px;text-wrap:pretty}
.race-screen .lb-label{font:600 10px/1 Inter,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#75798c}
.race-screen .lb-field{display:flex;align-items:center;height:44px;padding:0 14px;border-radius:8px;
  background:rgba(35,37,50,.72);box-shadow:inset 0 0 0 1px rgba(233,233,237,.16);border:none;outline:none;
  font:400 15px/1 Inter,sans-serif;color:#e9e9ed;width:100%;box-sizing:border-box}
.race-screen .lb-field:focus{box-shadow:inset 0 0 0 1px rgba(145,132,217,.6)}
.race-screen .lb-btn{display:flex;align-items:center;justify-content:center;height:46px;padding:0 20px;
  border:1px solid #9184d9;border-radius:8px;background:none;cursor:pointer;
  font:600 14px/1 Inter,sans-serif;color:#d2cefd;box-shadow:0 0 22px rgba(145,132,217,.2)}
.race-screen .lb-btn:hover{background:rgba(145,132,217,.12)}
.race-screen .lb-btn.dim{border-color:rgba(233,233,237,.18);color:#cfd3e5;box-shadow:none}
.race-screen .lb-btn.ghost{border-color:rgba(145,132,217,.35);color:#9397ab;box-shadow:none}
.race-screen .lb-or{display:flex;align-items:center;gap:12px}
.race-screen .lb-or span{flex:1;height:1px;background:linear-gradient(to right,transparent,rgba(233,233,237,.16))}
.race-screen .lb-or span:last-child{background:linear-gradient(to left,transparent,rgba(233,233,237,.16))}
.race-screen .lb-or b{font:400 10.5px/1 Inter,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#75798c}
.race-screen .lb-code-in{width:7.5ch;text-transform:uppercase;font:600 20px/1 ui-monospace,Menlo,monospace;
  letter-spacing:.42em;text-align:center;padding:0 8px}
.race-screen .lb-how{display:flex;flex-direction:column;gap:22px;width:min(400px,90vw);padding-top:56px}
.race-screen .lb-how-item{display:flex;gap:14px}
.race-screen .lb-how-n{font:400 11px/1.3 ui-monospace,Menlo,monospace;color:#9184d9;padding-top:2px}
.race-screen .lb-how-t{font:600 13px/1.4 Inter,sans-serif;display:block}
.race-screen .lb-how-d{font:400 12px/1.65 Inter,sans-serif;color:#9397ab}
.race-screen .lb-rule{height:1px;background:linear-gradient(to right,rgba(233,233,237,.16) 0,rgba(233,233,237,.16) 220px,transparent 320px)}
.race-screen .lb-fine{font:400 11.5px/1.6 Inter,sans-serif;color:#75798c}
.race-screen .lb-bigcode{display:flex;align-items:center;justify-content:center;height:112px;border-radius:10px;
  background:rgba(35,37,50,.6);box-shadow:inset 0 0 0 1px rgba(145,132,217,.4),0 0 40px rgba(145,132,217,.1);
  border:none;outline:none;width:100%;box-sizing:border-box;text-align:center;
  font:500 64px/1 ui-monospace,Menlo,monospace;letter-spacing:.28em;color:#e9e9ed;
  text-shadow:0 0 26px rgba(181,171,252,.45)}
.race-screen .lb-link{font:400 12.5px/1 ui-monospace,Menlo,monospace;color:#9397ab;height:40px}
.race-screen .lb-seat{display:flex;align-items:center;gap:16px;min-height:66px;padding:0 18px;border-radius:10px;
  background:rgba(35,37,50,.7);box-shadow:inset 0 0 0 1px rgba(233,233,237,.12)}
.race-screen .lb-seat.you{box-shadow:inset 0 0 0 1px rgba(143,196,250,.4)}
.race-screen .lb-seat.them{box-shadow:inset 0 0 0 1px rgba(252,192,138,.35)}
.race-screen .lb-seat.empty{background:rgba(20,22,36,.4)}
.race-screen .lb-seat-name{font:600 15px/1.2 Inter,sans-serif}
.race-screen .lb-seat-sub{font:400 11px/1.2 Inter,sans-serif;color:#75798c}
.race-screen .lb-pill{margin-left:auto;padding:5px 11px;border-radius:6px;background:rgba(233,233,237,.08);
  font:600 11px/1 Inter,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#9397ab;display:flex;align-items:center;gap:7px}
.race-screen .lb-pill.on{background:rgba(145,132,217,.14);color:#b5abfc}
.race-screen .lb-pill.on i{width:5px;height:5px;border-radius:50%;background:#b5abfc;box-shadow:0 0 6px rgba(181,171,252,.9);display:block}
.race-screen .lb-facts{display:flex;flex-direction:column;gap:9px;max-width:280px}
.race-screen .lb-facts div{display:flex;justify-content:space-between;font:400 11.5px/1 Inter,sans-serif}
.race-screen .lb-facts span:first-child{color:#75798c}
.race-screen .lb-facts span:last-child{color:#cfd3e5}
.race-screen .lb-leave{background:none;border:none;cursor:pointer;font:400 12px/1 Inter,sans-serif;color:#75798c;padding:0;text-align:left}
.race-screen .lb-leave:hover{color:#b5abfc}
.race-screen .lb-center{position:relative;display:flex;flex-direction:column;align-items:center;gap:26px;padding-top:64px}
.race-screen .lb-ring{position:relative;display:grid;place-items:center;width:220px;height:220px}
.race-screen .lb-ring i{position:absolute;inset:0;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(181,171,252,.28),0 0 60px rgba(145,132,217,.22)}
.race-screen .lb-ring i+i{inset:26px;box-shadow:inset 0 0 0 1px rgba(181,171,252,.14)}
.race-screen .lb-count{font:500 108px/1 Inter,sans-serif;color:#f5f4ff;text-shadow:0 0 40px rgba(181,171,252,.55)}
.race-screen .lb-vsline{display:flex;align-items:center;gap:20px;font:600 14px/1 Inter,sans-serif}
.race-screen .lb-vsline em{font:400 11px/1 Inter,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#75798c;font-style:normal}
.race-screen .lb-vsline b i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:9px}
.race-screen .lb-mono{font:400 11.5px/1 ui-monospace,Menlo,monospace;color:#9397ab}
.race-screen .lb-hex{width:26px;height:26px;flex:none}
.race-screen .lb-picks{display:flex;gap:8px;flex-wrap:wrap}
.race-screen .lb-pick{padding:9px 13px;border-radius:7px;border:1px solid rgba(233,233,237,.16);
  background:none;cursor:pointer;font:600 12px/1 Inter,sans-serif;color:#9397ab}
.race-screen .lb-pick.on{border-color:#9184d9;color:#d2cefd;box-shadow:0 0 14px rgba(145,132,217,.18)}
.race-screen .lb-webhook{height:40px;font-size:12.5px;font-family:ui-monospace,Menlo,monospace}

/* Touch. Scoped so desktop rendering is untouched.

   The 16px floor is not a taste call: iOS Safari zooms the page whenever a
   field under 16px takes focus, and it does not zoom back out. Every field on
   this screen was under it except the room code.

   The rest is reclaiming vertical space — at 1024x600 this form is ~1150px
   tall, and the padding and display type are where that goes. */
@media (pointer: coarse) {
  .race-screen .lb-field{font-size:16px}
  .race-screen .lb-webhook{font-size:16px}
  .race-screen .lb-link{font-size:16px;height:48px}
  .race-screen .lb-body{padding:32px 24px;gap:32px}
  .race-screen .lb-how{padding-top:8px}
  .race-screen .lb-title{font-size:clamp(32px,7vw,56px)}
  .race-screen .lb-count{font-size:clamp(64px,16vw,108px)}
  .race-screen .lb-bigcode{height:88px;font-size:clamp(38px,11vw,64px)}
  .race-screen .lb-center{padding-top:24px}
}
`;

export function ensureRaceStyle(): void {
  if (document.getElementById('race-style')) return;
  const style = document.createElement('style');
  style.id = 'race-style';
  style.textContent = STYLE;
  document.head.appendChild(style);
}

export const raceBar = (brand: string, sub: string, conn: string, bad = false): string =>
  `<div class="lb-bar"><span class="lb-brand">${brand}</span><span class="lb-sep"></span>` +
  `<span class="lb-sub">${sub}</span>` +
  `<span class="lb-conn"><span class="lb-dot${bad ? ' bad' : ''}"></span>${conn}</span></div>`;

export const hexSvg = (color: string, dim = false): string =>
  `<svg class="lb-hex" viewBox="0 0 40 40" style="filter:drop-shadow(0 0 6px ${color}73)">` +
  `<path d="M20 3 L34 11 L34 29 L20 37 L6 29 L6 11 Z" fill="${color}" fill-opacity="${dim ? '.14' : '.2'}" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>` +
  `<circle cx="20" cy="20" r="5.5" fill="${color}"${dim ? ' fill-opacity=".6"' : ''}/></svg>`;

export const YOU = '#8fc4fa';
export const THEM = '#fcc08a';
