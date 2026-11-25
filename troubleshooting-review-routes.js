import {identityPolicy,assertDatabaseIdentity,boundReportPool} from './installation-database-identity.js';
import {listIncidentReviews,listEmployeeIncidentReviews,transitionIncidentReview} from './troubleshooting-incident-review.js';
import {inspectHazardAssessment,recordHazardAssessment} from './troubleshooting-hazard-assessment.js';
const exact=(x,keys)=>x&&Object.getPrototypeOf(x)===Object.prototype&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
export function registerIncidentReviewRoutes(app,db,env=process.env){
 function mount(method,path,role,keys,service){
  app[method](path,async(req,res)=>{
   res.set('Cache-Control','no-store');
   if(!req.user||req.user.role!==role||!req.token||req.headers.authorization!=='Bearer '+req.token)return res.status(403).json({error:'REVIEW_SCOPE_DENIED'});
   const query=req.query;
   if(Object.keys(query).some(k=>method==='post'||!keys.includes(k)||typeof query[k]!=='string')||(method==='post'&&(!req.is('application/json')||!exact(req.body,keys))))return res.status(400).json({error:'REVIEW_INVALID'});
   if(!db.isMysqlConnected())return res.status(503).json({error:'REVIEW_UNAVAILABLE'});
   try{
    const policy=identityPolicy(env),pool=db.getPool(),id=await assertDatabaseIdentity(pool,policy);
    return res.json(await service(boundReportPool(pool,policy,id),{...(method==='post'?req.body:query),principal:req.user,installationId:id}));
   }catch(e){
    const code=e?.message;
    const status=['REVIEW_INVALID','HAZARD_INVALID'].includes(code)?400:['REVIEW_SCOPE_DENIED','HAZARD_SCOPE_DENIED'].includes(code)?403:code==='REVIEW_NOT_FOUND'?404:['REVIEW_CONFLICT','HAZARD_CONFLICT','HAZARD_NOT_ELIGIBLE'].includes(code)?409:503;
    return res.status(status).json({error:status===503?'REVIEW_NOT_CONFIRMED':code});
   }
  });
 }
 mount('get','/api/v1/troubleshooting/review-queue','SUPER_ADMIN',['after','category','status','deviceId'],listIncidentReviews);
 mount('get','/api/v1/troubleshooting/my-reports','MONITORING',['after'],listEmployeeIncidentReviews);
 mount('get','/api/v1/troubleshooting/hazard-assessment','SUPER_ADMIN',['incidentId','deviceId'],inspectHazardAssessment);
 mount('post','/api/v1/troubleshooting/hazard-assessment','SUPER_ADMIN',['incidentId','deviceId','requestId','assessment','confirmation'],recordHazardAssessment);
 mount('post','/api/v1/troubleshooting/review-transition','SUPER_ADMIN',['incidentId','deviceId','requestId','expectedRevision','nextState','confirmation'],transitionIncidentReview);
}
