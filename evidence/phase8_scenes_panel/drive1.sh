#!/bin/bash
# Drive the Scenes tab once and dump what it renders.
B=http://127.0.0.1:3100
P=cmwfum4uh0006ffuutb528ciw
agent-browser open "$B/projects/$P" >/dev/null 2>&1
sleep 6
agent-browser eval "const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Scenes'); if(b){b.click();'clicked'}else{'no-tab'}" > /tmp/p8/click.log 2>&1
sleep 6
agent-browser eval "const t=document.querySelector('[data-testid=\"scenes-summary-sentence\"]'); JSON.stringify({path:location.pathname, summary:t?t.innerText:null, scenes:document.querySelectorAll('[data-testid^=\"scene-\"]').length, sourced:[...document.querySelectorAll('[data-testid\$=\"-sourced\"]')].map(e=>e.innerText)})" > /tmp/p8/dom.json 2>&1
agent-browser screenshot /tmp/p8/scenes_tab.png > /tmp/p8/shot.log 2>&1
echo done
