// Authenticated, read-only help. No incident, endpoint or execution access.
import {employeeGuidanceCatalog,getEmployeeGuidance} from './troubleshooting-guidance.js';
import {inspectDiagnosticCapability} from './diagnostic-capability-catalog.js';
const hazards=Object.freeze(['UNKNOWN','NONE','PHYSICAL_HAZARD','SUSPECTED_COMPROMISE','DATA_LOSS_RISK','BOOT_OR_ENCRYPTION_DAMAGE']);
const platforms=Object.freeze(['windows','linux','macos']);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return d?.enumerable&&Object.hasOwn(d,'value')});
export function buildTroubleshootingHelp(query){
 if(!exact(query,['category_id','hazard','platform'])||!hazards.includes(query.hazard)||!platforms.includes(query.platform))throw Error('INVALID_HELP_QUERY');
 const guidance=getEmployeeGuidance({category_id:query.category_id,hazard:query.hazard});
 if(guidance.reason==='INVALID_INPUT')throw Error('INVALID_HELP_QUERY');
 const capability=guidance.guidance_type==='ADVISORY_ONLY'?inspectDiagnosticCapability({categoryId:query.category_id,platform:query.platform}):null;
 return Object.freeze({schema_version:1,guidance,capability,incident_created:false,diagnostic_authorized:false,repair_authorized:false,execution_authorized:false,production_accepted:false});
}
export function registerTroubleshootingHelpRoutes(app){
 // Must be mounted after the existing universal authenticated API gateway.
 const guard=(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!req.user||!req.user.tenant_id)return res.status(401).json({error:'AUTHENTICATION_REQUIRED'});
  return null;
 };
 app.get('/api/v1/troubleshooting/catalog',(req,res)=>{
  if(guard(req,res))return;
  if(Object.keys(req.query).length)return res.status(400).json({error:'INVALID_HELP_QUERY'});
  return res.json({schema_version:1,categories:employeeGuidanceCatalog.map(({id,title,category,repair_tier})=>({id,title,category,repair_tier})),hazards,platforms,diagnostic_authorized:false,repair_authorized:false});
 });
 app.get('/api/v1/troubleshooting/help',(req,res)=>{
  if(guard(req,res))return;
  try{return res.json(buildTroubleshootingHelp(req.query))}
  catch{return res.status(400).json({error:'INVALID_HELP_QUERY'})}
 });
}
