const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Serviamo i file della grafica (HTML, CSS, JS) dalla cartella 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Stato del gioco in memoria
let buzzerQueue = [];
let scores = { A: 0, B: 0 };
let currentSongIndex = 1;

io.on('connection', (socket) => {
  console.log(`🔌 Dispositivo connesso: ${socket.id}`);

  // Invia subito lo stato attuale al dispositivo che si è appena connesso
  socket.emit('initGameState', {
    buzzerQueue,
    scores,
    currentSongIndex
  });

  // 1. Registrazione Giocatore dal Telefono
  socket.on('registerPlayer', (data) => {
    socket.data.playerName = data.name || 'Giocatore Anonymous';
    socket.data.team = data.team; // 'Squadra Rossa' o 'Squadra Blu'
    console.log(`👤 ${socket.data.playerName} è entrato nella ${socket.data.team}`);
  });

  // 2. Pressione del Buzzer dal Telefono
  socket.on('pressBuzzer', () => {
    const team = socket.data.team || 'Senza Squadra';
    const name = socket.data.playerName || 'Giocatore';

    // Controlla se questo specifico giocatore ha già premuto il buzzer in questo turno
    const alreadyBuzzed = buzzerQueue.some(item => item.socketId === socket.id);

    if (!alreadyBuzzed) {
      const buzzerEntry = {
        socketId: socket.id,
        name: name,
        team: team,
        time: new Date().toLocaleTimeString('it-IT', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 2 })
      };

      buzzerQueue.push(buzzerEntry);

      // Invia la coda aggiornata in TEMPO REALE a tutti i dispositivi connessi
      io.emit('buzzerQueueUpdated', buzzerQueue);
      console.log(`🔔 BUZZER! #${buzzerQueue.length} - ${name} (${team})`);
    }
  });

  // 3. COMANDI PRESENTATORE: Reset Coda Buzzer
  socket.on('resetBuzzerQueue', () => {
    buzzerQueue = [];
    io.emit('buzzerQueueUpdated', buzzerQueue);
    console.log('🧹 Coda Buzzer azzerata dal Presentatore');
  });

  // 4. COMANDI PRESENTATORE: Gestione Punteggi
  socket.on('updateScore', ({ team, amount }) => {
    if (scores[team] !== undefined) {
      scores[team] = Math.max(0, scores[team] + amount);
      io.emit('scoreUpdated', scores);
      console.log(`🏆 Punteggio aggiornato: Rossa ${scores.A} - Blu ${scores.B}`);
    }
  });

  // 5. COMANDI PRESENTATORE: Prossima Canzone Top 30
  socket.on('nextSong', () => {
    if (currentSongIndex < 30) {
      currentSongIndex++;
    } else {
      currentSongIndex = 1; // Resetta se arrivato alla fine
    }
    buzzerQueue = []; // Azzera la coda per la nuova canzone
    io.emit('buzzerQueueUpdated', buzzerQueue);
    io.emit('songChanged', currentSongIndex);
    console.log(`🎵 Passati alla canzone #${currentSongIndex}`);
  });

  // Disconnessione
  socket.on('disconnect', () => {
    console.log(`❌ Dispositivo disconnesso: ${socket.id}`);
  });
});

// Avvio del server sulla porta 3000
const os = require('os');

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  const localIp = getLocalIp();
  console.log(`\n==================================================`);
  console.log(`🚀 SERVER ALEBANDA AVVIATO!`);
  console.log(`📺 Computer (Host): http://localhost:${PORT}`);
  console.log(`📱 Smartphone (Wi-Fi): http://${localIp}:${PORT}`);
  console.log(`==================================================\n`);
});