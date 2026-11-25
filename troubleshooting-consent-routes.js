import {identityPolicy,assertDatabaseIdentity,boundReportPool} from './installation-database-identity.js';
import {inspectConsent,changeConsent,inspectConsentReviewPlan,recordConsentReviewPlan} from './troubleshooting-diagnostic-consent.js';
export function registerDiagnosticConsentRoutes(app,db,env=process.env){
 for(const [method,suffix,keys,service,roles] of [['get','diagnostic-consent',['incidentId','deviceId'],inspectConsent,['SUPER_ADMIN','MONITORING']],['post','diagnostic-consent',['incidentId','deviceId','requestId','expectedRevision','action','confirmation'],changeConsent,['SUPER_ADMIN','MONITORING']],['get','diagnostic-review-plan',['incidentId','deviceId'],inspectConsentReviewPlan,['SUPER_ADMIN']],['post','diagnostic-review-plan',['incidentId','deviceId','requestId','expectedConsentRevision','confirmation'],recordConsentReviewPlan,['SUPER_ADMIN']]]){
  app[method]('/api/v1/troubleshooting/'+suffix,async(req,res)=>{
   res.set('Cache-Control','no-store');
   if(!roles.includes(req.user?.role)||!req.token||req.headers.authorization!=='Bearer '+req.token)return res.status(403).json({error:'CONSENT_SCOPE_DENIED'});
   const v=method==='get'?req.query:req.body;
   if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||!keys.every(k=>Object.hasOwn(v,k))||(method==='post'&&(!req.is('application/json')||Object.keys(req.query).length)))return res.status(400).json({error:'CONSENT_INVALID'});
   if(!db.isMysqlConnected())return res.status(503).json({error:'CONSENT_UNAVAILABLE'});
   try{const policy=identityPolicy(env),pool=db.getPool(),installationId=await assertDatabaseIdentity(pool,policy);
    return res.json(await service(boundReportPool(pool,policy,installationId),{...v,principal:req.user,installationId}));
   }catch(e){const code=e?.message,status=code==='CONSENT_INVALID'?400:code==='CONSENT_SCOPE_DENIED'?403:['CONSENT_CONFLICT','CONSENT_NOT_ELIGIBLE','CONSENT_PLAN_CONFLICT'].includes(code)?409:503;return res.status(status).json({error:status===503?'CONSENT_NOT_CONFIRMED':code})}
  });
 }
}
