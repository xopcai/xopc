// Bundled algorithmic-art starter.
let seed = 1;
let params = { density: 180, drift: 0.008, scale: 0.015 };

function seededRandom(value) {
  const x = Math.sin(value) * 10000;
  return x - Math.floor(x);
}

function field(x, y, index) {
  return Math.sin(x * params.scale + index) + Math.cos(y * params.scale - index * params.drift);
}

function createStudy(canvas, context) {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#f7f8fc';
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < params.density; index += 1) {
    const x = seededRandom(seed + index * 17) * canvas.width;
    const y = seededRandom(seed + index * 31) * canvas.height;
    const hue = 210 + field(x, y, index) * 28;
    context.fillStyle = `hsla(${hue}, 62%, 38%, 0.45)`;
    context.beginPath();
    context.arc(x, y, 2 + Math.abs(field(x, y, index)) * 4, 0, Math.PI * 2);
    context.fill();
  }
}
