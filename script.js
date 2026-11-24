(() => {
  const toast = document.querySelector('.toast');
  const toastMessage = document.querySelector('.toast-message');
  let workflowName='My workflow';let currentLanguage='javascript';let hasSavedDraft=false;let workflowId=null;let isCreatingWorkflow=false;let restoringWorkflow=false;
  const workflowsKey='flowstate-workflows-v1';let workflows=[];let legacyDraft=null;
  function makeId(prefix='flow'){return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;}
  try{workflows=JSON.parse(localStorage.getItem(workflowsKey)||'[]');if(!Array.isArray(workflows))workflows=[];}catch{workflows=[];}
  try{legacyDraft=JSON.parse(localStorage.getItem('flowstate-draft-v1')||'null');}catch{}
  if(legacyDraft?.steps){workflowId=legacyDraft.workflowId||legacyDraft.id||makeId();legacyDraft={...legacyDraft,id:workflowId,workflowId,name:legacyDraft.name||legacyDraft.workflowName||'My workflow',createdAt:legacyDraft.createdAt||legacyDraft.updatedAt||Date.now()};const index=workflows.findIndex(item=>item.id===workflowId);if(index<0)workflows.push(legacyDraft);else workflows[index]={...workflows[index],...legacyDraft};workflowName=legacyDraft.name;currentLanguage=legacyDraft.language||'javascript';hasSavedDraft=true;try{localStorage.setItem(workflowsKey,JSON.stringify(workflows));}catch{}}
  let workflowSyncQueue = Promise.resolve();
  function persistWorkflows(){
    try{localStorage.setItem(workflowsKey,JSON.stringify(workflows));}catch{notify('Could not save: browser storage may be full or disabled.');return false;}
    if (accountState?.user) {
      const snapshot = JSON.stringify({workflows});
      workflowSyncQueue = workflowSyncQueue.then(async () => {
        try { const response = await fetch('/api/workflows', {method:'POST', credentials:'same-origin', headers:{'content-type':'application/json'}, body:snapshot}); const data = await response.json(); if (!response.ok) notify(data.error || 'Cloud save failed.'); }
        catch { notify('Cloud save failed. Your local copy is still saved in this browser.'); }
      });
    }
    return true;
  }
  const metricKey='flowstate-local-metrics-v1';
  let metrics={days:{},previewRunsByDay:{},previewRuns:0,exports:0,verifiedSavedSeconds:0,events:[]};
  try { metrics={...metrics,...JSON.parse(localStorage.getItem(metricKey)||'{}')};metrics.days||={};metrics.previewRunsByDay||={};metrics.events||=[]; } catch {}
  function storeMetrics(){try{localStorage.setItem(metricKey,JSON.stringify(metrics));}catch{}}
  function dateKey(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
  function weekKeys(){const today=new Date();today.setHours(0,0,0,0);return Array.from({length:7},(_,index)=>{const date=new Date(today);date.setDate(date.getDate()-6+index);return dateKey(date);});}
  function durationLabel(seconds){if(seconds===0)return '0m';if(seconds<60)return `${seconds}s`;const minutes=Math.floor(seconds/60);const hours=Math.floor(minutes/60);return hours?`${hours}h ${minutes%60}m`:`${minutes}m`;}
  function relativeLabel(timestamp){const seconds=Math.max(0,Math.floor((Date.now()-timestamp)/1000));if(seconds<60)return 'just now';if(seconds<3600)return `${Math.floor(seconds/60)}m ago`;if(seconds<86400)return `${Math.floor(seconds/3600)}h ago`;return `${Math.floor(seconds/86400)}d ago`;}
  function recordDashboardEvent(title,detail){metrics.events.unshift({title,detail,time:Date.now()});metrics.events=metrics.events.slice(0,20);storeMetrics();refreshDashboard();}
  function refreshDashboard(){
    const days=weekKeys();const activeSeconds=days.reduce((sum,key)=>sum+(Number(metrics.days[key])||0),0);
    const activeNode=document.querySelector('[data-active-time]');if(activeNode)activeNode.textContent=durationLabel(activeSeconds);
    const savedNode=document.querySelector('[data-time-saved]');if(savedNode)savedNode.textContent=durationLabel(Number(metrics.verifiedSavedSeconds)||0);
    const previewNode=document.querySelector('[data-preview-runs]');if(previewNode)previewNode.textContent=String(metrics.previewRuns||0);const plan=currentPlan();const runsUsage=document.querySelector('[data-runs-usage]');if(runsUsage)runsUsage.textContent=`${metrics.previewRuns||0} local previews · not hosted runs`;const workflowsUsage=document.querySelector('[data-workflows-usage]');if(workflowsUsage)workflowsUsage.textContent=Number.isFinite(plan.workflows)?`${workflows.length} of ${plan.workflows} active workflows · ${plan.name}`:`${workflows.length} active workflows · ${plan.name}`;
    const range=document.querySelector('[data-date-range]');if(range){const start=new Date();start.setDate(start.getDate()-6);range.textContent=`${start.toLocaleDateString(undefined,{month:'short',day:'numeric'})} — ${new Date().toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}`;}
    const chart=document.querySelector('.usage-bars');if(chart){chart.replaceChildren(...days.map(key=>{const bar=document.createElement('i');const value=Number(metrics.days[key])||0;bar.style.height=`${Math.max(value?8:2,Math.min(100,value/3600*100))}%`;bar.title=`${key}: ${durationLabel(value)}`;return bar;}));}
    const previewChart=document.querySelector('.preview-bars');if(previewChart){const values=days.map(key=>Number(metrics.previewRunsByDay[key])||0);const peak=Math.max(0,...values);previewChart.replaceChildren(...values.map((value,index)=>{const bar=document.createElement('i');bar.style.height=`${peak?value?Math.max(10,value/peak*100):2:2}%`;bar.title=`${days[index]}: ${value} preview${value===1?'':'s'}`;return bar;}));}
    const workflowList=document.querySelector('#workflowList');if(workflowList){workflowList.replaceChildren();const sorted=[...workflows].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));const countNode=document.querySelector('[data-workflow-count]');if(countNode)countNode.textContent=String(sorted.length);
      if(sorted.length){for(const record of sorted){const row=document.createElement('div');row.className='workflow-row';row.tabIndex=0;row.dataset.workflowId=record.id;const name=document.createElement('span');name.className='workflow-name';const icon=document.createElement('i');icon.className='workflow-app notion';icon.textContent='⌁';const copy=document.createElement('span');const title=document.createElement('b');title.textContent=record.name||record.workflowName||'Untitled workflow';const subtitle=document.createElement('small');subtitle.textContent=`${record.steps?.length||0} steps · ${String(record.language||'javascript').toUpperCase()}`;copy.append(title,subtitle);name.append(icon,copy);const edited=document.createElement('span');edited.className='last-run';edited.textContent=relativeLabel(record.updatedAt||record.createdAt||Date.now());const status=document.createElement('span');status.className='status-pill paused';status.textContent='Saved here';const steps=document.createElement('span');steps.className='run-total';steps.textContent=String(record.steps?.length||0);const menu=document.createElement('button');menu.className='row-menu';menu.setAttribute('aria-label',`Options for ${title.textContent}`);menu.textContent='···';const actions=document.createElement('div');actions.className='workflow-actions';actions.hidden=true;for(const [action,label] of [['rename','Rename'],['duplicate','Duplicate'],['delete','Delete']]){const button=document.createElement('button');button.type='button';button.dataset.action=action;button.textContent=label;if(action==='delete')button.className='danger-action';actions.appendChild(button);}row.append(name,edited,status,steps,menu,actions);workflowList.appendChild(row);row.addEventListener('click',event=>{if(event.target.closest('button,.workflow-actions'))return;loadWorkflow(record.id);});row.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.target.closest('button'))loadWorkflow(record.id);});menu.addEventListener('click',event=>{event.stopPropagation();workflowList.querySelectorAll('.workflow-actions').forEach(item=>{if(item!==actions)item.hidden=true;});actions.hidden=!actions.hidden;if(!actions.hidden){const box=menu.getBoundingClientRect();actions.style.left=`${Math.max(8,Math.min(box.right-132,window.innerWidth-140))}px`;actions.style.top=`${box.bottom+6+112>window.innerHeight?Math.max(8,box.top-112):box.bottom+6}px`;}});actions.addEventListener('click',event=>{event.stopPropagation();const action=event.target.closest('button')?.dataset.action;if(action==='rename')renameWorkflow(record.id);if(action==='duplicate')duplicateWorkflow(record.id);if(action==='delete')deleteWorkflow(record.id);});}}
      else{const empty=document.createElement('div');empty.className='dashboard-empty';empty.innerHTML='No workflows saved yet. Select <b>＋ New workflow</b> to start.';workflowList.appendChild(empty);}
    }
    const activityList=document.querySelector('#activityList');if(activityList){activityList.replaceChildren();const events=metrics.events.slice(0,5);if(!events.length){const empty=document.createElement('div');empty.className='dashboard-empty';empty.textContent='Your workflow previews and exports will appear here.';activityList.appendChild(empty);}else for(const event of events){const row=document.createElement('div');row.className='activity-item';const icon=document.createElement('div');icon.className='activity-icon activity-success';icon.textContent='✓';const copy=document.createElement('span');const title=document.createElement('b');title.textContent=event.title;const detail=document.createElement('small');detail.textContent=event.detail;copy.append(title,detail);const when=document.createElement('time');when.textContent=relativeLabel(event.time);row.append(icon,copy,when);activityList.appendChild(row);}}
  }
  let lastActiveAt=Date.now();
  const markActive=()=>{lastActiveAt=Date.now();};
  function startUsageTracking(){
    ['pointerdown','keydown','scroll','touchstart'].forEach(type=>document.addEventListener(type,markActive,{passive:true}));
    setInterval(()=>{if(document.visibilityState==='visible'&&Date.now()-lastActiveAt<60000){const key=dateKey(new Date());metrics.days[key]=(Number(metrics.days[key])||0)+5;storeMetrics();refreshDashboard();}},5000);
    window.addEventListener('pagehide',storeMetrics);document.addEventListener('visibilitychange',markActive);refreshDashboard();
  }
  let activeDialog=null; let dialogReturnFocus=null;
  function openDialog(dialog, target) { dialogReturnFocus=document.activeElement; activeDialog=dialog; dialog.classList.add('open'); dialog.setAttribute('aria-hidden','false'); document.body.classList.add('dialog-open'); requestAnimationFrame(()=>dialog.querySelector(target||'button,input,[tabindex="0"]')?.focus()); }
  function closeDialog(dialog, restore=true) { dialog.classList.remove('open'); dialog.setAttribute('aria-hidden','true'); if(activeDialog===dialog){activeDialog=null;document.body.classList.remove('dialog-open');if(restore&&dialogReturnFocus?.isConnected)dialogReturnFocus.focus();} }
  document.addEventListener('keydown',(event)=>{
    if(!activeDialog)return;
    if(event.key==='Escape'){event.preventDefault();activeDialog.querySelector('.modal-close')?.click();return;}
    if(event.key==='Tab'){
      const items=[...activeDialog.querySelectorAll('button:not(:disabled),input:not(:disabled),[href],[tabindex]:not([tabindex="-1"])')].filter(item=>!item.hidden);
      if(!items.length)return;const first=items[0],last=items[items.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  let toastTimer;
  function notify(message) {
    toastMessage.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  }
  toast.querySelector('button').addEventListener('click', () => toast.classList.remove('show'));

  // Reveal sections as they enter view; keep content visible when motion is reduced.
  const revealItems = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
    }), { threshold: 0.12 });
    revealItems.forEach((item) => observer.observe(item));
  } else revealItems.forEach((item) => item.classList.add('visible'));

  const menuButton = document.querySelector('.mobile-menu');
  const nav = document.querySelector('.top-links');
  menuButton.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(open));
  });
  nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    nav.classList.remove('open'); menuButton.setAttribute('aria-expanded', 'false');
  }));

  document.querySelectorAll('.run-demo').forEach((button) => button.addEventListener('click', () => {
    button.disabled = true; button.innerHTML = '<span class="run-symbol">◌</span> Running…';
    setTimeout(() => { button.disabled = false; button.innerHTML = '<span class="run-symbol">▶</span> Run test'; notify('Local demo preview completed · no workflow was executed'); }, 1100);
  }));
  function enterWorkspace() {
    document.body.classList.remove('builder-open');document.body.classList.add('workspace-open');
    history.pushState({ workspace: true }, '', '#workspace');window.scrollTo({top:0,behavior:'instant'});refreshDashboard();
  }
  function leaveWorkspace() {
    document.body.classList.remove('workspace-open');history.replaceState(null,'','#home');window.scrollTo({top:0,behavior:'smooth'});document.querySelector('.open-workspace')?.focus();
  }
  document.querySelectorAll('.open-workspace').forEach(button=>button.addEventListener('click',enterWorkspace));
  document.querySelector('.back-home').addEventListener('click',leaveWorkspace);
  function enterBuilder() {
    document.body.classList.remove('workspace-open');document.body.classList.add('builder-open');
    history.pushState({ builder: true }, '', '#builder');
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.querySelector('.workflow-title').textContent=workflowName;
    document.querySelector('.language-badge').textContent=currentLanguage==='python'?'Python':'JavaScript';
    requestAnimationFrame(()=>document.querySelector('.back-dashboard')?.focus());
    requestAnimationFrame(renderConnections);
  }
  function leaveBuilder() {
    document.body.classList.remove('builder-open');
    document.body.classList.add('workspace-open');
    history.replaceState(null, '', '#workspace');window.scrollTo({top:0,behavior:'smooth'});
    refreshDashboard();
    document.querySelector('.create-flow')?.focus();
  }
  // Plan identity comes only from the signed-in server session. Never trust URL/localStorage for Pro.
  async function refreshTeamWorkspace() {
    const panel=document.querySelector('#teamWorkspacePanel'); if(!panel) return;
    if(!accountState.user){panel.hidden=true;return;}
    const inviteToken=new URLSearchParams(location.search).get('team_invite');
    if(inviteToken){
      try{const joined=await fetch('/api/teams',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({action:'join',token:inviteToken})});const result=await joined.json();if(!joined.ok)throw new Error(result.error||'Could not join team');history.replaceState({},'',location.pathname+location.hash);notify(`Joined ${result.team.name}`);}catch(error){notify(error.message||'Team invite failed');}
    }
    try{
      const response=await fetch('/api/teams',{credentials:'same-origin'});const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not load Team workspace');
      if(!data.team){panel.hidden=true;return;}
      panel.hidden=false;panel.querySelector('[data-team-name]').textContent=data.team.name;
      panel.querySelector('[data-team-description]').textContent=`${data.team.members.length} member${data.team.members.length===1?'':'s'} · shared team workspace`;
      const list=panel.querySelector('#teamMembersList');list.replaceChildren();
      data.team.members.forEach(member=>{const chip=document.createElement('span');chip.className='team-member-chip';chip.textContent=member.id===accountState.user.id?'You':`Discord user ${member.id}`;const role=document.createElement('small');role.textContent=member.role;chip.append(role);if(data.team.ownerId===accountState.user.id&&member.id!==data.team.ownerId){const select=document.createElement('select');select.className='team-role-select';select.setAttribute('aria-label','Change member role');for(const value of ['member','admin']){const option=document.createElement('option');option.value=value;option.textContent=value;option.selected=member.role===value;select.append(option);}select.addEventListener('change',async()=>{const response=await fetch('/api/teams',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({action:'role',userId:member.id,role:select.value})});if(!response.ok){const error=await response.json();notify(error.error||'Could not change role');await refreshTeamWorkspace();}else notify('Team role updated.');});const remove=document.createElement('button');remove.type='button';remove.className='team-remove-member';remove.textContent='Remove';remove.addEventListener('click',async()=>{if(!confirm('Remove this person from the team?'))return;const response=await fetch('/api/teams',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({action:'remove',userId:member.id})});const result=await response.json();if(!response.ok)notify(result.error||'Could not remove member');else{notify('Member removed.');await refreshTeamWorkspace();}});chip.append(select,remove);}list.append(chip);});
      panel.dataset.teamId=data.team.id;panel.dataset.ownerId=data.team.ownerId;
      const shared=await fetch('/api/team-workflows',{credentials:'same-origin'});const sharedData=await shared.json();
      panel.querySelector('#teamSharedStatus').textContent=shared.ok?`${sharedData.workflows.length} shared workflow${sharedData.workflows.length===1?'':'s'} in ${sharedData.team.name}.`:(sharedData.error||'Shared workflows unavailable.');
      const sharedList=panel.querySelector('#teamSharedWorkflows');sharedList.replaceChildren();if(shared.ok)sharedData.workflows.forEach(flow=>{const item=document.createElement('div');item.className='team-shared-flow';const name=document.createElement('b');name.textContent=flow.name||flow.workflowName||'Untitled workflow';const detail=document.createElement('small');detail.textContent=`${flow.steps?.length||0} steps`;item.append(name,detail);sharedList.append(item);});
    }catch(error){panel.hidden=true;console.warn('Team workspace:',error);}
  }
  document.querySelector('#teamInviteButton')?.addEventListener('click',async()=>{
    const button=document.querySelector('#teamInviteButton');button.disabled=true;
    try{const response=await fetch('/api/teams',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({action:'invite',maxUses:10})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not create invite');const box=document.querySelector('#teamInviteResult');box.hidden=false;box.replaceChildren();const link=document.createElement('a');link.href=data.url;link.textContent=data.url;link.target='_blank';link.rel='noopener noreferrer';box.append('Invite link (10 uses, expires in 7 days): ',link);try{await navigator.clipboard.writeText(data.url);notify('Team invite link copied.');}catch{notify('Team invite link created.');}}catch(error){notify(error.message||'Could not create invite.');}finally{button.disabled=false;}
  });
  document.querySelector('#teamImportWorkflows')?.addEventListener('click',async()=>{
    const button=document.querySelector('#teamImportWorkflows');button.disabled=true;
    try{const response=await fetch('/api/team-workflows',{credentials:'same-origin'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not load shared workflows');const byId=new Map(workflows.map(flow=>[flow.id,flow]));for(const flow of data.workflows)byId.set(flow.id,flow);workflows=[...byId.values()];try{localStorage.setItem(workflowsKey,JSON.stringify(workflows));}catch{}const cloud=await fetch('/api/workflows',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({workflows})});if(!cloud.ok){const error=await cloud.json();throw new Error(error.error||'Could not sync imported workflows');}refreshDashboard();notify(`Loaded ${data.workflows.length} shared workflow${data.workflows.length===1?'':'s'}.`);}catch(error){notify(error.message||'Could not load shared workflows.');}finally{button.disabled=false;}
  });
  document.querySelector('#teamShareWorkflows')?.addEventListener('click',async()=>{
    const button=document.querySelector('#teamShareWorkflows');button.disabled=true;
    try{const response=await fetch('/api/team-workflows',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({workflows})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not share workflows');document.querySelector('#teamSharedStatus').textContent=`Shared ${data.count} workflow${data.count===1?'':'s'} with your team.`;notify('Your workflows are now shared with the team.');}catch(error){notify(error.message||'Could not share workflows.');}finally{button.disabled=false;}
  });

  const planLimits = { starter: { name: 'Starter', workflows: 3, runs: Infinity }, pro: { name: 'Pro', workflows: Infinity, runs: Infinity }, team: { name: 'Team', workflows: Infinity, runs: Infinity } };
  let accountState = { user: null, plan: 'starter', subscriptionStatus: 'none' };
  let accountReady = false;
  try { localStorage.removeItem('flowstate-plan-v1'); } catch {}
  function currentPlan() { const key = Object.hasOwn(planLimits, accountState.plan) ? accountState.plan : 'starter'; return { key, ...planLimits[key] }; }
  function renderSubscriptionCountdown() {
    const proLink = document.querySelector('.checkout-plan[data-plan="pro"]');
    const teamLink = document.querySelector('.checkout-plan[data-plan="team"]');
    const proCard = proLink?.closest('.price-card');
    if (!proCard) return;
    const plan = accountState.plan || 'starter';
    const active = ['active', 'trialing', 'team-member'].includes(accountState.subscriptionStatus);
    const hasPro = active && ['pro', 'team'].includes(plan);
    let status = proCard.querySelector('[data-subscription-countdown]');
    if (!hasPro) {
      if (status) status.remove();
      if (proLink) proLink.style.display = '';
      if (teamLink) teamLink.style.display = '';
      return;
    }
    if (proLink) proLink.style.display = 'none';
    if (teamLink) teamLink.style.display = plan === 'team' ? 'none' : '';
    if (!status) {
      status = document.createElement('p');
      status.dataset.subscriptionCountdown = 'true';
      status.className = 'plan-caption';
      status.setAttribute('aria-live', 'polite');
      proLink?.insertAdjacentElement('afterend', status);
    }
    if (plan === 'team') { status.textContent = 'Team active · Pro features included'; return; }
    const endMs = Number(accountState.currentPeriodEnd) * 1000;
    if (!Number.isFinite(endMs) || endMs <= 0) { status.textContent = 'Pro active'; return; }
    const remaining = Math.max(0, endMs - Date.now());
    if (!remaining) { status.textContent = 'Billing period ended · updating plan…'; return; }
    const d=Math.floor(remaining/86400000), hh=Math.floor(remaining%86400000/3600000),
      mm=Math.floor(remaining%3600000/60000), ss=Math.floor(remaining%60000/1000);
    const t=(d?d+'d ':'')+hh+'h '+mm+'m '+ss+'s';
    status.textContent = accountState.cancelAtPeriodEnd ? 'Pro access ends in '+t : 'Next Pro renewal in '+t;
  }

  async function refreshAccount() {
    try { const response = await fetch('/api/me', { credentials: 'same-origin', headers: { 'accept': 'application/json' } }); if (!response.ok) throw new Error('Could not load account'); accountState = await response.json(); } catch { accountState = { user: null, plan: 'starter', subscriptionStatus: 'none' }; }
    if (accountState.user) {
      try {
        const response = await fetch('/api/workflows', {credentials:'same-origin'});
        if (response.ok) {
          const data = await response.json();
          if (data.workflows.length === 0 && workflows.length) {
            const migrated = await fetch('/api/workflows', {method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({workflows})});
            if (migrated.ok) { /* existing local drafts were imported */ } else { const error = await migrated.json(); notify(error.error || 'Could not sync local drafts.'); }
          } else { workflows = Array.isArray(data.workflows) ? data.workflows : []; try { localStorage.setItem(workflowsKey,JSON.stringify(workflows)); } catch {} }
        }
      } catch { notify('Could not reach cloud workflow storage. Local drafts are still available.'); }
    }
    const button = document.querySelector('#accountButton');
    if (button) { button.textContent = accountState.user ? `@${accountState.user.username} · ${currentPlan().name} · Sign out` : 'Sign in with Discord'; button.href = accountState.user ? '/api/logout' : '/api/login'; }
    await refreshTeamWorkspace();
    accountReady = true;
    renderSubscriptionCountdown();
    refreshDashboard();
  }
  refreshAccount();
  setInterval(renderSubscriptionCountdown, 1000);
  setInterval(() => { if (accountReady) refreshAccount(); }, 30000);
  function monthRunCount() {
    const prefix = dateKey(new Date()).slice(0, 7);
    return Object.entries(metrics.previewRunsByDay || {}).reduce((sum, [day, count]) => day.startsWith(prefix) ? sum + (Number(count) || 0) : sum, 0);
  }
  function showUpgrade(kind) {
    const modal = document.querySelector('#upgradeModal'); if (!modal) return;
    const plan = currentPlan();
    const copy = kind === 'runs'
      ? ['You’ve used all ' + plan.runs + ' runs this month', 'The ' + plan.name + ' plan includes ' + plan.runs + ' runs per month. Upgrade to Pro for unlimited runs, or wait until next month.']
      : ['You’ve reached ' + plan.workflows + ' active workflows', 'The ' + plan.name + ' plan includes ' + plan.workflows + ' active workflows. Upgrade to Pro for unlimited workflows, or delete one you no longer need.'];
    modal.querySelector('.upgrade-eyebrow').textContent = plan.name.toUpperCase() + ' PLAN LIMIT';
    modal.querySelector('#upgradeTitle').textContent = copy[0];
    modal.querySelector('.upgrade-text').textContent = copy[1];
    openDialog(modal, '.upgrade-plans');
  }
  (() => {
    const modal = document.querySelector('#upgradeModal'); if (!modal) return;
    modal.querySelectorAll('.upgrade-close,.upgrade-dismiss').forEach((button) => button.addEventListener('click', () => closeDialog(modal)));
    modal.addEventListener('click', (event) => { if (event.target === modal) closeDialog(modal); });
    modal.querySelector('.upgrade-plans').addEventListener('click', () => {
      closeDialog(modal, false);
      document.body.classList.remove('builder-open', 'workspace-open');
      history.replaceState(null, '', '#pricing');
      requestAnimationFrame(() => document.querySelector('#pricing')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    });
  })();
  async function requestWorkflowStart(){if(!accountReady) await refreshAccount();if(workflows.length>=currentPlan().workflows){showUpgrade('workflows');return;}isCreatingWorkflow=true;workflowName='My workflow';openSetup();}
  const setupModal=document.querySelector('#setupModal');
  function openSetup(){
    document.querySelector('.workflow-name-input').value=workflowName;
    document.querySelectorAll('.language-option').forEach(option=>{const selected=option.dataset.language===currentLanguage;option.classList.toggle('selected',selected);option.setAttribute('aria-pressed',String(selected));option.querySelector('.language-radio').textContent=selected?'●':'○';});
    document.querySelector('.setup-error').textContent='';openDialog(setupModal,'.workflow-name-input');
  }
  document.querySelectorAll('.language-option').forEach(option=>option.addEventListener('click',()=>{
    currentLanguage=option.dataset.language;
    document.querySelectorAll('.language-option').forEach(item=>{const selected=item===option;item.classList.toggle('selected',selected);item.setAttribute('aria-pressed',String(selected));item.querySelector('.language-radio').textContent=selected?'●':'○';});
  }));
  document.querySelector('.setup-continue').addEventListener('click',()=>{
    const name=document.querySelector('.workflow-name-input').value.trim();
    if(!name){document.querySelector('.setup-error').textContent='Add a name for this workflow to continue.';document.querySelector('.workflow-name-input').focus();return;}
    workflowName=name.slice(0,60);document.querySelector('.workflow-title').textContent=workflowName;document.querySelector('.language-badge').textContent=currentLanguage==='python'?'Python':'JavaScript';
    if(isCreatingWorkflow){workflowId=makeId();blockSerial=0;blockOffset=0;pendingConnection=null;connections.splice(0);lineElements.clear();const canvas=document.querySelector('#builderCanvas');canvas.querySelectorAll('.canvas-block').forEach(block=>block.remove());canvas.querySelector('.builder-start')?.remove();restoreStart();isCreatingWorkflow=false;}
    closeDialog(setupModal,false);recordDashboardEvent('Workflow created',`${workflowName} · ${currentLanguage==='python'?'Python':'JavaScript'}`);saveDraft();enterBuilder();
  });
  document.querySelectorAll('.setup-close,.setup-cancel').forEach(button=>button.addEventListener('click',()=>closeDialog(setupModal)));
  setupModal.addEventListener('click',event=>{if(event.target===setupModal)closeDialog(setupModal);});
  document.querySelectorAll('.create-flow, .add-step,.start-workflow').forEach((button) => button.addEventListener('click', requestWorkflowStart));
  document.querySelector('.back-dashboard').addEventListener('click', leaveBuilder);
  document.querySelectorAll('a[href="#how-it-works"]').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); openSetup(); }));
  window.addEventListener('popstate', () => { if(activeDialog){activeDialog.querySelector('.modal-close')?.click();return;}if(document.body.classList.contains('builder-open'))leaveBuilder();else if(document.body.classList.contains('workspace-open'))leaveWorkspace(); });
  if (location.hash === '#builder') { if(hasSavedDraft){document.body.classList.add('builder-open');document.querySelector('.workflow-title').textContent=workflowName;document.querySelector('.language-badge').textContent=currentLanguage==='python'?'Python':'JavaScript';requestAnimationFrame(renderConnections);} else openSetup(); }
  document.querySelector('.add-trigger').addEventListener('click', () => addBlock('trigger', 50, 17));
  document.querySelector('.publish-button').addEventListener('click', openSafetyScan);
  document.querySelector('.undo-button').addEventListener('click', () => { const block = document.querySelector('.canvas-block:last-of-type'); if (block) { block.remove(); notify('Last step removed.'); } else notify('Nothing to undo yet.'); });
  document.querySelector('.redo-button').addEventListener('click', () => notify('Nothing to redo yet.'));
  document.querySelectorAll('.view-all').forEach((button) => button.addEventListener('click', () => {document.querySelector('.workflow-list')?.scrollIntoView({behavior:'smooth',block:'center'});}));
  document.querySelectorAll('.activity-menu').forEach((button) => button.addEventListener('click', () => notify('Recent activity is stored on this device.')));
  document.querySelectorAll('.marketplace-link').forEach((link) => link.addEventListener('click', () => notify('The app directory is a preview; integrations are not connected yet.')));

  // Billing toggle: prices, billing notes and Stripe payment links always switch together.
  const billingOptions = document.querySelectorAll('.billing-option');
  const applyBilling = (mode) => {
    billingOptions.forEach((item) => {
      const on = item.dataset.billing === mode;
      item.classList.toggle('active', on);
      item.setAttribute('aria-pressed', String(on));
    });
    document.querySelectorAll('.price strong').forEach((price) => {
      price.textContent = `$${price.dataset[mode]}`;
      price.classList.remove('price-swap'); void price.offsetWidth; price.classList.add('price-swap');
    });
    document.querySelectorAll('.price-period[data-monthly]').forEach((period) => { period.textContent = period.dataset[mode]; });
    document.querySelectorAll('.billing-note').forEach((note) => { note.textContent = note.dataset[mode + 'Label'] || (mode === 'yearly' ? 'Billed yearly.' : 'Billed monthly.'); });
    document.querySelectorAll('.checkout-plan').forEach((link) => {
      link.href = '/api/checkout';
      link.setAttribute('aria-label', `Subscribe to ${link.dataset.planName || 'this plan'}, billed ${mode}`);
      link.dataset.interval = mode;
    });
    document.querySelector('.pricing-grid')?.setAttribute('data-billing', mode);
  };
  billingOptions.forEach((option) => option.addEventListener('click', () => applyBilling(option.dataset.billing)));
  applyBilling('monthly');
  document.querySelectorAll('.checkout-plan').forEach(link => link.addEventListener('click', async event => {
    event.preventDefault();
    if (!accountState.user) { location.href = '/api/login'; return; }
    const original = link.textContent; link.setAttribute('aria-busy','true');
    try { const response = await fetch('/api/checkout', { method:'POST', credentials:'same-origin', headers:{'content-type':'application/json'}, body:JSON.stringify({ plan:link.dataset.plan, interval:link.dataset.interval || 'monthly' }) }); const data = await response.json(); if (!response.ok || !data.url) throw new Error(data.error || 'Checkout could not start'); location.href = data.url; }
    catch (error) { notify(error.message || 'Checkout could not start.'); link.textContent = original; link.removeAttribute('aria-busy'); }
  }));
  document.querySelectorAll('[data-discord-invite]').forEach(async link => {
    try { const response = await fetch('/api/discord-invite', { headers:{'accept':'application/json'} }); const data = await response.json(); if (response.ok && data.url) { link.href = data.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; } else { link.textContent = 'Discord invite not configured yet'; link.removeAttribute('href'); } } catch { link.textContent = 'Discord invite unavailable'; link.removeAttribute('href'); }
  });

  const blockInfo = {
    trigger: { title: 'Webhook trigger', detail: 'Receives an incoming event', glyph: 'ϟ', cls: 'purple-glyph' },
    action: { title: 'HTTP request', detail: 'Send an API request', glyph: '↗', cls: 'green-glyph' },
    discord: { title: 'Send Discord message', detail: 'Post through your webhook URL', glyph: '◉', cls: 'blue-glyph' },
    email: { title: 'Send email', detail: 'Needs an email provider adapter', glyph: '✉', cls: 'green-glyph' },
    filter: { title: 'Check a condition', detail: 'Continue only when the value is true', glyph: '⌕', cls: 'amber-glyph' },
    branch: { title: 'Choose a path', detail: 'Route based on a true or false value', glyph: '⑂', cls: 'amber-glyph' },
    transform: { title: 'Set variables', detail: 'Create a value from earlier data', glyph: 'ƒ', cls: 'purple-glyph' },
    loop: { title: 'Repeat for each item', detail: 'Run the next step for each list item', glyph: '↻', cls: 'blue-glyph' },
    delay: { title: 'Wait', detail: 'Pause before the next connected step', glyph: '◷', cls: 'blue-glyph' },
    log: { title: 'Write to run log', detail: 'Print useful data while troubleshooting', glyph: '≡', cls: 'green-glyph' },
    schedule: { title: 'Scheduled trigger', detail: 'Start on a repeating timer', glyph: '◷', cls: 'blue-glyph' },
    json: { title: 'Parse JSON', detail: 'Turn text into structured data', glyph: '{ }', cls: 'purple-glyph' },
    map: { title: 'Map fields', detail: 'Rename and reshape fields', glyph: '⇄', cls: 'green-glyph' },
    database: { title: 'Save to database', detail: 'Needs a database adapter', glyph: '▤', cls: 'blue-glyph' },
    retry: { title: 'Retry failed step', detail: 'Needs a retry policy adapter', glyph: '⟳', cls: 'amber-glyph' },
    response: { title: 'Webhook response', detail: 'Send data back to the caller', glyph: '↩', cls: 'purple-glyph' },
    code: { title: 'Custom code', detail: 'Add a small custom transform', glyph: '</>', cls: 'amber-glyph' },
    notify: { title: 'Write a notification', detail: 'Add a clear status message to the log', glyph: '♧', cls: 'green-glyph' },
    stop: { title: 'End this path', detail: 'Stop connected steps from running', glyph: '■', cls: 'amber-glyph' }
  };
  const blockGuide={
    trigger:['Triggers','Starts a workflow when an incoming POST request arrives at /webhook. The request body becomes trigger data.','POST /webhook with JSON'],
    schedule:['Triggers','Starts the workflow on a repeating interval when the exported runner is on. Set SCHEDULE_INTERVAL_MS in .env.','Every 60 seconds'],
    action:['Actions','Makes an HTTP GET request. Put the URL in the value, and use variables to build it dynamically.','https://api.example.com/items'],
    discord:['Actions','Posts a message to a Discord webhook. Add DISCORD_WEBHOOK_URL to your local .env file.','New lead: {{trigger.body.email}}'],
    email:['Actions','Marks where an email should be sent. The export needs an email provider adapter before this can run.','To: {{trigger.body.email}}'],
    database:['Actions','Marks where data should be saved. Add your database adapter and credentials in your own environment.','Save {{steps.previous.output}}'],
    response:['Actions','Prepares a value to return to the webhook caller. The starter runner returns the last step result.','{{steps.previous.output}}'],
    notify:['Actions','Writes a short status message to the local runner log.','Order received'],
    filter:['Logic','Continues only when its value is truthy. Connect its output to the steps that should run.','{{trigger.body.is_valid}}'],
    branch:['Logic','Adds a conditional decision point. Use a boolean or variable to select whether the path continues.','{{trigger.body.approved}}'],
    loop:['Logic','Iterates over an array value. Configure the array with a variable from an earlier step.','{{trigger.body.items}}'],
    retry:['Logic','Marks an action that should retry after failure. Add retry limits and backoff in a production adapter.','3 attempts'],
    stop:['Logic','Stops the current path so connected later steps are skipped.','Stop after validation fails'],
    delay:['Logic','Waits before continuing. The exported runner caps a single delay at 60 seconds.','5000 (milliseconds)'],
    transform:['Data','Creates a value from earlier step data. Use {{...}} variables in the value field.','Hello {{trigger.body.name}}'],
    json:['Data','Parses a JSON string into structured data for following steps.','{{trigger.body.json}}'],
    map:['Data','Builds a new object from a JSON mapping of output field names to variable expressions.','{"email":"{{trigger.body.email}}"}'],
    log:['Tools','Prints the current payload and value in the local run log to help troubleshoot.','Inspect lead payload'],
    code:['Tools','A placeholder for custom code. The exported starter does not execute user code; review and implement it yourself.','Custom transform']
  };
  const guideModal=document.querySelector('#guideModal');
  function renderGuide(){
    const list=document.querySelector('.guide-list');list.innerHTML='';const groups=new Map();
    for(const [type,[category,description,example]] of Object.entries(blockGuide)){
      const info=blockInfo[type];
      if(!groups.has(category))groups.set(category,[]);groups.get(category).push({info,description,example});
    }
    for(const [category,items] of groups){const heading=document.createElement('h3');heading.className='guide-category';heading.textContent=category;list.appendChild(heading);for(const item of items){const card=document.createElement('article');card.className='guide-card';const icon=document.createElement('span');icon.className=`block-glyph ${item.info.cls}`;icon.textContent=item.info.glyph;const copy=document.createElement('div');copy.className='guide-card-copy';const title=document.createElement('b');title.textContent=item.info.title;const description=document.createElement('p');description.textContent=item.description;const example=document.createElement('code');example.textContent=item.example;copy.append(title,description,example);card.append(icon,copy);list.appendChild(card);}}
    
  }
  document.querySelector('.guide-open').addEventListener('click',()=>{renderGuide();openDialog(guideModal,'.guide-close');});
  const workspaceSwitcher=document.querySelector('#workspaceSwitcher');const workspaceMenu=document.querySelector('#workspaceMenu');
  workspaceSwitcher.addEventListener('click',()=>{const isOpen=!workspaceMenu.hidden;workspaceMenu.hidden=isOpen;workspaceSwitcher.setAttribute('aria-expanded',String(!isOpen));});
  document.addEventListener('click',event=>{if(!workspaceMenu.hidden&&!workspaceMenu.contains(event.target)&&!workspaceSwitcher.contains(event.target)){workspaceMenu.hidden=true;workspaceSwitcher.setAttribute('aria-expanded','false');}});
  document.querySelector('.workspace-new-flow').addEventListener('click',()=>{workspaceMenu.hidden=true;workspaceSwitcher.setAttribute('aria-expanded','false');requestWorkflowStart();});
  document.querySelector('.workspace-info').addEventListener('click',()=>{workspaceMenu.hidden=true;workspaceSwitcher.setAttribute('aria-expanded','false');notify('This workspace is stored only in this browser.');});
  document.querySelectorAll('.guide-close').forEach(button=>button.addEventListener('click',()=>closeDialog(guideModal)));
  guideModal.addEventListener('click',event=>{if(event.target===guideModal)closeDialog(guideModal);});
  let blockOffset = 0;
  let blockSerial = 0;
  const connections = [];
  const lineElements = new Map();
  let pendingConnection = null;
  function saveDraft() {
    if(restoringWorkflow)return;
    try {
      if(!workflowId)workflowId=makeId();const existing=workflows.find(item=>item.id===workflowId);const now=Date.now();
      const steps=[...document.querySelectorAll('#builderCanvas .canvas-block')].map(block=>({id:block.dataset.id,type:block.dataset.type,name:block.dataset.name||block.querySelector('.block-title').textContent,value:block.dataset.value||'',settings:(()=>{try{return JSON.parse(block.dataset.settings||'{}')}catch{return {}}})(),left:block.style.left,top:block.style.top}));
      const record={...(existing||{}),id:workflowId,workflowId,name:workflowName,workflowName,language:currentLanguage,settings:{...(existing?.settings||{}),language:currentLanguage},steps,connections:connections.map(edge=>({...edge})),createdAt:existing?.createdAt||now,updatedAt:now};
      const index=workflows.findIndex(item=>item.id===workflowId);if(index<0)workflows.push(record);else workflows[index]=record;hasSavedDraft=true;
      localStorage.setItem('flowstate-draft-v1',JSON.stringify(record));persistWorkflows();
      if(!document.body.classList.contains('builder-open'))refreshDashboard();
    } catch { notify('Could not save: browser storage may be full or disabled.'); }
  }
  function loadWorkflow(id){const record=workflows.find(item=>item.id===id);if(!record)return;restoringWorkflow=true;workflowId=record.id;workflowName=record.name||record.workflowName||'Untitled workflow';currentLanguage=record.language||'javascript';blockSerial=0;blockOffset=0;pendingConnection=null;connections.splice(0);lineElements.clear();const canvas=document.querySelector('#builderCanvas');canvas.querySelectorAll('.canvas-block').forEach(block=>block.remove());canvas.querySelector('.builder-start')?.remove();for(const step of record.steps||[]){const block=addBlock(step.type,parseFloat(step.left)||40,parseFloat(step.top)||18);if(!block)continue;block.dataset.id=step.id||makeId('step');blockSerial=Math.max(blockSerial,Number(String(block.dataset.id).replace('step-',''))||0);block.dataset.name=step.name||'';block.dataset.value=step.value||'';block.dataset.settings=JSON.stringify(step.settings||{});block.querySelector('.block-title').textContent=step.name||blockInfo[step.type].title;block.querySelector('.block-detail').textContent=step.value||blockInfo[step.type].detail;block.classList.toggle('configured',Boolean(step.value));}if(!record.steps?.length)restoreStart();connections.splice(0,connections.length,...(record.connections||[]).map(edge=>({...edge})));hasSavedDraft=Boolean(record.steps?.length);restoringWorkflow=false;renderConnections();localStorage.setItem('flowstate-draft-v1',JSON.stringify(record));document.querySelector('.workflow-title').textContent=workflowName;document.querySelector('.language-badge').textContent=currentLanguage==='python'?'Python':'JavaScript';enterBuilder();}
  function renameWorkflow(id){const record=workflows.find(item=>item.id===id);if(!record)return;const next=window.prompt('Rename workflow',record.name||record.workflowName||'');if(next===null)return;const name=next.trim().slice(0,60);if(!name){notify('A workflow name cannot be empty.');return;}record.name=name;record.workflowName=name;record.updatedAt=Date.now();if(workflowId===id)workflowName=name;persistWorkflows();if(workflowId===id)saveDraft();refreshDashboard();}
  function duplicateWorkflow(id){const record=workflows.find(item=>item.id===id);if(!record)return;if(workflows.length>=currentPlan().workflows){showUpgrade('workflows');return;}const copy=JSON.parse(JSON.stringify(record));copy.id=makeId();copy.workflowId=copy.id;copy.name=`${record.name||record.workflowName||'Workflow'} copy`;copy.workflowName=copy.name;copy.createdAt=Date.now();copy.updatedAt=Date.now();const idMap=new Map();copy.steps=(copy.steps||[]).map((step,index)=>{const old=step.id;step.id=`step-${copy.id}-${index+1}`;idMap.set(old,step.id);return step;});copy.connections=(copy.connections||[]).map(edge=>({from:idMap.get(edge.from)||edge.from,to:idMap.get(edge.to)||edge.to}));workflows.push(copy);persistWorkflows();refreshDashboard();notify('Workflow duplicated.');}
  function deleteWorkflow(id){const record=workflows.find(item=>item.id===id);if(!record||!window.confirm(`Delete “${record.name||record.workflowName||'this workflow'}”? This cannot be undone.`))return;workflows=workflows.filter(item=>item.id!==id);if(workflowId===id){workflowId=null;hasSavedDraft=false;localStorage.removeItem('flowstate-draft-v1');}persistWorkflows();refreshDashboard();notify('Workflow deleted.');}
  function clearPendingConnection() {
    pendingConnection = null;
    document.querySelectorAll('.port-selected').forEach((port) => port.classList.remove('port-selected'));
    document.querySelector('#builderCanvas')?.classList.remove('is-connecting');
  }
  function addBlock(type, x, y) {
    const info = blockInfo[type];
    if (!info) return;
    const canvas = document.querySelector('#builderCanvas');
    canvas.querySelector('.builder-start')?.remove();
    const block = document.createElement('div');
    block.className = 'canvas-block'; block.dataset.type = type; block.dataset.id = `step-${++blockSerial}`; block.style.left = `${x}%`; block.style.top = `${y}%`;
    block.innerHTML = `<button class="port port-in" aria-label="Connect to this step" title="Connect to this step"></button><div class="canvas-block-head"><i class="block-glyph ${info.cls}">${info.glyph}</i><span class="block-title">${info.title}</span><button class="block-edit" aria-label="Configure ${info.title}">⚙</button><button class="block-remove" aria-label="Remove block">×</button></div><p class="block-detail">${info.detail}</p><button class="port port-out" aria-label="Start a connection from this step" title="Start a connection from this step"></button>`;
    canvas.appendChild(block);
    block.querySelector('.block-remove').addEventListener('click', (event) => { event.stopPropagation(); connections.splice(0, connections.length, ...connections.filter((edge) => edge.from !== block.dataset.id && edge.to !== block.dataset.id)); block.remove(); if (!canvas.querySelector('.canvas-block')) restoreStart(); renderConnections(); saveDraft(); });
    block.querySelector('.block-edit').addEventListener('click', (event) => { event.stopPropagation(); configureBlock(block); });
    block.querySelector('.port-out').addEventListener('pointerdown', (event) => event.stopPropagation());
    block.querySelector('.port-in').addEventListener('pointerdown', (event) => event.stopPropagation());
    block.querySelector('.port-out').addEventListener('click', (event) => { event.stopPropagation(); const wasSelected = pendingConnection === block.dataset.id; clearPendingConnection(); if (wasSelected) return; pendingConnection = block.dataset.id; block.querySelector('.port-out').classList.add('port-selected'); canvas.classList.add('is-connecting'); notify('Now click another step’s top connector.'); });
    block.querySelector('.port-in').addEventListener('click', (event) => {
      event.stopPropagation();
      if (!pendingConnection) { notify('Start from a step’s bottom connector first.'); return; }
      if (pendingConnection === block.dataset.id) { notify('Connect two different steps.'); return; }
      if (connections.some((edge) => edge.from === pendingConnection && edge.to === block.dataset.id)) { notify('Those steps are already connected.'); return; }
      connections.push({ from: pendingConnection, to: block.dataset.id });
      document.querySelectorAll('.port-selected').forEach((port) => port.classList.remove('port-selected'));
      clearPendingConnection(); renderConnections(); saveDraft(); notify('Steps connected. Click a line to disconnect.');
    });
    block.addEventListener('dblclick', () => configureBlock(block));
    makeMovable(block, canvas);
    blockOffset += 1;
    document.querySelector('.draft-badge').textContent = 'Draft';
    document.querySelector('.draft-badge').classList.remove('published');
    renderConnections();
    saveDraft();
    return block;
  }
  document.querySelector('.load-example')?.addEventListener('click', () => {
    document.querySelectorAll('#builderCanvas .canvas-block').forEach(block => block.remove());
    connections.splice(0); lineElements.clear(); document.querySelector('#builderCanvas .connections-layer').innerHTML='';blockOffset=0;blockSerial=0;pendingConnection=null;
    const trigger=addBlock('trigger',42,8),filter=addBlock('filter',42,27),transform=addBlock('transform',42,46),log=addBlock('log',42,65),response=addBlock('response',42,82);
    const set=(block,name,value,settings={})=>{block.dataset.name=name;block.dataset.value=value;block.dataset.settings=JSON.stringify(settings);block.querySelector('.block-title').textContent=name;block.querySelector('.block-detail').textContent=value||blockInfo[block.dataset.type].detail;block.classList.toggle('configured',Boolean(value||Object.keys(settings).length));};
    set(trigger,'Webhook trigger','',{path:'/webhook'});set(filter,'Email provided?','{{trigger.body.email}}',{operator:'not_empty',compareValue:''});set(transform,'Build confirmation','Captured lead: {{trigger.body.email}}');set(log,'Write lead to console','{{steps.build_confirmation.output}}');set(response,'Return result','{{steps.build_confirmation.output}}',{statusCode:'200'});
    const order=[trigger,filter,transform,log,response];for(let index=0;index<order.length-1;index++)connections.push({from:order[index].dataset.id,to:order[index+1].dataset.id});
    workflowName='Lead capture demo';document.querySelector('.workflow-title').textContent=workflowName;document.querySelector('.draft-badge').textContent='Draft';renderConnections();saveDraft();notify('Runnable example loaded · POST a JSON email to /webhook after download.');
  });
  const configModal = document.querySelector('#configModal');
  let configuringBlock = null;
  const settingSchemas={
    trigger:[{key:'path',label:'Webhook path',type:'text',value:'/webhook'}],
    schedule:[{key:'intervalMs',label:'Repeat interval (milliseconds)',type:'number',value:'60000',min:'1000'}],
    action:[{key:'method',label:'Request method',type:'select',value:'GET',options:['GET','POST','PUT','PATCH','DELETE']},{key:'headers',label:'Request headers (JSON)',type:'textarea',value:'{}'},{key:'body',label:'Request body',type:'textarea',value:''}],
    discord:[{key:'webhookEnv',label:'Webhook URL environment variable',type:'text',value:'DISCORD_WEBHOOK_URL'}],
    email:[{key:'to',label:'To',type:'text',value:''},{key:'subject',label:'Subject',type:'text',value:''}],
    filter:[{key:'operator',label:'Condition',type:'select',value:'not_empty',options:['not_empty','is_empty','equals','not_equals','contains','greater_than','less_than','truthy']},{key:'compareValue',label:'Compare with',type:'text',value:''}],
    branch:[{key:'operator',label:'Condition',type:'select',value:'truthy',options:['truthy','not_empty','is_empty','equals','not_equals','contains','greater_than','less_than']},{key:'compareValue',label:'Compare with',type:'text',value:''}],
    delay:[{key:'durationMs',label:'Wait (milliseconds)',type:'number',value:'1000',min:'0',max:'60000'}],
    database:[{key:'table',label:'Table or collection',type:'text',value:'records'},{key:'connection',label:'Connection environment variable',type:'text',value:'DATABASE_URL'}],
    retry:[{key:'attempts',label:'Maximum attempts',type:'number',value:'3',min:'1',max:'10'},{key:'backoffMs',label:'Delay between attempts (ms)',type:'number',value:'500',min:'0',max:'60000'}],
    response:[{key:'statusCode',label:'HTTP response status',type:'number',value:'200',min:'100',max:'599'}],
    code:[{key:'language',label:'Code language',type:'select',value:'javascript',options:['javascript','python']}]
  };
  const valueLabels={action:'Request URL',discord:'Message text',email:'Email body',filter:'Value to check',branch:'Value to check',transform:'Output template',loop:'Array to repeat',delay:'Wait duration (ms)',log:'Log message',notify:'Notification message',json:'JSON text or variable',map:'Field mapping JSON',database:'Record data',retry:'Value to retry',response:'Response body',code:'Code snippet'};
  const valuePlaceholders={action:'https://api.example.com/items',discord:'New lead: {{trigger.body.email}}',email:'Hello {{trigger.body.name}}',filter:'{{trigger.body.email}}',branch:'{{trigger.body.approved}}',transform:'Captured lead: {{trigger.body.email}}',loop:'{{trigger.body.items}}',delay:'1000',log:'{{steps.previous.output}}',notify:'Workflow completed',json:'{{trigger.body.json}}',map:'{"email":"{{trigger.body.email}}"}',database:'{{steps.previous.output}}',retry:'{{steps.previous.output}}',response:'{{steps.previous.output}}',code:'// This block is a safe placeholder in exports'};
  function parseBlockSettings(block){try{return JSON.parse(block.dataset.settings||'{}')}catch{return {}}}
  function populateSettingFields(block){const host=document.querySelector('.step-settings-fields');host.replaceChildren();const current=parseBlockSettings(block);for(const spec of settingSchemas[block.dataset.type]||[]){const label=document.createElement('label');label.className='field-label setting-field';label.textContent=spec.label;let control;if(spec.type==='select'){control=document.createElement('select');for(const optionValue of spec.options){const option=document.createElement('option');option.value=optionValue;option.textContent=optionValue;control.appendChild(option);}}else if(spec.type==='textarea'){control=document.createElement('textarea');control.rows=3;}else{control=document.createElement('input');control.type=spec.type;if(spec.min)control.min=spec.min;if(spec.max)control.max=spec.max;}control.dataset.setting=spec.key;control.value=current[spec.key]??spec.value;label.appendChild(control);host.appendChild(label);}}
  function populateVariableChips(block){const host=document.querySelector('.variable-chips');host.replaceChildren();const type=block.dataset.type;let paths=['{{trigger.body}}','{{trigger.body.email}}','{{trigger.body.name}}','{{trigger.body.message}}','{{trigger.body.items}}','{{steps.previous.output}}'];if(['filter','branch'].includes(type))paths=['{{trigger.body.email}}','{{trigger.body.approved}}','{{trigger.body.amount}}','{{steps.previous.output}}'];if(type==='loop')paths=['{{trigger.body.items}}','{{steps.previous.output}}'];if(type==='json')paths=['{{trigger.body.json}}','{{steps.previous.output}}'];if(type==='map')paths=['{{trigger.body.email}}','{{trigger.body.name}}','{{trigger.body.id}}','{{steps.previous.output}}'];for(const prior of [...document.querySelectorAll('#builderCanvas .canvas-block')]){if(prior===block)break;const name=(prior.dataset.name||prior.querySelector('.block-title').textContent).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');if(name)paths.push(`{{steps.${name}.output}}`);}for(const token of [...new Set(paths)]){const chip=document.createElement('button');chip.type='button';chip.dataset.variable=token;chip.textContent=token;host.appendChild(chip);}}
  function configureBlock(block) {
    configuringBlock = block;const type=block.dataset.type;
    document.querySelector('#configTitle').textContent=block.querySelector('.block-title').textContent;
    const descriptions={trigger:'Choose the local webhook path that starts this flow.',schedule:'Choose how often this flow starts while its runner is active.',action:'Configure an HTTP request. URL, method, headers, and body are exported to the runner.',discord:'Set the message and the environment variable holding your Discord webhook URL.',email:'Set recipient, subject, and body. An email provider still needs to be connected in the downloaded project.',filter:'Test a value. A false result stops the connected path.',branch:'Evaluate a condition. A false result stops connected steps; true continues.',transform:'Build a reusable value from incoming data and earlier step outputs.',loop:'Choose an array. Each item is sent to the next connected step separately.',delay:'Set the pause duration. The downloaded runner caps a single wait at 60 seconds.',log:'Choose the message printed in the runner terminal.',json:'Choose the JSON text or variable to parse.',map:'Map output fields to values using JSON and workflow variables.',database:'Choose the table and environment variable. A database adapter is required to write records.',retry:'Set retry limits. A retry adapter must be added to the exported runner before retries take effect.',response:'Choose the response body and HTTP status returned to the webhook caller.',code:'This is a safe placeholder; exported custom code is not executed.'};document.querySelector('.config-description').textContent=descriptions[type]||'Configure this block and reference values from earlier steps.';
    document.querySelector('.step-name-input').value=block.dataset.name||block.querySelector('.block-title').textContent;
    const label=document.querySelector('.step-value-label');label.textContent=valueLabels[type]||'Value or expression';
    const input=document.querySelector('.step-value-input');input.value=block.dataset.value||'';input.placeholder=valuePlaceholders[type]||'Choose a value or insert a variable';
    document.querySelector('.value-field').hidden=type==='trigger'||type==='schedule'||type==='stop';
    document.querySelector('.variable-help').hidden=type==='trigger'||type==='schedule'||type==='stop';
    populateSettingFields(block);populateVariableChips(block);openDialog(configModal,'.step-name-input');
  }
  function closeConfig() { closeDialog(configModal); configuringBlock = null; }
  document.querySelectorAll('.config-close,.config-cancel').forEach((button) => button.addEventListener('click', closeConfig));
  configModal.addEventListener('click', (event) => { if (event.target === configModal) closeConfig(); });
  document.querySelector('.save-config').addEventListener('click', () => {
    if (!configuringBlock) return;
    const name = document.querySelector('.step-name-input').value.trim() || 'Workflow step';
    const value = document.querySelector('.step-value-input').value.trim();const settings={};document.querySelectorAll('.step-settings-fields [data-setting]').forEach(input=>settings[input.dataset.setting]=input.value);
    configuringBlock.dataset.name = name; configuringBlock.dataset.value = value;configuringBlock.dataset.settings=JSON.stringify(settings);
    configuringBlock.querySelector('.block-title').textContent = name;
    const info=blockInfo[configuringBlock.dataset.type];const detail=value||(info?.detail||'Configured');configuringBlock.querySelector('.block-detail').textContent=detail;
    configuringBlock.classList.toggle('configured', Boolean(value||Object.keys(settings).length));
    document.querySelector('.draft-badge').textContent = 'Draft';document.querySelector('.draft-badge').classList.remove('published');
    closeConfig(); notify('Step settings saved.'); renderConnections(); saveDraft();
  });
  let variableTarget=null;configModal.addEventListener('focusin',event=>{if(event.target.matches('.step-value-input,.step-settings-fields input,.step-settings-fields textarea'))variableTarget=event.target;});
  document.querySelector('.variable-chips').addEventListener('click',event=>{const chip=event.target.closest('[data-variable]');if(!chip)return;const input=variableTarget||document.querySelector('.step-value-input');input.value+=(input.value&&!input.value.endsWith(' ')?' ':'')+chip.dataset.variable;input.focus();});
  function renderConnections() {
    const canvas = document.querySelector('#builderCanvas');
    const svg = canvas.querySelector('.connections-layer');
    const blocks = [...canvas.querySelectorAll('.canvas-block')];
    const rect = canvas.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    if (!svg.querySelector('defs')) svg.innerHTML = '<defs><marker id="lineArrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1 L7 4.5 L1 8" fill="none" stroke="#d1c5ff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>';
    const active = new Set();
    for (const edge of connections) {
      const source = blocks.find((block) => block.dataset.id === edge.from);
      const target = blocks.find((block) => block.dataset.id === edge.to);
      if (!source || !target) continue;
      const key = `${edge.from}__${edge.to}`; active.add(key);
      const a=source.getBoundingClientRect(), b=target.getBoundingClientRect();
      const x1=a.left+a.width/2-rect.left, y1=a.bottom-rect.top;
      const x2=b.left+b.width/2-rect.left, y2=b.top-rect.top-9;
      const bend = Math.max(44, Math.abs(y2-y1)*.43);
      const pathData=`M ${x1} ${y1} C ${x1} ${y1+bend}, ${x2} ${y2-bend}, ${x2} ${y2}`;
      let group=lineElements.get(key);
      if (!group) {
        group=document.createElementNS('http://www.w3.org/2000/svg','g');
        const hit=document.createElementNS('http://www.w3.org/2000/svg','path'); hit.setAttribute('class','connection-hit-area'); hit.setAttribute('tabindex','0'); hit.setAttribute('role','button'); hit.setAttribute('aria-label','Remove connection'); hit.setAttribute('title','Click to remove this connection');
        const glow=document.createElementNS('http://www.w3.org/2000/svg','path'); glow.setAttribute('class','connection-glow');
        const path=document.createElementNS('http://www.w3.org/2000/svg','path'); path.id=`line-${key}`; path.setAttribute('class','connection-path'); path.setAttribute('marker-end','url(#lineArrow)'); path.setAttribute('aria-hidden','true');
        const dot=document.createElementNS('http://www.w3.org/2000/svg','circle'); dot.setAttribute('class','connection-pulse'); dot.setAttribute('r','4');
        const motion=document.createElementNS('http://www.w3.org/2000/svg','animateMotion'); motion.setAttribute('dur','1.7s'); motion.setAttribute('repeatCount','indefinite');
        const motionPath=document.createElementNS('http://www.w3.org/2000/svg','mpath'); motionPath.setAttribute('href',`#line-${key}`); motion.appendChild(motionPath); dot.appendChild(motion);
        const dot2=dot.cloneNode(true); dot2.setAttribute('r','2.5'); dot2.querySelector('animateMotion').setAttribute('begin','-0.85s');
        const disconnect=(event)=>{event.stopPropagation();const index=connections.indexOf(edge);if(index>=0)connections.splice(index,1);renderConnections();saveDraft();notify('Connection removed.');};
        hit.addEventListener('click',disconnect);hit.addEventListener('keydown',(event)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();disconnect(event);}});
        group.append(hit,glow,path,dot,dot2); svg.appendChild(group); lineElements.set(key,group);
      }
      group.children[0].setAttribute('d',pathData); group.children[1].setAttribute('d',pathData); group.children[2].setAttribute('d',pathData);
    }
    for (const [key,group] of lineElements) if (!active.has(key)) { group.remove(); lineElements.delete(key); }
  }
  window.addEventListener('resize', renderConnections);
  document.querySelector('#builderCanvas')?.addEventListener('click', (event) => { if (event.target.matches('#builderCanvas, .builder-grid, .connections-layer')) clearPendingConnection(); });
  function openSafetyScan() {
    const blocks = [...document.querySelectorAll('.canvas-block')];
    const findings = [];
    if (!blocks.length) findings.push(['warn','No steps yet','Add a trigger and at least one action before exporting.']);
    else if (!blocks.some(block => ['trigger','schedule'].includes(block.dataset.type))) findings.push(['block','No workflow trigger','Add a webhook or schedule trigger so the exported project has a starting point.']);
    if (blocks.length > 1 && !connections.length) findings.push(['warn','Steps are not connected','Connect the steps that should run after your trigger. Unconnected steps will be left out of a run.']);
    const connectedIds=new Set(connections.flatMap(edge=>[edge.from,edge.to]));
    if (blocks.some(block=>!['trigger','schedule'].includes(block.dataset.type)&&!connectedIds.has(block.dataset.id))) findings.push(['warn','Some steps are unreachable','Connect every step you want included in the workflow run.']);
    if (!blocks.some((block) => ['action','discord','email'].includes(block.dataset.type))) findings.push(['warn','No output action found','Add an action to send a message, call an API, or write data.']);
    const credentials = blocks.some((block) => /(?:token|secret|api[_ -]?key|password)\s*[:=]\s*\S+/i.test(block.dataset.value || ''));
    if (credentials) findings.push(['block','Possible hard-coded credential','Move secrets into environment variables before sharing or exporting.']);
    else findings.push(['pass','No obvious hard-coded secrets','Keep real credentials in a local .env file and never commit that file.']);
    const unsafeInput=blocks.some(block=>/^(?:javascript:|data:|file:|\\\\)/i.test((block.dataset.value||'').trim()));
    if(unsafeInput)findings.push(['block','Unsafe destination or value','Remove executable or local-file URLs from step values before exporting.']);
    const variables = blocks.some((block) => /\{\{[^}]+\}\}/.test(block.dataset.value || ''));
    findings.push(variables ? ['pass','Variable mappings found','Mapped values will be inserted at runtime.'] : ['warn','No variables mapped yet','Map trigger data into later steps where your workflow needs it.']);
    if (blocks.some((block) => ['filter','branch'].includes(block.dataset.type))) findings.push(['pass','Conditional logic included','Review both true and false paths in the generated code.']);
    if (findings.every((item) => item[0] !== 'block') && blocks.length) findings.push(['pass','Workflow structure looks ready','Check required settings and run a test with sample data.']);
    const results = document.querySelector('.scan-results'); results.innerHTML = '';
    findings.forEach(([kind,title,detail]) => { const row=document.createElement('div'); row.className=`scan-row ${kind}`; row.innerHTML=`<span class="scan-status">${kind==='pass'?'✓':kind==='block'?'!':'↗'}</span><span><b>${title}</b><small>${detail}</small></span>`; results.appendChild(row); });
    const blocked = findings.some((item) => item[0] === 'block');
    document.querySelector('.export-demo').disabled = blocked || !blocks.length;
    document.querySelector('.export-demo').textContent = blocked ? 'Fix required issues first' : blocks.length ? 'Continue to export ↗' : 'Add workflow steps first';
    openDialog(document.querySelector('#scanModal'),'.modal-close');
  }
  const scanModal=document.querySelector('#scanModal');
  function closeScan(){closeDialog(scanModal);}
  document.querySelectorAll('#scanModal .modal-close,.close-scan').forEach((button)=>button.addEventListener('click',closeScan));
  scanModal.addEventListener('click',(event)=>{if(event.target===scanModal)closeScan();});
  function generatedPythonRunner() { return `import json, os, re, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

def load_dotenv():
    try:
        with open('.env', encoding='utf-8') as env_file:
            for line in env_file:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ.setdefault(key.strip(), value.strip().strip(chr(34)).strip(chr(39)))
    except FileNotFoundError:
        pass

load_dotenv()
with open('workflow.json', encoding='utf-8') as file:
    flow = json.load(file)
webhook_path = next((step.get('settings', {}).get('path', '/webhook') for step in flow['steps'] if step['type'] == 'trigger'), '/webhook')
by_id = {step['id']: step for step in flow['steps']}
outgoing = {step['id']: [] for step in flow['steps']}
for edge in flow['connections']:
    outgoing.get(edge['from'], []).append(edge['to'])
outputs = {}

def lookup(path, context):
    value = context
    for part in path.split('.'):
        value = value.get(part) if isinstance(value, dict) else None
    return value

def resolve(value, context):
    if not isinstance(value, str):
        return value
    exact = re.fullmatch(r"\\{\\{\\s*([^}]+)\\s*\\}\\}", value)
    if exact:
        return lookup(exact.group(1).strip(), context)
    return re.sub(r"\\{\\{\\s*([^}]+)\\s*\\}\\}", lambda match: str(lookup(match.group(1).strip(), context) or ''), value)

def execute(step, payload, trigger_payload):
    context = {'trigger': {'body': trigger_payload}, 'steps': outputs}
    value = resolve(step.get('value', ''), context)
    kind = step['type']
    settings = step.get('settings') or {}
    if kind == 'action':
        url = resolve(value or 'https://example.com', context)
        method = settings.get('method', 'GET').upper()
        headers = json.loads(settings.get('headers') or '{}')
        body = resolve(settings.get('body', ''), context)
        data = (body if isinstance(body, str) else json.dumps(body)).encode() if body and method not in ('GET', 'HEAD') else None
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(request, timeout=20) as response:
            response_body = response.read().decode('utf-8', errors='replace')
            return {'status': response.status, 'body': response_body}
    if kind == 'discord':
        url = os.getenv(settings.get('webhookEnv', 'DISCORD_WEBHOOK_URL'))
        if not url:
            raise RuntimeError('Set DISCORD_WEBHOOK_URL in .env first.')
        data = json.dumps({'content': str(value or payload)}).encode()
        request = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(request, timeout=20) as response:
            return {'status': response.status}
    if kind in ('filter', 'branch'):
        operator = settings.get('operator', 'truthy')
        expected = resolve(settings.get('compareValue', ''), context)
        actual = value
        if operator == 'not_empty': return actual not in (None, '')
        if operator == 'is_empty': return actual in (None, '')
        if operator == 'equals': return str(actual).lower() == str(expected).lower()
        if operator == 'not_equals': return str(actual).lower() != str(expected).lower()
        if operator == 'contains': return str(expected).lower() in str(actual or '').lower()
        if operator == 'greater_than': return float(actual or 0) > float(expected or 0)
        if operator == 'less_than': return float(actual or 0) < float(expected or 0)
        return actual not in (False, None, '', 'false', '0', 'no')
    if kind == 'transform':
        return value
    if kind == 'json':
        return json.loads(value if isinstance(value, str) else json.dumps(value))
    if kind == 'map':
        fields = json.loads(value) if value else {}
        return {key: resolve(expression, context) for key, expression in fields.items()}
    if kind == 'loop':
        return [{'item': item, 'index': index} for index, item in enumerate(value if isinstance(value, list) else [])]
    if kind == 'delay':
        time.sleep(min(float(value or settings.get('durationMs', 1000)) / 1000, 60))
        return value
    if kind == 'log':
        print('Step:', step['name'], 'payload:', payload, 'value:', value)
        return value or payload
    if kind in ('database', 'retry'):
        print(step['name'] + ': adapter placeholder; data passes through.')
        return value or payload
    if kind == 'email':
        raise RuntimeError('Connect an email provider adapter before using this step.')
    if kind == 'code':
        print('Custom code is a safe placeholder and is not executed.')
        return value or payload
    if kind == 'response':
        global response_status
        response_status = int(settings.get('statusCode', 200))
        return value or payload
    if kind == 'notify':
        print('[Flowstate]', value or step['name'])
        return value
    if kind == 'stop':
        return '__FLOWSTATE_STOP__'
    return value or payload

def run_flow(payload, entry_type='trigger'):
    global response_status
    response_status = 200
    outputs.clear()
    queue = [(child, payload) for step in flow['steps'] if step['type'] == entry_type for child in outgoing.get(step['id'], [])]
    last = payload
    count = 0
    while queue and count < 500:
        count += 1
        step_id, current = queue.pop(0)
        step = by_id.get(step_id)
        if not step:
            continue
        result = execute(step, current, payload)
        safe_name = re.sub(r'[^a-z0-9]+', '_', step['name'].lower()).strip('_')
        outputs[step_id] = {'output': result}
        outputs['previous'] = {'output': result}
        outputs[safe_name] = {'output': result}
        last = result
        if result == '__FLOWSTATE_STOP__' or (step['type'] in ('filter', 'branch') and not result):
            continue
        if step['type'] == 'loop' and isinstance(result, list):
            for index, item in enumerate(result):
                queue.extend((child, {'item': item, 'index': index}) for child in outgoing.get(step_id, []))
        else:
            queue.extend((child, result) for child in outgoing.get(step_id, []))
    return last

response_status = 200
class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != webhook_path:
            self.send_error(404, 'POST ' + webhook_path)
            return
        try:
            raw = self.rfile.read(int(self.headers.get('Content-Length', '0')))
            payload = json.loads(raw or b'{}')
            result = run_flow(payload)
            body = json.dumps({'ok': True, 'result': result}, default=str).encode()
            self.send_response(response_status)
        except Exception as error:
            body = json.dumps({'ok': False, 'error': str(error)}).encode()
            self.send_response(500)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        print('[Webhook]', format % args)

port = int(os.getenv('PORT', '3030'))
if any(step['type'] == 'schedule' for step in flow['steps']):
    def scheduled_runs():
        interval_ms = next((int(step.get('settings', {}).get('intervalMs', 60000)) for step in flow['steps'] if step['type'] == 'schedule'), int(os.getenv('SCHEDULE_INTERVAL_MS', '60000')))
        interval = max(1, interval_ms) / 1000
        while True:
            time.sleep(interval)
            try:
                run_flow({'scheduledAt': time.time()}, 'schedule')
            except Exception as error:
                print('[Schedule error]', error)
    threading.Thread(target=scheduled_runs, daemon=True).start()

print(f"{flow['name']} listening at http://localhost:{port}{webhook_path}")
HTTPServer(('0.0.0.0', port), Handler).serve_forever()
`; }
  function generatedRunner(language=currentLanguage) { if(language==='python')return generatedPythonRunner(); return `import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const flow = JSON.parse(readFileSync(new URL('./workflow.json', import.meta.url), 'utf8'));
const byId = new Map(flow.steps.map(step => [step.id, step]));
const next = new Map(flow.steps.map(step => [step.id, []]));
for (const edge of flow.connections) next.get(edge.from)?.push(edge.to);
const outputs = {};
const webhookPath = flow.steps.find(step => step.type === 'trigger')?.settings?.path || '/webhook';
let responseStatus = 200;
function pathValue(object, path) { return path.split('.').reduce((value, key) => value == null ? undefined : value[key], object); }
function resolve(value, context) {
  if (typeof value !== 'string') return value;
  const exact = value.match(/^\\{\\{\\s*([^}]+)\\s*\\}\\}$/);
  if (exact) return pathValue(context, exact[1].trim());
  return value.replace(/\\{\\{\\s*([^}]+)\\s*\\}\\}/g, (_, path) => String(pathValue(context, path.trim()) ?? ''));
}
async function execute(step, payload, triggerPayload) {
  const context = { trigger: { body: triggerPayload }, steps: outputs };
  const value = resolve(step.value || '', context);
  switch (step.type) {
    case 'trigger': return payload;
    case 'action': { const settings = step.settings || {}; const method = settings.method || 'GET'; const headers = JSON.parse(settings.headers || '{}'); const body = resolve(settings.body || '', context); const response = await fetch(value || 'https://example.com', { method, headers, ...(body && !['GET','HEAD'].includes(method) ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.text() }; }
    case 'discord': { const settings = step.settings || {}; const url = process.env[settings.webhookEnv || 'DISCORD_WEBHOOK_URL']; if (!url) throw new Error('Set ' + (settings.webhookEnv || 'DISCORD_WEBHOOK_URL') + ' in .env first.'); const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: String(value || JSON.stringify(payload)) }) }); return { status: response.status }; }
    case 'filter': case 'branch': { const settings = step.settings || {}; const expected = resolve(settings.compareValue || '', context); const actual = value; switch (settings.operator || 'truthy') { case 'not_empty': return actual !== undefined && actual !== null && actual !== ''; case 'is_empty': return actual === undefined || actual === null || actual === ''; case 'equals': return String(actual).toLowerCase() === String(expected).toLowerCase(); case 'not_equals': return String(actual).toLowerCase() !== String(expected).toLowerCase(); case 'contains': return String(actual ?? '').toLowerCase().includes(String(expected).toLowerCase()); case 'greater_than': return Number(actual) > Number(expected); case 'less_than': return Number(actual) < Number(expected); default: return actual !== '' && actual !== undefined && !['false','0','no'].includes(String(actual).toLowerCase()); } }
    case 'transform': return value;
    case 'json': return JSON.parse(typeof value === 'string' ? value : JSON.stringify(value));
    case 'map': { const fields = value ? JSON.parse(value) : {}; return Object.fromEntries(Object.entries(fields).map(([key, expression]) => [key, resolve(expression, context)])); }
    case 'loop': return Array.isArray(value) ? value.map((item, index) => ({ item, index })) : [];
    case 'delay': await new Promise(resolve => setTimeout(resolve, Math.min(Number(value) || Number(step.settings?.durationMs) || 1000, 60000))); return value;
    case 'log': console.dir({ step: step.name, payload, value }, { depth: 5 }); return value || payload;
    case 'database': console.log('Database adapter needed; this step currently passes data through.'); return value || payload;
    case 'retry': console.log('Retry wrapper placeholder; add retry policy for your action.'); return value || payload;
    case 'response': responseStatus = Number(step.settings?.statusCode) || 200; return value || payload;
    case 'notify': console.log('[Flowstate]', value || step.name); return value;
    case 'code': console.warn('Custom code block is a safe placeholder and does not eval user code.'); return value || payload;
    case 'email': throw new Error('Connect an email provider adapter before using this step.');
    case 'schedule': return payload;
    case 'stop': return '__FLOWSTATE_STOP__';
    default: return payload;
  }
}
async function runFlow(payload, entryType = 'trigger') {
  for (const key of Object.keys(outputs)) delete outputs[key];responseStatus=200;
  const queue = flow.steps.filter(step => step.type === entryType).flatMap(step => next.get(step.id).map(id => [id, payload]));
  let last = payload; let count = 0;
  while (queue.length && count++ < 500) {
    const [id, current] = queue.shift(); const step = byId.get(id); if (!step) continue;
    const result = await execute(step, current, payload); outputs[id] = { output: result }; outputs.previous = { output: result }; outputs[step.name.toLowerCase().replace(/[^a-z0-9]+/g,'_')] = { output: result }; last = result;
    if (result === '__FLOWSTATE_STOP__') continue;
    if ((step.type === 'filter' || step.type === 'branch') && !result) continue;
    for (const child of next.get(id) || []) queue.push([child, result]);
  }
  return last;
}
const port = Number(process.env.PORT || 3030);
const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== webhookPath) { res.writeHead(404); return res.end('POST /webhook'); }
  try { let body = ''; for await (const chunk of req) body += chunk; const payload = body ? JSON.parse(body) : {}; const result = await runFlow(payload); res.writeHead(responseStatus, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, result })); }
  catch (error) { console.error(error); res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: error.message })); }
});
server.listen(port, () => console.log('Flowstate workflow listening at http://localhost:' + port + webhookPath));
if (flow.steps.some(step => step.type === 'schedule')) { const interval = Number(flow.steps.find(step => step.type === 'schedule')?.settings?.intervalMs || process.env.SCHEDULE_INTERVAL_MS || 60000); setInterval(() => runFlow({ scheduledAt: new Date().toISOString() }, 'schedule').catch(console.error), interval); }
`; }
  function crc32(bytes) {
    let crc = -1;
    for (const byte of bytes) { crc ^= byte; for (let k=0; k<8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    return (crc ^ -1) >>> 0;
  }
  function makeZip(files) {
    const encoder = new TextEncoder(); const localParts=[]; const centralParts=[]; let offset=0;
    const put16=(view,pos,value)=>view.setUint16(pos,value,true); const put32=(view,pos,value)=>view.setUint32(pos,value,true);
    for (const [name,content] of Object.entries(files)) {
      const filename=encoder.encode(name); const data=encoder.encode(content); const checksum=crc32(data);
      const local=new Uint8Array(30+filename.length+data.length); const lv=new DataView(local.buffer);
      put32(lv,0,0x04034b50); put16(lv,4,20); put16(lv,6,0x0800); put16(lv,8,0); put32(lv,14,checksum); put32(lv,18,data.length); put32(lv,22,data.length); put16(lv,26,filename.length); local.set(filename,30); local.set(data,30+filename.length); localParts.push(local);
      const central=new Uint8Array(46+filename.length); const cv=new DataView(central.buffer);
      put32(cv,0,0x02014b50); put16(cv,4,20); put16(cv,6,20); put16(cv,8,0x0800); put16(cv,10,0); put32(cv,16,checksum); put32(cv,20,data.length); put32(cv,24,data.length); put16(cv,28,filename.length); put32(cv,42,offset); central.set(filename,46); centralParts.push(central); offset+=local.length;
    }
    const centralSize=centralParts.reduce((sum,part)=>sum+part.length,0); const end=new Uint8Array(22); const ev=new DataView(end.buffer);
    put32(ev,0,0x06054b50); put16(ev,8,centralParts.length); put16(ev,10,centralParts.length); put32(ev,12,centralSize); put32(ev,16,offset);
    return new Blob([...localParts,...centralParts,end],{type:'application/zip'});
  }
  function downloadProject() {
    const nodes=[...document.querySelectorAll('.canvas-block')];
    const slug=(workflowName.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'my-workflow');
    const isPython=currentLanguage==='python';
    const flow={name:workflowName,language:currentLanguage,version:1,steps:nodes.map((node,index)=>({id:node.dataset.id||`step-${index+1}`,type:node.dataset.type,name:node.dataset.name||node.querySelector('.block-title').textContent,value:node.dataset.value||'',settings:parseBlockSettings(node)})),connections:connections.map(edge=>({...edge}))};
    const startCommand=isPython?'python workflow.py':'npm start';
    const runtimeFile=isPython?'workflow.py':'workflow.mjs';const webhookPath=flow.steps.find(step=>step.type==='trigger')?.settings?.path||'/webhook';
    const readme=`# ${workflowName}\n\n## Run locally\n1. Install ${isPython?'Python 3.10 or newer':'Node.js 20.6 or newer'}.\n2. Copy \`.env.example\` to \`.env\` (the demo needs no secrets).\n3. Open this folder in Terminal or PowerShell.\n4. Start the workflow with \`${startCommand}\`. Keep that terminal open.\n5. In a second PowerShell window, run: \`Invoke-RestMethod -Method Post -Uri 'http://localhost:3030${webhookPath}' -ContentType 'application/json' -Body '{\"email\":\"alex@example.com\",\"name\":\"Alex Rivera\"}'\`.\n6. The response should say \`ok: true\`; the runner terminal prints the captured lead.\n\nThe included flow needs no API keys or third-party services. Send your own JSON to \`http://localhost:3030${webhookPath}\` using POST.\n\n## Included\n- workflow.json: your blocks, values, connections, and selected language\n- ${runtimeFile}: local ${isPython?'Python':'Node.js'} runner\n- .env.example: local configuration template\n\n## Notes\nThe export runs on your own computer or server; Flowstate does not host it. Webhooks, schedules, HTTP requests, Discord webhook messages, JSON, variables, filters, delays, and logs have starter behavior. Email, database, retry, and custom-code blocks need provider or safety adapters before production use. Review the code and keep real credentials in .env; never share that file.\n`;
    const pkg={name:slug,version:'1.0.0',private:true,type:'module',engines:{node: '>=20.6'},scripts:{start:'node --env-file=.env workflow.mjs'}};
    const env='# Local-only settings. Keep .env private and out of version control.\nPORT=3030\nSCHEDULE_INTERVAL_MS=60000\nDISCORD_WEBHOOK_URL=\n';
    const folder=`${slug}/`;
    const files={[folder+'README.md']:readme,[folder+'workflow.json']:JSON.stringify(flow,null,2)+'\n',[folder+'.env.example']:env,[folder+'.gitignore']:'.env\nnode_modules/\n'};
    if(isPython){files[folder+'workflow.py']=generatedPythonRunner();files[folder+'requirements.txt']='# Uses Python standard library only.\n';}
    else{files[folder+'workflow.mjs']=generatedRunner('javascript');files[folder+'package.json']=JSON.stringify(pkg,null,2)+'\n';}
    const archiveName=`${slug}-${currentLanguage}.zip`;
    const blob=makeZip(files); const link=document.createElement('a'); link.href=URL.createObjectURL(blob); link.download=archiveName; document.body.appendChild(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(link.href),2000);
    metrics.exports=(Number(metrics.exports)||0)+1;recordDashboardEvent('Project exported',`${workflowName} · ${currentLanguage==='python'?'Python':'JavaScript'} ZIP`);
    closeScan(); notify(`Export downloaded: ${archiveName}`);
  }
  document.querySelector('.export-demo').addEventListener('click',downloadProject);
  function restoreStart() {
    const canvas = document.querySelector('#builderCanvas');
    if (canvas.querySelector('.builder-start')) return;
    const start = document.createElement('div'); start.className = 'builder-start';
    start.innerHTML = '<span class="start-icon">✦</span><b>Let’s start with a trigger</b><small>Every good workflow begins somewhere.</small><button class="button button-soft add-trigger">＋ Add your first step</button>';
    canvas.appendChild(start);
    start.querySelector('.add-trigger').addEventListener('click', () => addBlock('trigger', 50, 17));
  }
  function makeMovable(block, canvas) {
    let pointerId, dx = 0, dy = 0;
    block.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.block-remove,.block-edit,.port')) return;
      const rect = block.getBoundingClientRect(); pointerId = event.pointerId;
      dx = event.clientX - rect.left; dy = event.clientY - rect.top;
      block.classList.add('dragging'); block.setPointerCapture(pointerId);
    });
    block.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId) return;
      const bounds = canvas.getBoundingClientRect();
      const x = Math.min(Math.max(0, event.clientX - bounds.left - dx), bounds.width - block.offsetWidth);
      const y = Math.min(Math.max(0, event.clientY - bounds.top - dy), bounds.height - block.offsetHeight);
      block.style.left = `${x / bounds.width * 100}%`; block.style.top = `${y / bounds.height * 100}%`; renderConnections();
    });
    block.addEventListener('pointerup', (event) => { if (event.pointerId === pointerId) { block.classList.remove('dragging'); pointerId = null; renderConnections(); saveDraft(); } });
    block.addEventListener('pointercancel', () => { block.classList.remove('dragging'); pointerId = null; });
  }
  document.querySelectorAll('.block-item').forEach((item) => {
    item.addEventListener('dragstart', (event) => { event.dataTransfer.setData('text/plain', item.dataset.block); event.dataTransfer.effectAllowed = 'copy'; });
    item.addEventListener('click', () => {
      const offsets = [[40, 12], [58, 35], [40, 58], [58, 77]];
      const position = offsets[blockOffset % offsets.length]; addBlock(item.dataset.block, ...position);
      notify(`${blockInfo[item.dataset.block].title} added to your flow.`);
    });
  });
  function evaluateCondition(actual,expected,operator='truthy'){if(operator==='not_empty')return actual!==undefined&&actual!==null&&actual!=='';if(operator==='is_empty')return actual===undefined||actual===null||actual==='';if(operator==='equals')return String(actual).toLowerCase()===String(expected).toLowerCase();if(operator==='not_equals')return String(actual).toLowerCase()!==String(expected).toLowerCase();if(operator==='contains')return String(actual??'').toLowerCase().includes(String(expected).toLowerCase());if(operator==='greater_than')return Number(actual)>Number(expected);if(operator==='less_than')return Number(actual)<Number(expected);return actual!==''&&actual!==undefined&&!['false','0','no'].includes(String(actual).toLowerCase());}
  document.querySelector('.preview-flow').addEventListener('click', () => {
    const blocks=[...document.querySelectorAll('#builderCanvas .canvas-block')];
    const output=document.querySelector('.run-output'); const lines=document.querySelector('.run-output-lines');
    if(!blocks.length){notify('Add a trigger and steps to preview a run.');return;}
    if(monthRunCount()>=currentPlan().runs){showUpgrade('runs');return;}
    const byId=new Map(blocks.map(block=>[block.dataset.id,block])); const outgoing=new Map(blocks.map(block=>[block.dataset.id,[]]));
    connections.forEach(edge=>outgoing.get(edge.from)?.push(edge.to));
    const starts=blocks.filter(block=>['trigger','schedule'].includes(block.dataset.type));
    if(!starts.length){notify('Add a webhook or scheduled trigger before previewing.');return;}
    const sample={lead:true,email:'alex@example.com',name:'Alex Rivera',items:[{sku:'FLOW-01',quantity:2}],approved:true};
    const previewOutputs={};
    const lookup=(path)=>path.trim().split('.').reduce((value,key)=>value==null?undefined:value[key],path.trim().startsWith('trigger.body.')?{trigger:{body:sample}}:path.trim().startsWith('steps.')?{steps:previewOutputs}:{trigger:{body:sample}});
    const resolve=(value)=>{if(typeof value!=='string')return value;const exact=value.match(/^\{\{\s*([^}]+)\s*\}\}$/);if(exact)return lookup(exact[1]);return value.replace(/\{\{\s*([^}]+)\s*\}\}/g,(_,path)=>String(lookup(path)??''));};
    const queue=[],visited=new Set(),results=[]; let previewedActions=0;
    results.push({name:'Sample webhook event',status:'RECEIVED',detail:JSON.stringify(sample)});
    for(const start of starts){for(const nextId of outgoing.get(start.dataset.id)||[])queue.push({id:nextId,payload:sample});}
    while(queue.length&&visited.size<40){const {id,payload}=queue.shift();if(visited.has(id))continue;visited.add(id);const block=byId.get(id);if(!block)continue;
      const type=block.dataset.type;const name=block.dataset.name||block.querySelector('.block-title').textContent;const input=block.dataset.value||'';let value=resolve(input);let status='PREVIEWED';let detail='Sample data passed through this step.';let continuePath=true;
      if(type==='action'){const settings=parseBlockSettings(block);status='WOULD REQUEST';detail=`${settings.method||'GET'} ${String(value||'https://example.com')} · external request skipped`;previewedActions++;}
      else if(type==='discord'){status='WOULD SEND';detail=`Discord message: ${String(value||'New lead: '+sample.email)} · not sent`;previewedActions++;}
      else if(type==='email'){const settings=parseBlockSettings(block);status='NEEDS SETUP';detail=`Email adapter required · ${settings.to||'recipient not set'} · nothing sent`;}
      else if(type==='database'){status='NEEDS SETUP';detail='Database adapter required · nothing written';}
      else if(type==='filter'||type==='branch'){const settings=parseBlockSettings(block);const expected=resolve(settings.compareValue||'');const matched=evaluateCondition(value,expected,settings.operator||'truthy');status=matched?'CONDITION TRUE':'CONDITION FALSE';detail=`${input||'value'} ${settings.operator||'truthy'} ${expected||''} → ${String(value)}`;continuePath=matched;}
      else if(type==='transform'){status='VALUE CREATED';detail=String(value||input||'Add a value in step settings.');}
      else if(type==='json'){try{value=typeof value==='string'?JSON.parse(value):value;status='JSON PARSED';detail=JSON.stringify(value);}catch{status='NEEDS INPUT';detail='Provide valid JSON text or map a JSON variable.';}}
      else if(type==='map'){status='MAPPING PREVIEW';detail=input||'Add a JSON field mapping in step settings.';}
      else if(type==='loop'){status='ITEMS FOUND';const items=Array.isArray(value)?value:sample.items;detail=`${items.length} sample item${items.length===1?'':'s'} · next connected step runs once per item`;}
      else if(type==='delay'){status='WAIT SKIPPED';detail=`Would wait ${String(value||parseBlockSettings(block).durationMs||1000)} ms · preview does not pause`;}
      else if(type==='log'){status='LOG OUTPUT';detail=JSON.stringify(payload);}
      else if(type==='retry'){status='NEEDS SETUP';detail='Retry policy adapter required.';}
      else if(type==='response'){status='RESPONSE READY';detail=`HTTP ${parseBlockSettings(block).statusCode||200} · ${String(value||JSON.stringify(payload))}`;}
      else if(type==='code'){status='PLACEHOLDER';detail='Custom code is not executed in preview or export.';}
      else if(type==='notify'){status='LOG OUTPUT';detail=String(value||name);}
      else if(type==='stop'){status='PATH STOPPED';detail='Later connected steps will be skipped.';continuePath=false;}
      results.push({name,status,detail});previewOutputs.previous={output:value??payload};if(block.dataset.name)previewOutputs[block.dataset.name.toLowerCase().replace(/[^a-z0-9]+/g,'_')]={output:value??payload};if(continuePath)for(const nextId of outgoing.get(id)||[])queue.push({id:nextId,payload:value??payload});
    }
    for(const block of blocks){if(!visited.has(block.dataset.id)&&!['trigger','schedule'].includes(block.dataset.type))results.push({name:block.dataset.name||block.querySelector('.block-title').textContent,status:'SKIPPED',detail:'No connected path reached this step.'});}
    lines.replaceChildren();results.forEach((result,index)=>{const row=document.createElement('div');row.className='run-output-row';const time=document.createElement('time');time.className='run-output-index';time.textContent=new Date(Date.now()+index*10).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});const name=document.createElement('span');name.className='run-output-step';name.textContent=result.name;const status=document.createElement('span');status.className='run-output-result'+(result.status.includes('WOULD')?' status-would':result.status.includes('SETUP')||result.status.includes('INPUT')?' status-setup':result.status==='SKIPPED'?' status-skipped':'');status.textContent=result.status;const detail=document.createElement('span');detail.className='run-output-detail';detail.textContent=result.detail;row.append(time,name,status,detail);lines.appendChild(row);});
    output.hidden=false;output.querySelector('.run-output-head b').textContent=`Preview log · ${results.length} entries`;output.querySelector('.run-output-state').textContent='SIMULATED · NO EXTERNAL ACTIONS';
    metrics.previewRuns=(Number(metrics.previewRuns)||0)+1;const previewKey=dateKey(new Date());metrics.previewRunsByDay[previewKey]=(Number(metrics.previewRunsByDay[previewKey])||0)+1;recordDashboardEvent('Preview run completed',`${results.length} log entries · external actions skipped`);
    notify(`Preview generated ${results.length} log entries; external actions were skipped.`);
  });
  document.querySelector('.run-output-close').addEventListener('click',()=>{document.querySelector('.run-output').hidden=true;});
  const canvas = document.querySelector('#builderCanvas');
  canvas.addEventListener('dragover', (event) => { event.preventDefault(); canvas.classList.add('drag-over'); });
  canvas.addEventListener('dragleave', (event) => { if (!canvas.contains(event.relatedTarget)) canvas.classList.remove('drag-over'); });
  canvas.addEventListener('drop', (event) => {
    event.preventDefault(); canvas.classList.remove('drag-over');
    const type = event.dataTransfer.getData('text/plain'); const bounds = canvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * 100; const y = (event.clientY - bounds.top) / bounds.height * 100;
    addBlock(type, x, y); notify(`${blockInfo[type]?.title || 'Block'} added to your flow.`);
  });
  try {
    const saved=JSON.parse(localStorage.getItem('flowstate-draft-v1')||'null');
    if(saved?.steps?.length){
      document.querySelectorAll('#builderCanvas .canvas-block').forEach(block=>block.remove());
      saved.steps.forEach(step=>{const block=addBlock(step.type,parseFloat(step.left)||40,parseFloat(step.top)||18);if(!block)return;block.dataset.id=step.id;blockSerial=Math.max(blockSerial,Number(String(step.id).replace('step-',''))||0);block.dataset.name=step.name||'';block.dataset.value=step.value||'';block.dataset.settings=JSON.stringify(step.settings||{});block.querySelector('.block-title').textContent=step.name||blockInfo[step.type].title;block.querySelector('.block-detail').textContent=step.value||blockInfo[step.type].detail;block.classList.toggle('configured',Boolean(step.value));});
      connections.splice(0,connections.length,...(saved.connections||[]));renderConnections();saveDraft();
    }
  } catch { /* Ignore an unavailable or malformed local draft. */ }
  if(!location.hash||location.hash==='#dashboard'||location.hash==='#workspace'){history.replaceState(null,'','#home');window.scrollTo(0,0);}
  startUsageTracking();
})();


