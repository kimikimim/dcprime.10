// 원장 관리자 — Supabase 서버리스
(async () => {
  const me = window.session.require(['admin', '부원장', '튜터']);
  if (!me) return;
  const sb = window.sb;

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const todayStr = () => fmt(new Date());

  // 헤더 / 로그아웃
  const pageRole = document.body.dataset.role || '원장';
  const badge = document.getElementById('adminBadge');
  if (badge) badge.textContent = pageRole;
  $('adminName').textContent = `${me.sname} ${pageRole}`;
  $('logoutBtn')?.addEventListener('click', () => { window.session.clear(); window.location.href = '/'; });

  // 공통: 학생 목록 캐시
  let studentsCache = [];
  async function fetchStudents() {
    const { data } = await sb.from('students_pub').select('*').order('name');
    studentsCache = data || [];
    return studentsCache;
  }

  // ── 탭 전환 ──
  const tabBtns = document.querySelectorAll('.tab-btn');
  const panels = {
    attendance: $('tabAttendance'), leave: $('tabLeaveMgmt'), study: $('tabStudy'),
    analysis: $('tabAnalysis'), students: $('tabStudents'), accounts: $('tabAccounts'),
  };
  const tabBar = document.querySelector('.tab-bar');
  const menuBackdrop = document.createElement('div');
  menuBackdrop.className = 'menu-backdrop';
  document.body.appendChild(menuBackdrop);
  const closeMenu = () => { tabBar?.classList.remove('open'); menuBackdrop.classList.remove('show'); };
  const openMenu  = () => { tabBar?.classList.add('open'); menuBackdrop.classList.add('show'); };

  tabBtns.forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.tab;
    tabBtns.forEach(x => x.classList.toggle('active', x.dataset.tab === t));
    Object.entries(panels).forEach(([k, p]) => p?.classList.toggle('active', k === t));
    closeMenu();
    if (t === 'attendance') loadAttendance();
    if (t === 'leave')      loadLeaveMgmt();
    if (t === 'study')      loadStudy();
    if (t === 'analysis')   loadConsultStudents();
    if (t === 'students')   loadStudents();
    if (t === 'accounts')   loadAccounts();
  }));

  document.getElementById('hamburgerBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    tabBar?.classList.contains('open') ? closeMenu() : openMenu();
  });
  menuBackdrop.addEventListener('click', closeMenu);
  document.getElementById('hamburgerLogoutBtn')?.addEventListener('click', () => {
    document.getElementById('logoutBtn')?.click();
  });

  // ═══════════════ 출석 관리 ═══════════════
  const startOfWeek = d => { const x = new Date(d); const dy = (x.getDay()+6)%7; x.setDate(x.getDate()-dy); x.setHours(0,0,0,0); return x; };
  let weekStart = startOfWeek(new Date());
  const SYMB = { present:{t:'○',c:'#10b981'}, partial:{t:'△',c:'#f59e0b'}, absent:{t:'✕',c:'#e2574c'}, excused:{t:'Ⓧ',c:'#8b5cf6'} };

  function autoStatus(key, ttSet, glAgg) {
    const first = ttSet.has(key);
    const g = glAgg[key];
    const allGoalsDone = !!(first && g && g.total > 0 && g.done === g.total);
    if (allGoalsDone) return 'present';
    if (first) return 'partial';
    return 'absent';
  }

  async function loadAttendance() {
    await fetchStudents();
    const days = [...Array(7)].map((_, i) => { const d = new Date(weekStart); d.setDate(d.getDate()+i); return d; });
    const from = fmt(days[0]), to = fmt(days[6]);
    $('weekLabel').textContent = `${from} ~ ${to}`;

    const [tt, ov, gl] = await Promise.all([
      sb.from('timetables').select('student_id,date,submitted').gte('date', from).lte('date', to),
      sb.from('attendance_overrides').select('student_id,date,status,reason').gte('date', from).lte('date', to),
      sb.from('goals').select('student_id,date,done').gte('date', from).lte('date', to),
    ]);
    const ttSet = new Set((tt.data||[]).filter(x=>x.submitted).map(x=>x.student_id+'|'+x.date));
    const ovMap = new Map((ov.data||[]).map(x=>[x.student_id+'|'+x.date, x.status]));
    const glAgg = {};
    (gl.data||[]).forEach(g => { const a = glAgg[g.student_id+'|'+g.date] ||= { done:0, total:0 }; a.total++; if (g.done) a.done++; });

    const dn = ['일','월','화','수','목','금','토'];
    const attCampus = $('attCampusFilter')?.value || '';
    const attList = studentsCache.filter(s => !attCampus || s.campus === attCampus);
    $('attendanceHead').innerHTML =
      `<tr><th style="text-align:left">학생</th>${days.map(d=>`<th>${d.getMonth()+1}/${d.getDate()}<br><small style="color:#9098a8">${dn[d.getDay()]}</small></th>`).join('')}</tr>`;
    $('attendanceBody').innerHTML = attList.map(s => `<tr>
      <td style="text-align:left;font-weight:600;white-space:nowrap">${esc(s.name)}<br><small style="color:#9098a8">${esc(s.campus||'')}</small></td>
      ${days.map(d => {
        const date = fmt(d), key = s.id+'|'+date;
        const st = ovMap.has(key) ? ovMap.get(key) : autoStatus(key, ttSet, glAgg);
        const sy = SYMB[st] || SYMB.absent;
        const over = ovMap.has(key) ? ';text-decoration:underline' : '';
        const g = glAgg[key];
        const rate = g && g.total ? Math.round(g.done/g.total*100) : null;
        const rateTxt = rate==null ? '' : `<div style="font-size:10px;font-weight:600;color:#8b92a4;text-decoration:none">${rate}%</div>`;
        return `<td class="att-cell" data-sid="${s.id}" data-date="${date}" style="text-align:center;font-size:18px;font-weight:800;color:${sy.c};cursor:pointer${over}">${sy.t}${rateTxt}</td>`;
      }).join('')}
    </tr>`).join('') || `<tr><td>학생이 없습니다.</td></tr>`;

    document.querySelectorAll('.att-cell').forEach(c => c.addEventListener('click', (e) => {
      e.stopPropagation();
      openStatusMenu(c, c.dataset.sid, c.dataset.date, ovMap.has(c.dataset.sid+'|'+c.dataset.date) ? ovMap.get(c.dataset.sid+'|'+c.dataset.date) : null);
    }));
  }

  // ═══════════════ 지각/결석 관리 ═══════════════
  let leaveMgmtCache = [];
  async function loadLeaveMgmt() {
    await fetchStudents();
    const { data } = await sb.from('leave_requests').select('*')
      .order('date', { ascending: false }).order('created_at', { ascending: false });
    leaveMgmtCache = data || [];
    renderLeaveMgmt();
  }
  function renderLeaveMgmt() {
    const q = ($('lvMgmtSearch')?.value || '').trim();
    const campus = $('lvMgmtCampus')?.value || '';
    const studentMap = new Map(studentsCache.map(s => [s.id, s]));
    const rows = leaveMgmtCache.filter(r => {
      const st = studentMap.get(r.student_id);
      if (campus && (!st || st.campus !== campus)) return false;
      if (q && !(st?.name || '').includes(q)) return false;
      return true;
    });
    const list = $('lvMgmtList');
    if (!list) return;
    if (!rows.length) { list.innerHTML = '<p class="empty-text">신청 내역이 없습니다.</p>'; return; }
    const byDate = {};
    rows.forEach(r => { (byDate[r.date] ||= []).push(r); });
    list.innerHTML = Object.entries(byDate).map(([date, arr]) => `
      <div style="margin-bottom:18px">
        <p style="font-weight:700;color:#444;margin-bottom:8px;font-size:14px">${esc(date)}</p>
        ${arr.map(r => `<div style="background:#fff;border:1px solid #eceef4;border-radius:12px;padding:12px 14px;margin-bottom:8px">
          <span style="font-weight:700;font-size:13px">${esc(studentMap.get(r.student_id)?.name || '알 수 없음')}</span>
          <span style="font-size:11px;font-weight:700;color:${r.type==='결석'?'#e2574c':'#f59e0b'};background:${r.type==='결석'?'#fdeceb':'#fff7e6'};padding:2px 8px;border-radius:999px;margin-left:6px">${esc(r.type)}</span>
          ${r.type==='지각' && r.arrival_time ? `<span style="font-size:12px;color:#9098a8;margin-left:6px">등원예정 ${esc(r.arrival_time)}</span>` : ''}
          <div style="font-size:12.5px;color:#666;margin-top:4px">${esc(r.reason || '-')}</div>
        </div>`).join('')}
      </div>`).join('');
  }
  $('lvMgmtSearch')?.addEventListener('input', renderLeaveMgmt);
  $('lvMgmtCampus')?.addEventListener('change', renderLeaveMgmt);

  // 셀 탭 → 선택 메뉴 (오터치로 바로 안 바뀌게)
  function closeStatusMenu() { document.getElementById('attMenu')?.remove(); }
  function openStatusMenu(cell, sid, date, cur) {
    closeStatusMenu();
    const r = cell.getBoundingClientRect();
    const opts = [
      { v:'present', t:'○ 출석', c:'#10b981' },
      { v:'partial', t:'△ 부분', c:'#f59e0b' },
      { v:'absent',  t:'✕ 미출석', c:'#e2574c' },
      { v:'excused', t:'Ⓧ 인정결석', c:'#8b5cf6' },
      { v:'',        t:'↩ 자동으로', c:'#6b7280' },
    ];
    const menu = document.createElement('div');
    menu.id = 'attMenu';
    menu.style.cssText = 'position:fixed;z-index:1000;background:#fff;border:1px solid #e2e5ee;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.14);padding:6px;min-width:150px';
    menu.innerHTML = opts.map(o => `<button class="att-opt" data-v="${o.v}" style="display:flex;width:100%;align-items:center;gap:8px;padding:10px 12px;border:none;background:none;border-radius:8px;font-size:14px;color:${o.c};font-weight:700;cursor:pointer;text-align:left">${o.t}${(cur||'')===o.v?' · 현재':''}</button>`).join('');
    document.body.appendChild(menu);
    let top = r.bottom + 4, left = r.left;
    if (top + menu.offsetHeight > window.innerHeight) top = r.top - menu.offsetHeight - 4;
    if (left + menu.offsetWidth > window.innerWidth) left = window.innerWidth - menu.offsetWidth - 8;
    menu.style.top = top + 'px'; menu.style.left = Math.max(8, left) + 'px';
    menu.querySelectorAll('.att-opt').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      closeStatusMenu();
      applyStatus(sid, date, b.dataset.v || null, cur);
    }));
    setTimeout(() => document.addEventListener('click', closeStatusMenu, { once: true }), 0);
  }

  async function setOverride(sid, date, status) {
    if (status === null) await sb.from('attendance_overrides').delete().eq('student_id', sid).eq('date', date);
    else await sb.from('attendance_overrides').upsert({ student_id: sid, date, status }, { onConflict: 'student_id,date' });
    await loadAttendance();
  }
  async function applyStatus(sid, date, status, prev) {
    if (status === (prev || null)) return; // 변화 없음
    await setOverride(sid, date, status);
    showUndoToast(sid, date, prev || null);
  }

  let undoTimer;
  function showUndoToast(sid, date, prev) {
    document.getElementById('attToast')?.remove();
    clearTimeout(undoTimer);
    const toast = document.createElement('div');
    toast.id = 'attToast';
    toast.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:1100;background:#1f2430;color:#fff;padding:12px 18px;border-radius:12px;display:flex;align-items:center;gap:14px;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.2)';
    toast.innerHTML = '<span>출석이 변경되었습니다.</span><button id="undoBtn" style="background:none;border:none;color:#7fb3ff;font-weight:700;cursor:pointer">되돌리기</button>';
    document.body.appendChild(toast);
    document.getElementById('undoBtn').addEventListener('click', () => { toast.remove(); clearTimeout(undoTimer); setOverride(sid, date, prev); });
    undoTimer = setTimeout(() => toast.remove(), 4000);
  }

  $('weekPrev')?.addEventListener('click', () => { weekStart.setDate(weekStart.getDate()-7); loadAttendance(); });
  $('weekNext')?.addEventListener('click', () => { weekStart.setDate(weekStart.getDate()+7); loadAttendance(); });
  $('todayBtn')?.addEventListener('click', () => { weekStart = startOfWeek(new Date()); loadAttendance(); });
  $('attCampusFilter')?.addEventListener('change', loadAttendance);

  // 출석표 엑셀 내보내기 (현재 주)
  $('exportExcel')?.addEventListener('click', async () => {
    await fetchStudents();
    const days = [...Array(7)].map((_, i) => { const d = new Date(weekStart); d.setDate(d.getDate()+i); return d; });
    const from = fmt(days[0]), to = fmt(days[6]);
    const [tt, ov, gl, lv] = await Promise.all([
      sb.from('timetables').select('student_id,date,submitted').gte('date', from).lte('date', to),
      sb.from('attendance_overrides').select('student_id,date,status').gte('date', from).lte('date', to),
      sb.from('goals').select('student_id,date,done').gte('date', from).lte('date', to),
      sb.from('leave_requests').select('student_id,date,type,reason,arrival_time').gte('date', from).lte('date', to),
    ]);
    const ttSet = new Set((tt.data||[]).filter(x=>x.submitted).map(x=>x.student_id+'|'+x.date));
    const ovMap = new Map((ov.data||[]).map(x=>[x.student_id+'|'+x.date, x.status]));
    const glAgg = {};
    (gl.data||[]).forEach(g => { const a = glAgg[g.student_id+'|'+g.date] ||= { done:0, total:0 }; a.total++; if (g.done) a.done++; });

    const dn = ['일','월','화','수','목','금','토'];
    const SYM = { present:'○', partial:'△', absent:'✕', excused:'Ⓧ' };
    const header = ['학생','캠퍼스', ...days.map(d => `${d.getMonth()+1}/${d.getDate()}(${dn[d.getDay()]})`)];
    const rows = [header];
    studentsCache.forEach(s => {
      const row = [s.name, s.campus || ''];
      days.forEach(d => {
        const date = fmt(d), key = s.id+'|'+date;
        const st = ovMap.has(key) ? ovMap.get(key) : autoStatus(key, ttSet, glAgg);
        const g = glAgg[key];
        const rate = g && g.total ? ` ${Math.round(g.done/g.total*100)}%` : '';
        row.push(SYM[st] + rate);
      });
      rows.push(row);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 10 }, { wch: 7 }, ...days.map(() => ({ wch: 11 }))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '출석');

    const nameMap = new Map(studentsCache.map(s => [s.id, s.name]));
    const lvRows = [['학생','날짜','구분','사유','등원예정시간']];
    (lv.data||[]).forEach(r => lvRows.push([nameMap.get(r.student_id) || r.student_id, r.date, r.type, r.reason || '', r.arrival_time || '']));
    const ws2 = XLSX.utils.aoa_to_sheet(lvRows);
    ws2['!cols'] = [{ wch: 10 }, { wch: 11 }, { wch: 7 }, { wch: 30 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws2, '지각결석사유');

    XLSX.writeFile(wb, `출석부_${from}_${to}.xlsx`);
  });

  // ═══════════════ 학습 현황 ═══════════════
  async function loadStudy() {
    await fetchStudents();
    const campus = $('studyCampusFilter').value;
    const today = todayStr();
    const [ttRes, glRes, glTotalRes] = await Promise.all([
      sb.from('timetables').select('student_id,slots,campus,seat,submitted,submitted_at').eq('date', today),
      sb.from('goals').select('student_id,text,done,created_at').eq('date', today).order('sort_order').order('created_at'),
      sb.from('goals').select('student_id,done').lte('date', today),
    ]);
    const ttMap = new Map((ttRes.data||[]).map(t => [t.student_id, t]));
    const goalAgg = {};
    const goalFirstTime = {};
    const goalsByStudent = {};
    (glRes.data||[]).forEach(g => {
      const a = goalAgg[g.student_id] ||= { done:0, total:0 }; a.total++; if (g.done) a.done++;
      if (!goalFirstTime[g.student_id] || g.created_at < goalFirstTime[g.student_id]) goalFirstTime[g.student_id] = g.created_at;
      (goalsByStudent[g.student_id] ||= []).push(g);
    });
    const fmtSubmitTime = iso => {
      if (!iso) return null;
      const d = new Date(iso);
      const mins = d.getHours() * 60 + d.getMinutes();
      return { timeTxt: d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }), isLate: mins > 600 };
    };
    const goalTotalAgg = {};
    (glTotalRes.data||[]).forEach(g => { const a = goalTotalAgg[g.student_id] ||= { done:0, total:0 }; a.total++; if (g.done) a.done++; });
    const list = studentsCache.filter(s => !campus || s.campus === campus);

    // 전체 이행률 요약
    const totDone = list.reduce((s, x) => s + (goalAgg[x.id]?.done || 0), 0);
    const totTotal = list.reduce((s, x) => s + (goalAgg[x.id]?.total || 0), 0);
    if (totTotal > 0) {
      const totRate = Math.round(totDone / totTotal * 100);
      const barColor = totRate >= 80 ? '#10b981' : totRate >= 50 ? '#f59e0b' : '#e2574c';
      $('goalSummaryBar').style.display = 'block';
      $('goalSummaryRate').textContent = totRate + '%';
      $('goalSummaryRate').style.color = barColor;
      $('goalSummaryBarFill').style.width = totRate + '%';
      $('goalSummaryBarFill').style.background = barColor;
      $('goalSummaryDetail').textContent = `${totDone}개 완료 / 전체 ${totTotal}개 · 목표 입력 학생 ${list.filter(x => goalAgg[x.id]?.total).length}명`;
    } else {
      $('goalSummaryBar').style.display = 'none';
    }

    $('studySummaryCards').innerHTML = list.map(s => {
      const tt = ttMap.get(s.id);
      const slots = tt?.slots || {};
      const studied = Object.keys(slots).length;
      const totalH = (studied*0.5).toFixed(1);
      const bySub = {}; Object.values(slots).forEach(v => bySub[v] = (bySub[v]||0)+0.5);
      const subTxt = Object.entries(bySub).map(([k,h])=>`${k} ${h}h`).join(' · ') || '기록 없음';
      const g = goalAgg[s.id];
      const rate = g && g.total ? Math.round(g.done/g.total*100) : null;
      const rateColor = r => r==null ? '#9098a8' : r>=80 ? '#10b981' : r>=50 ? '#f59e0b' : '#e2574c';
      const gt = goalTotalAgg[s.id];
      const totalRate = gt && gt.total ? Math.round(gt.done/gt.total*100) : null;
      const ttTime = fmtSubmitTime(tt?.submitted_at);
      const glTime = fmtSubmitTime(goalFirstTime[s.id]);
      const lateBadge = ' <b style="color:#e2574c">지각</b>';
      return `<div style="background:#fff;border:1px solid #eceef4;border-radius:14px;padding:16px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><span style="font-weight:700">${esc(s.name)}</span> <small style="color:#9098a8">${esc(s.grade||'')} ${s.campus?'· '+esc(s.campus):''}</small></div>
          <span style="font-size:22px;font-weight:800;color:#3b82f6">${totalH}h</span>
        </div>
        <div style="margin-top:8px;color:#666;font-size:13px">${esc(subTxt)}</div>
        <div style="margin-top:8px;display:flex;gap:12px;font-size:13px;font-weight:700">
          <span>당일 <span style="color:${rateColor(rate)}">${rate==null?'—':rate+'% ('+g.done+'/'+g.total+')'}</span></span>
          <span style="color:#e2e5ee">|</span>
          <span>전체 누적 <span style="color:${rateColor(totalRate)}">${totalRate==null?'—':totalRate+'% ('+gt.done+'/'+gt.total+')'}</span></span>
        </div>
        <div style="margin-top:6px;display:flex;gap:14px;font-size:11.5px;color:#9098a8">
          <span>시간표 제출 ${ttTime ? esc(ttTime.timeTxt) + (ttTime.isLate ? lateBadge : '') : '—'}</span>
          <span>목표 작성 ${glTime ? esc(glTime.timeTxt) + (glTime.isLate ? lateBadge : '') : '—'}</span>
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${tt?.submitted ? `<span style="font-size:12px;color:#10b981;background:#e7f7f0;padding:3px 10px;border-radius:999px">제출완료 (좌석 ${esc(tt.seat||'-')})</span>` : '<span style="font-size:12px;color:#9098a8">미제출</span>'}
          <button class="btn-ghost-sm tt-view-btn" data-id="${s.id}" data-name="${esc(s.name)}">시간표 보기</button>
          <button class="btn-ghost-sm goals-view-btn" data-id="${s.id}" data-name="${esc(s.name)}">목표 보기</button>
          <button class="btn-ghost-sm photos-btn" data-id="${s.id}" data-name="${esc(s.name)}" style="margin-left:auto">인증사진 모아보기</button>
        </div>
      </div>`;
    }).join('') || '<p class="empty-text">해당 학생이 없습니다.</p>';

    document.querySelectorAll('.tt-view-btn').forEach(b => b.addEventListener('click', () => showTimetableModal(b.dataset.name, ttMap.get(b.dataset.id)?.slots || {})));
    document.querySelectorAll('.goals-view-btn').forEach(b => b.addEventListener('click', () => showGoalsModal(b.dataset.name, goalsByStudent[b.dataset.id] || [])));
    document.querySelectorAll('.photos-btn').forEach(b => b.addEventListener('click', () => showStudentPhotos(b.dataset.id, b.dataset.name)));
    $('studyLogList').innerHTML = '<p class="empty-text">학생 카드의 "인증사진 모아보기"를 누르면 날짜별 사진이 표시됩니다.</p>';
  }

  // 시간표 모달
  const TT_COLORS = { '스카':'#3b82f6','식사':'#f59e0b','학원수업':'#10b981','기타':'#8b5cf6','국어':'#e2574c','영어':'#3b82f6','수학':'#10b981','과학':'#f59e0b' };
  const ttSlots = (() => { const a = []; for (let m=480;m<1440;m+=30){ const h=Math.floor(m/60),mm=m%60; a.push(`${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`); } return a; })();

  function showTimetableModal(name, slots) {
    const baseKey = k => k ? k.split(':')[0] : k;
    const colorOf = k => TT_COLORS[baseKey(k)] || '#8b5cf6';
    const displayOf = k => { if(!k) return ''; const [b,...r]=k.split(':'); return r.length?`${b}(${r.join(':')})`:b; };
    $('ttModalTitle').textContent = `${name} 오늘 시간표`;
    $('ttModalContent').innerHTML = ttSlots.map(t => {
      const v = slots[t];
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:12px;color:#9098a8;width:38px;flex-shrink:0">${t}</span>
        <div style="flex:1;padding:5px 10px;border-radius:6px;font-size:13px;font-weight:600;${v?`background:${colorOf(v)};color:#fff`:'background:#f5f6fa;color:#d0d4df'}">${v?displayOf(v):''}</div>
      </div>`;
    }).join('');
    $('ttModal').classList.add('show');
  }

  $('ttModalClose')?.addEventListener('click', () => $('ttModal').classList.remove('show'));
  $('ttModal')?.addEventListener('click', e => { if(e.target===$('ttModal')) $('ttModal').classList.remove('show'); });

  function showGoalsModal(name, goals) {
    const body = goals.length
      ? goals.map(g => `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#f8f9fb;border-radius:10px;margin-bottom:6px">
          <span style="flex-shrink:0;width:20px;height:20px;border-radius:6px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;background:${g.done?'#10b981':'#fff'};border:2px solid ${g.done?'#10b981':'#cbd2e0'}">${g.done?'✓':''}</span>
          <span style="font-size:13.5px;color:${g.done?'#9098a8':'#1f2430'};text-decoration:${g.done?'line-through':'none'}">${esc(g.text)}</span>
        </div>`).join('')
      : '<p style="color:#9098a8;font-size:13px;text-align:center;padding:20px 0">오늘 등록된 목표가 없습니다.</p>';
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2000;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `<div style="background:#fff;border-radius:16px;padding:22px;max-width:380px;width:90%;max-height:75vh;overflow:auto">
      <h3 style="margin:0 0 14px;font-size:16px;font-weight:800;color:#1f2430">${esc(name)} 오늘의 목표</h3>
      ${body}
      <button id="goalsModalClose" style="margin-top:6px;width:100%;padding:11px;border:none;border-radius:10px;background:#f3f4f8;color:#444;font-weight:700;font-size:13px;cursor:pointer">닫기</button>
    </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#goalsModalClose').addEventListener('click', () => overlay.remove());
  }

  // 학생 인증사진+메모: 날짜별 표출 + ZIP 다운로드
  async function showStudentPhotos(sid, name) {
    const wrap = $('studyLogList');
    wrap.innerHTML = '<p class="empty-text">불러오는 중...</p>';
    const { data: logs } = await sb.from('study_logs').select('*')
      .eq('student_id', sid).order('date', { ascending: false }).order('created_at', { ascending: false });
    if (!logs || !logs.length) { wrap.innerHTML = `<p class="empty-text">${esc(name)} 학생의 학습 인증 기록이 없습니다.</p>`; return; }

    const photoLogs = logs.filter(l => l.image_path);
    // 날짜별 그룹
    const byDate = {};
    logs.forEach(l => { (byDate[l.date] ||= []).push(l); });

    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 class="section-subtitle" style="margin:0">${esc(name)} 학습 인증 (사진 ${photoLogs.length}장 · 전체 ${logs.length}건)</h3>
        <button class="btn-primary-sm" id="zipBtn" ${photoLogs.length ? '' : 'disabled'}>전체 ZIP 다운로드</button>
      </div>` +
      Object.entries(byDate).map(([date, arr]) => `
        <div style="margin-bottom:16px">
          <p style="font-weight:700;color:#444;margin-bottom:8px">${esc(date)}</p>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">
            ${arr.map(l => `<div style="border:1px solid #eceef4;border-radius:10px;overflow:hidden;background:#fff">
              ${l.image_path ? `<a href="${esc(l.image_path)}" target="_blank"><img src="${esc(l.image_path)}" style="width:100%;aspect-ratio:1;object-fit:cover;display:block" /></a>` : ''}
              <div style="padding:8px 10px">
                <div style="font-size:11.5px;font-weight:700;color:#3b82f6">${esc(l.subject || '-')}${l.estimated_hours ? ` · ${esc(String(l.estimated_hours))}h` : ''}</div>
                ${l.summary ? `<div style="font-size:12px;color:#555;margin-top:4px;line-height:1.5;white-space:pre-wrap">${esc(l.summary)}</div>` : ''}
              </div>
            </div>`).join('')}
          </div>
        </div>`).join('');

    $('zipBtn')?.addEventListener('click', () => downloadZip(name, photoLogs));
  }

  async function downloadZip(name, logs) {
    const btn = $('zipBtn');
    btn.disabled = true; btn.textContent = 'ZIP 생성 중...';
    try {
      const zip = new JSZip();
      const counts = {};
      for (const l of logs) {
        try {
          const res = await fetch(l.image_path);
          const blob = await res.blob();
          const ext = (l.image_path.split('.').pop() || 'jpg').split('?')[0];
          counts[l.date] = (counts[l.date] || 0) + 1;
          zip.file(`${name}_${l.date}_${counts[l.date]}.${ext}`, blob);
        } catch (e) { console.error('이미지 로드 실패', l.image_path, e); }
      }
      const out = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(out);
      const a = document.createElement('a');
      a.href = url; a.download = `${name}_인증사진.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } finally {
      btn.disabled = false; btn.textContent = '전체 ZIP 다운로드';
    }
  }
  $('studyCampusFilter')?.addEventListener('change', loadStudy);
  $('refreshStudyBtn')?.addEventListener('click', loadStudy);

  // 학습현황: 전체 학생 인증사진 + 코멘트 일괄 다운로드
  $('downloadAllPhotosBtn')?.addEventListener('click', async () => {
    const btn = $('downloadAllPhotosBtn');
    const label = btn.innerHTML;
    btn.disabled = true; btn.textContent = '준비 중...';
    try {
      await fetchStudents();
      const campus = $('studyCampusFilter').value;
      const list = studentsCache.filter(s => !campus || s.campus === campus);
      const nameMap = new Map(list.map(s => [s.id, s.name]));
      const ids = list.map(s => s.id);
      if (!ids.length) { alert('학생이 없습니다.'); return; }
      const { data: logs } = await sb.from('study_logs').select('*')
        .in('student_id', ids).order('date', { ascending: true }).order('created_at', { ascending: true });
      if (!logs || !logs.length) { alert('학습 인증 기록이 없습니다.'); return; }

      const byStudent = {};
      logs.forEach(l => { (byStudent[l.student_id] ||= []).push(l); });

      const zip = new JSZip();
      let photoCount = 0;
      for (const [sid, arr] of Object.entries(byStudent)) {
        const name = nameMap.get(sid) || sid;
        const counts = {};
        const commentLines = [];
        for (const l of arr) {
          commentLines.push(`[${l.date}] ${l.subject || '-'} · ${l.estimated_hours ?? '-'}시간\n${l.summary || '(메모 없음)'}\n`);
          if (l.image_path) {
            try {
              const res = await fetch(l.image_path);
              const blob = await res.blob();
              const ext = (l.image_path.split('.').pop() || 'jpg').split('?')[0];
              counts[l.date] = (counts[l.date] || 0) + 1;
              zip.file(`${name}/${l.date}_${counts[l.date]}.${ext}`, blob);
              photoCount++;
            } catch (e) { console.error('이미지 로드 실패', l.image_path, e); }
          }
        }
        zip.file(`${name}/코멘트.txt`, commentLines.join('\n'));
      }

      btn.textContent = 'ZIP 생성 중...';
      const out = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(out);
      const a = document.createElement('a');
      a.href = url; a.download = `학습인증_전체_${todayStr()}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } finally {
      btn.disabled = false; btn.innerHTML = label;
    }
  });

  // ═══════════════ 상담 ═══════════════
  // 키는 워커에서 받아오고(깃엔 없음), Gemini 호출은 브라우저(한국 IP)에서 직접 한다.
  // 워커 egress IP가 Gemini 미지원 지역으로 잡혀 서버사이드 프록시가 막히기 때문.
  let _geminiKey = null;
  async function getGeminiKey() {
    if (_geminiKey) return _geminiKey;
    const res = await fetch('/api/key');
    const json = await res.json();
    _geminiKey = (json.key || '').trim();
    return _geminiKey;
  }

  const REPORT_SYSTEM = `당신은 진로 상담 전문가입니다. 학생 맞춤형 진로 리포트를 작성하세요.

[작성 원칙]
- 학생의 상담 내용에 기반하여 심화적이고 실질적인 내용을 제공하세요.
- 학생의 가능성과 강점을 중심으로 긍정적이고 응원하는 톤으로 작성하세요.
- 구체적인 활동 추천, 방향성 제시, 동기부여가 되는 내용만 포함하세요.

[절대 금지]
- "정시/수시를 써라" 등 입시 전략 단정 금지
- "가망이 없다", "어렵다", "힘들다" 등 부정적 평가 금지
- 성적이나 현재 수준으로 가능성을 제한하는 표현 금지
- 특정 대학/학과를 단정적으로 추천하거나 배제하는 표현 금지
- 학생을 위축시킬 수 있는 모든 표현 금지`;

  const CATEGORY_MAP = {
    '컴퓨터/AI/소프트웨어': '공과',
    '기계/로봇/자동차': '공과',
    '전기/전자/반도체': '공과',
    '화학/재료/에너지': '공과',
    '건축/토목/환경': '공과',
    '의학/치의학': '바이오/생명',
    '간호/보건': '바이오/생명',
    '약학/생명과학': '바이오/생명',
    '경영/경제': '문과',
    '법학/행정': '문과',
    '교육': '문과',
    '사회/심리': '문과',
    '어문/인문': '문과',
    '자유전공': '자유전공',
  };

  const CATEGORY_RESEARCH = {
    '공과': `당신은 공과계열 진로 리서치 전문가입니다.
학생의 상담 기록을 바탕으로 아래 항목을 조사·정리하세요:
- 공과계열 최신 기술 트렌드 및 주목받는 연구 분야
- 국내외 주요 산업 동향 (반도체/AI/자동차/에너지/건설 등)
- 공과계열 졸업생의 주요 취업 경로 및 유망 직종
- 고등학생이 지금부터 준비할 수 있는 공과 관련 활동/대회/자격증
조사 결과는 한국 고등학생과 학부모가 이해할 수 있는 수준으로 정리하세요.`,
    '바이오/생명': `당신은 바이오/생명계열 진로 리서치 전문가입니다.
학생의 상담 기록을 바탕으로 아래 항목을 조사·정리하세요:
- 의학/간호/약학/생명과학 분야 최신 연구 동향
- 국내 의료·바이오·제약 산업 현황 및 성장 분야
- 바이오/생명계열 졸업생의 주요 취업 경로 및 전문직 자격
- 고등학생이 지금부터 준비할 수 있는 관련 활동/대회/봉사
조사 결과는 한국 고등학생과 학부모가 이해할 수 있는 수준으로 정리하세요.`,
    '문과': `당신은 문과계열 진로 리서치 전문가입니다.
학생의 상담 기록을 바탕으로 아래 항목을 조사·정리하세요:
- 경영/법학/교육/사회/어문 분야 최신 산업 동향 및 직업 전망
- 문과계열에서 주목받는 융합 직종 (데이터 분석가, UX리서처, HR테크 등)
- 문과계열 졸업생의 주요 취업 경로 (대기업/공무원/금융/미디어 등)
- 고등학생이 지금부터 준비할 수 있는 관련 활동/대회/자격증
조사 결과는 한국 고등학생과 학부모가 이해할 수 있는 수준으로 정리하세요.`,
    '자유전공': `당신은 자유전공/무전공 진로 리서치 전문가입니다.
학생의 상담 기록을 바탕으로 아래 항목을 조사·정리하세요:
- 자유전공/무전공 운영 주요 대학 현황 및 특징 (서울대/연세대/고려대 등)
- 자유전공 입학 후 전공 탐색 과정 및 전공 선택 전략
- 다양한 분야를 탐색할 수 있는 융합 커리어 사례
- 고등학생이 지금부터 준비할 수 있는 폭넓은 활동/독서/경험
조사 결과는 한국 고등학생과 학부모가 이해할 수 있는 수준으로 정리하세요.`,
  };

  const MAJOR_PROMPTS = {
    '컴퓨터/AI/소프트웨어': `컴퓨터/AI/소프트웨어 전공 진로 리포트를 작성하세요:
1. 학생 현황 요약 (강점/관심사 중심)
2. 추천 세부 전공 (컴퓨터공학/AI/데이터사이언스/사이버보안 등)
3. 고등학교 재학 중 추천 활동 5가지 (구체적으로)
4. 추천 대학 학과 유형 및 진학 방향
5. 졸업 후 커리어 로드맵`,
    '기계/로봇/자동차': `기계/로봇/자동차 전공 진로 리포트를 작성하세요:
1. 학생 현황 요약 (강점/관심사 중심)
2. 추천 세부 전공 (기계공학/로봇공학/자동차공학/항공우주 등)
3. 고등학교 재학 중 추천 활동 5가지 (구체적으로)
4. 추천 대학 학과 유형 및 진학 방향
5. 졸업 후 커리어 로드맵 (국내 대기업 연계 포함)`,
    '전기/전자/반도체': `전기/전자/반도체 전공 진로 리포트를 작성하세요:
1. 학생 현황 요약 (강점/관심사 중심)
2. 추천 세부 전공 (전기공학/전자공학/반도체/디스플레이 등)
3. 고등학교 재학 중 추천 활동 5가지 (구체적으로)
4. 추천 대학 학과 유형 및 진학 방향
5. 졸업 후 커리어 로드맵 (삼성전자/SK하이닉스 등 반도체 산업 연계)`,
    '화학/재료/에너지': `화학/재료/에너지 전공 진로 리포트를 작성하세요:
1. 학생 현황 요약 (강점/관심사 중심)
2. 추천 세부 전공 (화학공학/재료공학/신재생에너지/배터리 등)
3. 고등학교 재학 중 추천 활동 5가지 (구체적으로)
4. 추천 대학 학과 유형 및 진학 방향
5. 졸업 후 커리어 로드맵 (이차전지/수소에너지 산업 연계)`,
    '건축/토목/환경': `건축/토목/환경 전공 진로 리포트를 작성하세요:
1. 학생 현황 요약 (강점/관심사 중심)
2. 추천 세부 전공 (건축학/건축공학/토목/도시공학/환경공학 등)
3. 고등학교 재학 중 추천 활동 5가지 (구체적으로)
4. 추천 대학 학과 유형 및 진학 방향
5. 졸업 후 커리어 로드맵 (건설사/공기업/설계사무소 등)`,
    '의학/치의학': `의학/치의학 전공 진로 리포트를 작성하세요:
1. 학생 현황 요약 (강점/관심사 중심)
2. 추천 방향 (의예과/치의예과 등)
3. 고등학교 재학 중 추천 활동 5가지 (의료봉사/생명과학 심화 등)
4. 추천 대학 학과 유형 및 진학 방향
5. 졸업 후 커리어 로드맵 (전공의 과정 포함)`,
    '간호/보건': `간호/보건 전공 진로 리포트를 작성하세요:
1. 학생 현황 요약 (강점/관심사 중심)
2. 추천 세부 전공 (간호학/보건관리/물리치료/임상병리 등)
3. 고등학교 재학 중 추천 활동 5가지 (구체적으로)
4. 추천 대학 학과 유형 및 진학 방향
5. 졸업 후 커리어 로드맵 (병원/공공보건/해외취업 등)`,
    '약학/생명과학': `약학/생명과학 전공 진로 리포트를 작성하세요:
1. 학생 현황 요약 (강점/관심사 중심)
2. 추천 세부 전공 (약학/생명공학/바이오/식품영양 등)
3. 고등학교 재학 중 추천 활동 5가지 (구체적으로)
4. 추천 대학 학과 유형 및 진학 방향
5. 졸업 후 커리어 로드맵 (제약회사/연구소/약국 등)`,
    '경영/경제': `경영/경제 전공 진로 리포트를 작성하세요:
1. 학생 현황 요약 (강점/관심사 중심)
2. 추천 세부 전공 (경영/경제/회계/마케팅/금융 등)
3. 고등학교 재학 중 추천 활동 5가지 (구체적으로)
4. 추천 대학 학과 유형 및 진학 방향
5. 졸업 후 커리어 로드맵 (대기업/금융권/스타트업/컨설팅 등)`,
    '법학/행정': `법학/행정 전공 진로 리포트를 작성하세요:
1. 학생 현황 요약 (강점/관심사 중심)
2. 추천 세부 전공 (법학/행정학/정치외교/공공정책 등)
3. 고등학교 재학 중 추천 활동 5가지 (모의재판/토론/봉사 등)
4. 추천 대학 학과 유형 및 진학 방향
5. 졸업 후 커리어 로드맵 (로스쿨/공무원/공기업/NGO 등)`,
    '교육': `교육 전공 진로 리포트를 작성하세요:
1. 학생 현황 요약 (강점/관심사 중심)
2. 추천 세부 전공 (사범대/교육학/유아교육/특수교육 등)
3. 고등학교 재학 중 추천 활동 5가지 (튜터링/교육봉사 등)
4. 추천 대학 학과 유형 및 진학 방향
5. 졸업 후 커리어 로드맵 (교원임용/교육행정/EdTech 등)`,
    '사회/심리': `사회/심리 전공 진로 리포트를 작성하세요:
1. 학생 현황 요약 (강점/관심사 중심)
2. 추천 세부 전공 (심리학/사회학/사회복지/상담심리 등)
3. 고등학교 재학 중 추천 활동 5가지 (구체적으로)
4. 추천 대학 학과 유형 및 진학 방향
5. 졸업 후 커리어 로드맵 (임상심리사/사회복지사/HR/UX리서처 등)`,
    '어문/인문': `어문/인문 전공 진로 리포트를 작성하세요:
1. 학생 현황 요약 (강점/관심사 중심)
2. 추천 세부 전공 (국문/영문/중문/일문/철학/역사 등)
3. 고등학교 재학 중 추천 활동 5가지 (독서/글쓰기/언어 자격증 등)
4. 추천 대학 학과 유형 및 진학 방향
5. 졸업 후 커리어 로드맵 (출판/미디어/번역/외교/공무원 등)`,
    '자유전공': `자유전공 진로 리포트를 작성하세요:
1. 학생 현황 요약 (강점/관심사 중심)
2. 자유전공 선택이 적합한 이유 분석
3. 고등학교 재학 중 추천 활동 5가지 (다양한 분야 탐색 중심)
4. 입학 후 전공 탐색 전략 및 추천 전공 방향 2~3가지
5. 졸업 후 커리어 로드맵`,
  };

  // 리포트 캐시 헬퍼 (localStorage, 최대 30개 LRU)
  const RC_PREFIX = 'dcr_';
  const RC_MAX = 30;
  function _rcHash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  function getReportCache(sid, major) {
    try { const r = localStorage.getItem(RC_PREFIX + sid + '_' + major); return r ? JSON.parse(r) : null; }
    catch { return null; }
  }
  function setReportCache(sid, major, text, hash) {
    try {
      localStorage.setItem(RC_PREFIX + sid + '_' + major, JSON.stringify({ text, hash, at: Date.now() }));
      const keys = Object.keys(localStorage).filter(k => k.startsWith(RC_PREFIX));
      if (keys.length > RC_MAX) {
        keys.map(k => { try { return { k, at: JSON.parse(localStorage.getItem(k))?.at || 0 }; } catch { return { k, at: 0 }; } })
            .sort((a, b) => a.at - b.at)
            .slice(0, keys.length - RC_MAX)
            .forEach(e => localStorage.removeItem(e.k));
      }
    } catch {}
  }

  async function callGemini(systemText, userText) {
    const key = await getGeminiKey();
    if (!key) throw new Error('API 키를 불러올 수 없습니다.');
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemText }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: { temperature: 0.7 }
      })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(json.error || json));
    return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  let consultSid = null;
  let currentConsults = [];
  async function loadConsultStudents() {
    await fetchStudents();
    const grid = $('studentSelectGrid');
    grid.innerHTML = studentsCache.map(s => `<button class="student-select-card" data-id="${s.id}">
      <span class="select-avatar" style="font-size:13px">${esc(s.campus || '—')}</span>
      <span class="select-name">${esc(s.name)}</span>
      <span class="select-grade">${esc(s.grade||'')}</span>
    </button>`).join('') || '<p class="empty-text">학생이 없습니다.</p>';
    grid.querySelectorAll('.student-select-card').forEach(b => b.addEventListener('click', () => openConsult(b.dataset.id)));
  }
  async function openConsult(id) {
    consultSid = id;
    const s = studentsCache.find(x => x.id === id);
    $('consultStudentName').textContent = `${s.name} 상담 기록`;
    $('consultPanel').style.display = 'block';
    $('consultForm').style.display = 'none';
    await renderConsults();
    $('consultPanel').scrollIntoView({ behavior:'smooth' });
  }
  async function renderConsults() {
    const { data } = await sb.from('consults').select('*').eq('student_id', consultSid).order('date', { ascending:false });
    currentConsults = data || [];
    const list = $('consultList');
    $('reportBtn').style.display = currentConsults.length ? 'inline-flex' : 'none';
    if (!currentConsults.length) { list.innerHTML = '<p class="empty-text">상담 기록이 없습니다.</p>'; return; }
    list.innerHTML = data.map(c => `<div style="border:1px solid #eceef4;border-radius:12px;padding:14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px"><b>${esc(c.date||'')}</b><span style="color:#8b92a4;font-size:13px">${esc(c.counselor||'')}</span></div>
      ${c.content?`<p style="margin:4px 0;white-space:pre-wrap"><b>내용</b> · ${esc(c.content)}</p>`:''}
      ${c.strength?`<p style="margin:4px 0;color:#10b981;white-space:pre-wrap"><b>강점</b> · ${esc(c.strength)}</p>`:''}
      ${c.weakness?`<p style="margin:4px 0;color:#e2574c;white-space:pre-wrap"><b>약점</b> · ${esc(c.weakness)}</p>`:''}
      ${c.next_goal?`<p style="margin:4px 0;color:#3b82f6;white-space:pre-wrap"><b>다음목표</b> · ${esc(c.next_goal)}</p>`:''}
      <button class="btn-ghost-sm del-consult" data-id="${c.id}" style="margin-top:6px">삭제</button>
    </div>`).join('');
    list.querySelectorAll('.del-consult').forEach(b => b.addEventListener('click', async () => {
      await sb.from('consults').delete().eq('id', b.dataset.id); renderConsults();
    }));
  }
  $('addConsultBtn')?.addEventListener('click', () => {
    $('consultForm').style.display = 'block';
    $('cDate').value = todayStr();
    ['cContent','cStrength','cWeakness','cNextGoal','cCounselor'].forEach(id => $(id).value = '');
    if (pageRole === '튜터') {
      $('cCounselor').value = me.sname;
      $('cCounselor').readOnly = true;
    }
    $('consultFormError').textContent = '';
  });
  $('reportBtn')?.addEventListener('click', () => {
    const s = studentsCache.find(x => x.id === consultSid);
    $('reportModalTitle').textContent = `${s?.name || ''} 상담 리포트`;
    $('reportMajorWrap').style.display = 'block';
    $('reportContent').style.display = 'none';
    $('reportContent').textContent = '';
    $('reportCopyBtn').style.display = 'none';
    $('reportModal').classList.add('show');
  });

  function _buildRecordsText() {
    return currentConsults.map(c =>
      `[${c.date}]\n내용: ${c.content||'-'}\n강점: ${c.strength||'-'}\n약점: ${c.weakness||'-'}\n다음목표: ${c.next_goal||'-'}\n상담인: ${c.counselor||'-'}`
    ).join('\n\n');
  }

  function _showCachedReport(text, notice) {
    $('reportMajorWrap').style.display = 'none';
    $('reportContent').style.display = 'block';
    $('reportContent').textContent = text;
    $('reportCacheNotice').style.display = 'block';
    $('reportCacheNotice').textContent = notice;
    $('reportCopyBtn').style.display = 'block';
    $('reportRegenBtn').style.display = 'block';
  }

  async function _generateReport(sid, studentName, grade, majorField, recordsText, forceRegen) {
    const category = CATEGORY_MAP[majorField] || '자유전공';
    const hash = _rcHash(recordsText);

    if (!forceRegen) {
      const cached = getReportCache(sid, majorField);
      if (cached) {
        if (cached.hash === hash) {
          _showCachedReport(cached.text, '저장된 리포트');
          return;
        }
        if (!confirm('상담 내용이 변경됐습니다. 재발행하시겠습니까?\n(아니오: 이전 리포트 보기)')) {
          _showCachedReport(cached.text, '이전 리포트 (내용 변경됨)');
          return;
        }
      }
    }

    $('reportMajorWrap').style.display = 'none';
    $('reportContent').style.display = 'block';
    $('reportContent').textContent = '';
    $('reportCacheNotice').style.display = 'none';
    $('reportCopyBtn').style.display = 'none';
    $('reportRegenBtn').style.display = 'none';

    try {
      $('reportContent').textContent = '1/2 계열 정보 분석 중...';
      const researchPrompt = `[학생 정보]\n이름: ${studentName} / 학년: ${grade}\n\n[상담 기록]\n${recordsText}\n\n위 학생의 상담 기록을 바탕으로 ${category} 계열 진로 관련 정보를 정리해주세요.`;
      const researchResult = await callGemini(CATEGORY_RESEARCH[category], researchPrompt);

      $('reportContent').textContent = '2/2 진로 리포트 작성 중...';
      const majorPrompt = MAJOR_PROMPTS[majorField] || MAJOR_PROMPTS['자유전공'];
      const reportPrompt = `[참고 자료 — ${category} 계열 동향]\n${researchResult}\n\n[학생 정보]\n이름: ${studentName} / 학년: ${grade} / 희망 계열: ${majorField}\n\n[상담 기록]\n${recordsText}\n\n${majorPrompt}`;
      const reportResult = await callGemini(REPORT_SYSTEM, reportPrompt);

      const text = reportResult || '리포트 생성 실패';
      setReportCache(sid, majorField, text, hash);
      const { error: rErr } = await sb.from('reports').insert({ student_id: sid, major: majorField, content: text, records_hash: hash });
      if (rErr) console.error('리포트 저장 실패:', rErr.message);
      $('reportContent').textContent = text;
      $('reportCacheNotice').style.display = 'none';
      $('reportCopyBtn').style.display = 'block';
      $('reportRegenBtn').style.display = 'block';
    } catch(e) {
      $('reportContent').textContent = '오류: ' + e.message;
      $('reportMajorWrap').style.display = 'block';
    }
  }

  $('reportGenerateBtn')?.addEventListener('click', async () => {
    const s = studentsCache.find(x => x.id === consultSid);
    const majorField = $('reportMajorSelect').value;
    await _generateReport(consultSid, s?.name || '', s?.grade || '', majorField, _buildRecordsText(), false);
  });

  $('reportRegenBtn')?.addEventListener('click', async () => {
    const s = studentsCache.find(x => x.id === consultSid);
    const majorField = $('reportMajorSelect').value;
    await _generateReport(consultSid, s?.name || '', s?.grade || '', majorField, _buildRecordsText(), true);
  });

  $('reportCopyBtn')?.addEventListener('click', () => {
    navigator.clipboard.writeText($('reportContent').textContent);
    $('reportCopyBtn').textContent = '복사 완료 ✓';
    setTimeout(() => $('reportCopyBtn').textContent = '복사하기', 2000);
  });
  function _closeReportModal() {
    $('reportModal').classList.remove('show');
    $('reportCacheNotice').style.display = 'none';
    $('reportRegenBtn').style.display = 'none';
  }
  $('reportModalClose')?.addEventListener('click', _closeReportModal);
  $('reportModal')?.addEventListener('click', e => { if (e.target === $('reportModal')) _closeReportModal(); });

  $('consultCancel')?.addEventListener('click', () => $('consultForm').style.display = 'none');
  $('consultSave')?.addEventListener('click', async () => {
    if (!consultSid) return;
    const payload = {
      student_id: consultSid,
      date: $('cDate').value || todayStr(),
      content: $('cContent').value.trim() || null,
      strength: $('cStrength').value.trim() || null,
      weakness: $('cWeakness').value.trim() || null,
      next_goal: $('cNextGoal').value.trim() || null,
      counselor: $('cCounselor').value.trim() || null,
    };
    const { error } = await sb.from('consults').insert(payload);
    if (error) { $('consultFormError').textContent = '저장 오류: ' + error.message; return; }
    $('consultForm').style.display = 'none';
    renderConsults();
  });

  // ═══════════════ 학생 관리 ═══════════════
  let editingId = null, deletingId = null;
  const studentModal = $('studentModal'), deleteModal = $('deleteStudentModal');

  async function loadStudents() {
    await fetchStudents();
    const wrap = $('studentMgmtList');
    wrap.innerHTML = studentsCache.map(s => `<div style="display:flex;justify-content:space-between;align-items:center;background:#fff;border:1px solid #eceef4;border-radius:12px;padding:14px;margin-bottom:8px">
      <div><span style="font-weight:700">${esc(s.name)}</span> <small style="color:#9098a8">${esc(s.grade||'')} ${s.campus?'· '+esc(s.campus):''}</small></div>
      <div style="display:flex;gap:8px">
        <button class="btn-ghost-sm edit-st" data-id="${s.id}">수정</button>
        <button class="btn-ghost-sm del-st" data-id="${s.id}" style="color:#e2574c">삭제</button>
      </div>
    </div>`).join('') || '<p class="empty-text">학생이 없습니다.</p>';
    wrap.querySelectorAll('.edit-st').forEach(b => b.addEventListener('click', () => openStudentModal(b.dataset.id)));
    wrap.querySelectorAll('.del-st').forEach(b => b.addEventListener('click', () => openDelete(b.dataset.id)));
  }

  function openStudentModal(id) {
    editingId = id || null;
    const s = id ? studentsCache.find(x => x.id === id) : null;
    $('studentModalTitle').textContent = id ? '학생 수정' : '학생 추가';
    $('fieldName').value = s?.name || '';
    $('fieldPin').value = '';
    $('fieldGrade').value = s?.grade || '';
    $('fieldCampus').value = s?.campus || '';
    $('pinHint').style.display = id ? 'block' : 'none';
    $('studentFormError').textContent = '';
    studentModal.classList.add('show');
  }
  $('addStudentBtn')?.addEventListener('click', () => openStudentModal(null));
  $('studentModalCancel')?.addEventListener('click', () => studentModal.classList.remove('show'));
  $('studentModalSave')?.addEventListener('click', async () => {
    const name = $('fieldName').value.trim();
    const pin = $('fieldPin').value.trim();
    const grade = $('fieldGrade').value.trim() || null;
    const campus = $('fieldCampus').value || null;
    const err = $('studentFormError');
    if (!name) { err.textContent = '이름을 입력하세요.'; return; }
    if (!editingId && !/^\d{4}$/.test(pin)) { err.textContent = 'PIN 4자리를 입력하세요.'; return; }
    if (editingId && pin && !/^\d{4}$/.test(pin)) { err.textContent = 'PIN은 4자리 숫자입니다.'; return; }
    const { error } = await sb.rpc('set_student', { p_id: editingId, p_name: name, p_pin: pin || null, p_grade: grade, p_campus: campus });
    if (error) { err.textContent = '저장 오류: ' + error.message; return; }
    studentModal.classList.remove('show');
    loadStudents();
  });

  function openDelete(id) {
    deletingId = id;
    const s = studentsCache.find(x => x.id === id);
    $('deleteStudentDesc').textContent = `${s?.name||''} 학생의 모든 기록(시간표·출석·상담)이 함께 삭제됩니다.`;
    deleteModal.classList.add('show');
  }
  $('deleteCancel')?.addEventListener('click', () => deleteModal.classList.remove('show'));
  $('deleteConfirm')?.addEventListener('click', async () => {
    await sb.rpc('delete_student', { p_id: deletingId });
    deleteModal.classList.remove('show');
    loadStudents();
  });

  // ═══════════════ 계정 관리 (원장/부원장/튜터) ═══════════════
  async function loadAccounts() {
    const list = $('accountsList');
    if (!list) return;
    list.innerHTML = '<p class="empty-text">불러오는 중...</p>';
    const { data, error } = await sb.rpc('list_admin_accounts');
    if (error) { list.innerHTML = `<p class="empty-text" style="color:#e2574c">오류: ${esc(error.message)}</p>`; return; }
    const rows = data || [];
    if (!rows.length) { list.innerHTML = '<p class="empty-text">계정이 없습니다.</p>'; return; }
    const roleColor = r => r === '원장' ? '#3b82f6' : r === '부원장' ? '#8b5cf6' : '#10b981';
    list.innerHTML = rows.map(a => `
      <div style="display:flex;justify-content:space-between;align-items:center;background:#fff;border:1px solid #eceef4;border-radius:12px;padding:14px 16px;margin-bottom:8px">
        <div>
          <span style="font-weight:700;font-size:14px">${esc(a.name)}</span>
          <span style="font-size:11px;font-weight:700;color:${roleColor(a.role)};background:${roleColor(a.role)}20;padding:2px 8px;border-radius:999px;margin-left:8px">${esc(a.role)}</span>
        </div>
        <button class="btn-ghost-sm acc-edit-btn" data-id="${esc(a.id)}" data-name="${esc(a.name)}" data-role="${esc(a.role)}">수정</button>
      </div>`).join('');
    list.querySelectorAll('.acc-edit-btn').forEach(b => b.addEventListener('click', () =>
      showAccountEditModal(b.dataset.id, b.dataset.name, b.dataset.role)));
  }

  function showAccountEditModal(id, name, role) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2000;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `<div style="background:#fff;border-radius:16px;padding:22px;max-width:340px;width:90%">
      <h3 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#1f2430">${esc(role)} 계정 수정</h3>
      <div class="form-group">
        <label class="form-label">이름</label>
        <input class="form-input" id="accEditName" type="text" value="${esc(name)}" maxlength="20" />
      </div>
      <div class="form-group" style="margin-top:10px">
        <label class="form-label">새 PIN (4자리)</label>
        <input class="form-input" id="accEditPin" type="text" placeholder="0000" maxlength="4" pattern="\\d{4}" inputmode="numeric" />
        <p class="form-hint">비워두면 기존 PIN 유지</p>
      </div>
      <p class="form-error" id="accEditError"></p>
      <div class="modal-actions" style="margin-top:14px">
        <button class="modal-btn modal-btn--cancel" id="accEditCancel">취소</button>
        <button class="modal-btn modal-btn--save" id="accEditSave">저장</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#accEditCancel').addEventListener('click', close);
    overlay.querySelector('#accEditSave').addEventListener('click', async () => {
      const newName = overlay.querySelector('#accEditName').value.trim();
      const newPin = overlay.querySelector('#accEditPin').value.trim();
      const errEl = overlay.querySelector('#accEditError');
      if (!newName) { errEl.textContent = '이름을 입력해주세요.'; return; }
      if (newPin && !/^\d{4}$/.test(newPin)) { errEl.textContent = 'PIN은 숫자 4자리여야 합니다.'; return; }
      const { error } = await sb.rpc('update_admin_account', { p_id: id, p_name: newName, p_pin: newPin || null });
      if (error) { errEl.textContent = '저장 실패: ' + error.message; return; }
      close();
      loadAccounts();
    });
  }

  // 초기 로드 (기본 탭: 출석)
  loadAttendance();
})();
