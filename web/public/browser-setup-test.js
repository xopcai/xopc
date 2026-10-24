
const marker = location.hash.slice(1);
if (/^XOPC-[a-f0-9-]{36}$/.test(marker)) {
  document.getElementById('read').textContent = 'Read check: ' + marker;
  document.getElementById('click').onclick = () => { document.getElementById('clicked').textContent = 'Click passed: ' + marker; };
  document.getElementById('input').oninput = event => { document.getElementById('filled').textContent = 'Input passed: ' + event.target.value; };
} else { document.getElementById('read').textContent = 'Start this demo from xopc Browser setup.'; }
