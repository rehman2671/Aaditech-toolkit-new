#!/usr/bin/env node
// Offline employee advisory page generator. No embedded JS, network requests,
// forms, telemetry, repair or authorization. Output is stdout only.
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {employeeGuidanceCatalog,getEmployeeGuidance} from '../troubleshooting-guidance.js';
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderOfflineTroubleshootingGuide(){
 const cards=employeeGuidanceCatalog.map(c=>{
  const g=getEmployeeGuidance({category_id:c.id,hazard:'NONE'});
  return '<details id="'+esc(c.id)+'"><summary>'+esc(c.id)+' · '+esc(c.title)+'</summary><p class="tier">'+
   esc(g.guidance_type==='HUMAN_ONLY'?'Qualified human assistance only':'Advisory observations only')+
   '</p><ol>'+g.instructions.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ol><p><strong>What success would require:</strong> '+
   esc(g.success_check)+'</p></details>';
 }).join('\n');
 return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
 '<meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; style-src &apos;unsafe-inline&apos;; base-uri &apos;none&apos;; form-action &apos;none&apos;">'+
 '<title>AadiTech | Offline troubleshooting guide</title><style>body{font:1rem/1.6 system-ui,sans-serif;background:#f4f6f9;color:#182538;margin:0}main{max-width:850px;padding:24px;margin:auto}h1{line-height:1.2}aside{border:2px solid #a23b18;background:#fff4ec;padding:16px;border-radius:8px}details{background:white;border:1px solid #cbd5e1;border-radius:8px;margin:12px 0;padding:14px}summary{cursor:pointer;font-weight:650}summary:focus-visible{outline:3px solid #2563eb}.tier{font-weight:600;color:#374151}footer{margin-top:24px;color:#334155}</style></head>'+
 '<body><main><h1>What problem are you having?</h1><p>Offline AadiTech employee guide. Choose an issue below. This page does not collect device information or change settings.</p>'+
 '<aside aria-label="Safety warning"><strong>Safety first</strong><p>If there is burning smell, overheating, suspected compromise, data-loss risk, boot or encryption damage, stop and contact qualified IT or emergency assistance as appropriate. Do not follow routine observations when danger is suspected or uncertain.</p></aside>'+
 '<h2>26 common issues</h2>'+cards+'<footer>Observations are advisory, not consent, diagnosis, approval, repair or verified resolution. Use your organization’s approved IT support channel.</footer></main></body></html>';
}
export function runLocalTroubleshootingGuide(argv){
 if(!Array.isArray(argv))throw Error('GUIDE_INPUT_INVALID');
 if(argv.length===1&&argv[0]==='--html')return renderOfflineTroubleshootingGuide();
 if(argv.length===4&&argv[0]==='--category'&&argv[2]==='--hazard'){
  const g=getEmployeeGuidance({category_id:argv[1],hazard:argv[3]});
  if(g.reason==='INVALID_INPUT')throw Error('GUIDE_INPUT_INVALID');
  return JSON.stringify(g)+'\n';
 }
 throw Error('GUIDE_INPUT_INVALID');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.stdout.write(runLocalTroubleshootingGuide(process.argv.slice(2)))}
 catch{process.stderr.write('Usage: node scripts/local-troubleshooting-guide.mjs --html | --category TR-01 --hazard UNKNOWN|NONE|PHYSICAL_HAZARD|SUSPECTED_COMPROMISE|DATA_LOSS_RISK|BOOT_OR_ENCRYPTION_DAMAGE\n');process.exitCode=1}
}
