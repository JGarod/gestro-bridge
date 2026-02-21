# 🖨️ Guía de Uso Puntual: Gestro Bridge

Gestro Bridge es el componente que conecta la nube con tus impresoras locales. Esta guía explica cómo ponerlo en marcha en menos de 2 minutos.

---

## 📋 Requisitos Previos
1. **PC con Windows:** Debe ser el computador que esté conectado a la misma red (Wifi o Cable) que las impresoras.
2. **Impresoras LAN:** Tus impresoras deben estar encendidas y tener una IP estática en tu red local.
3. **Archivo Ejecutable:** Debes tener el archivo `GestroBridge.exe`.

---

## 🚀 Pasos para la Instalación

### 1. Ejecutar el Programa
Doble clic al archivo `GestroBridge.exe`. Verás una ventana de comandos (terminal) negra que indica que el servidor local está iniciado.

### 2. Abrir el Panel de Control
Automáticamente se abrirá una pestaña en tu navegador en la dirección: `http://localhost:8080`.
> [!TIP]
> Si no se abre sola, escríbela manualmente en Chrome o Edge.

### 3. Activación de la Sede
En el panel visual que aparece:
1. Ingresa el **Correo** y **Contraseña** de tu cuenta administrativa de Gestro.
2. Haz clic en **"Conectar ahora"**.

---

## ⚙️ Configuración en la Nube (Panel Admin)

Una vez el Bridge esté "Activo", entra a tu panel de Gestro en la web y ve a **Administración > Impresoras**.

1. **Tokens:** Verás que tu sede ahora aparece como "Enlazada".
2. **Auto-Registro:** El Bridge habrá escaneado tu red y verás las impresoras detectadas automáticamente en el listado.
3. **Edición:** Si una impresora no tiene nombre, dale a "Editar", ponle un nombre (ej: "Cocina") y selecciona si es para **Cocina** o **Bar**.

---

## 🛠️ Solución de Problemas Comunes

### El Panel dice "Error de conexión con el servidor Gestro"
- Verifica que el PC tenga acceso a Internet.
- Asegúrate de que no haya un firewall bloqueando la salida del programa.

### No aparecen impresoras en el listado
- Verifica que las impresoras estén encendidas y conectadas al mismo router que el PC.
- Asegúrate de que las impresoras soporten el protocolo ESC/POS sobre el puerto 9100.

### Las impresoras aparecen pero no imprimen
- En el panel de Admin de Gestro, verifica que la IP que muestra la impresora sea la correcta.
- Prueba a reiniciar el archivo `GestroBridge.exe`.

---

## 💡 Recomendación Pro
Para que el sistema nunca falle, asegúrate de que el PC del local **no se apague ni entre en suspensión** durante las horas de servicio, ya que es el "puente" que lleva los pedidos a la cocina.
