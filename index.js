
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const os = require('os');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;

// Configuración de logging
const log = (message, type = 'INFO') => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${type}] ${message}`);
};

// Servir página estática
app.get('/', (req, res) => {
  log('Solicitud de página principal recibida');
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Servidor de Transmisión en Vivo</title>
      <style>
        body {
          font-family: 'Courier New', monospace;
          background-color: #121212;
          color: #00ff00;
          margin: 0;
          padding: 20px;
        }
        .console {
          background-color: #1e1e1e;
          border-radius: 5px;
          padding: 15px;
          box-shadow: 0 0 10px rgba(0, 255, 0, 0.2);
          max-width: 800px;
          margin: 20px auto;
        }
        .video-container {
          margin-top: 20px;
          text-align: center;
        }
        #videoStream, #placeholder {
          max-width: 100%;
          height: auto;
          margin: 10px auto;
          display: none;
        }
      </style>
    </head>
    <body>
      <div class="console">
        <div class="console-header">Servidor de Transmisión en Vivo - Estado</div>
        <div class="console-line">
          <span class="status active"></span>Estado: <span id="serverStatus">Activo</span>
        </div>
        <div class="console-line" id="serverTime"></div>
        <div class="console-line">Puerto: ${PORT}</div>
        <div class="console-line">URL local: http://0.0.0.0:${PORT}</div>
        <div class="console-line">URL externa: https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co</div>
        <div class="console-line">IP del servidor: ${getServerIP()}</div>
        <div class="console-line" id="connectedClients">Clientes conectados: 0</div>
        <div class="console-line" id="lastConnection">Última conexión: Ninguna</div>
        <div class="console-line" id="serverUptime">Tiempo de actividad: 0s</div>
        
        <div class="video-container">
          <video id="videoStream" controls>
            <source src="/stream" type="video/mp4">
            Tu navegador no soporta video HTML5.
          </video>
          <img id="placeholder" src="/image" alt="Imagen de placeholder">
        </div>
      </div>

      <script src="/socket.io/socket.io.js"></script>
      <script>
        const socket = io();
        const startTime = new Date();
        const video = document.getElementById('videoStream');
        const placeholder = document.getElementById('placeholder');
        
        socket.on('streamStatus', (status) => {
          console.log('Estado del stream:', status);
          video.style.display = status.streaming ? 'block' : 'none';
          placeholder.style.display = status.streaming ? 'none' : 'block';
        });

        setInterval(() => {
          document.getElementById('serverTime').textContent = 'Hora del servidor: ' + new Date().toLocaleString();
          const uptime = Math.floor((new Date() - startTime) / 1000);
          const hours = Math.floor(uptime / 3600);
          const minutes = Math.floor((uptime % 3600) / 60);
          const seconds = uptime % 60;
          document.getElementById('serverUptime').textContent = 'Tiempo de actividad: ' + 
            (hours > 0 ? hours + 'h ' : '') + 
            (minutes > 0 ? minutes + 'm ' : '') + 
            seconds + 's';
        }, 1000);
        
        socket.on('clientsCount', (count) => {
          document.getElementById('connectedClients').textContent = 'Clientes conectados: ' + count;
        });
        
        socket.on('newConnection', (time) => {
          document.getElementById('lastConnection').textContent = 'Última conexión: ' + time;
        });
      </script>
    </body>
    </html>
  `);
});

// Ruta para el stream de video
app.get('/stream', (req, res) => {
  const videoPath = path.join(__dirname, 'video.mp4');
  log(`Solicitud de stream de video. Buscando: ${videoPath}`);
  
  if (fs.existsSync(videoPath)) {
    log('Archivo de video encontrado, iniciando streaming');
    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(videoPath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
      };
      res.writeHead(206, head);
      file.pipe(res);
      log(`Streaming video desde byte ${start} hasta ${end}`);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      };
      res.writeHead(200, head);
      fs.createReadStream(videoPath).pipe(res);
      log('Iniciando streaming de video completo');
    }
    io.emit('streamStatus', { streaming: true });
  } else {
    log('Archivo de video no encontrado', 'ERROR');
    io.emit('streamStatus', { streaming: false });
    res.status(404).send('Video no encontrado');
  }
});

// Ruta para imagen placeholder
app.get('/image', (req, res) => {
  const imagePath = path.join(__dirname, 'placeholder.jpg');
  log(`Solicitud de imagen placeholder. Buscando: ${imagePath}`);
  
  if (fs.existsSync(imagePath)) {
    log('Enviando imagen placeholder');
    res.sendFile(imagePath);
  } else {
    log('Imagen placeholder no encontrada', 'ERROR');
    res.status(404).send('Imagen no encontrada');
  }
});

// Configurar Socket.IO
io.on('connection', (socket) => {
  log('Nuevo cliente conectado');
  
  const connectionTime = new Date().toLocaleString();
  io.emit('newConnection', connectionTime);
  io.emit('clientsCount', io.engine.clientsCount);
  
  // Verificar estado inicial del stream
  const videoPath = path.join(__dirname, 'video.mp4');
  const isStreaming = fs.existsSync(videoPath);
  socket.emit('streamStatus', { streaming: isStreaming });
  
  socket.on('disconnect', () => {
    log('Cliente desconectado');
    io.emit('clientsCount', io.engine.clientsCount);
  });
});

function getServerIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '0.0.0.0';
}

// Iniciar el servidor
server.listen(PORT, '0.0.0.0', () => {
  log('='.repeat(50));
  log(`Servidor iniciado en puerto ${PORT}`);
  log(`URL externa: https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`);
  log('='.repeat(50));
});
