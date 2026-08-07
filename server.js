const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Serviamo i file statici dalla cartella 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Stato del Gioco in Memoria
let buzzerQueue = [];
let scores = { A: 0, B: 0 };
let songsList = [];
let playedSongIds = [];
let currentSong = null;
let selectedCategories = [];
let turnIndex = 0;
let turnPattern = [];
let leadingTeam = 'A';

let perksState = {
  A: { bonus: [false, false, false, false], malus: [false, false, false, false] },
  B: { bonus: [false, false, false, false], malus: [false, false, false, false] }
};

io.on('connection', (socket) => {
  console.log(`🔌 Dispositivo connesso: ${socket.id}`);

  // Invia lo stato di gioco iniziale al nuovo dispositivo connesso
  socket.emit('initGameState', {
    buzzerQueue,
    scores,
    progressCount: playedSongIds.length,
    totalSongs: songsList.length,
    currentSong,
    selectedCategories,
    perksState
  });

  // 1. REGISTRAZIONE GIOCATORE (da smartphone)
  socket.on('registerPlayer', (data) => {
    socket.data.playerName = data.name || 'Giocatore';
    socket.data.team = data.team; // 'Squadra Rossa' o 'Squadra Blu'
    console.log(`👤 Registrato: ${socket.data.playerName} (${socket.data.team})`);
  });

  // 2. PRESSIONE BUZZER (Usato in Fase 1)
  socket.on('pressBuzzer', () => {
    const team = socket.data.team || 'Senza Squadra';
    const name = socket.data.playerName || 'Giocatore';

    // Evita prenotazioni doppie dallo stesso dispositivo
    const alreadyBuzzed = buzzerQueue.some(item => item.socketId === socket.id);

    if (!alreadyBuzzed) {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('it-IT', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit'
      }) + '.' + String(now.getMilliseconds()).padStart(3, '0');

      const buzzerEntry = {
        socketId: socket.id,
        name: name,
        team: team,
        time: timeStr
      };

      buzzerQueue.push(buzzerEntry);
      io.emit('buzzerQueueUpdated', buzzerQueue);
      console.log(`🔔 BUZZER! #${buzzerQueue.length} - ${name} (${team}) a ${timeStr}`);
    }
  });

  // 3. FASE 1: CARICAMENTO LISTA TOP 30
  socket.on('loadTop30Songs', (songs) => {
    songsList = songs;
    playedSongIds = [];
    currentSong = null;
    buzzerQueue = [];
    io.emit('top30Reset', { totalSongs: songsList.length });
    io.emit('buzzerQueueUpdated', buzzerQueue);
    console.log(`🎵 Caricate ${songsList.length} canzoni per la Top 30`);
  });

  // 4. FASE 1: ESTRAZIONE CASUALE PROSSIMA CANZONE
  socket.on('playNextRandomSong', () => {
    const remainingSongs = songsList.filter(song => !playedSongIds.includes(song.id));

    if (remainingSongs.length === 0) {
      io.emit('top30Finished');
      console.log('🏆 Top 30 Completata!');
      return;
    }

    const randomIndex = Math.floor(Math.random() * remainingSongs.length);
    currentSong = remainingSongs[randomIndex];
    playedSongIds.push(currentSong.id);

    // Azzera la coda buzzer per il nuovo brano
    buzzerQueue = [];
    io.emit('buzzerQueueUpdated', buzzerQueue);

    io.emit('newSongExtracted', {
      song: currentSong,
      progressCount: playedSongIds.length,
      totalSongs: songsList.length
    });

    console.log(`▶️ Estratta traccia #${playedSongIds.length}/${songsList.length}: ${currentSong.title}`);
  });

  // 5. RESET CODA BUZZER (Comando Host Fase 1)
  socket.on('resetBuzzerQueue', () => {
    buzzerQueue = [];
    io.emit('buzzerQueueUpdated', buzzerQueue);
    console.log('🧹 Coda Buzzer azzerata dal Presentatore');
  });

  // 6. AGGIORNAMENTO PUNTEGGI
  socket.on('updateScore', ({ team, amount }) => {
    if (scores[team] !== undefined) {
      scores[team] = Math.max(0, scores[team] + amount);
      io.emit('scoreUpdated', scores);
      console.log(`🏆 Punteggi aggiornati: Rossa ${scores.A} | Blu ${scores.B}`);
    }
  });

  // 7. FASE 2: AVVIO CATEGORIE & CALCOLO PATTERN TURNI
  socket.on('startPhase2', () => {
    leadingTeam = scores.B > scores.A ? 'B' : 'A';
    const otherTeam = leadingTeam === 'A' ? 'B' : 'A';

    // Sequenza alternata basata su chi è in vantaggio dopo la Fase 1
    turnPattern = [
      leadingTeam, otherTeam, otherTeam, 
      leadingTeam, leadingTeam, 
      otherTeam, otherTeam, 
      leadingTeam, leadingTeam, 
      otherTeam
    ];

    turnIndex = 0;

    io.emit('phase2Started', {
      turnPattern,
      currentTurnTeam: turnPattern[turnIndex],
      turnIndex,
      perksState
    });
    console.log(`🚀 Iniziata Fase 2. Squadra in vantaggio: ${leadingTeam === 'A' ? 'Rossa' : 'Blu'}`);
  });

  // 8. FASE 2: SELEZIONE CATEGORIA
  socket.on('selectCategory', (categoryId) => {
    if (!selectedCategories.includes(categoryId)) {
      selectedCategories.push(categoryId);

      io.emit('categorySelectedForHost', {
        categoryId,
        selectedCategories,
        currentTurnTeam: turnPattern[turnIndex]
      });
      console.log(`📁 Selezionata categoria #${categoryId}`);
    }
  });

  // 9. FASE 2: FINE ROUND CATEGORIA (Avanzamento turno)
  socket.on('finishCategoryRound', () => {
    turnIndex++;
    const nextTeam = turnPattern[turnIndex] || null;

    io.emit('returnToCategoryGrid', {
      turnIndex,
      currentTurnTeam: nextTeam,
      selectedCategories
    });
  });

  // 10. FASE 2: USO BONUS / MALUS
  socket.on('usePerk', ({ team, type, index }) => {
    if (perksState[team] && perksState[team][type]) {
      perksState[team][type][index] = true;
      io.emit('perkUpdated', perksState);
      console.log(`💥 ${team} ha usato ${type.toUpperCase()} #${index + 1}`);
    }
  });

  // 11. SINCRONIZZAZIONE TIMER 5 SECONDI
  socket.on('triggerTimerStart', () => {
    io.emit('startTimerOnClients');
  });

  socket.on('triggerTimerStop', () => {
    io.emit('stopTimerOnClients');
  });

  socket.on('disconnect', () => {
    console.log(`❌ Dispositivo disconnesso: ${socket.id}`);
  });
});

// Funzione ausiliaria per ricavare l'IP locale Wi-Fi
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
  console.log(`🚀 SERVER ALEBANDA AVVIATO CON SUCCESSO!`);
  console.log(`📺 PC / Schermo Host:   http://localhost:${PORT}`);
  console.log(`📱 Smartphone (Wi-Fi):  http://${localIp}:${PORT}`);
  console.log(`==================================================\n`);
});