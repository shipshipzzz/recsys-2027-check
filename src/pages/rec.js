import fallback from '../../data/rec.json';
import {loadCatalog} from '../backend.js';
import {createPersonalManager} from '../personal.js';

const catalog=await loadCatalog('rec',fallback);
const {DATA,EXTRA,KIND,LOG,DUE,TIMELINE,PAGE_KIND,ORIGINAL_ITEMS,SOURCES,REC_DEADLINES}=catalog;
const ALL_ITEMS=catalog.ALL_ITEMS;
const personal=createPersonalManager('rec',catalog);

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
    const grid = document.getElementById('grid'),extraGrid=document.getElementById('extra'),extraWrap=document.getElementById('extra-wrap'),countEl=document.getElementById('count');
    const chips=[...document.querySelectorAll('.filters .chip')];
    let filter='all',sortBy='due',railFilter='all';
    function deadlineFor(item){
      if(Object.prototype.hasOwnProperty.call(REC_DEADLINES,item.name))return REC_DEADLINES[item.name];
      const date=DUE[item.name];
      return date?{date,time:null,kind:'advisory',scope:'原版日期（待复核）',confidence:'pending',refs:['H01'],note:'保留原节点，但不当本轮已核实的公司统一截止'}:null;
    }
    function dueMeta(item){return timeState(deadlineFor(item));}
    function rank(item){const m=dueMeta(item);if(m.days===null)return 1e6;if(m.expired)return 5e5-m.days;return m.days+(m.event.kind==='special'?100000:0);}
    function sortList(list){return [...list].sort((a,b)=>personal.compare(a,b)||(sortBy==='due'?rank(a)-rank(b):0));}
    function badge(item){
      const r={yes:['明确推荐岗','s-open'],likely:['算法里可能有推荐','s-intern'],weak:['推荐含量弱','s-weak']}[item.rec]||['方向待核','s-wait'];
      const st={open:['秋招已开','s-open'],intern:['实习/专项','s-intern'],wait:['未见本届新证据','s-wait'],verify:['当前需复核','s-intern']}[item.status];
      const src={see:['官网亲见·8月','s-see'],mix:['部分亲见·原记录','s-intern'],news:['公开转载','s-wait'],paste:['官网原文·你贴的','s-paste']}[item.src]||['待核','s-wait'];
      const recent=item.audit?.checked===RECHECKED;
      const stage=st[0]+(!recent&&item.status==='open'?'·历史':'');
      return `<span class="badge ${st[1]}">${stage}</span><span class="badge ${r[1]}">${r[0]}</span><span class="badge ${src[1]}">${src[0]}</span>${item.rev===RECHECKED?`<span class="badge s-rev">9/13 ${recent?'复核':'口径'}</span>`:''}`;
    }
    function cardHTML(item,i,hidden){
      const m=dueMeta(item),ev=deadlineFor(item),date=ev?ev.date+(ev.time?' '+ev.time:''):'滚动 / 截止待核';
      return `<article class="card st-${item.status}${personal.muted(item)?' is-muted':''}${hidden?' hidden':''}" data-i="${i}" data-name="${escapeHTML(item.name)}" data-entry-id="${item.id}">
        ${personal.controls(item)}
        <div class="top"><div><h3 class="name">${escapeHTML(item.name)}</h3><div class="en">${escapeHTML(item.en)}</div></div><div class="badges">${badge(item)}</div></div>
        <div class="due ${m.cls}"><span class="due-k">${ev?.confidence==='pending'?'待核节点':'截止 / 节点'}</span><span class="due-v">${date}</span><span class="due-pill">${m.label}</span></div>
        ${ev?`<p class="node-scope">${escapeHTML(ev.scope)} · ${escapeHTML(ev.note||'')} ${sourceRefs(ev.refs)}</p>`:''}
        ${auditHTML(item)}
        <p class="field"><b>何时结束</b>${escapeHTML(item.closes||'未见统一截止')}</p><p class="field"><b>岗位情况</b>${escapeHTML(item.jobs)}</p>
        <details class="more"><summary>展开：放出时间 · 毕业窗 · 城市 · 硬性要求</summary><p class="field"><b>何时放出</b>${escapeHTML(item.opened)}</p><p class="field"><b>毕业时间</b>${escapeHTML(item.window)}</p><p class="field"><b>城市</b>${escapeHTML(item.city)}</p><p class="field"><b>硬性要求</b>${escapeHTML(item.req)}</p></details>
        <div class="links">${itemLinks(item)}</div><p class="note">${escapeHTML(item.note)}</p>${historyHTML(item)}</article>`;
    }
    function matchFilter(item){
      if(filter==='rev')return item.rev===RECHECKED;
      if(filter==='all'||filter==='extra')return true;
      if(filter==='urgent'){const m=dueMeta(item);return m.days!==null&&!m.expired&&m.days<=45&&m.event.kind!=='special';}
      if(filter==='rec')return item.rec==='yes';
      if(filter==='see')return item.src==='see'||item.audit?.level==='官方正文';
      if(filter==='wait')return ['wait','verify'].includes(item.status);
      return item.status===filter;
    }
    function render(){
    const q=document.getElementById('q').value.trim();
    const visible=x=>matchFilter(x)&&textMatch(x,q)&&personal.matches(x);
    const core=filter==='extra'?[]:DATA.filter(visible),extra=EXTRA.filter(visible);
    const activeCore=sortList(core.filter(x=>!personal.muted(x))),activeExtra=sortList(extra.filter(x=>!personal.muted(x)));
    const processed=sortList(core.concat(extra).filter(x=>personal.muted(x)));
    grid.innerHTML=activeCore.map((x,i)=>cardHTML(x,i,false)).join('');
    extraGrid.innerHTML=activeExtra.map((x,i)=>cardHTML(x,'e'+i,false)).join('');
    grid.style.display=activeCore.length?'':'none';extraWrap.style.display=activeExtra.length?'':'none';
    const count=core.length+extra.length;
    if(!count){grid.style.display='';grid.innerHTML='<p class="empty">没有匹配的公司。请调整关键词、招聘筛选或“我的状态”。</p>';}
    personal.renderProcessed(processed,(x,i)=>cardHTML(x,'p'+i,false));
    countEl.textContent='显示 '+count+' / '+ALL_ITEMS.length;
    chips.forEach(b=>b.setAttribute('aria-pressed',b.dataset.filter===filter?'true':'false'));
  }
    function renderLog(){
      document.getElementById('log').innerHTML=LOG.map((day,i)=>`<details class="log-day${i===0?' is-latest':''}"><summary class="log-head"><span class="log-date">${day.date}</span><strong>${escapeHTML(day.title)}</strong><span class="log-n">${day.items.length} 条</span><p class="log-sum">${escapeHTML(day.summary)}</p></summary><ul class="log-items">${day.items.map(([kind,co,text])=>{const k=KIND[kind];return `<li><span class="tag ${k[1]}">${k[0]}</span><span class="log-co">${escapeHTML(co)}</span><span>${escapeHTML(text)}</span></li>`}).join('')}</ul></details>`).join('');
    }
    function buildRail(){
    const rows=(catalog.TIMELINE_EVENTS||[]).map(x=>({...x}));
    rows.push({date:chinaDay(),kind:'today',text:'今天 · 北京时间',refs:[],confidence:'confirmed',note:'只更新时间定位；招聘事实来自已保存的核查资料，不会自动核查招聘网站'});
    return rows.sort((a,b)=>a.date.localeCompare(b.date)||(a.kind==='today'?-1:b.kind==='today'?1:0)||(a.time||'00:00').localeCompare(b.time||'00:00'));
  }
    function renderRail(){
      const rows=buildRail(),today=chinaDay(),shown=rows.filter(x=>x.kind==='today'||railFilter==='all'||(railFilter==='future'?x.date>=today:x.kind==='deadline'));
      document.getElementById('rail').innerHTML=shown.map(x=>{
        const past=x.date<today,cls=[];if(past)cls.push('is-past');if(x.kind==='today')cls.push('now');
        cls.push(x.kind==='deadline'?(x.confidence==='pending'?'k-unverified':'k-close'):x.kind==='exam'?'k-exam':x.kind==='quota'?'k-quota':'k-open');
        const label=(x.date.startsWith('2027')?'27 ':'')+x.date.slice(5).replace('-','/');
        const kindName={deadline:'网申',advisory:'待核',special:'专项',open:'放出',exam:'笔试',quota:'次数',review:'核查',today:'今天'}[x.kind];
        const old=x.originalText&&x.originalText!==x.text?`<details class="rail-original"><summary>原节点完整保留</summary>${escapeHTML(x.originalText)}</details>`:'';
        return `<li ${x.kind==='today'?'id="rail-today-marker" tabindex="-1"':''} class="${cls.join(' ')}" data-date="${x.date}" ${x.originalIndex!==undefined?`data-legacy-index="${x.originalIndex}"`:''}><span class="dot"></span><span class="date">${label}${x.time?'<small>'+x.time+'</small>':''}</span><span class="txt"><span class="rail-kind">${kindName}</span> ${escapeHTML(x.text)} ${sourceRefs(x.refs)}${x.note?`<small class="rail-note">${escapeHTML(x.note)}</small>`:''}${old}</span></li>`;
      }).join('');
      document.getElementById('rail-count').textContent=`${shown.length} / ${rows.length} 个节点 · 原40条全部保留`;
      document.querySelectorAll('[data-rail-filter]').forEach(x=>x.setAttribute('aria-pressed',x.dataset.railFilter===railFilter?'true':'false'));
    }
    function renderStats(){
      document.getElementById('n-due').textContent=ALL_ITEMS.filter(x=>{const m=dueMeta(x);return m.days!==null&&!m.expired&&m.days<=45&&m.event.kind!=='special'}).length;
      document.getElementById('n-open').textContent=DATA.filter(x=>x.status==='open').length;
      document.getElementById('n-rec').textContent=DATA.filter(x=>x.rec==='yes').length;
      document.getElementById('n-see').textContent=DATA.filter(x=>x.src==='see'||x.audit?.level==='官方正文').length;
      document.getElementById('n-wait').textContent=DATA.filter(x=>['wait','verify'].includes(x.status)).length;
    }
    chips.forEach(c=>c.addEventListener('click',()=>{chips.forEach(x=>x.classList.remove('active'));c.classList.add('active');filter=c.dataset.filter;render();}));
    document.getElementById('q').addEventListener('input',render);document.getElementById('sort').addEventListener('change',e=>{sortBy=e.target.value;render()});
    document.querySelectorAll('[data-rail-filter]').forEach(b=>b.addEventListener('click',()=>{railFilter=b.dataset.railFilter;renderRail()}));
    document.getElementById('jump-today').addEventListener('click',()=>{document.getElementById('rail-today-marker').scrollIntoView({behavior:'smooth',block:'center'});document.getElementById('rail-today-marker').focus({preventScroll:true})});
    const themeBtn=document.getElementById('theme-btn');function applyTheme(t){document.documentElement.setAttribute('data-theme',t);themeBtn.textContent=t==='dark'?'浅色模式':'深色模式';try{localStorage.setItem('recsys-theme',t)}catch(e){}}
    let startTheme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';try{startTheme=localStorage.getItem('recsys-theme')||startTheme}catch(e){}applyTheme(startTheme);themeBtn.addEventListener('click',()=>applyTheme(document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark'));
    const topBtn=document.getElementById('top-btn');topBtn.addEventListener('click',()=>scrollTo({top:0,behavior:'smooth'}));addEventListener('scroll',()=>topBtn.classList.toggle('show',scrollY>700),{passive:true});
    document.addEventListener('keydown',e=>{if(e.key==='/'&&!/input|textarea|select/i.test(document.activeElement.tagName)&&!document.activeElement.isContentEditable){e.preventDefault();document.getElementById('q').focus()}});
    renderLog();renderRail();renderStats();render();setupCommon();
    // Re-evaluate boundaries every minute without collapsing an in-progress card expansion.
    let tickKey=chinaDay()+':'+ALL_ITEMS.map(x=>dueMeta(x).expired?'1':'0').join('');
    setInterval(()=>{const key=chinaDay()+':'+ALL_ITEMS.map(x=>dueMeta(x).expired?'1':'0').join('');if(key!==tickKey){tickKey=key;renderRail();renderStats();render();document.getElementById('clock-date').textContent=chinaDay()}},60000);
    window.__QA={kind:PAGE_KIND,items:ALL_ITEMS,original:ORIGINAL_ITEMS,originalTimeline:TIMELINE,buildRail,deadlineFor,timeState,chinaDay,dayDistance,deadlineEpoch,render,renderRail};

await personal.start(()=>{render();});
document.getElementById('app-loading')?.remove();
window.__APP={snapshot:personal.snapshot};
