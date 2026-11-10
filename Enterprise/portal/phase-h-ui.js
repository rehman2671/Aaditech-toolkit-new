/* Aaditech Toolkit Phase H — first-run wizard and editable admin configuration.
   Uses the existing portal styles and authentication token; never displays secrets. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const value = id => ($ (id)?.value || '').trim();
  const escText = text => String(text == null ? '' : text).replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stages=['Company & Admin','Network & Database','Secure Setup','Agent Delivery','Integrations','Review & Finish'];
  let step=0;
  function error(message) {if($('setup_err'))$('setup_err').textContent=message||'';}
  function validate(n) {
    error('');
    if(n===0) {
      if(value('company_name').length<2)return error('Company name must contain at least 2 characters.'),false;
      if(value('admin_username').length<3)return error('Administrator username must contain at least 3 characters.'),false;
      if(($('admin_password')?.value||'').length<12)return error('Administrator password must have at least 12 characters.'),false;
      if($('admin_password').value!==$('admin_password2').value)return error('Passwords do not match.'),false;
      if(value('admin_email')&&!$('admin_email').checkValidity())return error('Enter a valid administrator email.'),false;
    }
    if(n===1) {
      if(!/^[a-zA-Z0-9.[\]:-]{1,253}$/.test(value('server_host')))
        return error('Enter a server hostname or IP, without protocol, spaces or path.'),false;
      if(value('setup_network_mode')==='public'&&location.protocol!=='https:')
        return error('Public deployment requires verified HTTPS. Use local mode first.'),false;
    }
    if(n===2&&!value('setup_code'))return error('Read and enter the local server setup code.'),false;
    if(n===4) {
      if(value('smtp_provider')!=='none')for(const id of ['smtp_email','smtp_recipient']) {
        if(value(id)&&!$(id).checkValidity())return error('Enter valid SMTP addresses.'),false;
      }
    }
    return true;
  }
  function show(n) {
    step=n;
    document.querySelectorAll('[data-setup-stage]').forEach(node=>{
      node.hidden=Number(node.dataset.setupStage)!==n;
    });
    $('setup_progress').textContent=(n+1)+' / '+stages.length+' — '+stages[n];
    $('setup_back').disabled=n===0;
    $('setup_next').style.display=n===5?'none':'';
    $('setup_finish').style.display=n===5?'':'none';
    error('');
    if(n===5) {
      const fields=[
        ['Organization',value('company_name')],['Administrator',value('admin_username')],
        ['Host',value('server_host')],['Deployment',value('setup_network_mode')],
        ['Agent build',value('build_mode')],['SMTP provider',value('smtp_provider')],
        ['GitHub repository',value('github_repo')||'Not configured']
      ];
      $('setup_review').innerHTML=fields.map(([k,v])=>
        '<div><strong>'+escText(k)+':</strong> '+escText(v)+'</div>').join('');
    }
  }
  function next(diff) {
    if(diff>0&&!validate(step))return;
    show(Math.max(0,Math.min(5,step+diff)));
  }
  function refreshIntegrations() {
    $('smtp_fields').hidden=value('smtp_provider')==='none';
    $('smtp_custom').hidden=value('smtp_provider')!=='custom';
    $('github_fields').hidden=value('build_mode')!=='github';
  }
  window.phaseHRenderSetup=function() {
    const root=$('app');
    step=0;
    document.body.classList.add('auth');
    $('header').style.display='none';
    root.innerHTML=[
      '<div class="card" style="max-width:840px;margin:4vh auto;padding:26px">',
      '<h2>Aaditech Toolkit — First-Time Setup</h2>',
      '<p class="muted">Complete six steps. You can edit configuration later from Admin → System Settings.</p>',
      '<div id="setup_progress" style="margin:18px 0;font-weight:700"></div>',
      '<section data-setup-stage="0"><h3>Company & Administrator</h3>',
      '<label>Company name *</label><input id="company_name" maxlength="120" autocomplete="organization">',
      '<label>Admin username *</label><input id="admin_username" maxlength="64" autocomplete="username" value="admin">',
      '<label>Admin email (optional)</label><input id="admin_email" type="email" autocomplete="email">',
      '<label>Admin password (minimum 12 characters) *</label><input id="admin_password" type="password" autocomplete="new-password">',
      '<label>Confirm admin password *</label><input id="admin_password2" type="password" autocomplete="new-password">',
      '<label>Brand color</label><input id="branding_color" type="color" value="#38bdf8"></section>',
      '<section data-setup-stage="1" hidden><h3>Network & Database</h3>',
      '<label>Deployment mode</label><select id="setup_network_mode">',
      '<option value="local">Local test / this computer</option><option value="lan">Organization LAN</option>',
      '<option value="public">Public domain — HTTPS required</option></select>',
      '<label>Agent-reachable server hostname or IP *</label><input id="server_host" maxlength="253">',
      '<p class="muted">MySQL credentials are provisioned by the local bootstrap script, not entered into a web form.</p>',
      '<p class="muted" id="setup_database_state">Checking database connection…</p></section>',
      '<section data-setup-stage="2" hidden><h3>Security & Ownership</h3>',
      '<p>Strong application keys are generated and preserved on the server. Do not paste them into this browser.</p>',
      '<p>Retrieve <code>/data/first-run-setup-code</code> using a local Docker terminal.</p>',
      '<label>Local first-run setup code *</label><input id="setup_code" type="password" autocomplete="off">',
      '<p class="muted">The initial HTTP setup port must only be accessible from the server itself.</p></section>',
      '<section data-setup-stage="3" hidden><h3>Windows Agent Delivery</h3>',
      '<label>Agent MSI build mode</label><select id="build_mode">',
      '<option value="manual">Manual MSI build / upload</option>',
      '<option value="github">GitHub Actions Windows runner</option>',
      '<option value="local_windows">Local Windows build</option></select>',
      '<p class="muted">The repository MSI fixtures are not real installers. Agent deployment stays blocked until signed MSI validation passes.</p>',
      '<p class="muted">Changing a server address will not automatically migrate enrolled endpoints.</p></section>',
      '<section data-setup-stage="4" hidden><h3>Optional Integrations</h3>',
      '<p class="muted">Skip these integrations and configure them later from System Settings.</p>',
      '<label>SMTP provider</label><select id="smtp_provider"><option value="none">Disabled</option>',
      '<option value="hostinger">Hostinger</option><option value="office365">Microsoft 365</option>',
      '<option value="gmail">Gmail</option><option value="custom">Custom SMTP</option></select>',
      '<div id="smtp_fields" hidden><label>Sender email</label><input id="smtp_email" type="email">',
      '<label>SMTP password / app password</label><input id="smtp_password" type="password" autocomplete="new-password">',
      '<label>Recipient email</label><input id="smtp_recipient" type="email">',
      '<div id="smtp_custom" hidden><label>SMTP host</label><input id="smtp_host">',
      '<label>SMTP port</label><input id="smtp_port" type="number" min="1" max="65535" value="587">',
      '<label>Encryption</label><select id="smtp_encryption"><option value="starttls">STARTTLS</option>',
      '<option value="ssl">SSL/TLS</option><option value="none">None</option></select></div></div>',
      '<div id="github_fields" hidden><label>GitHub repository (owner/repo)</label><input id="github_repo">',
      '<label>GitHub Actions token (optional)</label><input id="github_token" type="password" autocomplete="new-password"></div>',
      '<p class="muted">Integration credentials are encrypted. Connection verification must be performed separately.</p></section>',
      '<section data-setup-stage="5" hidden><h3>Review & Finish</h3>',
      '<p>Review the configuration; passwords and setup code are not displayed.</p>',
      '<div id="setup_review" style="padding:12px;border:1px solid var(--line);line-height:1.9"></div>',
      '<p class="muted">Finish commits administrator credentials and required configuration.</p></section>',
      '<div id="setup_err" class="error" role="alert" aria-live="polite"></div>',
      '<div class="row" style="margin-top:20px;justify-content:space-between">',
      '<button class="ghost" id="setup_back">Back</button>',
      '<button class="action" id="setup_next">Next</button>',
      '<button class="action" id="setup_finish" style="display:none">Finish Setup</button>',
      '</div></div>'
    ].join('');
    $('server_host').value=location.hostname||'localhost';
    if(window.__defaultBuildMode&&[...$('build_mode').options].some(o=>o.value===window.__defaultBuildMode))
      $('build_mode').value=window.__defaultBuildMode;
    $('smtp_provider').addEventListener('change',refreshIntegrations);
    $('build_mode').addEventListener('change',refreshIntegrations);
    $('setup_next').addEventListener('click',()=>next(1));
    $('setup_back').addEventListener('click',()=>next(-1));
    $('setup_finish').addEventListener('click',()=>{
      if([0,1,2,4].some(n=>!validate(n)))return;
      $('setup_finish').disabled=true;
      Promise.resolve(window.doSetup()).finally(()=>{
        const el=$('setup_finish');if(el)el.disabled=false;
      });
    });
    refreshIntegrations();show(0);
    fetch('/api/setup/status',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject(r.status))
      .then(data=>{$('setup_database_state').textContent=data.database_connected?
        'MySQL connected; server confirms database connectivity.':
        'Database offline; setup cannot be completed.';})
      .catch(()=>{$('setup_database_state').textContent='Database unavailable. Inspect container logs.';});
  };

  const authHeaders=()=>({'Content-Type':'application/json',
    ...(localStorage.getItem('auth_token')?
      {'Authorization':'Bearer '+localStorage.getItem('auth_token')}:{})});
  window.phaseHRenderSystemSettings=async function() {
    if((window.user?.role||'').toUpperCase()!=='SUPER_ADMIN')return window.gotoView('dashboard');
    const root=$('app');
    let cfg;
    try{
      const r=await fetch('/api/v1/system/config',{headers:authHeaders()});
      if(!r.ok)throw new Error('Settings request failed: HTTP '+r.status);
      cfg=await r.json();
    }catch(e){root.innerHTML='<div class="card error">'+escText(e.message)+'</div>';return;}
    const smtp=cfg.smtp||{};
    root.innerHTML=[
      '<div class="card"><h3>System Settings</h3>',
      '<p class="muted">Stored settings can be edited without reinstalling. Environment secrets and database credentials remain host-managed.</p>',
      '<label>Company name</label><input id="sys_company">',
      '<label>Server host or IP</label><input id="sys_host">',
      '<label>Brand color</label><input id="sys_color" type="color">',
      '<label>Logo text</label><input id="sys_logo">',
      '<label>Build mode</label><select id="sys_build"><option value="manual">Manual</option>',
      '<option value="github">GitHub Actions</option><option value="local_windows">Windows Local</option></select>',
      '<label>GitHub repository</label><input id="sys_repo">',
      '<label>New GitHub token (blank keeps existing)</label><input id="sys_git_token" type="password" autocomplete="new-password">',
      '<p class="muted" id="sys_git_status"></p>',
      '<label><input id="sys_clear_github" type="checkbox" style="width:auto"> Clear stored GitHub token</label>',
      '<label>SMTP provider</label><select id="sys_provider">',
      '<option value="none">Disabled</option><option value="hostinger">Hostinger</option>',
      '<option value="office365">Microsoft 365</option><option value="gmail">Gmail</option>',
      '<option value="custom">Custom</option></select>',
      '<label>SMTP email</label><input id="sys_email" type="email">',
      '<label>Notification recipient</label><input id="sys_recipient" type="email">',
      '<label>SMTP host</label><input id="sys_smtp_host">',
      '<label>SMTP port</label><input id="sys_port" type="number" min="1" max="65535">',
      '<label>SMTP encryption</label><select id="sys_enc"><option value="starttls">STARTTLS</option>',
      '<option value="ssl">SSL/TLS</option><option value="none">None</option></select>',
      '<label>New SMTP password (blank keeps existing)</label><input id="sys_password" type="password" autocomplete="new-password">',
      '<label><input id="sys_clear_password" type="checkbox" style="width:auto"> Clear saved SMTP password</label>',
      '<p class="muted">Existing enrolled agents require controlled migration when server host changes.</p>',
      '<div id="sys_msg" class="error" role="status"></div>',
      '<div class="row"><button class="action" id="sys_save">Save Settings</button>',
      '<button class="ghost" id="sys_test">Test MySQL connection</button></div>',
      '</div>'
    ].join('');
    const set=(id,val)=>{$(id).value=val??'';};
    set('sys_company',cfg.company_name);set('sys_host',cfg.server_host);
    set('sys_color',cfg.branding?.color||'#38bdf8');set('sys_logo',cfg.branding?.logo_text||'IT-Toolkit');
    set('sys_build',cfg.build_mode||'manual');set('sys_repo',cfg.github_repo);
    set('sys_provider',smtp.provider||'none');set('sys_email',smtp.email);
    set('sys_recipient',smtp.recipient);set('sys_smtp_host',smtp.host);
    set('sys_port',smtp.port);set('sys_enc',smtp.encryption||'starttls');
    $('sys_git_status').textContent=cfg.github_token_managed_by_environment?
      'GitHub token is managed by the server environment; edit it on the host.':
      cfg.github_token_configured?'Encrypted GitHub token saved (value hidden).':
      'No GitHub token configured.';
    $('sys_clear_github').disabled=Boolean(cfg.github_token_managed_by_environment);
    $('sys_save').addEventListener('click',async()=>{
      $('sys_msg').textContent='';
      const body={
        company_name:value('sys_company'),server_host:value('sys_host'),
        branding:{color:value('sys_color'),logo_text:value('sys_logo')},
        build_mode:value('sys_build'),github_repo:value('sys_repo'),
        smtp:{provider:value('sys_provider'),email:value('sys_email'),
          recipient:value('sys_recipient'),host:value('sys_smtp_host'),
          port:Number(value('sys_port'))||null,encryption:value('sys_enc'),
          password:$('sys_password').value}
      };
      if($('sys_git_token').value)body.github_token=$('sys_git_token').value;
      if($('sys_clear_github').checked)body.clear_github_token=true;
      if($('sys_clear_password').checked)body.clear_smtp_password=true;
      try{
        const res=await fetch('/api/v1/system/config',{
          method:'PATCH',headers:authHeaders(),body:JSON.stringify(body)});
        const response=await res.json().catch(()=>({}));
        if(!res.ok)throw new Error(response.error||'HTTP '+res.status);
        await window.phaseHRenderSystemSettings();
        const msg=$('sys_msg');if(msg)msg.textContent='Settings saved.';
      }catch(e){$('sys_msg').textContent=e.message;}
    });
    $('sys_test').addEventListener('click',async()=>{
      try{
        const res=await fetch('/api/v1/system/config/test',{method:'POST',
          headers:authHeaders(),body:JSON.stringify({kind:'database'})});
        const data=await res.json();
        $('sys_msg').textContent='Database status: '+(data.status||'UNAVAILABLE');
      }catch(e){$('sys_msg').textContent='Database test failed: '+e.message;}
    });
  };
})();
