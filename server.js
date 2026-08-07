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

app.use(express.static(path.join(__dirname, 'public')));

// Stato del Gioco in Memoria
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

  socket.emit('initGameState', {
    scores,
    progressCount: playedSongIds.length,
    totalSongs: songsList.length,
    currentSong,
    selectedCategories,
    perksState
  });

  // Registrazione Giocatore
  socket.on('registerPlayer', (data) => {
    socket.data.playerName = data.name || 'Giocatore';
    socket.data.team = data.team;
    console.log(`👤 Registrato: ${socket.data.playerName} (${socket.data.team})`);
  });

  // FASE 1: Caricamento Top 30
  socket.on('loadTop30Songs', (songs) => {
    songsList = songs;
    playedSongIds = [];
    currentSong = null;
    io.emit('top30Reset', { totalSongs: songsList.length });
    console.log(`🎵 Caricate ${songsList.length} canzoni per la Top 30`);
  });

  // FASE 1: Estrazione Canzone
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

    io.emit('newSongExtracted', {
      song: currentSong,
      progressCount: playedSongIds.length,
      totalSongs: songsList.length
    });

    console.log(`▶️ Estratta traccia #${playedSongIds.length}/${songsList.length}: ${currentSong.title}`);
  });

  // Aggiornamento Punteggi
  socket.on('updateScore', ({ team, amount }) => {
    if (scores[team] !== undefined) {
      scores[team] = Math.max(0, scores[team] + amount);
      io.emit('scoreUpdated', scores);
      console.log(`🏆 Punteggi aggiornati: Rossa ${scores.A} | Blu ${scores.B}`);
    }
  });

  // FASE 2: Avvio Categorie
  socket.on('startPhase2', () => {
    leadingTeam = scores.B > scores.A ? 'B' : 'A';
    const otherTeam = leadingTeam === 'A' ? 'B' : 'A';

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
  });

  // FASE 2: Selezione Categoria
  socket.on('selectCategory', (categoryId) => {
    if (!selectedCategories.includes(categoryId)) {
      selectedCategories.push(categoryId);

      io.emit('categorySelectedForHost', {
        categoryId,
        selectedCategories,
        currentTurnTeam: turnPattern[turnIndex]
      });
    }
  });

  // FASE 2: Fine Round Categoria
  socket.on('finishCategoryRound', () => {
    turnIndex++;
    const nextTeam = turnPattern[turnIndex] || null;

    io.emit('returnToCategoryGrid', {
      turnIndex,
      currentTurnTeam: nextTeam,
      selectedCategories
    });
  });

  // FASE 2: Uso Bonus / Malus
  socket.on('usePerk', ({ team, type, index }) => {
    if (perksState[team] && perksState[team][type]) {
      perksState[team][type][index] = true;
      io.emit('perkUpdated', perksState);
    }
  });

  // Sincronizzazione Timer tra Host e Smartphone
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