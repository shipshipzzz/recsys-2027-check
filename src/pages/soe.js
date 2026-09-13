import fallback from '../../data/soe.json';
import {loadCatalog} from '../backend.js';
import {createPersonalManager} from '../personal.js';

const catalog=await loadCatalog('soe',fallback);
const {DATA,PAGE_KIND,ORIGINAL_ITEMS,SOURCES}=catalog;
const ALL_ITEMS=catalog.ALL_ITEMS;
const personal=createPersonalManager('soe',catalog);

const RECHECKED = catalog.RECHECKED;
const TZ = "Asia/Shanghai";
function escapeHTML(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function chinaDay(value=new Date()){
 const p=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
 return ['year','month','day'].map(k=>p.find(x=>x.type===k).value).join('-');
}
function dayDistance(iso,now=new Date()){
 return iso?Math.round((Date.parse(iso+'T00:00:00+08:00')-Date.parse(chinaDay(now)+'T00:00:00+08:00'))/86400000):null;
}
function deadlineEpoch(ev){
 if(!ev||!ev.date)return null;
 // A missing clock time is not asserted as an official 23:59 cutoff.
 // End-of-day below is only used to turn the calendar-day badge after that date ends.
 if(!ev.time||ev.time==='24:00')return Date.parse(ev.date+'T00:00:00+08:00')+86400000;
 return Date.parse(ev.date+'T'+(ev.time.length===5?ev.time+':00':ev.time)+'+08:00');
}
function timeState(ev,now=new Date()){
 if(!ev||!ev.date)return {days:null,expired:false,label:'未见统一截止',cls:'u-none'};
 const days=dayDistance(ev.date,now),end=deadlineEpoch(ev),expired=now.getTime()>=end;
 const pending=!['confirmed','supported'].includes(ev.confidence),special=['special','advisory'].includes(ev.kind);
 let label=expired?(pending||special?'原节点已过':'该窗口已过'):days===0?(pending?'今天节点·待核':ev.time?'今天 '+ev.time:'今天节点·时刻未注明'):`${days} 天后${pending?'·待核':''}`;
 if(!expired&&days>0&&!pending&&!special)label=`还剩 ${days} 天`;
 let cls=expired?'u-past':pending||special?'u-none':days<=14?'u-hot':days<=45?'u-soon':'u-far';
 return {days,expired,label,cls,iso:ev.date,event:ev};
}
function sourceRefs(ids=[]){return ids.map(id=>`<a class="source-ref" href="#src-${escapeHTML(id)}" title="查看证据范围">[${escapeHTML(id)}]</a>`).join(' ');}
function auditHTML(item){
 const a=item.audit||{},fresh=a.checked===RECHECKED;
 return `<div class="audit-note${fresh?' is-current':''}"><strong>${fresh?'9/13 复核':'历史记录 / 口径说明'}</strong> ${escapeHTML(a.summary||'原8月快照完整保留；本轮未重新核对该公司职位池与规则。')} ${sourceRefs(a.refs||[PAGE_KIND==='rec'?'H01':'H02'])}<small>${escapeHTML(fresh?a.scope||'本届信息已核；岗位在线与个人资格另核':'未注明本轮核实的岗位数量、条件与规则仍属历史信息，不代表今天在线。')}</small></div>`;
}
function originalCard(item){return ORIGINAL_ITEMS.find(x=>x.name===item.name)||null;}
function historyHTML(item){
 const old=originalCard(item);if(!old)return '';
 const labels={status:'原状态',src:'原来源',rec:'原推荐标签',opened:'何时放出',closes:'何时结束',window:'毕业窗口',city:'城市',jobs:'岗位情况',req:'硬性要求',note:'原备注',due:'原日期',dueAlt:'原补充日期',action:'原现在动作',why:'为什么适合',risk:'风险 / 缺口',resume:'简历版本',evidence:'原证据状态',fit:'原匹配分',tier:'原等级',ownership:'单位类型'};
 const fields=Object.keys(labels).filter(k=>old[k]!==undefined&&old[k]!==null).map(k=>`<p class="field"><b>${labels[k]}</b>${escapeHTML(old[k])}</p>`).join('');
 const links=(old.links||[]).map(([t,h])=>`<a href="${escapeHTML(h)}" target="_blank" rel="noopener noreferrer">${escapeHTML(t)}</a>`).join('');
 return `<details class="more history-record"><summary>原始记录完整保留 · 8月快照（非当前结论）</summary>${fields}${links?'<div class="links">'+links+'</div>':''}</details>`;
}
function currentSearchText(item){
 // History is available for reading but must not cause false matches in city/status filters.
 const keys=['name','en','opened','closes','window','city','jobs','req','note','action','why','risk','resume','evidence','ownership'];
 return keys.map(k=>item[k]||'').join(' ').toLowerCase();
}
function textMatch(item,q){return q.trim().toLowerCase().split(/\s+/).filter(Boolean).every(t=>currentSearchText(item).includes(t));}
function itemLinks(item){
 const links=[...(item.links||[])];
 for(const id of item.audit?.refs||[]){const s=SOURCES[id];if(s?.url&&!links.some(x=>x[1]===s.url))links.push([id+' · '+s.title,s.url]);}
 return links.map(([t,h])=>`<a href="${escapeHTML(h)}" target="_blank" rel="noopener noreferrer">${escapeHTML(t)}</a>`).join('');
}
function renderSources(){
 const ids=PAGE_KIND==='rec'?Object.keys(SOURCES).filter(x=>x.startsWith('R')||x==='H01'):Object.keys(SOURCES).filter(x=>x.startsWith('S')||x==='H02');
 document.getElementById('source-list').innerHTML=ids.map(id=>{const s=SOURCES[id];return `<article class="source-entry" id="src-${id}"><b>${id} · ${escapeHTML(s.title)}</b><span>${escapeHTML(s.level)} · ${escapeHTML(s.access)} · 复核 ${s.checked}</span><p>${escapeHTML(s.scope)}</p>${s.url?`<a href="${escapeHTML(s.url)}" target="_blank" rel="noopener noreferrer">打开原来源 ↗</a>`:'<span>原内容见各卡片的“原始记录”；原文件亦随更新包附上。</span>'}</article>`}).join('');
 const count=ALL_ITEMS.filter(x=>x.audit?.checked===RECHECKED).length;
 document.getElementById('audit-count').textContent=`共 ${ALL_ITEMS.length} 条记录；${count} 条取得本轮网页/索引证据，其余保留原信息或仅校正口径。`;
}
function revealHash(){
 const id=decodeURIComponent(location.hash.slice(1));if(!id)return;
 const target=document.getElementById(id);if(!target)return;
 for(let n=target.parentElement;n;n=n.parentElement)if(n.tagName==='DETAILS')n.open=true;
 requestAnimationFrame(()=>target.scrollIntoView({block:'start',behavior:'auto'}));
}
function saveJSON(){
 const blob=new Blob([JSON.stringify({checked:RECHECKED,timezone:TZ,kind:PAGE_KIND,items:ALL_ITEMS,originalItems:ORIGINAL_ITEMS,sources:SOURCES,timeline:PAGE_KIND==='rec'?buildRail():null},null,2)],{type:'application/json;charset=utf-8'});
 const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=PAGE_KIND+'_data_'+RECHECKED+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function setupCommon(){
 renderSources();addEventListener('hashchange',revealHash);revealHash();
 document.getElementById('export-btn').addEventListener('click',saveJSON);
 document.getElementById('q').setAttribute('aria-label','搜索公司、城市、岗位与关键词');
 document.querySelectorAll('.filters .chip').forEach(b=>b.setAttribute('aria-pressed',b.classList.contains('active')?'true':'false'));
 document.getElementById('clock-date').textContent=chinaDay();
}
    const STATUS={open:['当前可行动','b-open'],soon:['已公告·待开放','b-soon'],verify:['当前需二次核验','b-verify'],watch:['高匹配观察池','b-watch'],past:['本窗口已过','b-past']};
    const TRACK={rec:'内容推荐',ai:'AI / 云',finance:'金融科技',geo:'地球物理 AI',industrial:'工业 / 研究院'};
    let filter='all',sortBy='priority';
    function daysTo(iso){return dayDistance(iso);}
    function deadlineFor(item){
      if(!item.due)return null;
      const fresh=item.audit?.checked===RECHECKED;
      return {date:item.due,time:item.dueTime||null,kind:'deadline',confidence:fresh?'supported':'pending',scope:item.dueScope||'原版日期（待复核）',refs:item.audit?.refs||['H02'],note:fresh?'按明确批次计时；个人资格仍须核对':'原历史日期；不冒充本轮硬截止'};
    }
    function currentActionable(item){const m=timeState(deadlineFor(item));return item.status==='open'&&item.audit?.checked===RECHECKED&&!m.expired;}
    function urgency(item){
      const ev=deadlineFor(item);
      if(ev){const m=timeState(ev);return {...m,cls:m.expired?'past':ev.confidence==='pending'?'watch':m.days<=21?'hot':'',text:ev.date+(ev.time?' '+ev.time:''),scope:ev.scope};}
      if(item.start&&daysTo(item.start)>=0)return {cls:'soon',label:daysTo(item.start)===0?'今天开放':`${daysTo(item.start)}天后开放`,text:item.start,scope:'开放节点'};
      if(item.status==='watch')return {cls:'watch',label:'本轮未核到新入口',text:'观察 / 待更新'};
      if(item.status==='past')return {cls:'past',label:'原窗口已过',text:'等待补录 / 新批次'};
      if(item.status==='verify'||item.audit?.checked!==RECHECKED)return {cls:'watch',label:'先复核具体职位',text:'滚动 / 待核'};
      return {cls:'',label:'本届已公告·先核资格',text:'未见统一截止'};
    }
    function rank(item){
      const e=deadlineFor(item),m=timeState(e);if(m.days!==null&&!m.expired)return m.days+(e.confidence==='pending'?80:0);
      if(currentActionable(item))return 40;if(item.status==='verify')return 90;if(item.status==='watch')return 200-item.fit/10;return 260;
    }
    function card(item){
      const u=urgency(item),fresh=item.audit?.checked===RECHECKED,st=STATUS[item.status];
      const label=!fresh&&item.status==='open'?'原版已开·本轮待核':st[0];
      const alt=item.dueAlt?` · ${escapeHTML(item.dueAlt)}`:'';
      return `<article class="card st-${item.status}${personal.muted(item)?' is-muted':''}" data-name="${escapeHTML(item.name)}" data-entry-id="${item.id}">
        ${personal.controls(item)}
        <div class="card-head"><div><div class="rankline"><span class="tier t-${item.tier}">${item.tier} 级</span><span class="badge ${st[1]}">${label}</span><span class="badge b-track">${TRACK[item.track]}</span></div><h3 class="name">${escapeHTML(item.name)}</h3><div class="en">${escapeHTML(item.en)}</div></div><div class="score">${item.fit}<small>MATCH / 100</small></div></div>
        <div class="fitbar"><i style="width:${item.fit}%"></i></div>
        <div class="action-strip ${u.cls}"><span class="k">DATE</span><strong>${escapeHTML(u.text)}${alt}</strong><span class="pill">${escapeHTML(u.label)}</span></div>
        ${u.scope?`<p class="node-scope">${escapeHTML(u.scope)} ${sourceRefs(item.audit?.refs||['H02'])}</p>`:''}
        <div class="facts"><span class="fact">${escapeHTML(item.ownership)}</span><span class="fact">${escapeHTML(item.city)}</span>${item.xian?'<span class="fact">含西安/西北</span>':''}</div>
        ${auditHTML(item)}
        <p class="field"><b>现在动作</b>${escapeHTML(item.action)}</p><p class="field"><b>优先岗位</b>${escapeHTML(item.jobs)}</p><p class="field"><b>为什么适合你</b>${escapeHTML(item.why)}</p><p class="field risk"><b>风险 / 缺口</b>${escapeHTML(item.risk)}</p>
        <details class="more"><summary>展开：简历版本与证据</summary><p class="field"><b>简历版本</b>${escapeHTML(item.resume)}</p><p class="field"><b>证据状态</b>${escapeHTML(item.evidence)}</p></details>
        <div class="links">${itemLinks(item)}</div><p class="note">${escapeHTML(item.note)}</p>${historyHTML(item)}</article>`;
    }
    function isUrgent(item){
      const m=timeState(deadlineFor(item));const d=item.start?dayDistance(item.start):null;
      return (d!==null&&d>=0&&d<=21)||(m.days!==null&&!m.expired&&m.days<=21&&['confirmed','supported'].includes(m.event.confidence));
    }
    function match(item,q){
      let ok=true;
      if(filter==='now')ok=currentActionable(item);
      else if(filter==='urgent')ok=isUrgent(item);
      else if(filter==='s')ok=item.tier==='S';
      else if(['rec','ai','finance','geo','industrial'].includes(filter))ok=item.track===filter;
      else if(filter==='xian')ok=!!item.xian;
      else if(filter==='watch')ok=['verify','watch','past'].includes(item.status)||item.audit?.checked!==RECHECKED;
      else if(filter==='rev')ok=item.rev===RECHECKED;
      return ok&&textMatch(item,q);
    }
    function sorted(list){return [...list].sort((a,b)=>personal.compare(a,b)||(sortBy==='fit'?b.fit-a.fit:sortBy==='due'?rank(a)-rank(b):(a.priority-b.priority)||rank(a)-rank(b)||b.fit-a.fit));}
    function render(){
    const q=document.getElementById('q').value.trim(),list=sorted(DATA.filter(x=>match(x,q)&&personal.matches(x)));
    const active=list.filter(x=>!personal.muted(x)),processed=list.filter(x=>personal.muted(x)),grid=document.getElementById('grid');
    grid.innerHTML=active.map(card).join('');grid.style.display=active.length?'':'none';
    if(!list.length){grid.style.display='';grid.innerHTML='<p class="empty">没有匹配项。请调整关键词、招聘筛选或“我的状态”。</p>';}
    personal.renderProcessed(processed,card);
    document.getElementById('count').textContent='显示 '+list.length+' / '+DATA.length;
    document.querySelectorAll('.filters .chip').forEach(b=>b.setAttribute('aria-pressed',b.dataset.filter===filter?'true':'false'));
   }
    function renderActions(){
      const urgent=sorted(DATA.filter(x=>isUrgent(x)&&!personal.muted(x))),other=sorted(DATA.filter(x=>currentActionable(x)&&!isUrgent(x)&&!personal.muted(x))),items=urgent.concat(other).slice(0,8);
      document.getElementById('action-grid').innerHTML=items.map(x=>{const u=urgency(x);return `<div class="action ${u.cls==='hot'?'urgent':''}"><span class="date">${escapeHTML(u.text)}</span><b>${escapeHTML(x.name)}</b><p>${escapeHTML(x.action)}</p>${sourceRefs(x.audit?.refs||[])}</div>`}).join('')||'<p class="sub">当前没有已核实的近期时间节点；卡片与观察池全部保留，请按具体职位复核。</p>';
      document.getElementById('n-urgent').textContent=urgent.length;
    }
    function renderStats(){
      document.getElementById('n-now').textContent=DATA.filter(currentActionable).length;
      document.getElementById('n-s').textContent=DATA.filter(x=>x.tier==='S').length;
      document.getElementById('n-rg').textContent=DATA.filter(x=>['rec','geo'].includes(x.track)).length;
      document.getElementById('n-xian').textContent=DATA.filter(x=>x.xian).length;
      document.getElementById('n-watch').textContent=DATA.filter(x=>['verify','watch','past'].includes(x.status)||x.audit?.checked!==RECHECKED).length;
    }
    document.querySelectorAll('.filters .chip').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.filters .chip').forEach(x=>x.classList.remove('active'));btn.classList.add('active');filter=btn.dataset.filter;render()}));
    document.getElementById('q').addEventListener('input',render);document.getElementById('sort').addEventListener('change',e=>{sortBy=e.target.value;render()});
    document.addEventListener('keydown',e=>{if(e.key==='/'&&!/input|textarea|select/i.test(document.activeElement.tagName)&&!document.activeElement.isContentEditable){e.preventDefault();document.getElementById('q').focus()}});
    document.getElementById('print-btn').addEventListener('click',()=>window.print());
    const themeBtn=document.getElementById('theme-btn');function setTheme(t){document.documentElement.setAttribute('data-theme',t);themeBtn.textContent=t==='dark'?'浅色模式':'深色模式';try{localStorage.setItem('soe-personal-theme',t)}catch(e){}}
    let theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';try{theme=localStorage.getItem('soe-personal-theme')||theme}catch(e){}setTheme(theme);themeBtn.addEventListener('click',()=>setTheme(document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark'));
    const topBtn=document.getElementById('top-btn');topBtn.addEventListener('click',()=>scrollTo({top:0,behavior:'smooth'}));addEventListener('scroll',()=>topBtn.classList.toggle('show',scrollY>700),{passive:true});
    renderStats();renderActions();render();setupCommon();
    let tickKey=chinaDay()+':'+DATA.map(x=>timeState(deadlineFor(x)).expired?'1':'0').join('');
    setInterval(()=>{const key=chinaDay()+':'+DATA.map(x=>timeState(deadlineFor(x)).expired?'1':'0').join('');if(key!==tickKey){tickKey=key;renderStats();renderActions();render();document.getElementById('clock-date').textContent=chinaDay()}},60000);
    window.__QA={kind:PAGE_KIND,items:DATA,original:ORIGINAL_ITEMS,deadlineFor,timeState,chinaDay,dayDistance,deadlineEpoch,currentActionable,isUrgent,render};

await personal.start(()=>{render();renderActions();});
document.getElementById('app-loading')?.remove();
window.__APP={snapshot:personal.snapshot};
