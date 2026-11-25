// Stage N17: stateless, crash-recoverable notification outbox consumer.
// Shared authoritative state is the database; no in-process delivery queue.
import * as db from './db.js';
import { deliverTenantWebhook } from './tenant-alert-safety.js';
import { deliverTenantEmail } from './smtp-alerts.js';
import { matchesQueuedDestination } from './notification-destination.js';
import {admitOutboxDispatch} from './durable-delivery-boundary.js';

export async function deliverOutboxEntry(row, adapters = {}) {
  if (typeof row?.tenant_id !== 'string' || !row.tenant_id.trim() || !['webhook', 'email'].includes(row.channel)) {
    return { outcome: 'SKIPPED', reason: 'INVALID_OUTBOX_TARGET' };
  }
  let event;
  try {
    event = typeof row.payload_json === 'string'
      ? JSON.parse(row.payload_json) : row.payload_json;
  } catch {
    return { outcome: 'SKIPPED', reason: 'INVALID_OUTBOX_PAYLOAD' };
  }
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return { outcome: 'SKIPPED', reason: 'INVALID_OUTBOX_PAYLOAD' };
  }

  if (row.channel === 'webhook') {
    const config = await (adapters.getWebhookConfig || db.getTenantWebhookConfig)(row.tenant_id);
    if (config?.enabled !== true) return { outcome: 'SKIPPED', reason: 'DISABLED' };
    // Historical NULL rows and reconfigured destinations must never be sent
    // to the new tenant endpoint, even with a fresh opt-in.
    if ((adapters.verifyDestination || matchesQueuedDestination)(row, config) !== true) {
      return { outcome: 'SKIPPED', reason: 'DESTINATION_CHANGED_OR_UNBOUND' };
    }
    if(adapters.beforeDispatch){
      const admission=await adapters.beforeDispatch(row);
      if(admission!=='READY')return {outcome:admission};
    }
    const result = await (adapters.sendWebhook || deliverTenantWebhook)(
      row.tenant_id, config, event
    );
    if (result?.dispatched === true) return { outcome: 'DELIVERED' };
    if (['WEBHOOK_URL_NOT_APPROVED', 'WEBHOOK_PAYLOAD_TOO_LARGE', 'DISABLED']
      .includes(result?.reason)) return { outcome: 'SKIPPED', reason: result.reason };
    return { outcome: 'RETRY', reason: 'WEBHOOK_DELIVERY_FAILED' };
  }

  const config = await (adapters.getEmailConfig || db.getTenantEmailConfig)(row.tenant_id);
  if (config?.enabled !== true) return { outcome: 'SKIPPED', reason: 'DISABLED' };
  if ((adapters.verifyDestination || matchesQueuedDestination)(row, config) !== true) {
    return { outcome: 'SKIPPED', reason: 'DESTINATION_CHANGED_OR_UNBOUND' };
  }
  if(adapters.beforeDispatch){
    const admission=await adapters.beforeDispatch(row);
    if(admission!=='READY')return {outcome:admission};
  }
  const result = await (adapters.sendEmail || deliverTenantEmail)(
    row.tenant_id, config, event
  );
  if (result?.accepted === true) return { outcome: 'DELIVERED' };
  if (['RECIPIENT_NOT_APPROVED', 'DISABLED'].includes(result?.reason)) {
    return { outcome: 'SKIPPED', reason: result.reason };
  }
  return { outcome: 'RETRY', reason: 'SMTP_DELIVERY_FAILED' };
}

export async function runNotificationOutboxBatch(adapters = {}) {
  const claim = adapters.claim || db.claimNotificationOutbox;
  const complete = adapters.complete || db.finishNotificationOutbox;
  const retry = adapters.retry || db.retryNotificationOutbox;
  const empty = { processed: 0, delivered: 0, skipped: 0, retried: 0, lostLease: 0 };
  const canStart=adapters.canStart||(()=>true);
  const renewLease=adapters.renewLease||db.renewNotificationOutboxLease;
  const beforeDispatch=row=>admitOutboxDispatch(row,{canStart,renewLease});
  if(canStart()!==true)return empty;
  const rows = await claim(20);
  if (!Array.isArray(rows) || !rows.length) return empty;
  const counts = { ...empty };
  // Five concurrent messages per group; DB claim lease is 300 seconds.
  // External delivery remains at-least-once if a crash occurs before the ACK.
  for (let i = 0; i < rows.length; i += 5) {
    if(canStart()!==true)break;
    const settled=await Promise.allSettled(rows.slice(i, i + 5).map(async row => {
      if(canStart()!==true)return;
      let outcome;
      try {
        outcome = await deliverOutboxEntry(row, {...adapters,beforeDispatch});
      } catch {
        outcome = { outcome: 'RETRY', reason: 'DELIVERY_EXCEPTION' };
      }
      if(outcome.outcome==='DEFERRED')return;
      if(outcome.outcome==='LEASE_UNCONFIRMED')throw Error('OUTBOX_LEASE_RENEWAL_UNCONFIRMED');
      if(outcome.outcome==='LOST_LEASE'){counts.lostLease++;counts.processed++;return}
      if (outcome.outcome === 'DELIVERED') {
        if (await complete(row.id, row.lease_token, 'DELIVERED')) counts.delivered += 1;
        else counts.lostLease += 1;
      } else if (outcome.outcome === 'SKIPPED') {
        if (await complete(row.id, row.lease_token, 'SKIPPED')) counts.skipped += 1;
        else counts.lostLease += 1;
      } else {
        if (await retry(row, outcome.reason || 'DELIVERY_FAILED')) counts.retried += 1;
        else counts.lostLease += 1;
      }
      counts.processed += 1;
    }));
    if(settled.some(x=>x.status==='rejected'))throw Error('OUTBOX_BATCH_UNCONFIRMED');
  }
  return counts;
}

export function startNotificationOutboxWorker(intervalMs = 5000) {
  if (process.env.NODE_ENV !== 'production') return () => {};
  let running = false,stopped=false,active=null;
  let ticks = 0;
  const run = async () => {
    if (stopped || running || !db.isMysqlConnected()) return;
    running = true;
    try {
      await runNotificationOutboxBatch({canStart:()=>!stopped&&db.isMysqlConnected()});
      if (!stopped&&++ticks % 720 === 0) await db.pruneNotificationOutbox();
    } catch (err) {
      // Codes only: never log event data, credentials or destination addresses.
      console.error('Notification outbox cycle failed:', err.code || 'DATABASE_UNAVAILABLE');
    } finally {
      running = false;
    }
  };
  const tick=()=>{if(!stopped&&!running)active=run()};
  const timer=setInterval(tick,Math.max(1000,intervalMs));
  timer.unref?.();tick();
  return async()=>{stopped=true;clearInterval(timer);await active};
}
