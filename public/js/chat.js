(() => {
  // ── 탭 전환 ─────────────────────────────────────────────
  const tabBtns  = document.querySelectorAll('.tab-btn');
  const tabPanels = { chat: document.getElementById('tabChat'), study: document.getElementById('tabStudy') };

  tabBtns.forEach(btn => btn.addEventListener('click', () => {
    const t = btn.dataset.tab;
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    Object.entries(tabPanels).forEach(([k, p]) => p.classList.toggle('active', k === t));
    if (t === 'study') loadStudyLogs();
  }));

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

    const form = new FormData();
    if (currentFile) form.append('image', currentFile);
    form.append('subject', subject);
    form.append('hours', hours);
    form.append('memo', studyMemo.value);

    try {
      const res = await fetch('/api/study/submit', { method: 'POST', body: form });
      if (!res.ok) throw new Error((await res.json()).error);

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
      const res  = await fetch('/api/study/logs/me');
      const logs = await res.json();
      const list = document.getElementById('todayLogsList');
      if (!logs.length) { list.innerHTML = '<p class="empty-text">아직 학습 인증 기록이 없어요.</p>'; return; }

      const subjectColors = { '국어':'#FF6B35','영어':'#00B493','수학':'#0064FF','과학':'#8B5CF6','사회':'#F59E0B','기타':'#6B7280' };

      list.innerHTML = logs.map(log => `
        <div class="study-log-item">
          ${log.imagePath ? `<img class="study-log-thumb" src="${log.imagePath}" alt="학습 사진" />` : '<div class="study-log-thumb study-log-thumb--empty">📝</div>'}
          <div class="study-log-info">
            <div class="study-log-top">
              <span class="subject-badge" style="background:${subjectColors[log.subject]||'#6B7280'}20;color:${subjectColors[log.subject]||'#6B7280'}">${log.subject}</span>
              <span class="study-log-hours">${log.estimatedHours}시간</span>
            </div>
            <p class="study-log-summary">${escHtml(log.summary)}</p>
            <p class="study-log-date">${log.date} · ${fmtTime(new Date(log.createdAt))}</p>
          </div>
        </div>
      `).join('');
    } catch {}
  };

  // ══════════════════════════════════════════════
  // 초기화
  // ══════════════════════════════════════════════
  (async () => {
    try {
      const meRes = await fetch('/api/me');
      if (!meRes.ok) { window.location.href = '/'; return; }
      const me = await meRes.json();
      if (me.isAdmin) { window.location.href = '/admin'; return; }

      headerName.textContent = `${me.name} 학생`;
      headerGrade.textContent = me.grade || 'DC Prime';
      welcomeName.textContent = `안녕하세요, ${me.name} 학생!`;
      welcomeAvatar.textContent = me.name.charAt(0);

      const msgs = await (await fetch('/api/messages')).json();
      if (msgs.length) {
        welcomeCard.style.display = 'none';
        msgs.forEach(m => appendMsg(m.role, m.content, m.createdAt, false));
        scrollBottom(false);
      }
    } catch { window.location.href = '/'; }
  })();
})();
