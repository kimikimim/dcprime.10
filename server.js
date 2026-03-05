require('dotenv').config();
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const bcrypt = require('bcryptjs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Low, JSONFile } = require('lowdb');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const app = express();

// ── 디렉터리 초기화 ───────────────────────────────────────────
const DB_DIR       = path.join(__dirname, 'database');
const LOCAL_UPLOADS = path.join(__dirname, 'public', 'uploads');
const SESSIONS_DIR = path.join(DB_DIR, 'sessions');

// NAS 경로가 .env에 설정되어 있으면 그쪽으로, 아니면 로컬
const NAS_PATH   = process.env.NAS_UPLOAD_PATH ? process.env.NAS_UPLOAD_PATH.trim() : '';
const UPLOADS_DIR = NAS_PATH || LOCAL_UPLOADS;

[DB_DIR, LOCAL_UPLOADS, SESSIONS_DIR].forEach(d => !fs.existsSync(d) && fs.mkdirSync(d, { recursive: true }));

// NAS 경로가 있으면 접근 가능한지 확인
if (NAS_PATH) {
  try {
    fs.mkdirSync(NAS_PATH, { recursive: true });
    console.log(`📁 NAS 업로드 경로: ${NAS_PATH}`);
  } catch (err) {
    console.error(`⚠️  NAS 경로 접근 실패 (${NAS_PATH}): ${err.message}`);
    console.error('   → 로컬 경로로 폴백합니다.');
  }
}

// ── lowdb ─────────────────────────────────────────────────────
const db = new Low(new JSONFile(path.join(DB_DIR, 'data.json')));

async function initDB() {
  await db.read();
  db.data ??= {};
  db.data.admin ??= null;
  db.data.students ??= [];
  db.data.messages ??= [];
  db.data.attendance ??= [];
  db.data.studyLogs ??= [];
  await db.write();
}

// ── multer (이미지 업로드) ─────────────────────────────────────
const imgStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    // NAS가 살아있으면 NAS로, 죽어있으면 로컬로
    const dest = (NAS_PATH && fs.existsSync(NAS_PATH)) ? NAS_PATH : LOCAL_UPLOADS;
    cb(null, dest);
  },
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const uploadImg = multer({
  storage: imgStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    cb(null, ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif'].includes(file.mimetype)),
});

const uploadExcel = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── 미들웨어 ──────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  store: new FileStore({ path: SESSIONS_DIR, ttl: 28800, retries: 0 }),
  secret: process.env.SESSION_SECRET || 'dcprime-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 },
}));

const requireAuth  = (req, res, next) => req.session.userId  ? next() : res.status(401).json({ error: '로그인이 필요합니다.' });
const requireAdmin = (req, res, next) => req.session.isAdmin ? next() : res.status(403).json({ error: '원장 권한이 필요합니다.' });

// ─────────────────────────────────────────────────────────────
// 인증 API
// ─────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: '비밀번호를 입력해주세요.' });

  await db.read();

  // 원장 확인
  if (db.data.admin) {
    const match = await bcrypt.compare(password, db.data.admin.passwordHash);
    if (match) {
      req.session.userId = db.data.admin.id;
      req.session.userName = db.data.admin.name;
      req.session.isAdmin = true;
      return res.json({ success: true, name: db.data.admin.name, title: db.data.admin.title, isAdmin: true });
    }
  }

  // 학생 확인
  for (const s of db.data.students) {
    const match = await bcrypt.compare(password, s.passwordHash);
    if (match) {
      req.session.userId = s.id;
      req.session.userName = s.name;
      req.session.isAdmin = false;
      return res.json({ success: true, name: s.name, isAdmin: false });
    }
  }

  return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));

app.get('/api/me', requireAuth, async (req, res) => {
  await db.read();
  if (req.session.isAdmin) {
    const { passwordHash, ...safe } = db.data.admin;
    return res.json({ ...safe, isAdmin: true });
  }
  const s = db.data.students.find(s => s.id === req.session.userId);
  if (!s) return res.status(404).json({ error: '정보를 찾을 수 없습니다.' });
  const { passwordHash, ...safe } = s;
  res.json({ ...safe, isAdmin: false });
});

// ─────────────────────────────────────────────────────────────
// 채팅 API (학생 전용)
// ─────────────────────────────────────────────────────────────
app.get('/api/messages', requireAuth, async (req, res) => {
  await db.read();
  res.json(
    db.data.messages
      .filter(m => m.studentId === req.session.userId)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
  );
});

app.delete('/api/messages', requireAuth, async (req, res) => {
  await db.read();
  db.data.messages = db.data.messages.filter(m => m.studentId !== req.session.userId);
  await db.write();
  res.json({ success: true });
});

app.post('/api/chat', requireAuth, async (req, res) => {
  if (req.session.isAdmin) return res.status(403).json({ error: '원장은 학생 채팅을 사용할 수 없습니다.' });
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: '메시지를 입력해주세요.' });

  await db.read();
  const student = db.data.students.find(s => s.id === req.session.userId);
  if (!student) return res.status(404).json({ error: '학생 정보를 찾을 수 없습니다.' });

  const userMsg = { id: uuidv4(), studentId: req.session.userId, role: 'user', content: message.trim(), createdAt: new Date().toISOString() };
  db.data.messages.push(userMsg);
  await db.write();

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const systemPrompt = student.systemPrompt || `당신은 DC Prime 학원의 ${student.name} 학생(${student.grade || ''})을 위한 개인 AI 학습 어시스턴트입니다.
학생 특성: ${student.studentInfo || '정보 없음'}

역할:
- 학생의 학습 상황을 분석하고 맞춤형 피드백을 제공합니다.
- 질문에 친절하고 명확하게 답변합니다.
- 학생의 강점을 살리고 약점을 보완할 수 있도록 격려합니다.
- 한국어로 대화하며, 학생 눈높이에 맞는 설명을 합니다.`;

    const history = db.data.messages
      .filter(m => m.studentId === req.session.userId)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .slice(-31, -1)
      .map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));

    while (history.length && history[0].role === 'model') history.shift();

    const chat = model.startChat({ history, systemInstruction: systemPrompt });
    const result = await chat.sendMessage(message.trim());
    const aiResponse = result.response.text();

    db.data.messages.push({ id: uuidv4(), studentId: req.session.userId, role: 'assistant', content: aiResponse, createdAt: new Date().toISOString() });
    await db.write();
    res.json({ response: aiResponse });
  } catch (err) {
    console.error('Gemini 오류:', err.message);
    db.data.messages = db.data.messages.filter(m => m.id !== userMsg.id);
    await db.write();
    res.status(500).json({ error: 'AI 응답 생성 중 오류가 발생했습니다.' });
  }
});

// ─────────────────────────────────────────────────────────────
// 학습 인증 (OCR) API — 학생 전용
// ─────────────────────────────────────────────────────────────
app.post('/api/study/analyze', requireAuth, uploadImg.single('image'), async (req, res) => {
  if (req.session.isAdmin) return res.status(403).json({ error: '학생 전용 기능입니다.' });
  if (!req.file) return res.status(400).json({ error: '이미지를 업로드해주세요.' });

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const base64 = fs.readFileSync(req.file.path).toString('base64');
    const prompt = `학습 사진을 분석해주세요. 공책, 교재, 문제지, 필기, 화면 등 학습 관련 이미지입니다.

반드시 다음 JSON 형식으로만 응답하세요 (마크다운 없이 순수 JSON):
{
  "subject": "과목명 (수학/영어/국어/과학/사회/역사/물리/화학/생물/지구과학/기타 중 하나)",
  "estimatedHours": 숫자 (0.5 단위, 예: 0.5, 1, 1.5, 2),
  "summary": "학습 내용 요약 (2-3문장)",
  "feedback": "격려 메시지 + 학습 팁 (1-2문장)"
}`;

    const result = await model.generateContent([
      { inlineData: { mimeType: req.file.mimetype.replace('heic', 'jpeg'), data: base64 } },
      { text: prompt },
    ]);

    const text = result.response.text().trim();
    let analysis;
    try {
      const m = text.match(/\{[\s\S]*\}/);
      analysis = JSON.parse(m ? m[0] : text);
    } catch {
      analysis = { subject: '기타', estimatedHours: 1, summary: text.slice(0, 200), feedback: '열심히 공부했어요!' };
    }

    res.json({ success: true, imagePath: `/uploads/${req.file.filename}`, analysis });
  } catch (err) {
    console.error('OCR 오류:', err.message);
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: 'AI 분석 중 오류가 발생했습니다.' });
  }
});

app.post('/api/study/save', requireAuth, async (req, res) => {
  if (req.session.isAdmin) return res.status(403).json({ error: '학생 전용 기능입니다.' });
  const { imagePath, subject, estimatedHours, summary, feedback } = req.body;
  if (!subject) return res.status(400).json({ error: '과목 정보가 필요합니다.' });

  await db.read();
  db.data.studyLogs.push({
    id: uuidv4(),
    studentId: req.session.userId,
    date: new Date().toISOString().split('T')[0],
    imagePath: imagePath || null,
    subject,
    estimatedHours: parseFloat(estimatedHours) || 1,
    summary: summary || '',
    feedback: feedback || '',
    createdAt: new Date().toISOString(),
  });
  await db.write();
  res.json({ success: true });
});

app.get('/api/study/logs/me', requireAuth, async (req, res) => {
  await db.read();
  res.json(
    db.data.studyLogs
      .filter(l => l.studentId === req.session.userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  );
});

// ─────────────────────────────────────────────────────────────
// 원장 API
// ─────────────────────────────────────────────────────────────

// 학생 목록
app.get('/api/admin/students', requireAuth, requireAdmin, async (req, res) => {
  await db.read();
  res.json(db.data.students.map(({ passwordHash, ...s }) => s));
});

// ── 출석 ──────────────────────────────────────────────────────
app.get('/api/admin/attendance', requireAuth, requireAdmin, async (req, res) => {
  await db.read();
  res.json(db.data.attendance);
});

app.post('/api/admin/attendance', requireAuth, requireAdmin, async (req, res) => {
  const { studentId, date, status } = req.body;
  if (!studentId || !date) return res.status(400).json({ error: '필수 값 누락' });

  await db.read();
  const rec = db.data.attendance.find(a => a.studentId === studentId && a.date === date);
  if (rec) {
    if (status) { rec.status = status; rec.updatedAt = new Date().toISOString(); }
    else db.data.attendance = db.data.attendance.filter(a => !(a.studentId === studentId && a.date === date));
  } else if (status) {
    db.data.attendance.push({ id: uuidv4(), studentId, date, status, createdAt: new Date().toISOString() });
  }
  await db.write();
  res.json({ success: true });
});

// ── 출석 엑셀 내보내기 ────────────────────────────────────────
app.get('/api/admin/attendance/export', requireAuth, requireAdmin, async (req, res) => {
  await db.read();
  const { students, attendance } = db.data;
  const statusKr = { present: '출석', absent: '결석', late: '지각' };

  const days = parseInt(req.query.days || '30', 10);
  const dates = Array.from({ length: days }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (days - 1 - i));
    return d.toISOString().split('T')[0];
  });

  const header = ['이름', '학년', ...dates];
  const rows = [header, ...students.map(s => [
    s.name, s.grade || '',
    ...dates.map(date => {
      const r = attendance.find(a => a.studentId === s.id && a.date === date);
      return statusKr[r?.status] || '';
    }),
  ])];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 10 }, { wch: 5 }, ...dates.map(() => ({ wch: 8 }))];
  XLSX.utils.book_append_sheet(wb, ws, '출석부');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fn = encodeURIComponent(`출석부_${new Date().toISOString().split('T')[0]}.xlsx`);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fn}`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ── 출석 엑셀 가져오기 ────────────────────────────────────────
app.post('/api/admin/attendance/import', requireAuth, requireAdmin, uploadExcel.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일을 업로드해주세요.' });

  try {
    await db.read();
    const { students } = db.data;
    const statusEn = { '출석': 'present', '결석': 'absent', '지각': 'late' };

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    if (rows.length < 2) return res.status(400).json({ error: '올바른 형식이 아닙니다.' });

    const dates = rows[0].slice(2);
    let count = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const student = students.find(s => s.name === row[0]);
      if (!student) continue;

      for (let j = 0; j < dates.length; j++) {
        const date = String(dates[j]);
        const status = statusEn[row[j + 2]];
        if (!status || !date.match(/^\d{4}-\d{2}-\d{2}$/)) continue;

        const rec = db.data.attendance.find(a => a.studentId === student.id && a.date === date);
        if (rec) { rec.status = status; rec.updatedAt = new Date().toISOString(); }
        else db.data.attendance.push({ id: uuidv4(), studentId: student.id, date, status, createdAt: new Date().toISOString() });
        count++;
      }
    }
    await db.write();
    res.json({ success: true, message: `${count}개의 출석 기록을 업데이트했습니다.` });
  } catch (err) {
    console.error('엑셀 가져오기 오류:', err);
    res.status(500).json({ error: '파일 처리 중 오류가 발생했습니다.' });
  }
});

// ── 학습 현황 (원장) ──────────────────────────────────────────
app.get('/api/admin/study-logs', requireAuth, requireAdmin, async (req, res) => {
  await db.read();
  const { studentId } = req.query;
  let logs = studentId ? db.data.studyLogs.filter(l => l.studentId === studentId) : db.data.studyLogs;
  const nameMap = Object.fromEntries(db.data.students.map(s => [s.id, { name: s.name, grade: s.grade }]));
  res.json(
    logs
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(l => ({ ...l, studentName: nameMap[l.studentId]?.name || '?', grade: nameMap[l.studentId]?.grade || '' }))
  );
});

// ── 장단점 AI 분석 (원장) ─────────────────────────────────────
app.get('/api/admin/analysis/:studentId', requireAuth, requireAdmin, async (req, res) => {
  await db.read();
  const { studentId } = req.params;
  const student = db.data.students.find(s => s.id === studentId);
  if (!student) return res.status(404).json({ error: '학생을 찾을 수 없습니다.' });

  const studyLogs = db.data.studyLogs.filter(l => l.studentId === studentId);
  const messages = db.data.messages.filter(m => m.studentId === studentId);
  if (!studyLogs.length && !messages.length) {
    return res.status(400).json({ error: '분석할 데이터가 없습니다. 학습 인증 또는 채팅 기록이 필요합니다.' });
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const subjectHours = {};
    studyLogs.forEach(l => { subjectHours[l.subject] = (subjectHours[l.subject] || 0) + l.estimatedHours; });
    const subjectSummary = Object.entries(subjectHours).map(([s, h]) => `  - ${s}: ${h}시간`).join('\n') || '  없음';

    const recentLogs = studyLogs.slice(-5).map(l => `  - ${l.date} [${l.subject} ${l.estimatedHours}h] ${l.summary}`).join('\n') || '  없음';
    const recentChat = messages
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 15)
      .map(m => `  [${m.role === 'user' ? '학생' : 'AI'}] ${m.content.slice(0, 100)}`)
      .join('\n') || '  없음';

    const prompt = `DC Prime 학원 ${student.name} 학생(${student.grade || ''}) 분석 보고서를 작성해주세요.

[기본 정보]
${student.studentInfo || '없음'}

[과목별 누적 학습 시간]
${subjectSummary}

[최근 학습 인증 내역]
${recentLogs}

[최근 AI 대화]
${recentChat}

위 데이터를 바탕으로 **원장 선생님을 위한 분석 보고서**를 아래 형식으로 작성해주세요:

## 📊 전반적 학습 현황
(노력도, 학습 패턴, 전반적인 평가)

## 💪 강점 3가지
각 강점에 근거와 구체적 사례 포함

## 📈 개선 필요 사항 3가지
각 사항에 실현 가능한 개선 방법 포함

## 🎯 맞춤 학습 전략
이 학생에게 효과적인 공부법과 접근 방식 제안

## 💬 지도 시 주의사항
원장/강사가 특별히 신경써야 할 포인트`;

    const result = await model.generateContent(prompt);
    res.json({ studentName: student.name, grade: student.grade, analysis: result.response.text(), generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('AI 분석 오류:', err.message);
    res.status(500).json({ error: 'AI 분석 중 오류가 발생했습니다.' });
  }
});

// ─────────────────────────────────────────────────────────────
// 업로드 파일 서빙 (NAS 경로도 웹에서 접근 가능하도록)
// ─────────────────────────────────────────────────────────────
app.get('/uploads/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // path traversal 방지
  // NAS 먼저 확인, 없으면 로컬
  const nasFile   = NAS_PATH ? path.join(NAS_PATH, filename) : null;
  const localFile = path.join(LOCAL_UPLOADS, filename);

  if (nasFile && fs.existsSync(nasFile)) return res.sendFile(nasFile);
  if (fs.existsSync(localFile))          return res.sendFile(localFile);
  res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
});

// ─────────────────────────────────────────────────────────────
// 페이지 라우팅
// ─────────────────────────────────────────────────────────────
app.get('/chat', (req, res) => {
  if (!req.session.userId) return res.redirect('/');
  if (req.session.isAdmin) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

app.get('/admin', (req, res) => {
  if (!req.session.userId) return res.redirect('/');
  if (!req.session.isAdmin) return res.redirect('/chat');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ─────────────────────────────────────────────────────────────
async function start() {
  await initDB();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`\n🚀 DC Prime  →  http://localhost:${PORT}\n`));
}
start();
