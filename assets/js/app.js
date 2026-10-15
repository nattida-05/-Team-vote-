(function(){
  const C = window.VOTE_CONFIG;
  const API = window.VoteBackend;
  const $ = id => document.getElementById(id);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let teams = C.defaultTeams.map((n,i)=>({id:'r'+(i+1),name:n}));
  let settings = {open:true, title:C.defaultTitle};
  let rawVotes = [], counts = {}, total = 0, myVote = null;
  let uid = null, canVote = true, isAdmin = false;
  let view = 'vote', query = '', current = null, busy = false;
  let accessMsg = '';

  const teamNo = t => teams.indexOf(t)+1;
  const findTeam = id => teams.find(t=>t.id===id);

  function tally(){
    const valid = new Set(teams.map(t=>t.id));
    counts={}; total=0; myVote=null;
    rawVotes.forEach(v=>{
      if(!valid.has(v.team)) return;
      counts[v.team]=(counts[v.team]||0)+1; total++;
      if(v.id===uid) myVote=v.team;
    });
  }
  function ranked(){
    return teams.slice().sort((a,b)=>(counts[b.id]||0)-(counts[a.id]||0) || teamNo(a)-teamNo(b));
  }

  /* ---------- helpers ---------- */
  // นับเลขขึ้น/ลงแบบนุ่ม ๆ
  function setNum(el, to){
    to = +to || 0;
    const from = parseInt(el.textContent,10) || 0;
    cancelAnimationFrame(el._raf);
    if(from===to || reduceMotion.matches){ el.textContent = to; return; }
    const t0 = performance.now(), dur = 650;
    const step = now=>{
      const p = Math.min(1,(now-t0)/dur), e = 1-Math.pow(1-p,3);
      el.textContent = Math.round(from+(to-from)*e);
      if(p<1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }

  // หัวข้อใหญ่: ไฮไลต์คำว่า "ทีมที่ชอบ" ด้วยปากกาสีมิ้นต์
  function fillTitle(el, lead){
    const title = settings.title || C.defaultTitle;
    const key = 'ทีมที่ชอบ', i = title.indexOf(key);
    const mark = document.createElement('mark');
    el.textContent = '';
    if(lead){
      const s = document.createElement('span'); s.className = 'accent'; s.textContent = lead;
      el.append(s, ' ');
    }
    if(i>=0){ mark.textContent = key; el.append(title.slice(0,i), mark, title.slice(i+key.length)); }
    else { mark.textContent = title; el.append(mark); }
  }

  /* ---------- views ---------- */
  function setView(v){
    if(v==='admin' && !isAdmin) v='vote';
    view=v;
    document.querySelectorAll('.nav button').forEach(b=>b.setAttribute('aria-current', b.dataset.view===v?'page':'false'));
    $('v-vote').hidden = v!=='vote';
    $('v-results').hidden = v!=='results';
    $('v-admin').hidden = v!=='admin';
    render();
    window.scrollTo(0,0);
  }
  document.querySelectorAll('.nav button').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));

  function renderNotice(){
    const n = $('notice');
    const text = !settings.open ? 'ปิดโหวตแล้ว ดูผลได้ที่แท็บผลโหวต' : accessMsg;
    $('noticeText').textContent = text;
    n.classList.toggle('closed', !settings.open);
    n.hidden = !text;
  }

  function render(){
    $('brand').textContent = settings.title || C.defaultTitle;
    fillTitle($('voteTitle'));
    setNum($('total1'), total);
    renderNotice();
    if(view==='vote') renderVote();
    if(view==='results') renderResults();
    if(view==='admin') renderAdmin();
    const mine = myVote && findTeam(myVote);
    $('dock').hidden = !(mine && view==='vote');
    if(mine) $('dockTeam').textContent = '#'+teamNo(mine)+' '+mine.name;
  }

  function renderVote(){
    const q = query.trim().toLowerCase();
    const list = teams.filter(t=>!q || t.name.toLowerCase().includes(q) || String(teamNo(t))===q);
    const box = $('grid'); box.textContent='';
    if(!list.length){ box.innerHTML='<p class="empty">ไม่พบทีมที่ค้นหา</p>'; return; }
    const g=document.createElement('div'); g.className='grid';
    list.forEach(t=>{
      const b=document.createElement('button');
      b.className='team'+(t.id===myVote?' mine':'');
      b.innerHTML='<span class="num"></span><span class="tname"></span><span class="cnt"></span>';
      b.querySelector('.num').textContent='#'+teamNo(t);
      b.querySelector('.tname').textContent=t.name;
      b.querySelector('.cnt').textContent=(counts[t.id]||0)+' เสียง';
      b.addEventListener('click',()=>openPopup(t));
      g.appendChild(b);
    });
    box.appendChild(g);
  }

  /* ---------- results ---------- */
  const SPARKLE = '<svg class="pod-sparkle" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C13 8 16 11 24 12C16 13 13 16 12 24C11 16 8 13 0 12C8 11 11 8 12 0Z"/></svg>';
  // ลำดับบนจอ: ที่ 2, ที่ 1, ที่ 3
  const podSlots = [1,0,2].map(i=>{
    const el=document.createElement('div');
    el.className='pod p'+(i+1);
    el.innerHTML=(i===0?SPARKLE:'')+'<span class="medal"></span><div class="pname"></div><div class="pv"><b class="n">0</b> <small>เสียง</small></div>';
    el.querySelector('.medal').textContent=i+1;
    $('podium').appendChild(el);
    return {i,el};
  });
  function renderPodium(r){
    podSlots.forEach(({i,el})=>{
      const t=r[i], c=t?(counts[t.id]||0):0;
      el.classList.toggle('none', !t||c===0);
      el.querySelector('.pname').textContent = t&&c>0 ? t.name : 'รอเสียงโหวต';
      setNum(el.querySelector('.n'), c);
    });
  }

  // แถวอันดับใช้ element เดิมตาม id ทีม เพื่อให้แถบและการสลับอันดับเลื่อนได้นุ่ม (FLIP)
  const rowEls = new Map();
  function renderRanks(r){
    const box=$('ranks');
    const before=new Map();
    if(!reduceMotion.matches) rowEls.forEach((el,id)=>before.set(id, el.getBoundingClientRect().top));
    const ids=new Set(r.map(t=>t.id));
    rowEls.forEach((el,id)=>{ if(!ids.has(id)){ el.remove(); rowEls.delete(id); } });
    const max=Math.max(1,...r.map(t=>counts[t.id]||0));
    r.forEach((t,i)=>{
      const c=counts[t.id]||0;
      let row=rowEls.get(t.id);
      if(!row){
        row=document.createElement('div');
        row.innerHTML='<span class="pos"></span><div class="rmain"><div class="rname"></div><div class="meter"><i></i></div></div><div class="v"><b class="n">0</b><small></small></div>';
        rowEls.set(t.id,row);
      }
      row.className='rank'+(i<3&&c>0?' top'+(i+1):'');
      row.querySelector('.pos').textContent=i+1;
      row.querySelector('.rname').textContent='#'+teamNo(t)+' '+t.name;
      row.querySelector('.meter i').style.width=(c/max*100)+'%';
      setNum(row.querySelector('.n'), c);
      row.querySelector('.v small').textContent=(total?Math.round(c/total*100):0)+'%';
      if(box.children[i]!==row) box.insertBefore(row, box.children[i]||null);
    });
    before.forEach((top,id)=>{
      const el=rowEls.get(id); if(!el) return;
      const dy=top-el.getBoundingClientRect().top;
      if(Math.abs(dy)>1) el.animate([{transform:'translateY('+dy+'px)'},{transform:'translateY(0)'}],{duration:520,easing:'cubic-bezier(.2,.8,.2,1)'});
    });
  }

  function renderResults(){
    fillTitle($('resTitle'),'ผลโหวต');
    setNum($('total2'), total);
    const r=ranked();
    renderPodium(r);
    renderRanks(r);
    drawQR('qrSide');
  }

  /* ---------- admin ---------- */
  let namesDirty=false, titleDirty=false;
  function renderAdmin(){
    const open = settings.open;
    $('statusText').textContent = open ? 'เปิดรับโหวตอยู่' : 'ปิดโหวตแล้ว';
    $('statusText').className = 'status '+(open?'on':'off');
    $('toggleOpen').textContent = open ? 'ปิดโหวต' : 'เปิดโหวตอีกครั้ง';
    if(!titleDirty) $('titleInput').value = settings.title||'';
    if(!namesDirty) $('names').value = teams.map(t=>t.name).join('\n');
    checkNames();
    $('linkText').textContent = C.voteUrl;
    drawQR('qrAdmin');
  }

  const drawn = {};
  function drawQR(id){
    if(drawn[id]) return;
    $(id).innerHTML = window.VOTE_QR_SVG;
    drawn[id]=true;
  }

  /* ---------- popup ---------- */
  function openPopup(t){
    current=t;
    const card=document.querySelector('.card'); card.classList.remove('done');
    $('mBadge').textContent=teamNo(t);
    $('mName').textContent=t.name;
    const c=counts[t.id]||0;
    $('mVote').disabled=false;
    if(!settings.open){
      $('mMeta').textContent='ปิดโหวตแล้ว · '+c+' เสียง'; $('mVote').hidden=true;
    }else if(t.id===myVote){
      $('mMeta').textContent='คุณโหวตทีมนี้อยู่แล้ว · '+c+' เสียง'; $('mVote').hidden=true;
    }else{
      $('mMeta').textContent= myVote ? 'ตอนนี้มี '+c+' เสียง แตะเพื่อย้ายเสียงของคุณมาทีมนี้' : 'ตอนนี้มี '+c+' เสียง';
      $('mVote').hidden=!canVote;
      $('mVote').textContent= myVote ? 'ย้ายเสียงมาทีมนี้' : 'โหวตทีมนี้';
    }
    $('mClose').textContent='ปิด';
    $('overlay').classList.add('open'); $('overlay').setAttribute('aria-hidden','false');
    setTimeout(()=>($('mVote').hidden?$('mClose'):$('mVote')).focus(),50);
  }
  function closePopup(){ $('overlay').classList.remove('open'); $('overlay').setAttribute('aria-hidden','true'); current=null; }
  $('mClose').addEventListener('click',closePopup);
  $('overlay').addEventListener('click',e=>{ if(e.target.id==='overlay') closePopup(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') closePopup(); });

  function celebrate(){
    const burst=$('burst'); burst.textContent='';
    const colors=['#8ad0bb','#e66684','#7e412a','#3e9c82'];
    for(let i=0;i<22;i++){
      const s=document.createElement('i');
      const a=Math.random()*Math.PI*2, d=80+Math.random()*90;
      s.style.setProperty('--x',Math.cos(a)*d+'px'); s.style.setProperty('--y',Math.sin(a)*d+'px');
      s.style.setProperty('--r',(Math.random()*540)+'deg'); s.style.background=colors[i%colors.length];
      burst.appendChild(s);
    }
    document.querySelector('.card').classList.add('done');
    const b=$('mBadge'); b.textContent='✓'; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
  }

  $('mVote').addEventListener('click',async()=>{
    if(!current||busy||!settings.open) return;
    const t=current; busy=true; $('mVote').disabled=true;
    try{
      await API.castVote(t.id);
      celebrate();
      $('mName').textContent='โหวตแล้ว!';
      $('mMeta').textContent='เสียงของคุณไปที่ #'+teamNo(t)+' '+t.name;
      $('mVote').hidden=true; $('mClose').textContent='เสร็จแล้ว'; $('mClose').focus();
    }catch(err){
      if(err&&err.code==='invalid_argument'){
        canVote=false; accessMsg='บัญชีนี้ดูผลได้อย่างเดียว ยังโหวตไม่ได้'; renderNotice();
        $('mMeta').textContent='บัญชีนี้ยังโหวตไม่ได้'; $('mVote').hidden=true;
      }else{ $('mMeta').textContent='บันทึกเสียงไม่สำเร็จ ลองแตะโหวตอีกครั้ง'; $('mVote').disabled=false; }
    }finally{ busy=false; }
  });

  $('q').addEventListener('input',e=>{ query=e.target.value; renderVote(); });

  /* ---------- admin actions ---------- */
  function parseNames(){ return $('names').value.split('\n').map(s=>s.trim()).filter(Boolean); }
  function checkNames(){
    const n=parseNames(); $('teamCount').textContent='('+n.length+' ทีม)';
    const seen={}, d=[];
    n.forEach((x,i)=>{ (seen[x]=seen[x]||[]).push(i+1); });
    Object.keys(seen).forEach(k=>{ if(seen[k].length>1) d.push(k+' (ทีม '+seen[k].join(', ')+')'); });
    $('dupes').textContent = d.length ? 'ชื่อซ้ำ: '+d.join(' · ')+' ถ้าเป็นทีมเดียวกันควรลบให้เหลืออันเดียว' : '';
  }
  $('names').addEventListener('input',()=>{ namesDirty=true; checkNames(); $('namesMsg').textContent='ยังไม่ได้บันทึก'; });
  $('titleInput').addEventListener('input',()=>{ titleDirty=true; });

  async function saveSettings(patch,msg){
    const next=Object.assign({},settings,patch);
    try{ await API.saveSettings(next); $('settingsMsg').textContent=msg; }
    catch(e){ $('settingsMsg').textContent='บันทึกไม่สำเร็จ ลองอีกครั้ง'; }
  }
  $('toggleOpen').addEventListener('click',()=>saveSettings({open:!settings.open}, settings.open?'ปิดโหวตแล้ว':'เปิดโหวตแล้ว'));
  $('saveTitle').addEventListener('click',async()=>{
    const v=$('titleInput').value.trim()||C.defaultTitle;
    await saveSettings({title:v},'บันทึกชื่องานแล้ว'); titleDirty=false;
  });
  $('saveNames').addEventListener('click',async()=>{
    const lines=parseNames();
    if(!lines.length){ $('namesMsg').textContent='ใส่ชื่อทีมอย่างน้อย 1 ทีม'; return; }
    const used=new Set();
    const next=lines.map((name,i)=>{
      const old=teams.find(t=>t.name===name && !used.has(t.id));
      if(old){ used.add(old.id); return {id:old.id,name}; }
      return {id:'n'+Date.now().toString(36)+i,name};
    });
    $('saveNames').disabled=true;
    try{ await API.saveTeams(next); namesDirty=false; $('namesMsg').textContent='บันทึกแล้ว '+next.length+' ทีม'; }
    catch(e){ $('namesMsg').textContent='บันทึกไม่สำเร็จ ลองอีกครั้ง'; }
    finally{ $('saveNames').disabled=false; }
  });
  $('resetVotes').addEventListener('click',async()=>{
    if(!confirm('ล้างผลโหวตทั้งหมด? ย้อนกลับไม่ได้')) return;
    $('settingsMsg').textContent='กำลังล้าง...';
    try{ await API.resetVotes(); $('settingsMsg').textContent='ล้างผลโหวตแล้ว'; }
    catch(e){ $('settingsMsg').textContent='ล้างไม่สำเร็จ ลองอีกครั้ง'; }
  });
  $('copyLink').addEventListener('click',async()=>{
    try{ await navigator.clipboard.writeText(C.voteUrl); $('copyLink').textContent='คัดลอกแล้ว'; }
    catch(e){ $('copyLink').textContent='คัดลอกไม่ได้ ใช้ลิงก์ด้านบน'; }
    setTimeout(()=>$('copyLink').textContent='คัดลอกลิงก์',2000);
  });

  /* ---------- connect (real-time updates) ---------- */
  render();
  API.connect({
    onTeams(list){ if(list&&list.length) teams=list; tally(); render(); },
    onSettings(s){ if(s) settings=s; render(); if(current) openPopup(current); },
    onVotes(v){ rawVotes=v; tally(); render(); },
    onError(msg){ accessMsg=msg; renderNotice(); }
  }).then(info=>{
    uid=info.uid; canVote=info.canVote; isAdmin=info.isAdmin; accessMsg=info.message||'';
    $('navAdmin').hidden=!isAdmin;
    tally(); render();
  }).catch(()=>{ accessMsg='เชื่อมต่อไม่สำเร็จ รีเฟรชหน้าเพื่อลองใหม่'; renderNotice(); });
})();
