# DC Prime — 학원 개인 AI 분석 플랫폼

학생별 개인화된 Gemini AI 채팅 플랫폼입니다.

## 시작하기

### 1. 의존성 설치
```bash
npm install
```

### 2. 환경 변수 설정
```bash
cp .env.example .env
```
`.env` 파일을 열어 Gemini API 키와 세션 시크릿을 입력하세요.

```
GEMINI_API_KEY=여기에_API_키_입력
SESSION_SECRET=랜덤한_긴_문자열
PORT=3000
```

> Gemini API 키 발급: https://aistudio.google.com/app/apikey

### 3. 학생 데이터 등록
```bash
npm run seed
```
`database/seed.js` 파일을 수정하여 실제 학생 정보와 비밀번호를 설정하세요.

### 4. 서버 실행
```bash
# 개발 모드 (자동 재시작)
npm run dev

# 운영 모드
npm start
```

브라우저에서 `http://localhost:3000` 접속

---

## 학생 등록 방법

`database/seed.js`의 `students` 배열을 수정하세요:

```js
const students = [
  {
    name: '홍길동',
    password: '123456',      // 6자리 숫자
    grade: '고2',
    student_info: '수학 강점, 영어 보완 필요. 성실하고 꼼꼼함.',
    system_prompt: null,      // null이면 기본 프롬프트 사용
  },
  // ...
];
```

수정 후 다시 실행:
```bash
npm run seed
```

---

## 구조

```
dcprime.10/
├── server.js           # Express 서버
├── database/
│   ├── seed.js         # 학생 등록 스크립트
│   └── students.db     # SQLite DB (자동 생성)
└── public/
    ├── index.html      # 로그인 페이지 (PIN 패드)
    ├── chat.html       # AI 채팅 페이지
    ├── css/style.css   # Toss 스타일 디자인
    └── js/
        ├── login.js    # PIN 입력 로직
        └── chat.js     # 채팅 로직
```

## 기능

- **6자리 PIN 로그인** — 학생별 고유 번호
- **개인화 AI** — 학생 정보 기반 Gemini 맞춤 대화
- **대화 이력 저장** — 세션 간 이어지는 채팅
- **대화 초기화** — 새 학기나 새 주제로 리셋
- **반응형 UI** — 모바일/태블릿/PC 모두 지원
