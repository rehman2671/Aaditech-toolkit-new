import { describe, it, expect } from 'vitest';
import { validateEnrollmentIdentity, validateFreshEnrollment, matchesEnrolledDeviceIdentifier, extractEnrolledDeviceHeaderToken } from '../../enrollment-security.js';

const tenantA = '00000000-0000-0000-0000-000000000001';
const tenantB = '00000000-0000-0000-0000-000000000002';
const companyA = { id: 1, tenant_id: tenantA };
const companyB = { id: 2, tenant_id: tenantB };
const hostA = { id: 'device-a', tenant_id: tenantA, hostname: 'LAPTOP-01' };
const hostB = { id: 'device-b', tenant_id: tenantB, hostname: 'LAPTOP-01' };

describe('tenant-safe first-run device enrollment', () => {
  it('permits a brand-new device with a matching tenant company', () => {
    expect(validateEnrollmentIdentity({
      tenantId: tenantA, existingHost: null, existingUid: null, company: companyA
    })).toEqual({ ok: true });
  });

  it('allows a device to re-enroll in its own tenant when hostname and uid match', () => {
    expect(validateEnrollmentIdentity({
      tenantId: tenantA, existingHost: hostA,
      existingUid: { ...hostA }, company: companyA
    })).toEqual({ ok: true });
  });

  it('rejects a same-hostname device in another workspace before token consumption', () => {
    expect(validateEnrollmentIdentity({
      tenantId: tenantB, existingHost: hostA, existingUid: null, company: companyB
    })).toMatchObject({ ok: false, status: 409, code: 'DEVICE_TENANT_CONFLICT' });
  });

  it('rejects a device uid already claimed by a different workspace', () => {
    expect(validateEnrollmentIdentity({
      tenantId: tenantA, existingHost: null, existingUid: hostB, company: companyA
    })).toMatchObject({ ok: false, status: 409, code: 'DEVICE_TENANT_CONFLICT' });
  });

  it('does not allow reusing an existing uid for a different host in same workspace', () => {
    expect(validateEnrollmentIdentity({
      tenantId: tenantA, existingHost: { ...hostA },
      existingUid: { ...hostA, id: 'another-device' }, company: companyA
    })).toMatchObject({ ok: false, status: 409, code: 'DEVICE_UID_CONFLICT' });
  });

  it('rejects an ambiguous duplicated hostname owned by another tenant even when the first record matches', () => {
    expect(validateEnrollmentIdentity({
      tenantId: tenantA, existingHost: hostA, existingUid: null, company: companyA,
      matchingDevices: [hostA, hostB]
    })).toMatchObject({ ok: false, code: 'DEVICE_TENANT_CONFLICT' });
  });

  it('rejects distinct duplicate device records within a single tenant', () => {
    expect(validateEnrollmentIdentity({
      tenantId: tenantA, existingHost: hostA, existingUid: null, company: companyA,
      matchingDevices: [hostA, { ...hostA, id: 'duplicate-device' }]
    })).toMatchObject({ ok: false, code: 'DEVICE_UID_CONFLICT' });
  });

  it('rejects takeover of a known hostname with a different device UID', () => {
    expect(validateEnrollmentIdentity({
      tenantId: tenantA, existingHost: { ...hostA, device_uid: 'dev-uid-laptop-01' },
      existingUid: null, company: companyA,
      requestedUid: 'dev-uid-attacker'
    })).toMatchObject({ ok: false, code: 'DEVICE_UID_CONFLICT' });
  });

  it('rejects a token tenant that has no company or points at a different company', () => {
    for (const company of [null, companyB]) {
      expect(validateEnrollmentIdentity({
        tenantId: tenantA, existingHost: null, existingUid: null, company
      })).toMatchObject({ ok: false, status: 409, code: 'TENANT_COMPANY_MISSING' });
    }
  });
});


describe('first-use enrollment and exact device identity', () => {
  it('rejects an existing identity even with the same tenant and UID', () => {
    expect(validateFreshEnrollment([])).toEqual({ok:true});
    expect(validateFreshEnrollment([hostA])).toMatchObject({ok:false,status:409,code:'DEVICE_ALREADY_REGISTERED'});
    expect(validateFreshEnrollment(null)).toMatchObject({ok:false,status:503});
  });
  it('matches only persisted ID, UID or full hostname (case-insensitive)', () => {
    const d={id:'id-123',device_uid:'uid-123',hostname:'PC01.office.example'};
    for (const x of ['id-123','UID-123','pc01.office.example']) expect(matchesEnrolledDeviceIdentifier(d,x)).toBe(true);
    for (const x of ['pc01','pc01.other.example','dev-uid-pc01','',null]) expect(matchesEnrolledDeviceIdentifier(d,x)).toBe(false);
  });
});

describe('deployed agent credential transport', () => {
  const token='itk_dev_'+'a'.repeat(48);
  const other='itk_dev_'+'b'.repeat(48);
  it('accepts canonical enrolled token or matching bearer headers', () => {
    expect(extractEnrolledDeviceHeaderToken({'x-device-token':token})).toBe(token);
    expect(extractEnrolledDeviceHeaderToken({authorization:'Bearer '+token})).toBe(token);
    expect(extractEnrolledDeviceHeaderToken({'x-device-token':token,authorization:'Bearer '+token})).toBe(token);
  });
  it('refuses legacy/bootstrap headers, malformed and conflicting credentials', () => {
    for(const headers of [
      {}, {'x-agent-token':token}, {'x-bootstrap-token':token},
      {'x-device-token':token+'\n'}, {'x-device-token':[token]},
      {'x-device-token':token+', '+other}, {'x-device-token':'wrong',authorization:'Bearer '+token},
      {'x-device-token':token,authorization:'Bearer '+other},
      {authorization:'Bearer '+token+' '}, {authorization:'Basic '+token}
    ]) expect(extractEnrolledDeviceHeaderToken(headers)).toBeNull();
  });
});
