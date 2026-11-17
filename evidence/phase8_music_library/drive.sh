#!/bin/bash
# Drive the Music tab on the served build once and dump what it renders.
# Five steps: search counts, genre narrowing, preview currentTime, refused
# selection, permitted selection. Read-only apart from the two selection clicks,
# which are the point of steps 4 and 5.
B=http://127.0.0.1:3100
P=cmwfum4uh0006ffuutb528ciw
O=/tmp/ml
mkdir -p "$O"
cd "$O" || exit 1

agent-browser open "$B/projects/$P" > open.log 2>&1
sleep 6
agent-browser eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Music'); if(b){b.click();return 'clicked'} return 'no-tab'})()" > tab.log 2>&1
sleep 6

# ---- step 1: search "cinematic", no filters
agent-browser fill '[data-testid="music-search-input"]' 'cinematic' > fill1.log 2>&1
agent-browser click '[data-testid="music-search-submit"]' > sub1.log 2>&1
sleep 9
agent-browser eval "(()=>{const c=document.querySelector('[data-testid=\"music-counts\"]'); const rows=[...document.querySelectorAll('[data-testid=\"music-row\"]')]; const per=rows.map(r=>{const t=r.querySelector('[data-testid^=\"music-badge\"]'); return {id:r.dataset.trackId, title:(r.innerText||'').split('\n')[0].slice(0,60), badge:(t?.innerText||'').replace(/\s+/g,' ').trim()}}); return JSON.stringify({counts:c?c.innerText:null, rows:per.length, exportAllowed:per.filter(p=>/export allowed/i.test(p.badge)).length, previewOnly:per.filter(p=>/preview only/i.test(p.badge)).length, first:per.slice(0,3)}, null, 2)})()" > counts1.json 2>&1
agent-browser screenshot /tmp/ml/step1_search.png > shot1.log 2>&1

# ---- step 2: narrow to a genre the catalogue itself returned
agent-browser eval "(()=>{const s=document.querySelector('[data-testid=\"music-genre\"]'); return JSON.stringify([...s.options].map(o=>o.value))})()" > genre-options.json 2>&1
agent-browser select '[data-testid="music-genre"]' 'Soundtrack' > genre.log 2>&1
agent-browser click '[data-testid="music-search-submit"]' > sub2.log 2>&1
sleep 9
agent-browser eval "(()=>{const c=document.querySelector('[data-testid=\"music-counts\"]'); const rows=[...document.querySelectorAll('[data-testid=\"music-row\"]')]; const per=rows.map(r=>{const t=r.querySelector('[data-testid^=\"music-badge\"]'); return {id:r.dataset.trackId, title:(r.innerText||'').split('\n')[0].slice(0,60), badge:(t?.innerText||'').replace(/\s+/g,' ').trim()}}); const q=[...document.querySelectorAll('p')].map(p=>p.innerText).find(x=>x&&x.indexOf('genre')>-1&&x.indexOf('limit')>-1); return JSON.stringify({counts:c?c.innerText:null, queryLine:q||null, rows:per.length, exportAllowed:per.filter(p=>/export allowed/i.test(p.badge)).length, previewOnly:per.filter(p=>/preview only/i.test(p.badge)).length, first:per.slice(0,3)}, null, 2)})()" > counts2.json 2>&1
agent-browser screenshot /tmp/ml/step2_genre.png > shot2.log 2>&1

# ---- step 3: play a preview and watch audio.currentTime advance
agent-browser eval "(()=>{const rows=[...document.querySelectorAll('[data-testid=\"music-row\"]')]; const ok=rows.find(r=>/export allowed/i.test(r.querySelector('[data-testid^=\"music-badge\"]')?.innerText||'')); if(!ok) return 'no-permitted-row'; const id=ok.dataset.trackId; const btn=document.querySelector('[data-testid=\"music-preview-toggle-'+id+'\"]'); if(!btn) return 'no-toggle'; btn.click(); return JSON.stringify({id, title:(ok.innerText||'').split('\n')[0].slice(0,60)})})()" > preview-click.json 2>&1
sleep 4
agent-browser eval "(()=>{const a=document.querySelector('[data-testid=\"music-preview-audio\"]'); if(!a) return JSON.stringify({audio:null}); return JSON.stringify({audio:true, src:a.getAttribute('src'), paused:a.paused, readyState:a.readyState, t1:a.currentTime, duration:a.duration})})()" > preview-t1.json 2>&1
sleep 4
agent-browser eval "(()=>{const a=document.querySelector('[data-testid=\"music-preview-audio\"]'); if(!a) return JSON.stringify({audio:null}); return JSON.stringify({audio:true, paused:a.paused, t2:a.currentTime, duration:a.duration, advanced:a.currentTime>0})})()" > preview-t2.json 2>&1
agent-browser screenshot /tmp/ml/step3_preview.png > shot3.log 2>&1

# ---- step 4: a refused selection (a preview-only row)
agent-browser eval "(()=>{const rows=[...document.querySelectorAll('[data-testid=\"music-row\"]')]; const bad=rows.find(r=>/preview only/i.test(r.querySelector('[data-testid^=\"music-badge\"]')?.innerText||'')); if(!bad) return 'no-preview-only-row'; const id=bad.dataset.trackId; const btn=document.querySelector('[data-testid=\"music-use-'+id+'\"]'); if(!btn) return 'no-use-button'; btn.click(); return JSON.stringify({id, title:(bad.innerText||'').split('\n')[0].slice(0,60), licence:(bad.innerText||'').split('\n').slice(1,3).join(' ')})})()" > refusal-click.json 2>&1
sleep 6
agent-browser eval "(()=>{const r=document.querySelector('[data-testid=\"music-refusal\"]'); const sel=document.querySelector('[data-testid=\"music-selection\"]'); return JSON.stringify({refusal:r?r.innerText:null, selection:sel?sel.innerText.replace(/\s+/g,' ').trim():null}, null, 2)})()" > refusal.json 2>&1
agent-browser screenshot /tmp/ml/step4_refusal.png > shot4.log 2>&1

# ---- step 5: a permitted selection — "Cinematic Animation" by ONE ABE
agent-browser eval "(()=>{const rows=[...document.querySelectorAll('[data-testid=\"music-row\"]')]; const pick=rows.find(r=>/Cinematic Animation/i.test(r.innerText||'') && /export allowed/i.test(r.querySelector('[data-testid^=\"music-badge\"]')?.innerText||'')); if(!pick) return 'no-cinematic-animation-row'; const id=pick.dataset.trackId; const btn=document.querySelector('[data-testid=\"music-use-'+id+'\"]'); if(!btn) return 'no-use-button'; btn.click(); return JSON.stringify({id, title:(pick.innerText||'').split('\n')[0].slice(0,60)})})()" > permitted-click.json 2>&1
sleep 7
agent-browser eval "(()=>{const n=document.querySelector('[data-testid=\"music-notice\"]'); const sel=document.querySelector('[data-testid=\"music-selection\"]'); return JSON.stringify({notice:n?n.innerText:null, selection:sel?sel.innerText.replace(/\s+/g,' ').trim():null}, null, 2)})()" > permitted.json 2>&1
agent-browser screenshot /tmp/ml/step5_permitted.png > shot5.log 2>&1

echo done > /tmp/ml/DONE
