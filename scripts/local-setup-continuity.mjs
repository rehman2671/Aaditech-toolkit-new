// Local read-only continuity inspection: bind the current independently
// approved release to an anchored setup journal and fresh host observation.
// Never infer actual readiness or authorize a resumed installation.
import {inspectLocalLanReadiness} from './lan-combined-preflight.mjs';
import {inspectSetupProgress} from './setup-journal-posix.mjs';
const digest=x=>typeof x==='string'&&x.length===64&&/^[a-f0-9]{64}$/.test(x)&&x!=='0'.repeat(64);
export async function inspectLocalSetupContinuity({confirmation,bundle,host,anchor}={}){
 if(confirmation!=='INSPECT_LOCAL_SETUP_CONTINUITY_ONLY'||!bundle||!host||!anchor||
    !digest(bundle.trustedManifestSha256)||anchor.releaseSha256!==bundle.trustedManifestSha256||
    !Buffer.isBuffer(anchor.checkpointBytes)||!Buffer.isBuffer(anchor.signature)||
    anchor.checkpointBytes.length<1||anchor.checkpointBytes.length>1024||anchor.signature.length!==64)
  throw Error('LOCAL_SETUP_CONTINUITY_BINDING_REQUIRED');
 // Snapshot all mutable inputs before first await. Independent current
 // checkpoint and release pins are supplied by trusted local custody.
 const b={...bundle},h={...host,ports:Array.isArray(host.ports)?[...host.ports]:host.ports,
   markerPaths:host.markerPaths?{...host.markerPaths}:host.markerPaths};
 const a={...anchor,checkpointBytes:Buffer.from(anchor.checkpointBytes),signature:Buffer.from(anchor.signature)};
 const progress=await inspectSetupProgress(a);
 const preflight=await inspectLocalLanReadiness({confirmation:'INSPECT_LOCAL_LAN_ONLY',bundle:b,host:h});
 // Check the exact pinned head again after the potentially long host/bundle
 // inspection. This is not an execution lock or proof against full rollback.
 const current=await inspectSetupProgress(a);
 if(JSON.stringify(current)!==JSON.stringify(progress))throw Error('SETUP_PROGRESS_CHANGED');
 return Object.freeze({schema_version:1,decision:current.decision,
  progress:current,fresh_host_observation:preflight,
  existing_installation_reconciled:false,actual_readiness_verified:false,
  resume_authorized:false,execution_authorized:false,production_accepted:false});
}
