require('dotenv').config();
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GROQ_MODEL   = process.env.GROQ_MODEL   || 'llama-3.3-70b-versatile';
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const bcrypt = require('bcryptjs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');
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
    console.log(`📁 NAS 경로: ${NAS_PATH}`);
  } catch (err) {
    console.error(`⚠️  NAS 경로 접근 실패 (${NAS_PATH}): ${err.message}`);
    console.error('   → 로컬 경로로 폴백합니다.');
  }
}

// 폴더명으로 쓸 수 없는 문자 제거 (윈도우/맥 공통)
const safeFolderName = name => (name || 'unknown').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'unknown';

// ── AI 호출 헬퍼 (Groq 우선, 없으면 Gemini) ──────────────────
// chatHistory: [{ role: 'user'|'assistant', content }]
async function callAI({ system = '', chatHistory = [], userMessage }) {
  if (process.env.GROQ_API_KEY) {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const msgs = [];
    if (system) msgs.push({ role: 'system', content: system });
    chatHistory.forEach(m => msgs.push({ role: m.role, content: m.content }));
    if (userMessage) msgs.push({ role: 'user', content: userMessage });
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: msgs,
      max_tokens: 2048,
    });
    return res.choices[0].message.content;
  } else {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL, systemInstruction: system || undefined });
    const history = chatHistory.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    while (history.length && history[0].role === 'model') history.shift();
    const chat = model.startChat({ history });
    const result = await chat.sendMessage(userMessage || '');
    return result.response.text();
  }
}

// ── lowdb ─────────────────────────────────────────────────────
const DB_FILE = path.join(DB_DIR, 'data.json');
const db = new Low(new JSONFile(DB_FILE));

// ── NAS 백업 ──────────────────────────────────────────────────
const NAS_BACKUP_DIR = NAS_PATH ? path.join(NAS_PATH, 'backup') : null;
const NAS_STATUS_FILE = NAS_BACKUP_DIR ? path.join(NAS_BACKUP_DIR, 'latest.json') : null;

async function backupToNAS() {
  if (!NAS_PATH || !NAS_BACKUP_DIR) return { success: false, reason: 'NAS 경로가 설정되지 않았습니다.' };

  try {
    fs.mkdirSync(NAS_BACKUP_DIR, { recursive: true });

    const today = new Date().toISOString().split('T')[0];
    const destFile = path.join(NAS_BACKUP_DIR, `data_${today}.json`);

    fs.copyFileSync(DB_FILE, destFile);

    const status = { backedUpAt: new Date().toISOString(), file: destFile };
    fs.writeFileSync(NAS_STATUS_FILE, JSON.stringify(status));

    // 30일 초과 백업 파일 자동 삭제
    const backups = fs.readdirSync(NAS_BACKUP_DIR)
      .filter(f => f.startsWith('data_') && f.endsWith('.json'))
      .sort();
    backups.slice(0, Math.max(0, backups.length - 30))
      .forEach(f => { try { fs.unlinkSync(path.join(NAS_BACKUP_DIR, f)); } catch {} });

    return { success: true, ...status };
  } catch (err) {
    console.error('NAS 백업 실패:', err.message);
    return { success: false, reason: err.message };
  }
}

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
    // NAS가 살아있으면 NAS/학생이름/, 아니면 로컬/학생이름/
    const studentFolder = safeFolderName(req.session.userName);
    const base = (NAS_PATH && fs.existsSync(NAS_PATH)) ? NAS_PATH : LOCAL_UPLOADS;
    const dest = path.join(base, studentFolder);
    fs.mkdirSync(dest, { recursive: true });
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
    const systemPrompt = student.systemPrompt || `당신은 DC Prime 학원의 ${student.name} 학생(${student.grade || ''})을 위한 개인 AI 학습 어시스턴트입니다.
학생 특성: ${student.studentInfo || '정보 없음'}

역할:
- 학생의 학습 상황을 분석하고 맞춤형 피드백을 제공합니다.
- 질문에 친절하고 명확하게 답변합니다.
- 학생의 강점을 살리고 약점을 보완할 수 있도록 격려합니다.
- 한국어로 대화하며, 학생 눈높이에 맞는 설명을 합니다.`;

    const chatHistory = db.data.messages
      .filter(m => m.studentId === req.session.userId)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .slice(-31, -1)
      .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));

    const aiResponse = await callAI({ system: systemPrompt, chatHistory, userMessage: message.trim() });

    db.data.messages.push({ id: uuidv4(), studentId: req.session.userId, role: 'assistant', content: aiResponse, createdAt: new Date().toISOString() });
    await db.write();
    res.json({ response: aiResponse });
  } catch (err) {
    console.error('AI 오류:', err.message);
    db.data.messages = db.data.messages.filter(m => m.id !== userMsg.id);
    await db.write();
    res.status(500).json({ error: 'AI 응답 생성 중 오류가 발생했습니다.' });
  }
});

// ─────────────────────────────────────────────────────────────
// 학습 인증 — 학생 전용 (사진 업로드 + 직접 입력)
// ─────────────────────────────────────────────────────────────
app.post('/api/study/submit', requireAuth, uploadImg.single('image'), async (req, res) => {
  if (req.session.isAdmin) return res.status(403).json({ error: '학생 전용 기능입니다.' });
  const { subject, hours, memo } = req.body;
  if (!subject) return res.status(400).json({ error: '과목을 선택해주세요.' });

  const studentFolder = safeFolderName(req.session.userName);
  const imagePath = req.file ? `/uploads/${studentFolder}/${req.file.filename}` : null;

  await db.read();
  db.data.studyLogs.push({
    id: uuidv4(),
    studentId: req.session.userId,
    date: new Date().toISOString().split('T')[0],
    imagePath,
    subject,
    estimatedHours: parseFloat(hours) || 1,
    summary: memo || '',
    feedback: '',
    createdAt: new Date().toISOString(),
  });
  await db.write();
  backupToNAS();
  res.json({ success: true });
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
  backupToNAS(); // 학습 인증 저장 시 NAS 자동 백업 (non-blocking)
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

// ── NAS 백업 상태 / 수동 백업 ─────────────────────────────────
app.get('/api/admin/backup/status', requireAuth, requireAdmin, (req, res) => {
  if (!NAS_PATH) return res.json({ enabled: false });
  try {
    const status = JSON.parse(fs.readFileSync(NAS_STATUS_FILE, 'utf8'));
    // 백업 파일 목록
    const files = fs.existsSync(NAS_BACKUP_DIR)
      ? fs.readdirSync(NAS_BACKUP_DIR).filter(f => f.startsWith('data_') && f.endsWith('.json')).sort().reverse()
      : [];
    res.json({ enabled: true, ...status, fileCount: files.length, files: files.slice(0, 5) });
  } catch {
    res.json({ enabled: true, backedUpAt: null, fileCount: 0 });
  }
});

app.post('/api/admin/backup', requireAuth, requireAdmin, async (req, res) => {
  const result = await backupToNAS();
  res.json(result);
});

// ── 학생 관리 CRUD ────────────────────────────────────────────

// 목록
app.get('/api/admin/students', requireAuth, requireAdmin, async (req, res) => {
  await db.read();
  res.json(db.data.students.map(({ passwordHash, ...s }) => s));
});

// 추가
app.post('/api/admin/students', requireAuth, requireAdmin, async (req, res) => {
  const { name, pin, grade, studentInfo } = req.body;
  if (!name?.trim())           return res.status(400).json({ error: '이름을 입력해주세요.' });
  if (!pin || !/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN은 4자리 숫자여야 합니다.' });

  await db.read();
  if (db.data.students.some(s => s.name === name.trim())) {
    return res.status(409).json({ error: '같은 이름의 학생이 이미 있습니다.' });
  }

  const student = {
    id: uuidv4(),
    name: name.trim(),
    passwordHash: await bcrypt.hash(pin, 10),
    grade: grade?.trim() || '',
    studentInfo: studentInfo?.trim() || '',
    systemPrompt: null,
    createdAt: new Date().toISOString(),
  };
  db.data.students.push(student);
  await db.write();
  const { passwordHash, ...safe } = student;
  res.json({ success: true, student: safe });
});

// 수정
app.put('/api/admin/students/:id', requireAuth, requireAdmin, async (req, res) => {
  const { name, pin, grade, studentInfo } = req.body;
  await db.read();
  const student = db.data.students.find(s => s.id === req.params.id);
  if (!student) return res.status(404).json({ error: '학생을 찾을 수 없습니다.' });

  if (name?.trim()) {
    const dup = db.data.students.find(s => s.name === name.trim() && s.id !== req.params.id);
    if (dup) return res.status(409).json({ error: '같은 이름의 학생이 이미 있습니다.' });
    student.name = name.trim();
  }
  if (pin) {
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN은 4자리 숫자여야 합니다.' });
    student.passwordHash = await bcrypt.hash(pin, 10);
  }
  if (grade  !== undefined) student.grade       = grade.trim();
  if (studentInfo !== undefined) student.studentInfo = studentInfo.trim();
  student.updatedAt = new Date().toISOString();

  await db.write();
  const { passwordHash, ...safe } = student;
  res.json({ success: true, student: safe });
});

// 삭제
app.delete('/api/admin/students/:id', requireAuth, requireAdmin, async (req, res) => {
  await db.read();
  const idx = db.data.students.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '학생을 찾을 수 없습니다.' });

  db.data.students.splice(idx, 1);
  // 연관 데이터도 정리
  db.data.messages    = db.data.messages.filter(m => m.studentId !== req.params.id);
  db.data.attendance  = db.data.attendance.filter(a => a.studentId !== req.params.id);
  db.data.studyLogs   = db.data.studyLogs.filter(l => l.studentId !== req.params.id);
  await db.write();
  res.json({ success: true });
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
  backupToNAS(); // 출결 변경 시 NAS 자동 백업 (non-blocking)
  res.json({ success: true });
});

// ── 출석 엑셀 내보내기 ────────────────────────────────────────
app.get('/api/admin/attendance/export', requireAuth, requireAdmin, async (req, res) => {
  await db.read();
  const { students, attendance } = db.data;
  const statusKr = { present: '출석', absent: '결석', late: '지각' };
  const DAY_NAMES = ['월', '화', '수', '목', '금', '토', '일']; // 월=0 기준

  const days = parseInt(req.query.days || '30', 10);

  // 조회 범위의 시작일이 속한 주 월요일부터 오늘이 속한 주 일요일까지 확장
  const today = new Date();
  const rangeStart = new Date(today);
  rangeStart.setDate(today.getDate() - (days - 1));

  // rangeStart → 해당 주 월요일
  const toMonday = rangeStart.getDay() === 0 ? 6 : rangeStart.getDay() - 1;
  const weekStart = new Date(rangeStart);
  weekStart.setDate(rangeStart.getDate() - toMonday);

  // today → 해당 주 일요일
  const toSunday = today.getDay() === 0 ? 0 : 7 - today.getDay();
  const weekEnd = new Date(today);
  weekEnd.setDate(today.getDate() + toSunday);

  // 월요일~일요일 전체 날짜 배열
  const allDates = [];
  for (const d = new Date(weekStart); d <= weekEnd; d.setDate(d.getDate() + 1)) {
    allDates.push(d.toISOString().split('T')[0]);
  }

  // 7일씩 주차별 그룹
  const weeks = [];
  for (let i = 0; i < allDates.length; i += 7) weeks.push(allDates.slice(i, i + 7));

  // 행 1: 이름 | 학년 | [n주차(날짜범위) — 7칸 병합] | ...
  const row1 = ['이름', '학년'];
  const merges = [];
  let col = 2;
  weeks.forEach((wd, wi) => {
    const first = wd[0].slice(5).replace('-', '/');
    const last  = wd[wd.length - 1].slice(5).replace('-', '/');
    row1.push(`${wi + 1}주차\n(${first}~${last})`);
    for (let j = 1; j < 7; j++) row1.push('');
    merges.push({ s: { r: 0, c: col }, e: { r: 0, c: col + 6 } });
    col += 7;
  });

  // 행 2: '' | '' | 월 | 화 | 수 | 목 | 금 | 토 | 일 | 월 | ...
  const row2 = ['', '', ...weeks.flatMap(() => DAY_NAMES)];

  // 학생 데이터 행
  const dataRows = students.map(s => [
    s.name, s.grade || '',
    ...allDates.map(date => {
      const r = attendance.find(a => a.studentId === s.id && a.date === date);
      return statusKr[r?.status] || '';
    }),
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([row1, row2, ...dataRows]);
  ws['!merges'] = merges;
  ws['!cols']   = [{ wch: 10 }, { wch: 5 }, ...allDates.map(() => ({ wch: 6 }))];
  ws['!rows']   = [{ hpt: 32 }, { hpt: 16 }]; // 주차 헤더 행 높이
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

    const analysis = await callAI({ userMessage: prompt });
    res.json({ studentName: student.name, grade: student.grade, analysis, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('AI 분석 오류:', err.message);
    res.status(500).json({ error: 'AI 분석 중 오류가 발생했습니다.' });
  }
});

// ─────────────────────────────────────────────────────────────
// 업로드 파일 서빙 (NAS 경로도 웹에서 접근 가능하도록)
// ─────────────────────────────────────────────────────────────
// /uploads/학생이름/파일.jpg  또는 구버전 /uploads/파일.jpg 모두 처리
app.get('/uploads/*', (req, res) => {
  // path traversal 방지: 각 세그먼트를 개별 검증
  const segments = req.params[0].split('/').map(s => path.basename(s)).filter(Boolean);
  if (!segments.length) return res.status(404).end();

  const relativePath = path.join(...segments); // 예: "김민준/abc123.jpg"

  const candidates = [];
  if (NAS_PATH) candidates.push(path.join(NAS_PATH, relativePath));
  candidates.push(path.join(LOCAL_UPLOADS, relativePath));

  for (const f of candidates) {
    if (fs.existsSync(f)) return res.sendFile(f);
  }
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
