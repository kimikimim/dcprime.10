(() => {
  // ── 탭 전환 ─────────────────────────────────────────────
  const tabBtns = document.querySelectorAll('.tab-btn');
  const panels = {
    attendance: document.getElementById('tabAttendance'),
    study:      document.getElementById('tabStudy'),
    analysis:   document.getElementById('tabAnalysis'),
  };

  tabBtns.forEach(btn => btn.addEventListener('click', () => {
    const t = btn.dataset.tab;
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    Object.entries(panels).forEach(([k, p]) => p.classList.toggle('active', k === t));
    if (t === 'study')    loadStudyLogs();
    if (t === 'analysis') loadStudentCards();
  }));

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/';
  });

  const escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // ════════════════════════════════════════════════
  // 출석 관리
  // ════════════════════════════════════════════════
  const STATUS_CYCLE  = [null, 'present', 'late', 'absent'];
  const STATUS_LABEL  = { present: '출석', absent: '결석', late: '지각' };
  const STATUS_CLASS  = { present: 'status-present', absent: 'status-absent', late: 'status-late' };

  let weekOffset   = 0;
  let allStudents  = [];
  let attendanceData = [];

  const getWeekDates = offset => {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay()+6)%7) + offset*7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday); d.setDate(monday.getDate() + i);
      return d.toISOString().split('T')[0];
    });
  };

  const formatDateKr = iso => {
    const d = new Date(iso+'T12:00:00');
    const days = ['일','월','화','수','목','금','토'];
    return `${d.getMonth()+1}/${d.getDate()}(${days[d.getDay()]})`;
  };

  const isToday = iso => iso === new Date().toISOString().split('T')[0];

  const renderWeekLabel = () => {
    const dates = getWeekDates(weekOffset);
    document.getElementById('weekLabel').textContent = `${dates[0].slice(5).replace('-','/')} ~ ${dates[6].slice(5).replace('-','/')}`;
  };

  const renderAttendanceTable = () => {
    const dates = getWeekDates(weekOffset);
    const thead = document.getElementById('attendanceHead');
    const tbody = document.getElementById('attendanceBody');

    thead.innerHTML = `<tr>
      <th class="att-name-col">이름</th>
      ${dates.map(d => `<th class="${isToday(d)?'att-today':''}">${formatDateKr(d)}</th>`).join('')}
    </tr>`;

    tbody.innerHTML = allStudents.map(student => `
      <tr>
        <td class="att-name-cell">
          <span class="att-name">${escHtml(student.name)}</span>
          <span class="att-grade">${escHtml(student.grade||'')}</span>
        </td>
        ${dates.map(date => {
          const rec = attendanceData.find(a => a.studentId === student.id && a.date === date);
          const status = rec?.status || '';
          return `<td class="att-cell ${isToday(date)?'att-today':''}">
            <button class="att-btn ${STATUS_CLASS[status]||'status-none'}" data-sid="${student.id}" data-date="${date}" data-status="${status}" title="${STATUS_LABEL[status]||'미체크'}">${STATUS_LABEL[status]||''}</button>
          </td>`;
        }).join('')}
      </tr>
    `).join('');

    tbody.querySelectorAll('.att-btn').forEach(btn => btn.addEventListener('click', () => toggleAttendance(btn)));
  };

  const toggleAttendance = async btn => {
    const { sid, date } = btn.dataset;
    const cur = btn.dataset.status || '';
    const idx = STATUS_CYCLE.indexOf(cur);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];

    btn.dataset.status = next || '';
    btn.className = `att-btn ${STATUS_CLASS[next] || 'status-none'}`;
    btn.textContent = STATUS_LABEL[next] || '';

    try {
      await fetch('/api/admin/attendance', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ studentId: sid, date, status: next }),
      });
      const rec = attendanceData.find(a => a.studentId === sid && a.date === date);
      if (rec) { if (next) rec.status = next; else attendanceData = attendanceData.filter(a => !(a.studentId===sid && a.date===date)); }
      else if (next) attendanceData.push({ studentId: sid, date, status: next });
    } catch { alert('저장 실패'); }
  };

  document.getElementById('weekPrev').addEventListener('click', () => { weekOffset--; renderWeekLabel(); renderAttendanceTable(); });
  document.getElementById('weekNext').addEventListener('click', () => { weekOffset++; renderWeekLabel(); renderAttendanceTable(); });
  document.getElementById('todayBtn').addEventListener('click', () => { weekOffset = 0; renderWeekLabel(); renderAttendanceTable(); });

  document.getElementById('exportExcel').addEventListener('click', () => {
    window.location.href = '/api/admin/attendance/export';
  });

  document.getElementById('importExcel').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const form = new FormData(); form.append('file', file);
    const msg = document.getElementById('importMsg');
    msg.textContent = '가져오는 중...'; msg.style.color = 'var(--gray-3)';
    try {
      const res  = await fetch('/api/admin/attendance/import', { method: 'POST', body: form });
      const data = await res.json();
      msg.textContent = res.ok ? `✅ ${data.message}` : `❌ ${data.error}`;
      msg.style.color = res.ok ? 'var(--green)' : 'var(--red)';
      if (res.ok) { attendanceData = await (await fetch('/api/admin/attendance')).json(); renderAttendanceTable(); }
    } catch { msg.textContent = '❌ 오류 발생'; msg.style.color = 'var(--red)'; }
    e.target.value = '';
  });

  // ════════════════════════════════════════════════
  // 학습 현황
  // ════════════════════════════════════════════════
  const SUBJECT_COLORS = { '수학':'#0064FF','영어':'#00B493','국어':'#FF6B35','과학':'#8B5CF6','사회':'#F59E0B','역사':'#EF4444','물리':'#3B82F6','화학':'#10B981','생물':'#6366F1','지구과학':'#0891B2','기타':'#6B7280' };

  const loadStudyLogs = async () => {
    const filter = document.getElementById('studyStudentFilter').value;
    const url = filter ? `/api/admin/study-logs?studentId=${filter}` : '/api/admin/study-logs';
    try {
      const logs = await (await fetch(url)).json();

      // 학생별 요약
      const summaryMap = {};
      logs.forEach(l => {
        if (!summaryMap[l.studentId]) summaryMap[l.studentId] = { name: l.studentName, grade: l.grade, total: 0, subjects: {} };
        summaryMap[l.studentId].total += l.estimatedHours;
        summaryMap[l.studentId].subjects[l.subject] = (summaryMap[l.studentId].subjects[l.subject] || 0) + l.estimatedHours;
      });

      const cardsEl = document.getElementById('studySummaryCards');
      const entries = Object.values(summaryMap);
      if (!entries.length) { cardsEl.innerHTML = '<p class="empty-text">학습 기록이 없습니다.</p>'; }
      else {
        cardsEl.innerHTML = entries.map(s => `
          <div class="summary-card">
            <div class="summary-card-top">
              <span class="summary-avatar">${s.name.charAt(0)}</span>
              <div>
                <p class="summary-name">${escHtml(s.name)}</p>
                <p class="summary-grade">${escHtml(s.grade||'')}</p>
              </div>
              <span class="summary-total">${s.total}h</span>
            </div>
            <div class="summary-subjects">
              ${Object.entries(s.subjects).sort((a,b)=>b[1]-a[1]).map(([subj,h])=>`
                <span class="subject-badge" style="background:${SUBJECT_COLORS[subj]||'#6B7280'}20;color:${SUBJECT_COLORS[subj]||'#6B7280'}">${subj} ${h}h</span>
              `).join('')}
            </div>
          </div>
        `).join('');
      }

      // 상세 로그
      const listEl = document.getElementById('studyLogList');
      if (!logs.length) { listEl.innerHTML = '<p class="empty-text">학습 인증 기록이 없습니다.</p>'; return; }
      listEl.innerHTML = logs.map(log => `
        <div class="study-log-item">
          ${log.imagePath ? `<img class="study-log-thumb" src="${log.imagePath}" alt="학습" onerror="this.style.display='none'" />` : '<div class="study-log-thumb study-log-thumb--empty">📝</div>'}
          <div class="study-log-info">
            <div class="study-log-top">
              <strong class="study-log-student">${escHtml(log.studentName)}</strong>
              <span class="subject-badge" style="background:${SUBJECT_COLORS[log.subject]||'#6B7280'}20;color:${SUBJECT_COLORS[log.subject]||'#6B7280'}">${log.subject}</span>
              <span class="study-log-hours">${log.estimatedHours}h</span>
            </div>
            <p class="study-log-summary">${escHtml(log.summary)}</p>
            <p class="study-log-date">${log.date}</p>
          </div>
        </div>
      `).join('');
    } catch (err) { console.error(err); }
  };

  document.getElementById('refreshStudyBtn').addEventListener('click', loadStudyLogs);
  document.getElementById('studyStudentFilter').addEventListener('change', loadStudyLogs);

  // ════════════════════════════════════════════════
  // 장단점 분석
  // ════════════════════════════════════════════════
  let selectedStudentId = null;

  const renderMd = text => {
    let h = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    h = h.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
    h = h.split('\n\n').map(b => b.startsWith('<') ? b : `<p>${b.replace(/\n/g,'<br>')}</p>`).join('');
    return h;
  };

  const loadStudentCards = () => {
    const grid = document.getElementById('studentSelectGrid');
    if (!allStudents.length) { grid.innerHTML = '<p class="empty-text">등록된 학생이 없습니다.</p>'; return; }
    grid.innerHTML = allStudents.map(s => `
      <button class="student-select-card ${selectedStudentId===s.id?'selected':''}" data-id="${s.id}">
        <div class="select-card-avatar">${s.name.charAt(0)}</div>
        <p class="select-card-name">${escHtml(s.name)}</p>
        <p class="select-card-grade">${escHtml(s.grade||'')}</p>
      </button>
    `).join('');
    grid.querySelectorAll('.student-select-card').forEach(card => card.addEventListener('click', () => selectStudent(card.dataset.id)));
  };

  const selectStudent = async studentId => {
    selectedStudentId = studentId;
    loadStudentCards();
    await runAnalysis(studentId);
  };

  const runAnalysis = async studentId => {
    const panel = document.getElementById('analysisResultPanel');
    const loading = document.getElementById('analysisLoading');
    panel.style.display = 'none'; loading.style.display = '';

    try {
      const res  = await fetch(`/api/admin/analysis/${studentId}`);
      const data = await res.json();
      loading.style.display = 'none';

      if (!res.ok) { alert(data.error); return; }

      document.getElementById('analysisStudentName').textContent = `${data.studentName}${data.grade ? ` (${data.grade})` : ''}`;
      document.getElementById('analysisGeneratedAt').textContent = `분석 시각: ${new Date(data.generatedAt).toLocaleString('ko-KR')}`;
      document.getElementById('analysisContent').innerHTML = renderMd(data.analysis);
      panel.style.display = '';
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      loading.style.display = 'none';
      alert('분석 중 오류가 발생했습니다.');
    }
  };

  document.getElementById('reAnalyzeBtn').addEventListener('click', () => {
    if (selectedStudentId) runAnalysis(selectedStudentId);
  });

  // ════════════════════════════════════════════════
  // 초기화
  // ════════════════════════════════════════════════
  (async () => {
    try {
      const meRes = await fetch('/api/me');
      if (!meRes.ok) { window.location.href = '/'; return; }
      const me = await meRes.json();
      if (!me.isAdmin) { window.location.href = '/chat'; return; }
      document.getElementById('adminName').textContent = `${me.name} ${me.title||'원장'}`;

      // 학생 목록 로드
      const [students, attendance] = await Promise.all([
        fetch('/api/admin/students').then(r=>r.json()),
        fetch('/api/admin/attendance').then(r=>r.json()),
      ]);
      allStudents = students; attendanceData = attendance;

      // 학습현황 필터 채우기
      const filter = document.getElementById('studyStudentFilter');
      students.forEach(s => {
        const o = document.createElement('option');
        o.value = s.id; o.textContent = `${s.name} (${s.grade||''})`;
        filter.appendChild(o);
      });

      renderWeekLabel();
      renderAttendanceTable();
    } catch (err) { console.error(err); window.location.href = '/'; }
  })();
})();
