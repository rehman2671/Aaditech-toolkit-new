import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../Enterprise/portal/index.html', import.meta.url), 'utf8');
const msiSection = source.split('// ---------------------------------------------------------------- MSI Subsystem')[1]
  ?.split('// ---------------------------------------------------------------- Patch & Security Compliance')[0];
const stats = 'function statCardsEl(cards) {' +
  source.split('function statCardsEl(cards) {')[1]?.split('const VIEW_META')[0];
const esc = source.match(/^const esc = .*;$/m)?.[0];
const ic = source.match(/^const ic = .*;$/m)?.[0];

async function renderMsi(pkgs) {
  const app = { innerHTML: '' };
  const cards = { innerHTML: '' };
  const alerts = [];
  const calls = [];
  const inputs = { msi_pkg_name: {value:'Agent'}, msi_version:{value:'1.2.3'},
    msi_group:{value:'office'}, msi_expiry:{value:'24'} };
  const api = async (path, options = {}) => {
    calls.push({ path, options });
    if(path === '/api/v1/msi/packages') return pkgs;
    if(path === '/api/v1/msi/generate') return {
      package_name: 'Agent', version: '1.2.3', status: 'PENDING',
      file_hash_sha256: null
    };
    throw new Error('Unexpected API route '+path);
  };
  const context=vm.createContext({app, api, alert:x=>alerts.push(x), Date, Math,
    encodeURIComponent, document:{getElementById:id=>id==='statcards'?cards:inputs[id]||null}});
  vm.runInContext([esc,ic,stats,msiSection].join('\n'),context,{timeout:1000});
  await vm.runInContext('renderMsi()',context,{timeout:1000});
  return {app:app.innerHTML,cards:cards.innerHTML,alerts,calls,context};
}

const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const future=()=>new Date(Date.now()+3_600_000).toISOString();
const recent=()=>new Date(Date.now()-3_600_000).toISOString();
const ready=(extra={})=>({
  id,package_name:'Agent',version:'1.2.3',status:'READY',
  file_hash_sha256:'b'.repeat(64),file_size_bytes:100,downloads_count:0,
  token_expires_at:future(),download_url:'https://evil.test/download',...extra
});

describe('FE-41 backend package request audit contract',()=> {
  it('records request creation, never claims a new signed MSI build',()=> {
    const backend = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    expect(backend).toContain('MSI_PACKAGE_REQUEST_CREATED');
    expect(backend).not.toContain('logAudit(req.user, "MSI_PACKAGE_GENERATED"');
    expect(backend).toContain("let packageStatus = 'PENDING'");
    expect(backend).toContain("packageStatus = 'READY'");
  });
});

describe('FE-41 MSI portal truthful signed-artifact status',()=>{
  it('shows a clear empty-state and no claimed signer or artifact',async()=>{
    const x=await renderMsi([]);
    expect(x.app).toContain('does not compile, customize, embed a token into, or sign');
    expect(x.app).toContain('No package requests yet');
    expect(x.app).not.toContain('Generate Signed MSI Package');
    expect(x.cards).toContain('Not connected');
    expect(x.app).not.toContain('HMAC-SHA256 Valid');
  });
  it('renders a PENDING response without null hash crashes or download',async()=>{
    const x=await renderMsi([ready({status:'PENDING',file_hash_sha256:null,file_size_bytes:0})]);
    expect(x.app).toContain('Pending — no built MSI');
    expect(x.app).toContain('N/A');
    expect(x.app).toContain('No approved installer download available');
    expect(x.app).not.toContain('href="https://evil.test');
    expect(x.app).not.toContain('Download MSI</a>');
  });
  it('limits ready link to a derived same-origin route but does not claim signing',async()=>{
    const x=await renderMsi([ready()]);
    expect(x.app).toContain('Artifact recorded (signing not verified here)');
    expect(x.app).toContain('/api/v1/msi/download/'+id);
    expect(x.app).not.toContain('https://evil.test');
    expect(x.app).toContain('Attempt approved artifact download');
    expect(x.app).toContain('bbbbbbbbbbbbbbbb…');
    expect(x.cards).toContain('Locally indexed artifacts');
  });
  it('refuses expired, bad hash, malformed ID or missing byte-size artifact links',async()=>{
    const x=await renderMsi([
      ready({token_expires_at:recent()}),
      ready({id:'javascript:alert(1)'}),
      ready({file_hash_sha256:null}),
      ready({file_size_bytes:0})
    ]);
    expect(x.app).toContain('Expired');
    expect(x.app).not.toContain('href="/api/v1/msi/download/');
    expect(x.app).not.toContain('javascript:alert');
  });
  it('escapes hostile package names and never uses API-supplied external download_url',async()=>{
    const attack='<img src=x onerror=alert(1)>';
    const x=await renderMsi([ready({package_name:attack,version:attack,download_url:'javascript:alert(1)'})]);
    expect(x.app).toContain('&lt;img');
    expect(x.app).not.toContain('<img');
    expect(x.app).not.toContain('javascript:alert');
  });
  it('does not treat unknown status or missing expiry as approved ready',async()=>{
    const x=await renderMsi([ready({status:'SIGNED',token_expires_at:null})]);
    expect(x.app).toContain('Unverified artifact');
    expect(x.app).toContain('N/A');
    expect(x.app).not.toContain('href="/api/v1/msi/download/');
  });
  it('creates a package request and accurately states no installer was signed',async()=>{
    const x=await renderMsi([]);
    await vm.runInContext('generateMsiPackage()',x.context,{timeout:1000});
    expect(x.calls.some(c=>c.path==='/api/v1/msi/generate' && c.options.method==='POST')).toBe(true);
    expect(x.alerts.join(' ')).toContain('No new signed installer was built');
    expect(x.alerts.join(' ')).not.toContain('generated successfully');
  });
  it('does not crash when the package collection is null or malformed',async()=>{
    const a=await renderMsi(null);
    expect(a.app).toBe('');
    const b=await renderMsi({other:'wrong shape'});
    expect(b.app).toContain('No package requests yet');
  });
});
