/**
 * 초기 데이터 등록 스크립트
 * 실행: node database/seed.js
 */
const { Low, JSONFile } = require('lowdb');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname);
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Low(new JSONFile(path.join(DB_DIR, 'data.json')));

// ════════════════════════════════════════
// 여기를 수정하세요
// ════════════════════════════════════════

// 원장 정보 (PIN: 4자리)
const ADMIN = {
  name: '신성호',
  title: '원장',
  password: '1250',
};

// 학생 목록 (PIN: 4자리)
const STUDENTS = [
  {
    name: '김민준',
    password: '1111',
    grade: '고1',
    studentInfo: '수학과 과학을 좋아하며 논리적 사고력이 뛰어남. 영어 어휘력 보완 필요.',
    systemPrompt: null,
  },
  {
    name: '이서연',
    password: '2222',
    grade: '고2',
    studentInfo: '독서량이 많고 언어 감각이 좋음. 수학 계산 실수 줄이기 목표.',
    systemPrompt: null,
  },
  {
    name: '박지우',
    password: '3333',
    grade: '고1',
    studentInfo: '꼼꼼하고 성실한 학습 태도. 발표력과 자신감 향상 필요.',
    systemPrompt: null,
  },
];

// ════════════════════════════════════════

async function seed() {
  await db.read();
  db.data ??= {};
  db.data.admin ??= null;
  db.data.students ??= [];
  db.data.messages ??= [];
  db.data.attendance ??= [];
  db.data.studyLogs ??= [];

  // 원장 등록
  if (db.data.admin) {
    console.log(`⏭️  원장(${db.data.admin.name}) 이미 존재 — 덮어씁니다`);
  }
  db.data.admin = {
    id: 'admin-001',
    name: ADMIN.name,
    title: ADMIN.title,
    passwordHash: await bcrypt.hash(ADMIN.password, 10),
    createdAt: new Date().toISOString(),
  };
  console.log(`✅ 원장 등록: ${ADMIN.name} (${ADMIN.title}) — PIN: ${ADMIN.password}`);

  // 학생 등록
  for (const s of STUDENTS) {
    const existing = db.data.students.findIndex(st => st.name === s.name);
    const entry = {
      id: existing >= 0 ? db.data.students[existing].id : uuidv4(),
      name: s.name,
      passwordHash: await bcrypt.hash(s.password, 10),
      grade: s.grade,
      studentInfo: s.studentInfo,
      systemPrompt: s.systemPrompt,
      createdAt: existing >= 0 ? db.data.students[existing].createdAt : new Date().toISOString(),
    };
    if (existing >= 0) { db.data.students[existing] = entry; console.log(`🔄 ${s.name} 업데이트 — PIN: ${s.password}`); }
    else { db.data.students.push(entry); console.log(`✅ ${s.name} (${s.grade}) 등록 — PIN: ${s.password}`); }
  }

  await db.write();
  console.log('\n🎉 완료!\n');
}

seed().catch(console.error);
