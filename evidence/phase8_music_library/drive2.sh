#!/bin/bash
# Second pass: prove the refused selection from an EMPTY selection (0 stored rows),
# then the permitted one that stores exactly 1 row.
B=http://127.0.0.1:3100
P=cmwfum4uh0006ffuutb528ciw
O=/tmp/ml2
mkdir -p "$O"
cd "$O" || exit 1

agent-browser open "$B/projects/$P" > open.log 2>&1
sleep 6
agent-browser eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Music'); if(b){b.click();return 'clicked'} return 'no-tab'})()" > tab.log 2>&1
sleep 6

# ---- clear any existing selection
agent-browser click '[data-testid="music-clear-selection"]' > clear.log 2>&1
sleep 5
agent-browser eval "(()=>{const n=document.querySelector('[data-testid=\"music-notice\"]'); const sel=document.querySelector('[data-testid=\"music-selection\"]'); const empty=document.querySelector('[data-testid=\"music-no-selection\"]'); return JSON.stringify({notice:n?n.innerText:null, selection:sel?sel.innerText.replace(/\s+/g,' ').trim():null, emptyLine:empty?empty.innerText:null}, null, 2)})()" > cleared.json 2>&1

# ---- search again to get rows back
agent-browser fill '[data-testid="music-search-input"]' 'cinematic' > fill.log 2>&1
agent-browser click '[data-testid="music-search-submit"]' > sub0.log 2>&1
sleep 8
agent-browser select '[data-testid="music-genre"]' 'Soundtrack' > genre.log 2>&1
agent-browser click '[data-testid="music-search-submit"]' > sub1.log 2>&1
sleep 9

# ---- refused selection from an empty selection
agent-browser eval "(()=>{const rows=[...document.querySelectorAll('[data-testid=\"music-row\"]')]; const bad=rows.find(r=>/preview only/i.test(r.querySelector('[data-testid^=\"music-badge\"]')?.innerText||'')); if(!bad) return 'no-preview-only-row'; const id=bad.dataset.trackId; const btn=document.querySelector('[data-testid=\"music-use-'+id+'\"]'); if(!btn) return 'no-use-button'; btn.click(); return JSON.stringify({id, title:(bad.innerText||'').split('\n')[0].slice(0,60)})})()" > refusal-click.json 2>&1
sleep 6
agent-browser eval "(()=>{const r=document.querySelector('[data-testid=\"music-refusal\"]'); const sel=document.querySelector('[data-testid=\"music-selection\"]'); const empty=document.querySelector('[data-testid=\"music-no-selection\"]'); return JSON.stringify({refusal:r?r.innerText:null, selection:sel?sel.innerText.replace(/\s+/g,' ').trim():null, emptyLine:empty?empty.innerText:null}, null, 2)})()" > refusal.json 2>&1
agent-browser screenshot /tmp/ml2/refusal-empty.png > shot1.log 2>&1

# ---- permitted selection stores exactly 1 row
agent-browser eval "(()=>{const rows=[...document.querySelectorAll('[data-testid=\"music-row\"]')]; const pick=rows.find(r=>/Cinematic Animation/i.test(r.innerText||'') && /export allowed/i.test(r.querySelector('[data-testid^=\"music-badge\"]')?.innerText||'')); if(!pick) return 'no-cinematic-animation-row'; const id=pick.dataset.trackId; const btn=document.querySelector('[data-testid=\"music-use-'+id+'\"]'); if(!btn) return 'no-use-button'; btn.click(); return JSON.stringify({id, title:(pick.innerText||'').split('\n')[0].slice(0,60)})})()" > permitted-click.json 2>&1
sleep 7
agent-browser eval "(()=>{const n=document.querySelector('[data-testid=\"music-notice\"]'); const sel=document.querySelector('[data-testid=\"music-selection\"]'); return JSON.stringify({notice:n?n.innerText:null, selection:sel?sel.innerText.replace(/\s+/g,' ').trim():null}, null, 2)})()" > permitted.json 2>&1
agent-browser screenshot /tmp/ml2/permitted.png > shot2.log 2>&1

echo done > /tmp/ml2/DONE
