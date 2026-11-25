import {test,expect} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createHttpWorkTracker,installHttpRouteTracking} from '../../http-work-tracker.js';
const fixture=()=>{const app=express(),tracker=createHttpWorkTracker();installHttpRouteTracking(app,tracker);return {app,tracker}};
test('actual Express setting getter and nested route handlers retain normal behavior',async()=>{
 const {app,tracker}=fixture();app.set('fixture','value');expect(app.get('fixture')).toBe('value');
 app.get('/fixture',[(req,res,next)=>{res.locals.x=1;next()},[async(req,res)=>res.json({x:res.locals.x})]]);
 await request(app).get('/fixture').expect(200,{x:1});await tracker.sealAndDrain();
});
test('actual Express routes forward returned rejection through the error middleware',async()=>{
 const {app,tracker}=fixture();app.get('/fixture',async()=>{throw Error('fixture')});app.use((err,req,res,next)=>res.status(500).json({error:'fixture'}));
 await request(app).get('/fixture').expect(500,{error:'fixture'});await tracker.sealAndDrain();
});
test('actual Express authentication middleware and async route preserve ordering',async()=>{
 const {app,tracker}=fixture();app.use(tracker.wrap(async(req,res,next)=>{await Promise.resolve();res.locals.auth=true;next()}));app.post('/fixture',async(req,res)=>res.json({auth:res.locals.auth}));
 await request(app).post('/fixture').expect(200,{auth:true});await tracker.sealAndDrain();
});
test('actual Express sealed admission rejects new requests',async()=>{
 const {app,tracker}=fixture();let called=false;app.get('/fixture',(req,res)=>{called=true;res.end()});await tracker.sealAndDrain();
 await request(app).get('/fixture').expect(503,{error:'SERVER_DRAINING'});expect(called).toBe(false);
});
