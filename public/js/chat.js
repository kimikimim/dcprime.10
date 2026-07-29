(() => {
  // ── 탭 전환 ─────────────────────────────────────────────
  const tabBtns  = document.querySelectorAll('.tab-btn');
  const tabPanels = { chat: document.getElementById('tabChat'), study: document.getElementById('tabStudy'), timetable: document.getElementById('tabTimetable'), goals: document.getElementById('tabGoals'), leave: document.getElementById('tabLeave'), reports: document.getElementById('tabReports') };

  tabBtns.forEach(btn => btn.addEventListener('click', () => {
    const t = btn.dataset.tab;
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    Object.entries(tabPanels).forEach(([k, p]) => p && p.classList.toggle('active', k === t));
    if (t === 'study') loadStudyLogs();
    if (t === 'goals') loadGoals();
    if (t === 'reports') loadReports();
    if (t === 'leave') loadLeave();
  }));

  // ══════════════════════════════════════════════
  // 오늘의 목표 (계획 → 체크 → 이행률)
  // ══════════════════════════════════════════════
  const glTodayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

  async function loadGoals() {
    const me = window.session.get();
    const sb = window.sb;
    const today = glTodayStr();
    const dateEl = document.getElementById('glDate');
    if (dateEl) { const d = new Date(); dateEl.textContent = `${today} (${['일','월','화','수','목','금','토'][d.getDay()]})`; }
    const { data: goals } = await sb.from('goals').select('*')
      .eq('student_id', me.sid).eq('date', today).order('sort_order').order('created_at');
    renderGoals(goals || []);
  }

  function renderGoals(goals) {
    const list = document.getElementById('glList');
    const done = goals.filter(g => g.done).length;
    const rate = goals.length ? Math.round(done / goals.length * 100) : 0;
    document.getElementById('glBarFill').style.width = rate + '%';
    document.getElementById('glRate').textContent = rate + '%';
    if (!goals.length) { list.innerHTML = '<p class="empty-text">오늘의 목표를 추가해보세요.</p>'; return; }
    list.innerHTML = goals.map(g => `
      <div class="gl-item">
        <div class="gl-check ${g.done?'done':''}" data-id="${g.id}" data-done="${g.done?1:0}">${g.done?'✓':''}</div>
        <span class="gl-text ${g.done?'done':''}">${escHtml(g.text)}</span>
        <button class="gl-del" data-id="${g.id}">삭제</button>
      </div>`).join('');
    list.querySelectorAll('.gl-check').forEach(c => c.addEventListener('click', async () => {
      await window.sb.from('goals').update({ done: c.dataset.done === '0' }).eq('id', c.dataset.id);
      loadGoals();
    }));
    list.querySelectorAll('.gl-del').forEach(b => b.addEventListener('click', async () => {
      await window.sb.from('goals').delete().eq('id', b.dataset.id);
      loadGoals();
    }));
  }

  async function addGoal() {
    const input = document.getElementById('glInput');
    const text = input.value.trim();
    if (!text) return;
    const me = window.session.get();
    input.value = '';
    await window.sb.from('goals').insert({ student_id: me.sid, date: glTodayStr(), text });
    loadGoals();
  }
  document.getElementById('glAddBtn')?.addEventListener('click', addGoal);
  document.getElementById('glInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') addGoal(); });

  // ── 공통 ─────────────────────────────────────────────────
  const escHtml = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const renderMd = text => {
    let h = escHtml(text);
    h = h.replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
    h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    h = h.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
    h = h.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    h = h.split('\n\n').map(b => b.startsWith('<') ? b : `<p>${b.replace(/\n/g,'<br>')}</p>`).join('');
    return h;
  };

  const fmtTime = d => {
    const h = d.getHours(), m = String(d.getMinutes()).padStart(2,'0');
    return `${h<12?'오전':'오후'} ${h%12||12}:${m}`;
  };

  // ══════════════════════════════════════════════
  // 채팅 탭
  // ══════════════════════════════════════════════
  const chatMain     = document.getElementById('chatMain');
  const msgList      = document.getElementById('messagesList');
  const welcomeCard  = document.getElementById('welcomeCard');
  const welcomeName  = document.getElementById('welcomeName');
  const welcomeAvatar= document.getElementById('welcomeAvatar');
  const headerName   = document.getElementById('headerName');
  const headerGrade  = document.getElementById('headerGrade');
  const chatInput    = document.getElementById('chatInput');
  const sendBtn      = document.getElementById('sendBtn');
  const typingInd    = document.getElementById('typingIndicator');
  const clearBtn     = document.getElementById('clearBtn');
  const logoutBtn    = document.getElementById('logoutBtn');
  const clearModal   = document.getElementById('clearModal');
  const clearCancel  = document.getElementById('clearCancel');
  const clearConfirm = document.getElementById('clearConfirm');

  let isSending = false;

  const scrollBottom = (smooth=true) => requestAnimationFrame(() =>
    chatMain.scrollTo({ top: chatMain.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  );

  const appendMsg = (role, content, date=new Date(), animate=true) => {
    welcomeCard.style.display = 'none';
    const row = document.createElement('div');
    row.className = `msg-row ${role}`;
    if (!animate) row.style.animation = 'none';
    const t = fmtTime(new Date(date));
    if (role === 'assistant') {
      row.innerHTML = `<div class="msg-avatar"><svg viewBox="0 0 28 28" fill="none"><path d="M7 9h14M7 14h10M7 19h12" stroke="white" stroke-width="2.4" stroke-linecap="round"/></svg></div><div class="msg-bubble assistant-bubble">${renderMd(content)}</div><span class="msg-time">${t}</span>`;
    } else {
      row.innerHTML = `<span class="msg-time">${t}</span><div class="msg-bubble">${escHtml(content)}</div>`;
    }
    msgList.appendChild(row);
  };

  const sendMessage = async text => {
    const content = text.trim();
    if (!content || isSending) return;
    isSending = true; sendBtn.disabled = true;
    chatInput.value = ''; chatInput.style.height = 'auto';
    appendMsg('user', content); scrollBottom();
    typingInd.classList.add('show'); scrollBottom();

    try {
      const res  = await fetch('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ message: content }) });
      const data = await res.json();
      typingInd.classList.remove('show');
      if (res.ok) appendMsg('assistant', data.response);
      else {
        const r = document.createElement('div');
        r.className = 'msg-row assistant';
        r.innerHTML = `<div class="msg-avatar"><svg viewBox="0 0 28 28" fill="none"><path d="M7 9h14M7 14h10M7 19h12" stroke="white" stroke-width="2.4" stroke-linecap="round"/></svg></div><div class="msg-bubble assistant-bubble" style="color:var(--red)">⚠️ ${escHtml(data.error)}</div>`;
        msgList.appendChild(r);
      }
    } catch {
      typingInd.classList.remove('show');
      appendMsg('assistant', '⚠️ 네트워크 오류가 발생했습니다.');
    }
    scrollBottom(); isSending = false; sendBtn.disabled = false;
  };

  chatInput.addEventListener('input', () => {
    sendBtn.disabled = !chatInput.value.trim() || isSending;
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  });
  chatInput.addEventListener('keydown', e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); if (!sendBtn.disabled) sendMessage(chatInput.value); } });
  sendBtn.addEventListener('click', () => sendMessage(chatInput.value));
  document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => sendMessage(c.dataset.msg)));

  clearBtn.addEventListener('click', () => clearModal.classList.add('show'));
  clearCancel.addEventListener('click', () => clearModal.classList.remove('show'));
  clearModal.addEventListener('click', e => { if (e.target===clearModal) clearModal.classList.remove('show'); });
  clearConfirm.addEventListener('click', async () => {
    clearModal.classList.remove('show');
    await fetch('/api/messages', { method: 'DELETE' });
    msgList.innerHTML = '';
    welcomeCard.style.display = '';
  });
  logoutBtn.addEventListener('click', async () => { await fetch('/api/logout',{method:'POST'}); window.location.href='/'; });

  // ══════════════════════════════════════════════
  // 학습 인증 탭
  // ══════════════════════════════════════════════
  const uploadArea        = document.getElementById('uploadArea');
  const fileInput         = document.getElementById('studyFileInput');
  const uploadPlaceholder = document.getElementById('uploadPlaceholder');
  const uploadPreview     = document.getElementById('uploadPreview');
  const changeImgBtn      = document.getElementById('changeImageBtn');
  const saveStudyBtn      = document.getElementById('saveStudyBtn');
  const saveBtnText       = document.getElementById('saveBtnText');
  const saveSpinner       = document.getElementById('saveSpinner');
  const studyFormError    = document.getElementById('studyFormError');
  const studySubject      = document.getElementById('studySubject');
  const studyHoursInput   = document.getElementById('studyHours');
  const studyMemo         = document.getElementById('studyMemo');

  let currentFile = null;

  // 사진 업로드
  uploadArea.addEventListener('click', () => { if (!currentFile) fileInput.click(); });
  uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
  uploadArea.addEventListener('drop', e => {
    e.preventDefault(); uploadArea.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) setFile(f);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });
  changeImgBtn.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });

  const setFile = file => {
    currentFile = file;
    const reader = new FileReader();
    reader.onload = ev => {
      uploadPreview.src = ev.target.result;
      uploadPreview.style.display = 'block';
      uploadPlaceholder.style.display = 'none';
      changeImgBtn.style.display = '';
    };
    reader.readAsDataURL(file);
  };

  // 시간 칩 선택
  document.querySelectorAll('.hours-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.hours-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      studyHoursInput.value = chip.dataset.value;
    });
  });

  // 저장
  saveStudyBtn.addEventListener('click', async () => {
    studyFormError.textContent = '';
    const subject = studySubject.value;
    const hours   = studyHoursInput.value;

    if (!subject) { studyFormError.textContent = '과목을 선택해주세요.'; return; }
    if (!hours)   { studyFormError.textContent = '학습 시간을 선택해주세요.'; return; }

    saveBtnText.textContent = '저장 중...';
    saveSpinner.style.display = '';
    saveStudyBtn.disabled = true;

    try {
      const me = window.session.get();
      const sb = window.sb;
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

      let image_path = null;
      if (currentFile) {
        if (!currentFile.size) {
          throw new Error('사진을 불러오지 못했어요. 아이폰이면 사진이 iCloud에서 완전히 다운로드된 후 다시 선택해주세요.');
        }
        const ext = (currentFile.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${me.sid}/${Date.now()}.${ext}`;
        const { error: upErr } = await sb.storage.from('ten-uploads').upload(path, currentFile, { upsert: true, contentType: currentFile.type });
        if (upErr) throw new Error('사진 업로드 실패: ' + upErr.message);
        image_path = sb.storage.from('ten-uploads').getPublicUrl(path).data.publicUrl;
      }

      const { error } = await sb.from('study_logs').insert({
        student_id: me.sid, date: today, image_path,
        subject, estimated_hours: parseFloat(hours) || 1, summary: studyMemo.value || '',
      });
      if (error) throw new Error(error.message);

      // 폼 초기화
      currentFile = null;
      fileInput.value = '';
      uploadPreview.src = ''; uploadPreview.style.display = 'none';
      uploadPlaceholder.style.display = ''; changeImgBtn.style.display = 'none';
      studySubject.value = '';
      studyHoursInput.value = '';
      document.querySelectorAll('.hours-chip').forEach(c => c.classList.remove('active'));
      studyMemo.value = '';

      loadStudyLogs();
      showStudyToast('학습 인증이 저장되었습니다!');
    } catch (err) {
      studyFormError.textContent = '저장 실패: ' + err.message;
    } finally {
      saveBtnText.textContent = '저장하기';
      saveSpinner.style.display = 'none';
      saveStudyBtn.disabled = false;
    }
  });

  const showStudyToast = msg => {
    const t = document.createElement('div');
    t.className = 'study-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2500);
  };

  const loadStudyLogs = async () => {
    try {
      const me = window.session.get();
      const { data: logs } = await window.sb.from('study_logs')
        .select('*').eq('student_id', me.sid).order('created_at', { ascending: false });
      const list = document.getElementById('todayLogsList');
      if (!logs || !logs.length) { list.innerHTML = '<p class="empty-text">아직 학습 인증 기록이 없어요.</p>'; return; }

      const subjectColors = { '국어':'#FF6B35','영어':'#00B493','수학':'#0064FF','과학':'#8B5CF6','사회':'#F59E0B','기타':'#6B7280' };

      list.innerHTML = logs.map(log => `
        <div class="study-log-item">
          ${log.image_path ? `<img class="study-log-thumb" src="${log.image_path}" alt="학습 사진" />` : '<div class="study-log-thumb study-log-thumb--empty"></div>'}
          <div class="study-log-info">
            <div class="study-log-top">
              <span class="subject-badge" style="background:${subjectColors[log.subject]||'#6B7280'}20;color:${subjectColors[log.subject]||'#6B7280'}">${log.subject}</span>
              <span class="study-log-hours">${log.estimated_hours}시간</span>
              <button class="del-log-btn" data-id="${log.id}" data-img="${log.image_path||''}" title="삭제"
                style="margin-left:auto;border:none;background:none;color:#e2574c;cursor:pointer;font-size:13px;font-weight:600">삭제</button>
            </div>
            <p class="study-log-summary">${escHtml(log.summary || '')}</p>
            <p class="study-log-date">${log.date} · ${fmtTime(new Date(log.created_at))}</p>
          </div>
        </div>
      `).join('');

      list.querySelectorAll('.del-log-btn').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('이 학습 인증을 삭제할까요?')) return;
        const sb = window.sb;
        const img = b.dataset.img;
        if (img && img.includes('/ten-uploads/')) {
          const path = img.split('/ten-uploads/')[1].split('?')[0];
          await sb.storage.from('ten-uploads').remove([decodeURIComponent(path)]);
        }
        await sb.from('study_logs').delete().eq('id', b.dataset.id);
        loadStudyLogs();
      }));
    } catch (e) { console.error('학습기록 로드 오류', e); }
  };

  // ══════════════════════════════════════════════
  // 지각/결석신청 탭
  // ══════════════════════════════════════════════
  const lvTodayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  let lvType = '지각';
  const lvDateInput = document.getElementById('lvDateInput');
  const lvSelectedDate = () => (lvDateInput && lvDateInput.value) || lvTodayStr();

  document.querySelectorAll('.lv-type-btn').forEach(b => b.addEventListener('click', () => {
    lvType = b.dataset.type;
    document.querySelectorAll('.lv-type-btn').forEach(x => x.classList.toggle('active', x === b));
    document.getElementById('lvLateForm').style.display = lvType === '지각' ? 'block' : 'none';
    document.getElementById('lvAbsentForm').style.display = lvType === '결석' ? 'block' : 'none';
  }));

  lvDateInput?.addEventListener('change', loadLeave);

  async function loadLeave() {
    const me = window.session.get();
    if (lvDateInput && !lvDateInput.value) lvDateInput.value = lvTodayStr();
    const date = lvSelectedDate();

    const { data } = await window.sb.from('leave_requests').select('*')
      .eq('student_id', me.sid).eq('date', date).order('created_at', { ascending: false }).limit(1);
    const statusEl = document.getElementById('lvStatus');
    if (data && data.length) {
      const r = data[0];
      statusEl.classList.add('show');
      statusEl.innerHTML = r.type === '결석'
        ? `<b>${escHtml(date)} 결석 신청 완료</b> · 사유: ${escHtml(r.reason || '-')}<br>출석 상태: <b style="color:#e2574c">인정결석</b>으로 처리되었습니다.`
        : `<b>${escHtml(date)} 지각 신청 완료</b> · 등원 예정: ${escHtml(r.arrival_time || '-')} · 사유: ${escHtml(r.reason || '-')}`;
    } else {
      statusEl.classList.remove('show');
      statusEl.innerHTML = '';
    }
  }

  document.getElementById('lvAbsentSubmit')?.addEventListener('click', async () => {
    const me = window.session.get();
    const reason = document.getElementById('lvAbsentReason').value.trim();
    const errEl = document.getElementById('lvAbsentError');
    const date = lvSelectedDate();
    if (!date) { errEl.textContent = '날짜를 선택해주세요.'; return; }
    if (!reason) { errEl.textContent = '사유를 입력해주세요.'; return; }
    errEl.textContent = '';
    await window.sb.from('leave_requests').insert({ student_id: me.sid, date, type: '결석', reason });
    await window.sb.from('attendance_overrides').upsert(
      { student_id: me.sid, date, status: 'excused', reason },
      { onConflict: 'student_id,date' }
    );
    document.getElementById('lvAbsentReason').value = '';
    await loadLeave();
  });

  document.getElementById('lvLateSubmit')?.addEventListener('click', async () => {
    const me = window.session.get();
    const time = document.getElementById('lvArrivalTime').value;
    const reason = document.getElementById('lvLateReason').value.trim();
    const errEl = document.getElementById('lvLateError');
    const date = lvSelectedDate();
    if (!date) { errEl.textContent = '날짜를 선택해주세요.'; return; }
    if (!time || !reason) { errEl.textContent = '등원 예정 시간과 사유를 모두 입력해주세요.'; return; }
    errEl.textContent = '';
    await window.sb.from('leave_requests').insert({ student_id: me.sid, date, type: '지각', reason, arrival_time: time });
    document.getElementById('lvLateReason').value = '';
    document.getElementById('lvArrivalTime').value = '';
    await loadLeave();
  });

  // ══════════════════════════════════════════════
  // 상담 리포트 탭
  // ══════════════════════════════════════════════
  const loadReports = async () => {
    const me = window.session.get();
    const list = document.getElementById('rpList');
    if (!list) return;
    list.innerHTML = '<p class="empty-text" style="text-align:center;padding-top:40px;color:#aab0bf">불러오는 중...</p>';
    try {
      const [reportsRes, consultsRes] = await Promise.all([
        window.sb.from('reports').select('id,major,content,created_at').eq('student_id', me.sid).order('created_at', { ascending: false }),
        window.sb.from('consults').select('id,date,content,strength,weakness,next_goal,counselor,created_at').eq('student_id', me.sid).order('date', { ascending: false }),
      ]);
      if (reportsRes.error) throw reportsRes.error;
      if (consultsRes.error) throw consultsRes.error;
      const reports = reportsRes.data || [];
      const consults = consultsRes.data || [];
      if (!reports.length && !consults.length) {
        list.innerHTML = '<p class="empty-text" style="text-align:center;padding-top:40px;color:#aab0bf">아직 상담 기록이 없어요.</p>';
        return;
      }

      let html = '';

      if (consults.length) {
        html += `<div class="rp-date-label" style="margin-top:0">상담 기록</div>` + consults.map(c => `
          <div class="rp-card">
            <div class="rp-card-header">
              <span class="rp-major-badge" style="background:#eef2ff;color:#6366f1">${escHtml(c.date || '')}</span>
              ${c.counselor ? `<span class="rp-time">${escHtml(c.counselor)}</span>` : ''}
            </div>
            ${c.content ? `<div style="font-size:13.5px;color:#333;line-height:1.7;white-space:pre-wrap;margin-bottom:6px"><b>내용</b> · ${escHtml(c.content)}</div>` : ''}
            ${c.strength ? `<div style="font-size:13.5px;color:#10b981;line-height:1.7;white-space:pre-wrap;margin-bottom:6px"><b>강점</b> · ${escHtml(c.strength)}</div>` : ''}
            ${c.weakness ? `<div style="font-size:13.5px;color:#e2574c;line-height:1.7;white-space:pre-wrap;margin-bottom:6px"><b>약점</b> · ${escHtml(c.weakness)}</div>` : ''}
            ${c.next_goal ? `<div style="font-size:13.5px;color:#3b82f6;line-height:1.7;white-space:pre-wrap"><b>다음 목표</b> · ${escHtml(c.next_goal)}</div>` : ''}
          </div>`).join('');
      }

      if (reports.length) {
        // 날짜별 그룹핑
        const groups = {};
        reports.forEach(r => {
          const d = r.created_at.slice(0, 10);
          (groups[d] = groups[d] || []).push(r);
        });
        html += `<div class="rp-date-label" style="margin-top:20px">AI 컨설팅 리포트</div>` +
          Object.entries(groups).map(([date, list]) => `
            <div class="rp-date-group">
              <div class="rp-date-label">${date}</div>
              ${list.map(r => {
                const t = r.created_at.slice(11, 16);
                return `<div class="rp-card">
                  <div class="rp-card-header">
                    <span class="rp-major-badge">${escHtml(r.major)}</span>
                    <span class="rp-time">${t}</span>
                  </div>
                  <div class="rp-content" id="rpc-${r.id}">${escHtml(r.content)}</div>
                  <button class="rp-expand-btn" data-id="${r.id}">더 보기</button>
                </div>`;
              }).join('')}
            </div>`).join('');
      }

      list.innerHTML = html;
      list.querySelectorAll('.rp-expand-btn').forEach(btn => {
        const content = document.getElementById('rpc-' + btn.dataset.id);
        if (content && content.scrollHeight <= content.clientHeight + 4) btn.style.display = 'none';
        btn.addEventListener('click', () => {
          const expanded = content.classList.toggle('expanded');
          btn.textContent = expanded ? '접기' : '더 보기';
        });
      });
    } catch (e) { list.innerHTML = `<p class="empty-text" style="text-align:center;padding-top:40px;color:#e2574c">오류: ${e.message}</p>`; }
  };

  // 초기화: 인증/헤더/로그아웃은 Supabase 세션(chat.html 인라인 스크립트)에서 처리.
  // (옛 Express /api/me 인증 제거 — 서버리스 전환)
})();
