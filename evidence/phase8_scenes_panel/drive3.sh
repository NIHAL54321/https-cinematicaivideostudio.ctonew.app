#!/bin/bash
A=agent-browser
$A eval "(()=>{const b=document.querySelector('[data-testid=\"scene-1-search-run\"]'); if(!b) return 'no-button'; b.scrollIntoView({block:'center'}); b.click(); return 'searched'})()" > /tmp/p8/s3_search.log 2>&1
sleep 20
$A eval "(()=>{const r=document.querySelector('[data-testid=\"scene-1-results\"]'); const m=document.querySelector('[data-testid=\"scene-1-search-message\"]'); return JSON.stringify({results:r?r.innerText.slice(0,600):null, msg:m?m.innerText:null, candidates:document.querySelectorAll('[data-testid^=\"scene-1-candidate-\"]').length})})()" > /tmp/p8/s3_results.json 2>&1
$A eval "(()=>{const c=document.querySelector('[data-testid^=\"scene-1-candidate-\"]'); if(!c) return 'no-candidate'; c.scrollIntoView({block:'center'}); c.click(); return 'picked'})()" > /tmp/p8/s3_pick.log 2>&1
sleep 40
$A eval "(()=>{const p=document.querySelector('[data-testid=\"scene-1-pick-state\"]'); const a=document.querySelector('[data-testid=\"scene-1-asset\"]'); const s=document.querySelector('[data-testid=\"scenes-summary-sentence\"]'); return JSON.stringify({pick:p?p.innerText:null, asset:a?a.innerText.slice(0,700):null, summary:s?s.innerText:null, badge:document.querySelector('[data-testid=\"scene-1-sourced\"]').innerText})})()" > /tmp/p8/s3_after.json 2>&1
$A screenshot /tmp/p8/scene1_attached.png > /tmp/p8/s3_shot.log 2>&1
echo done
