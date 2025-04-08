const http = require('http');
const express = require('express');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket'],
  allowEIO3: true,
  cleanupEmptyChildNamespaces: true,
  connectTimeout: 45000
});

// Serve static files from the React app
app.use(express.static(path.join(__dirname, 'build')));

// Store game state
let gameState = {
  cards: [],
  drawnCards: [],
  discardPile: [],
  peekedCards: [],
  lastAction: null
};

// Broadcast game state to all connected clients
function broadcastState() {
  io.emit('state', gameState);
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Send current game state to new client
  socket.emit('state', gameState);

  socket.on('message', (data) => {
    const { type, ...payload } = data;
    
    switch (type) {
      case 'draw':
        if (gameState.cards.length > 0) {
          const card = gameState.cards.shift();
          gameState.drawnCards.push(card);
          gameState.lastAction = { type: 'draw', card };
          broadcastState();
        } else if (gameState.discardPile.length > 0) {
          // Shuffle discard pile and add to deck
          const shuffledDiscard = [...gameState.discardPile].sort(() => Math.random() - 0.5);
          gameState.cards = shuffledDiscard;
          gameState.discardPile = [];
          gameState.lastAction = { type: 'reset' };
          broadcastState();
        }
        break;
        
      case 'discard':
        if (gameState.drawnCards.length > 0) {
          // Discard all drawn cards at once
          gameState.discardPile = [...gameState.drawnCards, ...gameState.discardPile];
          gameState.drawnCards = [];
          gameState.lastAction = { type: 'discard' };
          broadcastState();
        }
        break;
        
      case 'peek':
        const count = Math.min(payload.count || 1, gameState.cards.length);
        if (count > 0) {
          // Take cards from the top of the deck
          gameState.peekedCards = gameState.cards.slice(0, count);
          gameState.cards = gameState.cards.slice(count);
          gameState.lastAction = { type: 'peek' };
          broadcastState();
        }
        break;
        
      case 'returnPeeked':
        if (gameState.peekedCards.length > 0) {
          // Add peeked cards back to the top of the deck in their current order
          gameState.cards = [...gameState.peekedCards, ...gameState.cards];
          gameState.peekedCards = [];
          gameState.lastAction = { type: 'returnPeeked' };
          broadcastState();
        }
        break;
        
      case 'reset':
        if (payload.cards && Array.isArray(payload.cards)) {
          gameState.cards = payload.cards;
          gameState.drawnCards = [];
          gameState.discardPile = [];
          gameState.peekedCards = [];
          gameState.lastAction = { type: 'reset' };
          broadcastState();
        }
        break;
        
      case 'updatePeekedCards':
        if (payload.peekedCards && Array.isArray(payload.peekedCards)) {
          console.log(`Updating peeked cards order:`, payload.peekedCards.map(card => card.id));
          gameState.peekedCards = payload.peekedCards;
          gameState.lastAction = { type: 'updatePeekedCards' };
        }
        break;
    }
  });
});

// Handle React routing - serve index.html for all routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// Start the server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 