const { io } = require('socket.io-client');
const net = require('net');
const fs = require('fs');
const http = require('http');
const os = require('os');
const readline = require('readline');

// Intercepción de cierre accidental
const interfazLectura = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Función para confirmar si el usuario realmente quiere cerrar el programa
const confirmarSalida = () => {
  console.log('\n');
  interfazLectura.question('⚠️  ¿ESTÁS SEGURO? Si cierras el Bridge, las comandas NO se imprimirán.\nPresiona [S] para salir o cualquier otra tecla para continuar: ', (respuesta) => {
    if (respuesta.match(/^s$/i)) {
      console.log("Cerrando Bridge...");
      process.exit(0);
    } else {
      console.log("Continuando ejecución... No cierres esta ventana para mantener el servicio activo.");
    }
  });
};

process.on('SIGINT', confirmarSalida);  // Ctrl+C
process.on('SIGHUP', confirmarSalida);  // Cierre de ventana / Alt+F4
process.on('SIGTERM', confirmarSalida); // Terminación genérica

// Captura de errores no controlados para evitar que la consola se cierre sin explicación
process.on('uncaughtException', (error) => {
  console.error('\n\x1b[31m[ERROR FATAL]\x1b[0m Excepción no capturada:', error.message);
  console.error(error.stack);
  fs.appendFileSync('./bridge-error.log', `[${new Date().toISOString()}] EXCEPCION NO CAPTURADA: ${error.stack}\n`);
  // Esperamos un segundo antes de salir para asegurar que se guarde el log
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (razon, promesa) => {
  console.error('\n\x1b[31m[PROCESO RECHAZADO]\x1b[0m Promesa no controlada en:', promesa, 'razón:', razon);
  fs.appendFileSync('./bridge-error.log', `[${new Date().toISOString()}] RECHAZO NO MANEJADO: ${razon}\n`);
});

// ──────────────────────────────────────────────────
//  CONFIGURACIÓN (Ajustes del servidor y sede)
// ──────────────────────────────────────────────────
const URL_SERVIDOR = 'https://api-vidadeperros.jgpredict.com';   // URL del servidor principal
const ID_UBICACION = '27267532-d7ad-476e-a288-6c142f55d13e';
const PUERTO_UI = 8080;
// ──────────────────────────────────────────────────

const RUTA_CONFIGURACION = './bridge-config.json';
let configuracion = { URL_SERVIDOR, ID_UBICACION };
let enlaceSocket = null;
let estadoActual = { connected: false, error: null, printers: [], lastJob: null, logs: [] };

// Agrega un mensaje al registro local y a la consola
function agregarRegistro(mensaje) {
  const entrada = `[${new Date().toLocaleTimeString()}] ${mensaje}`;
  estadoActual.logs.unshift(entrada);
  if (estadoActual.logs.length > 50) estadoActual.logs.pop();
  console.log(entrada);
}

// ── Servidor Web (Interfaz de Usuario) ─────────────────────────────
const CONTENIDO_HTML = `<!DOCTYPE html>
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
      <button id="login-btn" onclick="iniciarSesion()">Conectar ahora</button>
      <p class="error-msg" id="error-msg"></p>
    </div>
  </div>
  <div class="card" id="printers-card" style="display:none">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 1rem;">
      <h2 style="margin:0">Impresoras en Red</h2>
      <button id="rescan-btn" onclick="volverAEscanear()" class="btn-rescan">Actualizar lista</button>
    </div>
    <div class="printers-grid" id="printers-grid"><p>Escaneando...</p></div>
  </div>
  <div class="card">
    <h2>Registro de Actividad</h2>
    <div class="logs" id="logs-container"></div>
  </div>
</div>
<script>
let sondeo = setInterval(actualizarEstado, 1500);
async function volverAEscanear() {
  const boton = document.getElementById('rescan-btn');
  boton.disabled = true; boton.textContent = 'Buscando...';
  try {
    await fetch('/api/rescan', { method: 'POST' });
    setTimeout(() => { 
        boton.disabled = false; boton.textContent = 'Actualizar lista'; 
        actualizarEstado(); 
    }, 2000);
  } catch(e) { boton.disabled = false; boton.textContent = 'Actualizar lista'; }
}
async function iniciarSesion() {
  const boton = document.getElementById('login-btn');
  const errorMsg = document.getElementById('error-msg');
  const usuario = document.getElementById('user-input').value.trim();
  const contrasena = document.getElementById('pass-input').value;
  if (!usuario || !contrasena) { errorMsg.textContent = 'Ingresa credenciales.'; return; }
  boton.disabled = true; boton.textContent = 'Enviando...';
  try {
    const respuesta = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: usuario, pass: contrasena })
    });
    const datos = await respuesta.json();
    if (!datos.ok) { errorMsg.textContent = datos.message; boton.disabled = false; boton.textContent = 'Conectar ahora'; }
  } catch (e) { errorMsg.textContent = 'Error de red local.'; boton.disabled = false; boton.textContent = 'Conectar ahora'; }
}
async function actualizarEstado() {
  try {
    const respuesta = await fetch('/api/status');
    const datos = await respuesta.json();
    const punto = document.getElementById('dot');
    const texto = document.getElementById('status-text');
    if (datos.connected) {
      punto.className = 'status-dot on'; texto.textContent = 'ACTIVO';
      document.getElementById('login-card').style.display = 'none';
      document.getElementById('printers-card').style.display = '';
    } else {
      punto.className = 'status-dot'; texto.textContent = datos.error || 'Desconectado';
      document.getElementById('login-card').style.display = '';
    }
    const rejilla = document.getElementById('printers-grid');
    if (datos.printers?.length) {
      rejilla.innerHTML = datos.printers.map(p => \`
        <div class="printer-chip"><b>\${p.name}</b><br><small>\${p.ip}:\${p.port}</small></div>
      \`).join('');
    }
    document.getElementById('logs-container').innerHTML = datos.logs.map(l => {
      let cls = l.includes('[OK]') ? 'ok' : l.includes('[ERROR]') ? 'warn' : 'info';
      return \`<span class="\${cls}">\${l}</span>\`;
    }).join('');
  } catch(e) {}
}
</script>
</body>
</html>`;

const servidorWeb = http.createServer(async (peticion, respuesta) => {
  if (peticion.method === 'GET' && peticion.url === '/') {
    respuesta.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return respuesta.end(CONTENIDO_HTML);
  }
  if (peticion.method === 'GET' && peticion.url === '/api/status') {
    respuesta.writeHead(200, { 'Content-Type': 'application/json' });
    return respuesta.end(JSON.stringify(estadoActual));
  }
  if (peticion.method === 'POST' && peticion.url === '/api/rescan') {
    sincronizarImpresoras();
    respuesta.writeHead(200, { 'Content-Type': 'application/json' });
    respuesta.end(JSON.stringify({ ok: true }));
    return;
  }

  if (peticion.method === 'POST' && peticion.url === '/api/login') {
    let cuerpo = '';
    peticion.on('data', fragmento => cuerpo += fragmento);
    peticion.on('end', () => {
      try {
        const { user, pass } = JSON.parse(cuerpo);
        conectarPuente(user, pass);
        respuesta.writeHead(200, { 'Content-Type': 'application/json' });
        respuesta.end(JSON.stringify({ ok: true }));
      } catch {
        respuesta.writeHead(400); respuesta.end();
      }
    });
    return;
  }
  respuesta.writeHead(404); respuesta.end();
});

function inicializarSocket() {
  if (enlaceSocket) return;
  agregarRegistro(`Conectando a ${configuracion.URL_SERVIDOR}...`);
  // Configuración de reconexión infinita para máxima estabilidad
  enlaceSocket = io(configuracion.URL_SERVIDOR, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    timeout: 10000
  });

  enlaceSocket.on('connect', () => {
    agregarRegistro(`[OK] Conexión física establecida.`);
    estadoActual.error = null;
    if (fs.existsSync(RUTA_CONFIGURACION)) {
      const guardado = JSON.parse(fs.readFileSync(RUTA_CONFIGURACION, 'utf-8'));
      if (guardado.token) {
        agregarRegistro(`Restaurando sesión...`);
        enlaceSocket.emit('authBridge', { token: guardado.token, locationId: configuracion.ID_UBICACION });
      }
    }
  });

  enlaceSocket.on('connect_error', (error) => {
    estadoActual.error = "Error de conexión con el servidor Gestro";
    agregarRegistro(`[ERROR] No se pudo conectar a ${configuracion.URL_SERVIDOR} (reintentando...)`);
  });

  enlaceSocket.on('disconnect', (razon) => {
    estadoActual.connected = false;
    estadoActual.error = "Desconectado del servidor";
    agregarRegistro(`[ADVERTENCIA] Desconectado del servidor: ${razon}`);
  });

  enlaceSocket.on('reconnect', (numeroIntento) => {
    agregarRegistro(`[OK] ¡Reconectado con éxito! Intento #${numeroIntento}.`);
    estadoActual.error = null;
  });

  enlaceSocket.on('bridgeAuthenticated', (datos) => {
    if (datos.status === 'success') {
      const esConexionInicial = !estadoActual.connected;
      estadoActual.connected = true;
      estadoActual.printers = datos.printers || [];
      agregarRegistro(`[OK] Autenticado. ${estadoActual.printers.length} impresoras.`);
      if (datos.token) fs.writeFileSync(RUTA_CONFIGURACION, JSON.stringify({ token: datos.token }));

      // Solo escaneamos si es la conexión inicial para evitar bucles
      if (esConexionInicial) {
        sincronizarImpresoras();
      }
    } else {
      agregarRegistro(`[ERROR] ${datos.message}`);
      estadoActual.connected = false;
    }
  });

  enlaceSocket.on('printersRegistered', (datos) => {
    estadoActual.printers = datos.printers || [];
    agregarRegistro(`[OK] Lista de impresoras sincronizada (${estadoActual.printers.length} activas).`);
  });

  enlaceSocket.on('print-job', (datos) => {
    agregarRegistro(`Imprimiendo orden...`);
    datos.jobs.forEach(trabajo => {
      const buffer = Buffer.from(trabajo.content, 'base64');
      enviarAImpresora(trabajo.printer.ip, trabajo.printer.port, buffer, trabajo.printer.name);
    });
  });
}

// Función global para sincronizar impresoras con escaneo por lotes
async function sincronizarImpresoras() {
  if (!enlaceSocket || !enlaceSocket.connected) {
    agregarRegistro(`[ADVERTENCIA] No se puede sincronizar: Socket no conectado.`);
    return;
  }
  agregarRegistro(`Iniciando escaneo de red local (optimizado)...`);
  const encontradas = await escanearRedLocalOptimizada();
  agregarRegistro(`Escaneo finalizado. Sincronizando ${encontradas.length} impresoras con Gestro...`);
  enlaceSocket.emit('registerPrinters', { printers: encontradas, locationId: configuracion.ID_UBICACION });
}

function conectarPuente(usuario, contrasena) {
  if (!enlaceSocket) inicializarSocket();
  agregarRegistro(`Enviando login para ${usuario}...`);
  enlaceSocket.emit('authBridge', { user: usuario, pass: contrasena, locationId: configuracion.ID_UBICACION });
}

// Escaneo optimizado con concurrencia limitada para evitar bloquear el sistema
async function escanearRedLocalOptimizada() {
  const interfaces = os.networkInterfaces();
  const descubiertas = [];
  const PUERTOS_COMUNES = [9100, 9101, 9102, 8000]; // Puertos estándar para impresoras
  const LIMITE_CONCURRENCIA = 20;

  agregarRegistro("Detectando interfaces de red...");

  // Prueba inicial en localhost
  const tareasLocalhost = PUERTOS_COMUNES.map(puerto => validarPuerto('127.0.0.1', puerto).then(ok => {
    if (ok) descubiertas.push({ ip: '127.0.0.1', port: puerto, name: `Local (Puerto ${puerto})` });
  }));
  await Promise.all(tareasLocalhost);

  for (const [nombre, interfacesRed] of Object.entries(interfaces)) {
    for (const interfaz of interfacesRed) {
      if (interfaz.family === 'IPv4' && !interfaz.internal) {
        const miIp = interfaz.address;
        const prefijo = miIp.split('.').slice(0, 3).join('.') + '.';
        agregarRegistro(`Escaneando segmento ${prefijo}x en puertos ${PUERTOS_COMUNES.join(', ')}...`);

        const tareas = [];
        for (let i = 1; i < 255; i++) {
          const ip = prefijo + i;
          if (ip === miIp) continue;
          PUERTOS_COMUNES.forEach(puerto => tareas.push({ ip, port: puerto }));
        }

        // Ejecutar tareas por lotes para mayor estabilidad
        for (let i = 0; i < tareas.length; i += LIMITE_CONCURRENCIA) {
          const lote = tareas.slice(i, i + LIMITE_CONCURRENCIA);
          try {
            await Promise.all(lote.map(async (tarea) => {
              const ok = await validarPuerto(tarea.ip, tarea.port);
              if (ok) {
                agregarRegistro(`[OK] Impresora detectada: ${tarea.ip}:${tarea.port}`);
                descubiertas.push({ ip: tarea.ip, port: tarea.port, name: `Impresora ${tarea.ip}` });
              }
            }));
          } catch (errorLote) {
            // Error silencioso en el lote
          }
        }
      }
    }
  }

  return descubiertas;
}

// Verifica si un puerto está abierto con un tiempo de espera corto
function validarPuerto(ip, puerto = 9100) {
  return new Promise(resolver => {
    const s = new net.Socket();
    s.setTimeout(800);
    s.on('connect', () => { s.destroy(); resolver(true); });
    s.on('error', () => { s.destroy(); resolver(false); });
    s.on('timeout', () => { s.destroy(); resolver(false); });
    s.connect(puerto, ip);
  });
}

function enviarAImpresora(ip, puerto, datos, nombre) {
  const cliente = new net.Socket();

  // Tiempo de espera de 5 segundos para no dejar el proceso colgado
  cliente.setTimeout(5000);

  cliente.connect(puerto, ip, () => {
    cliente.write(datos, () => {
      agregarRegistro(`[EXITO] Enviado a ${nombre}`);
      cliente.end();
    });
  });

  cliente.on('error', error => {
    agregarRegistro(`[ERROR] ${nombre} (${ip}): ${error.message}`);
    cliente.destroy();
  });

  cliente.on('timeout', () => {
    agregarRegistro(`[ERROR] Tiempo de espera agotado en ${nombre} (${ip})`);
    cliente.destroy();
  });
}

// Latido (Heartbeat) para confirmar que el servicio sigue vivo cada 15 minutos
setInterval(() => {
  agregarRegistro(`[SISTEMA] El servicio sigue activo y monitoreando comandos.`);
}, 15 * 60 * 1000);

const { exec } = require('child_process');

// Abre el navegador predeterminado de forma segura en Windows y otros OS
function abrirNavegador(url) {
  // En Windows usamos 'start "" "url"' para que sea más robusto y no falle en equipos nuevos
  const comando = process.platform === 'win32' 
    ? `cmd /c start "" "${url}"` 
    : process.platform === 'darwin' 
      ? `open "${url}"` 
      : `xdg-open "${url}"`;
  
  exec(comando, (error) => {
    if (error) {
      console.error(`\n[ADVERTENCIA] No se pudo abrir el navegador automáticamente.`);
      console.log(`Por favor, abre manualmente esta dirección: ${url}\n`);
    }
  });
}

servidorWeb.listen(PUERTO_UI, () => {
  const url = `http://localhost:${PUERTO_UI}`;
  console.log(`\n--------------------------------------`);
  console.log(`Gestro Bridge UI: ${url}`);
  console.log(`--------------------------------------\n`);
  
  if (fs.existsSync(RUTA_CONFIGURACION)) inicializarSocket();
  
  // Esperamos un segundo para asegurar que el servidor esté listo antes de abrir el navegador
  setTimeout(() => abrirNavegador(url), 1000);
});
