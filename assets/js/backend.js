/* ============================================================
 * Backend adapter
 *
 * หน้าเว็บคุยกับ backend ผ่าน window.VoteBackend เท่านั้น:
 *
 *   connect(handlers) -> Promise<info>
 *     handlers.onTeams(teams | null)      teams = [{id, name}]  (null = ใช้รายชื่อเดิม)
 *     handlers.onSettings(settings|null)  settings = {open: bool, title: string}
 *     handlers.onVotes(votes)             votes = [{id: voterId, team: teamId}]
 *     handlers.onError(message)
 *     info = {mode: 'live'|'demo', uid, canVote, isAdmin, message}
 *
 *   castVote(teamId)      บันทึก/ย้ายเสียงของผู้ใช้คนนี้
 *   saveSettings(obj)     {open, title}
 *   saveTeams(teams)      [{id, name}]
 *   resetVotes()          ลบเสียงทั้งหมด
 *
 * จะต่อ backend ของคุณเอง: ให้ createCustomBackend() คืน adapter
 * ที่มีเมธอดตามด้านบน (ดูตัวอย่างในคอมเมนต์) แล้วระบบจะใช้ตัวนั้นก่อน
 * ============================================================ */
(function(){
  const C = window.VOTE_CONFIG;

  /* ---------- 1) ใส่ backend ของคุณตรงนี้ ---------- */
  function createCustomBackend(){
    return null;
    /* ตัวอย่าง:
    let h;
    return {
      async connect(handlers){
        h = handlers;
        const ws = new WebSocket('wss://example.com/votes');
        ws.onmessage = e => {
          const msg = JSON.parse(e.data);
          if(msg.type === 'votes') h.onVotes(msg.votes);
          if(msg.type === 'teams') h.onTeams(msg.teams);
          if(msg.type === 'settings') h.onSettings(msg.settings);
        };
        const me = await fetch('/api/me').then(r => r.json());
        return {mode:'live', uid:me.id, canVote:true, isAdmin:me.admin, message:''};
      },
      castVote: team => fetch('/api/vote', {method:'POST', body:JSON.stringify({team})}),
      saveSettings: s => fetch('/api/settings', {method:'PUT', body:JSON.stringify(s)}),
      saveTeams: t => fetch('/api/teams', {method:'PUT', body:JSON.stringify(t)}),
      resetVotes: () => fetch('/api/votes', {method:'DELETE'})
    };
    */
  }

  /* ---------- 2) Claude artifact database ---------- */
  function createClaudeBackend(){
    let db = null, uid = null;
    return {
      async connect(h){
        const [d,u] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
        if(!d) return null;
        db = d;
        uid = u ? await u.id() : null;
        const isAdmin = u ? await u.canEdit() : false;
        const w = u ? await u.can('data.write') : null;
        const canVote = !!uid && w !== false;

        db.doc('config/teams').onSnapshot(s=>{
          const data = s.exists ? s.data() : null;
          if(data && Array.isArray(data.teams) && data.teams.length){
            h.onTeams(data.teams.filter(t=>t&&typeof t.id==='string'&&typeof t.name==='string').map(t=>({id:t.id,name:t.name})));
          }else h.onTeams(null);
        },()=>{});
        db.doc('config/settings').onSnapshot(s=>{
          const data = s.exists ? s.data() : null;
          h.onSettings(data ? {open:data.open!==false, title:typeof data.title==='string'?data.title:C.defaultTitle} : null);
        },()=>{});
        db.collection('votes').onSnapshot(s=>{
          const votes = [];
          s.docs.forEach(d=>{ const t = d.data() && d.data().team; if(typeof t==='string') votes.push({id:d.id, team:t}); });
          h.onVotes(votes);
        },()=>h.onError('การเชื่อมต่อผลโหวตหลุด รีเฟรชหน้าเพื่อเชื่อมใหม่'));

        return {mode:'live', uid, canVote, isAdmin, message: canVote ? '' : 'บัญชีนี้ดูผลได้อย่างเดียว ยังโหวตไม่ได้'};
      },
      castVote: team => db.doc('votes/'+uid).set({team, at:Date.now()}),
      saveSettings: s => db.doc('config/settings').set(s),
      saveTeams: teams => db.doc('config/teams').set({teams}),
      async resetVotes(){
        const snap = await db.collection('votes').get();
        for(const d of snap.docs){ await db.doc('votes/'+d.id).delete(); }
      }
    };
  }

  /* ---------- 3) โหมดทดลอง (เก็บในหน่วยความจำ ไม่บันทึกจริง) ---------- */
  function createDemoBackend(h){
    let votes = [];
    const nope = () => Promise.reject(new Error('demo mode'));
    return {
      castVote(team){
        votes = votes.filter(v=>v.id!=='local').concat({id:'local', team});
        h.onVotes(votes.slice());
        return Promise.resolve();
      },
      saveSettings: nope, saveTeams: nope, resetVotes: nope
    };
  }
  const demoInfo = message => ({mode:'demo', uid:'local', canVote:true, isAdmin:false, message});

  let active = null;
  window.VoteBackend = {
    async connect(h){
      const custom = createCustomBackend();
      if(custom){ active = custom; return custom.connect(h); }
      if(window.claude && typeof window.claude.use==='function'){
        const b = createClaudeBackend();
        const info = await b.connect(h);
        if(info){ active = b; return info; }
        active = createDemoBackend(h);
        return demoInfo('ลงชื่อเข้าใช้ Claude เพื่อโหวต (ตอนนี้เป็นโหมดทดลอง ไม่บันทึกเสียง)');
      }
      active = createDemoBackend(h);
      return demoInfo('โหมดทดลอง: เสียงโหวตไม่ถูกบันทึก');
    },
    castVote: team => active.castVote(team),
    saveSettings: s => active.saveSettings(s),
    saveTeams: t => active.saveTeams(t),
    resetVotes: () => active.resetVotes()
  };
})();
