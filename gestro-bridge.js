const { io } = require('socket.io-client');
const net = require('net');
const fs = require('fs');
const http = require('http');
const os = require('os');
const readline = require('readline');

// Intercepción de cierre accidental
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askReadyToExit = () => {
  console.log('\n');
  rl.question('⚠️  ¿ESTÁS SEGURO? Si cierras el Bridge, las comandas NO se imprimirán.\nPresiona [S] para salir o cualquier otra tecla para continuar: ', (answer) => {
    if (answer.match(/^s$/i)) {
      console.log("Cerrando Bridge...");
      process.exit(0);
    } else {
      console.log("Continuando ejecución... No cierres esta ventana para mantener el servicio activo.");
    }
  });
};

process.on('SIGINT', askReadyToExit);  // Ctrl+C
process.on('SIGHUP', askReadyToExit);  // Cierre de ventana / Alt+F4
process.on('SIGTERM', askReadyToExit); // Terminación genérica

// ──────────────────────────────────────────────────
//  CONFIGURACIÓN (el desarrollador ajusta esto)
// ──────────────────────────────────────────────────
const SERVER_URL = 'https://backend-restaurante-a.vhrt6n.easypanel.host';   // IP del servidor según environment.ts
const LOCATION_ID = 'b4acea5b-6bfd-410d-a951-6618e2800be1';
const UI_PORT = 8080;
// ──────────────────────────────────────────────────

const CONFIG_PATH = './bridge-config.json';
let config = { SERVER_URL, LOCATION_ID };
let socket = null;
let status = { connected: false, error: null, printers: [], lastJob: null, logs: [] };

function addLog(msg) {
  const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
  status.logs.unshift(entry);
  if (status.logs.length > 50) status.logs.pop();
  console.log(entry);
}

// ── Servidor Web (UI) ─────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gestro Bridge</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
  header { background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 1.5rem 2rem; display: flex; align-items: center; gap: 1rem; }
  header h1 { font-size: 1.4rem; font-weight: 800; color: white; }
  .pill { background: rgba(255,255,255,0.2); border-radius: 2rem; padding: 0.3rem 0.8rem; font-size: 0.75rem; color: white; font-weight: 600; }
  .container { max-width: 900px; margin: 2rem auto; padding: 0 1.5rem; display: grid; gap: 1.5rem; }
  .card { background: #1e293b; border-radius: 1.2rem; padding: 1.5rem; border: 1px solid #334155; }
  .card h2 { font-size: 1rem; font-weight: 600; color: #94a3b8; margin-bottom: 1rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .status-dot { width: 12px; height: 12px; border-radius: 50%; background: #ef4444; display: inline-block; margin-right: 0.5rem; }
  .status-dot.on { background: #10b981; animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{box-shadow:0 0 0 0 rgba(16,185,129,0.4)} 70%{box-shadow:0 0 0 10px rgba(16,185,129,0)} }
  .status-text { font-size: 1.1rem; font-weight: 700; }
  .status-url { font-family: monospace; font-size: 0.8rem; color: #64748b; margin-top: 0.5rem; display: block; }
  .login-form { display: flex; flex-direction: column; gap: 1rem; max-width: 400px; margin: 0 auto; }
  .login-form input { padding: 0.9rem 1rem; border-radius: 0.8rem; border: 2px solid #334155; background: #0f172a; color: #e2e8f0; font-family: inherit; font-size: 0.95rem; }
  .login-form button { padding: 1rem; border-radius: 0.8rem; border: none; background: #6366f1; color: white; font-weight: 700; font-size: 1rem; cursor: pointer; transition: 0.2s; }
  .login-form button:disabled { opacity: 0.5; }
  .error-msg { color: #f87171; font-size: 0.875rem; text-align: center; font-weight: 600; }
  .printers-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem; }
  .printer-chip { background: #0f172a; border-radius: 0.8rem; padding: 1rem; border: 1px solid #334155; }
  .type-kitchen { color: #f87171; } .type-bar { color: #60a5fa; }
  .logs { font-family: monospace; font-size: 0.8rem; color: #94a3b8; line-height: 1.8; max-height: 250px; overflow-y: auto; background: #0f172a; padding: 1rem; border-radius: 0.8rem; }
  .logs span { display: block; border-bottom: 1px solid #1e293b; padding: 0.2rem 0; }
  .logs span.ok { color: #10b981; } .logs span.warn { color: #f87171; } .logs span.info { color: #6366f1; }
</style>
</head>
<body>
<header><h1>🖨️ Gestro Bridge</h1><span class="pill">v1.2</span></header>
<div class="container">
  <div class="card">
    <h2>Estado del Sistema</h2>
    <p><span class="status-dot" id="dot"></span><span class="status-text" id="status-text">Iniciando...</span></p>
  </div>
  <div class="card" id="login-card">
    <h2>Activación</h2>
    <div class="login-form">
      <input type="email" id="user-input" placeholder="correo@ejemplo.com" value="admin@restaurante.com">
      <input type="password" id="pass-input" placeholder="Contraseña">
      <button id="login-btn" onclick="doLogin()">Conectar ahora</button>
      <p class="error-msg" id="error-msg"></p>
    </div>
  </div>
  <div class="card" id="printers-card" style="display:none">
    <h2>Impresoras en Red</h2>
    <div class="printers-grid" id="printers-grid"><p>Escaneando...</p></div>
  </div>
  <div class="card">
    <h2>Registro de Actividad</h2>
    <div class="logs" id="logs-container"></div>
  </div>
</div>
<script>
let polling = setInterval(updateStatus, 1500);
async function doLogin() {
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('error-msg');
  const user = document.getElementById('user-input').value.trim();
  const pass = document.getElementById('pass-input').value;
  if (!user || !pass) { err.textContent = 'Ingresa credenciales.'; return; }
  btn.disabled = true; btn.textContent = 'Enviando...';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, pass })
    });
    const data = await res.json();
    if (!data.ok) { err.textContent = data.message; btn.disabled = false; btn.textContent = 'Conectar ahora'; }
  } catch (e) { err.textContent = 'Error de red local.'; btn.disabled = false; btn.textContent = 'Conectar ahora'; }
}
async function updateStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    const dot = document.getElementById('dot');
    const txt = document.getElementById('status-text');
    if (data.connected) {
      dot.className = 'status-dot on'; txt.textContent = 'ACTIVO';
      document.getElementById('login-card').style.display = 'none';
      document.getElementById('printers-card').style.display = '';
    } else {
      dot.className = 'status-dot'; txt.textContent = data.error || 'Desconectado';
      document.getElementById('login-card').style.display = '';
    }
    const grid = document.getElementById('printers-grid');
    if (data.printers?.length) {
      grid.innerHTML = data.printers.map(p => \`
        <div class="printer-chip"><b>\${p.name}</b><br><small>\${p.ip}:\${p.port}</small></div>
      \`).join('');
    }
    document.getElementById('logs-container').innerHTML = data.logs.map(l => {
      let cls = l.includes('[OK]') ? 'ok' : l.includes('[ERROR]') ? 'warn' : 'info';
      return \`<span class="\${cls}">\${l}</span>\`;
    }).join('');
  } catch(e) {}
}
</script>
</body>
</html>`;

const uiServer = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML);
  }
  if (req.method === 'GET' && req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(status));
  }
  if (req.method === 'POST' && req.url === '/api/login') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { user, pass } = JSON.parse(body);
        connectBridge(user, pass);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400); res.end();
      }
    });
    return;
  }
  res.writeHead(404); res.end();
});

function initSocket() {
  if (socket) return;
  addLog(`Conectando a ${config.SERVER_URL}...`);
  socket = io(config.SERVER_URL, { reconnectionAttempts: 5, timeout: 5000 });

  socket.on('connect', () => {
    addLog(`[OK] Conexión física establecida.`);
    status.error = null;
    if (fs.existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      if (saved.token) {
        addLog(`Restaurando sesión...`);
        socket.emit('authBridge', { token: saved.token, locationId: config.LOCATION_ID });
      }
    }
  });

  socket.on('connect_error', (err) => {
    status.error = "Error de conexión con el servidor Gestro";
    addLog(`[ERROR] No se pudo conectar a ${config.SERVER_URL}`);
  });

  socket.on('bridgeAuthenticated', (data) => {
    if (data.status === 'success') {
      const isInitialAuth = !status.connected;
      status.connected = true;
      status.printers = data.printers || [];
      addLog(`[OK] Autenticado. ${status.printers.length} impresoras.`);
      if (data.token) fs.writeFileSync(CONFIG_PATH, JSON.stringify({ token: data.token }));

      // Solo escaneamos si es la conexión inicial para evitar bucles
      if (isInitialAuth) {
        scanLocalSubnet().then(found => {
          if (found.length > 0) {
            addLog(`Registrando ${found.length} impresoras nuevas encontradas...`);
            socket.emit('registerPrinters', { printers: found, locationId: config.LOCATION_ID });
          }
        });
      }
    } else {
      addLog(`[ERROR] ${data.message}`);
      status.connected = false;
    }
  });

  socket.on('printersRegistered', (data) => {
    status.printers = data.printers || [];
    addLog(`[OK] Lista de impresoras actualizada (${status.printers.length}).`);
  });

  socket.on('print-job', (data) => {
    addLog(`Imprimiendo orden...`);
    data.jobs.forEach(job => {
      const buffer = Buffer.from(job.content, 'base64');
      sendToPrinter(job.printer.ip, job.printer.port, buffer, job.printer.name);
    });
  });
}

function connectBridge(user, pass) {
  if (!socket) initSocket();
  addLog(`Enviando login para ${user}...`);
  socket.emit('authBridge', { user, pass, locationId: config.LOCATION_ID });
}

async function scanLocalSubnet() {
  const interfaces = os.networkInterfaces();
  const discovered = [];
  const promises = [];
  promises.push(checkPort('127.0.0.1').then(ok => { if (ok) discovered.push({ ip: '127.0.0.1', port: 9100, name: 'Local' }); }));
  for (const ifaces of Object.values(interfaces)) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const myIp = iface.address;
        const prefix = myIp.split('.').slice(0, 3).join('.') + '.';
        for (let i = 1; i < 255; i++) {
          const ip = prefix + i;
          if (ip === myIp) continue; // Saltamos nuestra propia IP local ya que escaneamos 127.0.0.1
          promises.push(checkPort(ip).then(ok => { if (ok) discovered.push({ ip, port: 9100, name: `IP ${ip}` }); }));
        }
      }
    }
  }
  await Promise.allSettled(promises);
  return discovered;
}

function checkPort(ip) {
  return new Promise(resolve => {
    const s = new net.Socket();
    s.setTimeout(1000);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => { s.destroy(); resolve(false); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.connect(9100, ip);
  });
}

function sendToPrinter(ip, port, data, name) {
  const client = new net.Socket();
  client.connect(port, ip, () => {
    client.write(data, () => { addLog(`[EXITO] Enviado a ${name}`); client.end(); });
  });
  client.on('error', err => addLog(`[ERROR] ${name}: ${err.message}`));
}

const { exec } = require('child_process');

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start ${url}` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
  exec(cmd);
}

uiServer.listen(UI_PORT, () => {
  const url = `http://localhost:${UI_PORT}`;
  console.log(`Gestro Bridge UI: ${url}`);
  if (fs.existsSync(CONFIG_PATH)) initSocket();
  setTimeout(() => openBrowser(url), 1000);
});
