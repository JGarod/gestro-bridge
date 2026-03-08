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

// Captura de errores no controlados para evitar que la consola se cierre sin explicación
process.on('uncaughtException', (err) => {
  console.error('\n\x1b[31m[ERROR FATAL]\x1b[0m Excepción no capturada:', err.message);
  console.error(err.stack);
  fs.appendFileSync('./bridge-error.log', `[${new Date().toISOString()}] UNCAUGHT EXCEPTION: ${err.stack}\n`);
  // No salimos inmediatamente para intentar registrar el log
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n\x1b[31m[PROCESO RECHAZADO]\x1b[0m Promesa no controlada en:', promise, 'razón:', reason);
  fs.appendFileSync('./bridge-error.log', `[${new Date().toISOString()}] UNHANDLED REJECTION: ${reason}\n`);
});

// ──────────────────────────────────────────────────
//  CONFIGURACIÓN (el desarrollador ajusta esto)
// ──────────────────────────────────────────────────
const SERVER_URL = 'https://backend-restaurante-d.vhrt6n.easypanel.host';   // IP del servidor según environment.ts
const LOCATION_ID = '46630434-6258-4a76-ac1b-b12c209aa406';
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
  .btn-rescan { background: #6366f1; color: white; border: none; padding: 0.5rem 1rem; border-radius: 0.6rem; font-size: 0.8rem; font-weight: 700; cursor: pointer; transition: 0.2s; }
  .btn-rescan:hover { background: #8b5cf6; }
  .btn-rescan:disabled { opacity: 0.5; }
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
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 1rem;">
      <h2 style="margin:0">Impresoras en Red</h2>
      <button id="rescan-btn" onclick="rescan()" class="btn-rescan">Actualizar lista</button>
    </div>
    <div class="printers-grid" id="printers-grid"><p>Escaneando...</p></div>
  </div>
  <div class="card">
    <h2>Registro de Actividad</h2>
    <div class="logs" id="logs-container"></div>
  </div>
</div>
<script>
let polling = setInterval(updateStatus, 1500);
async function rescan() {
  const btn = document.getElementById('rescan-btn');
  btn.disabled = true; btn.textContent = 'Buscando...';
  try {
    await fetch('/api/rescan', { method: 'POST' });
    setTimeout(() => { 
        btn.disabled = false; btn.textContent = 'Actualizar lista'; 
        updateStatus(); 
    }, 2000);
  } catch(e) { btn.disabled = false; btn.textContent = 'Actualizar lista'; }
}
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
  if (req.method === 'POST' && req.url === '/api/rescan') {
    triggerPrinterSync();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
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
  // Configuración de reconexión infinita para máxima estabilidad
  socket = io(config.SERVER_URL, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    timeout: 10000
  });

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
    addLog(`[ERROR] No se pudo conectar a ${config.SERVER_URL} (reintentando...)`);
  });

  socket.on('disconnect', (reason) => {
    status.connected = false;
    status.error = "Desconectado del servidor";
    addLog(`[ADVERTENCIA] Desconectado del servidor: ${reason}`);
  });

  socket.on('reconnect', (attemptNumber) => {
    addLog(`[OK] ¡Reconectado con éxito! Intento #${attemptNumber}.`);
    status.error = null;
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
        triggerPrinterSync();
      }
    } else {
      addLog(`[ERROR] ${data.message}`);
      status.connected = false;
    }
  });

  socket.on('printersRegistered', (data) => {
    status.printers = data.printers || [];
    addLog(`[OK] Lista de impresoras sincronizada (${status.printers.length} activas).`);
  });

  socket.on('print-job', (data) => {
    addLog(`Imprimiendo orden...`);
    data.jobs.forEach(job => {
      const buffer = Buffer.from(job.content, 'base64');
      sendToPrinter(job.printer.ip, job.printer.port, buffer, job.printer.name);
    });
  });
}

// Función global para sincronizar impresoras con escaneo por lotes (batching)
// Se saca de initSocket para que sea accesible desde la API HTTP (/api/rescan)
async function triggerPrinterSync() {
  if (!socket || !socket.connected) {
    addLog(`[ADVERTENCIA] No se puede sincronizar: Socket no conectado.`);
    return;
  }
  addLog(`Iniciando escaneo de red local (optimizado)...`);
  const found = await scanLocalSubnetOptimized();
  addLog(`Escaneo finalizado. Sincronizando ${found.length} impresoras con Gestro...`);
  socket.emit('registerPrinters', { printers: found, locationId: config.LOCATION_ID });
}

function connectBridge(user, pass) {
  if (!socket) initSocket();
  addLog(`Enviando login para ${user}...`);
  socket.emit('authBridge', { user, pass, locationId: config.LOCATION_ID });
}

// Escaneo optimizado con concurrencia limitada para evitar bloquear el sistema
async function scanLocalSubnetOptimized() {
  const interfaces = os.networkInterfaces();
  const discovered = [];
  const COMMON_PORTS = [9100, 9101, 9102, 8000]; // Puertos estándar y genéricos (8000)
  const CONCURRENCY_LIMIT = 20; // Reducido aún más para mayor seguridad

  addLog("Detectando interfaces de red...");
  console.log("DEBUG: Iniciando escaneo optimizado...");

  // Prueba inicial en localhost
  const localhostPorts = COMMON_PORTS.map(port => checkPort('127.0.0.1', port).then(ok => {
    if (ok) discovered.push({ ip: '127.0.0.1', port, name: `Local (Puerto ${port})` });
  }));
  await Promise.all(localhostPorts);

  for (const [name, ifaces] of Object.entries(interfaces)) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const myIp = iface.address;
        const prefix = myIp.split('.').slice(0, 3).join('.') + '.';
        addLog(`Escaneando segmento ${prefix}x en puertos ${COMMON_PORTS.join(', ')}...`);

        // Lista de todas las tareas pendientes (IP + Puerto)
        const tasks = [];
        for (let i = 1; i < 255; i++) {
          const ip = prefix + i;
          if (ip === myIp) continue;
          COMMON_PORTS.forEach(port => tasks.push({ ip, port }));
        }

        // Ejecutar tareas por lotes para no saturar Windows
        for (let i = 0; i < tasks.length; i += CONCURRENCY_LIMIT) {
          const batch = tasks.slice(i, i + CONCURRENCY_LIMIT);
          console.log(`DEBUG: Procesando lote ${Math.floor(i / CONCURRENCY_LIMIT) + 1} de ${Math.ceil(tasks.length / CONCURRENCY_LIMIT)}...`);

          try {
            await Promise.all(batch.map(async (task) => {
              const ok = await checkPort(task.ip, task.port);
              if (ok) {
                addLog(`[OK] Impresora detectada: ${task.ip}:${task.port}`);
                discovered.push({ ip: task.ip, port: task.port, name: `Impresora ${task.ip}` });
              }
            }));
          } catch (batchErr) {
            console.error(`DEBUG: Error en lote: ${batchErr.message}`);
          }
        }
      }
    }
  }

  return discovered;
}

// Verifica si un puerto está abierto con un timeout corto
function checkPort(ip, port = 9100) {
  return new Promise(resolve => {
    const s = new net.Socket();
    s.setTimeout(800); // Timeout reducido para acelerar el escaneo por lotes
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => { s.destroy(); resolve(false); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.connect(port, ip);
  });
}

function sendToPrinter(ip, port, data, name) {
  const client = new net.Socket();

  // Timeout de 5 segundos para no dejar el proceso colgado si la impresora falla
  client.setTimeout(5000);

  client.connect(port, ip, () => {
    client.write(data, () => {
      addLog(`[EXITO] Enviado a ${name}`);
      client.end();
    });
  });

  client.on('error', err => {
    addLog(`[ERROR] ${name} (${ip}): ${err.message}`);
    client.destroy();
  });

  client.on('timeout', () => {
    addLog(`[ERROR] Tiempo de espera agotado en ${name} (${ip})`);
    client.destroy();
  });
}

// Latido (Heartbeat) para confirmar que el servicio sigue vivo cada 15 minutos
setInterval(() => {
  addLog(`[SISTEMA] El servicio sigue activo y monitoreando comandos.`);
}, 15 * 60 * 1000);

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
