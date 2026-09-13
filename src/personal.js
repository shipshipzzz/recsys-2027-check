import {supabase,readableError} from './backend.js';
import {StateStore} from './state-store.js';
import {comparePersonal,isMuted} from './catalog-model.js';
import './personal.css';
import {requestEmailLink,setVerifiedPassword} from './auth-actions.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={active:'未处理',applied:'已投递',uninterested:'不感兴趣'};
function safeStorage(){try{return window.localStorage;}catch{return {getItem(){return null;},setItem(){throw new Error('Storage unavailable');}};}}

export function createPersonalManager(kind,catalog) {
  const storage=safeStorage(),items=catalog.ALL_ITEMS,byId=new Map(items.map(x=>[x.id,x]));
  let user=null,store=new StateStore(storage),onChange=()=>{},filter='all',lastSignature='',lastAction=null;
  let epoch=0,ready=Promise.resolve(),busy=false,lastRefresh=0,rendering=false;
  const panel=document.createElement('section');panel.className='personal-panel';panel.setAttribute('aria-label','个人投递工作台');
  panel.innerHTML=`<div class="personal-heading"><div><span class="personal-eyebrow">MY APPLICATIONS</span><h2>留意机会，记录进度</h2><p>已投递或不感兴趣的卡片会置灰、移到末尾；随时可以恢复。</p></div><div class="personal-summary" aria-label="个人状态统计"></div></div>
  <div class="sync-row"><span data-catalog-mode></span><span data-sync-status role="status" aria-live="polite"></span><div class="sync-buttons"><button type="button" data-enable-sync>启用云端同步</button><button type="button" data-account>邮箱登录 / 绑定</button><button type="button" data-retry hidden>重试同步</button><button type="button" data-import hidden>同步本机标记</button><button type="button" data-signout hidden>退出登录</button></div></div>
  <p class="identity-note" data-identity-note></p>`;
  document.querySelector('.toolbar').before(panel);
  const filterLabel=document.createElement('label');filterLabel.className='personal-filter';
  filterLabel.innerHTML='<span>我的状态</span><select aria-label="筛选我的卡片状态" data-personal-filter><option value="all">全部状态</option><option value="active">只看未处理</option><option value="applied">只看已投递</option><option value="uninterested">只看不感兴趣</option></select>';
  document.querySelector('.filters').append(filterLabel);
  const processed=document.createElement('section');processed.id='processed-wrap';processed.hidden=true;
  processed.innerHTML='<div class="processed-heading"><h2>已处理的卡片 <span data-processed-count></span></h2><p>这里只改变你的个人视图，不代表招聘已结束。点击“恢复”即可回到前面的列表。</p></div><div id="processed-grid"></div>';
  (document.getElementById('extra-wrap')||document.getElementById('grid')).after(processed);
  processed.querySelector('#processed-grid').className=document.getElementById('grid').className;
  const toast=document.createElement('div');toast.className='personal-toast';toast.hidden=true;toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');document.body.append(toast);
  const dialog=document.createElement('dialog');dialog.className='account-dialog';dialog.setAttribute('aria-labelledby','account-title');
  dialog.innerHTML=`<form novalidate><div class="dialog-title"><h2 id="account-title">邮箱账号</h2><button type="button" data-close aria-label="关闭账号窗口">×</button></div><p>绑定邮箱后，可在其他设备登录并同步标记。首次注册或绑定需要确认邮件；匿名账号绑定时先填邮箱，确认后再设置密码。</p><label>邮箱<input name="email" type="email" autocomplete="email" required maxlength="254"></label><label>密码（至少 8 位）<input name="password" type="password" autocomplete="current-password" minlength="8" required></label><p class="auth-feedback" role="status" aria-live="polite"></p><div class="dialog-actions"><button type="submit" value="login">登录</button><button type="submit" value="register">注册 / 绑定当前标记</button><button type="submit" value="password" hidden>设置 / 修改登录密码</button></div><p class="auth-footnote">Supabase 默认邮件服务仅向项目团队邮箱发信。面向其他邮箱开放注册前，需要配置 SMTP。</p></form>`;
  document.body.append(dialog);

  function rerender(){
    if(rendering)return;rendering=true;
    const open=[...document.querySelectorAll('.card details[open]')].map(el=>({id:el.closest('.card')?.dataset.entryId,index:[...el.closest('.card').querySelectorAll('details')].indexOf(el)}));
    try{onChange();for(const x of open){const card=document.querySelector(`[data-entry-id="${x.id}"]`);const detail=card?.querySelectorAll('details')[x.index];if(detail)detail.open=true;}}finally{rendering=false;}
  }
  function update(){
    const counts={active:0,applied:0,uninterested:0};for(const item of items)counts[store.status(item.id)]++;
    panel.querySelector('.personal-summary').innerHTML=Object.entries(counts).map(([s,n])=>`<span><b>${n}</b>${labels[s]}</span>`).join('');
    panel.querySelector('[data-catalog-mode]').textContent=({cloud:'云端招聘资料',cached:'离线缓存资料',fallback:'内置只读备份'}[catalog.connection]||'本地资料')+' · '+items.length+' 张';
    const pending=store.pendingCount();
    let text=!user?'仅本机保存':pending?`${pending} 项待同步`:'云端已同步';
    if(store.lastError)text='同步失败 · 本机记录保留';
    if(store.inFlight)text='正在同步…';
    if(store.storageError)text='浏览器阻止本地保存，请勿关闭页面';
    panel.querySelector('[data-sync-status]').textContent=text;
    panel.querySelector('[data-enable-sync]').hidden=!!user;
    panel.querySelector('[data-signout]').hidden=!user;
    panel.querySelector('[data-retry]').hidden=!user||(!pending&&!store.lastError);
    panel.querySelector('[data-import]').hidden=!user||!Object.values(new StateStore(storage).entries).some(e=>e.status!=='active');
    panel.querySelector('[data-account]').textContent=user?.email&&!user?.is_anonymous?'已绑定邮箱':'邮箱登录 / 绑定';
    panel.querySelector('[data-identity-note]').textContent=!user?'无需登录即可标记。启用云端同步后，当前浏览器的标记会保存到数据库。':user.is_anonymous?'当前为匿名设备账号：刷新不会丢失，但清除浏览器数据或退出后无法找回。请绑定邮箱以跨设备使用。':`账号：${user.email} · 各账号标记独立保存。`;
    panel.querySelectorAll('button').forEach(b=>b.disabled=busy);
    dialog.querySelector('[value=password]').hidden=!user?.email||user?.is_anonymous;
    dialog.querySelector('[value=register]').hidden=!!user&&!user.is_anonymous;
    const signature=items.map(x=>x.id+':'+store.status(x.id)).join('|');
    if(signature!==lastSignature){lastSignature=signature;rerender();}
  }
  function notify(message,undo=false){
    toast.replaceChildren(document.createTextNode(message));
    if(undo){const b=document.createElement('button');b.type='button';b.textContent='撤销';b.addEventListener('click',()=>{if(lastAction){const {id,status}=lastAction;lastAction=null;store.set(id,status);void sync();toast.hidden=true;}});toast.append(b);}
    toast.hidden=false;
  }
  function attachStore(next){store=next;next.notify=()=>{if(store===next)update();};lastSignature='';update();}
  async function writeRemote(target,batch){
    const {data,error}=await supabase.from('user_card_states').upsert(batch.map(e=>({user_id:target.scope,entry_id:e.entry_id,status:e.status})),{onConflict:'user_id,entry_id'}).select('entry_id,status,updated_at').abortSignal(AbortSignal.timeout(12000));
    if(error)throw error;return data;
  }
  async function sync(){
    if(!user)return;
    const target=store;
    try{await target.flush(batch=>writeRemote(target,batch));}catch(error){if(store===target)notify(readableError(error));}
    update();
  }
  async function pull(target=store,version=epoch){
    if(target.scope==='guest')return;
    try{
      const {data,error}=await supabase.from('user_card_states').select('entry_id,status,updated_at').eq('user_id',target.scope).abortSignal(AbortSignal.timeout(12000));
      if(error)throw error;
      if(version!==epoch||store!==target)return;
      target.lastError=null;target.acceptRemote(data);lastRefresh=Date.now();await sync();
    }catch(error){if(store===target){target.lastError=error;update();}}
  }
  function adoptSession(session){
    const next=session?.user||null,nextId=next?.id||'guest';
    if(nextId===store.scope){user=next;update();return ready;}
    user=next;const version=++epoch;attachStore(new StateStore(storage,nextId));
    ready=next?pull(store,version):Promise.resolve();return ready;
  }
  async function importGuest(){
    if(!user)return;
    const guest=new StateStore(storage);
    for(const [id,e] of Object.entries(guest.entries))store.set(id,e.status);
    await sync();
  }
  async function withBusy(action){
    if(busy)return;busy=true;update();
    try{await action();}catch(error){notify(readableError(error));}finally{busy=false;update();}
  }
  panel.querySelector('[data-enable-sync]').addEventListener('click',()=>withBusy(async()=>{
    const {data,error}=await supabase.auth.signInAnonymously();if(error)throw error;
    await adoptSession(data.session);await importGuest();
    notify(store.pendingCount()?'云端账号已启用，部分标记等待同步。':'云端同步已启用。建议绑定邮箱，避免清除浏览器数据后失去账号。');
  }));
  panel.querySelector('[data-retry]').addEventListener('click',()=>withBusy(async()=>{await sync();await pull();}));
  panel.querySelector('[data-import]').addEventListener('click',()=>withBusy(async()=>{
    if(confirm('将本机访客标记合并到当前账号？同一卡片将采用本机标记。'))await importGuest();
  }));
  panel.querySelector('[data-signout]').addEventListener('click',()=>withBusy(async()=>{
    if(store.pendingCount()&&!confirm('还有未同步标记。退出后这些标记仍保留在此浏览器的原账号缓存中，确定退出？'))return;
    if(user?.is_anonymous&&!confirm('当前为匿名账号。退出后无法重新登录此账号，建议先绑定邮箱。仍要退出？'))return;
    const {error}=await supabase.auth.signOut({scope:'local'});if(error)throw error;await adoptSession(null);
  }));
  panel.querySelector('[data-account]').addEventListener('click',()=>{dialog.querySelector('.auth-feedback').textContent='';dialog.querySelector('[name=email]').value=user?.email||'';dialog.showModal();dialog.querySelector('[name=email]').focus();});
  dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{dialog.querySelector('[name=password]').value='';});
  dialog.querySelector('form').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,button=event.submitter,feedback=dialog.querySelector('.auth-feedback');
    const email=form.elements.email.value.trim(),password=form.elements.password.value;
    if(!form.elements.email.reportValidity())return;
    const linking=button?.value==='register'&&user?.is_anonymous;
    if(!linking&&!form.elements.password.reportValidity())return;
    const buttons=[...form.querySelectorAll('button[type=submit]')];buttons.forEach(b=>b.disabled=true);feedback.textContent='正在处理…';
    try{
      if(button?.value==='password'){
        await setVerifiedPassword(supabase,user,password);feedback.textContent='登录密码已设置。现在可以在其他设备用此邮箱和密码登录。';form.elements.password.value='';
      }else if(button?.value==='login'){
        const {data,error}=await supabase.auth.signInWithPassword({email,password});if(error)throw error;
        await adoptSession(data.session);dialog.close();notify('已登录。云端标记已读取，本机访客标记不会自动混入账号。');
      }else{
        const redirect=new URL(location.pathname,location.origin).href;
        if(user?.is_anonymous){
          await requestEmailLink(supabase,email,redirect);
          feedback.textContent='确认邮件已请求发送。请在此浏览器打开邮件链接，再回到账号窗口点击“设置 / 修改登录密码”。匿名标记会保留在同一账号。';
        }else if(user){throw new Error('当前账号已经绑定邮箱。需要切换账号时，请退出后登录。');}
        else{
          const {data,error}=await supabase.auth.signUp({email,password,options:{emailRedirectTo:redirect}});if(error)throw error;
          if(data.session){await adoptSession(data.session);dialog.close();}
          else feedback.textContent='请检查邮箱中的确认邮件。确认后登录，再使用“同步本机标记”导入已有记录。';
        }
      }
    }catch(error){feedback.textContent=readableError(error);}finally{buttons.forEach(b=>b.disabled=false);}
  });
  filterLabel.querySelector('select').addEventListener('change',event=>{filter=event.target.value;rerender();});
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-card-state]');if(!button)return;
    const id=button.dataset.cardId;if(!byId.has(id))return;
    const previous=store.status(id),next=button.dataset.cardState;if(next===previous)return;
    lastAction={id,status:previous};store.set(id,next);notify(`${byId.get(id).name}：${next==='active'?'已恢复到未处理列表':labels[next]+'，已置灰并移到末尾'}`,true);void sync();
  });
  window.addEventListener('storage',event=>{if(event.key===store.key){store.reload();update();void sync();}});
  window.addEventListener('online',()=>{void sync().then(()=>pull());});
  window.addEventListener('focus',()=>{if(user&&Date.now()-lastRefresh>15000)void pull();});
  store.notify=update;
  const manager={
    status:item=>store.status(item.id),muted:item=>isMuted(store.status(item.id)),
    matches:item=>filter==='all'||store.status(item.id)===filter,
    compare:(a,b)=>comparePersonal(a,b,store.entries),
    controls:item=>{
      const state=store.status(item.id),muted=isMuted(state);
      return `<div class="personal-actions"><span class="personal-card-state" data-testid="card-personal-status">${labels[state]}${muted?' · 已置后':''}</span><div><button type="button" data-card-id="${item.id}" data-card-state="applied" aria-pressed="${state==='applied'}" aria-label="标记${esc(item.name)}为已投递">已投递</button><button type="button" data-card-id="${item.id}" data-card-state="uninterested" aria-pressed="${state==='uninterested'}" aria-label="标记${esc(item.name)}为不感兴趣">不感兴趣</button>${muted?`<button type="button" class="restore-card" data-card-id="${item.id}" data-card-state="active" aria-label="恢复${esc(item.name)}为未处理">恢复</button>`:''}</div></div>`;
    },
    renderProcessed:(list,renderCard)=>{processed.hidden=!list.length;processed.querySelector('[data-processed-count]').textContent=`· ${list.length}`;processed.querySelector('#processed-grid').innerHTML=list.map(renderCard).join('');},
    async start(callback){onChange=callback;update();rerender();const {data,error}=await supabase.auth.getSession();if(error)notify(readableError(error));await adoptSession(data?.session);supabase.auth.onAuthStateChange((_event,session)=>{queueMicrotask(()=>{void adoptSession(session);});});},
    snapshot:()=>({scope:store.scope,isAnonymous:!!user?.is_anonymous,connection:catalog.connection,filter,pending:store.pendingCount(),states:items.map(x=>({id:x.id,name:x.name,status:store.status(x.id)}))})
  };
  return manager;
}
