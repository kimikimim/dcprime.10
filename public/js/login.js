(() => {
  const PIN_LENGTH = 4;
  let pin = '';
  let busy = false;

  const dots = Array.from({ length: PIN_LENGTH }, (_, i) => document.getElementById(`dot${i}`));
  const pinDisplay = document.getElementById('pinDisplay');
  const errorMsg  = document.getElementById('errorMsg');
  const loading   = document.getElementById('loginLoading');

  const updateDots = () => dots.forEach((d, i) => {
    d.classList.toggle('filled', i < pin.length);
    d.classList.remove('error');
  });

  const showError = msg => {
    dots.forEach(d => d.classList.add('error'));
    pinDisplay.classList.remove('shake');
    void pinDisplay.offsetWidth;
    pinDisplay.classList.add('shake');
    errorMsg.textContent = msg;
    errorMsg.classList.add('show');
    setTimeout(() => { pin = ''; updateDots(); errorMsg.classList.remove('show'); }, 1400);
  };

  const submit = async () => {
    if (busy) return;
    busy = true;
    loading.classList.add('show');

    try {
      const res  = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pin }) });
      const data = await res.json();

      if (res.ok && data.success) {
        if (data.isAdmin) {
          loading.innerHTML = `<div style="font-size:36px;margin-bottom:10px">👑</div><span style="font-size:17px;font-weight:700;color:#191F28">${data.name} ${data.title}님, 안녕하세요!</span>`;
          setTimeout(() => { window.location.href = '/admin'; }, 900);
        } else {
          loading.innerHTML = `<div style="font-size:36px;margin-bottom:10px">✅</div><span style="font-size:17px;font-weight:700;color:#191F28">${data.name}님, 환영해요!</span>`;
          setTimeout(() => { window.location.href = '/chat'; }, 800);
        }
      } else {
        loading.classList.remove('show');
        showError(data.error || '비밀번호가 올바르지 않습니다.');
        pin = '';
        busy = false;
      }
    } catch {
      loading.classList.remove('show');
      showError('네트워크 오류가 발생했습니다.');
      pin = '';
      busy = false;
    }
  };

  const pressNum = n => {
    if (busy || pin.length >= PIN_LENGTH) return;
    pin += n;
    updateDots();
    if (navigator.vibrate) navigator.vibrate(10);
    if (pin.length === PIN_LENGTH) setTimeout(submit, 100);
  };

  const pressDelete = () => {
    if (busy || !pin.length) return;
    pin = pin.slice(0, -1);
    updateDots();
    if (navigator.vibrate) navigator.vibrate(5);
  };

  document.querySelectorAll('.numpad-btn[data-num]').forEach(b => b.addEventListener('click', () => pressNum(b.dataset.num)));
  document.getElementById('deleteBtn').addEventListener('click', pressDelete);
  document.addEventListener('keydown', e => {
    if (e.key >= '0' && e.key <= '9') pressNum(e.key);
    else if (e.key === 'Backspace') pressDelete();
  });
})();
