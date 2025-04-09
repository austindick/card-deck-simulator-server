const express = require('express');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);

// Configure CORS
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    'http://localhost:3000',
    'https://card-deck-simulator.vercel.app',
    /\.vercel\.app$/
  ];
  
  if (!origin || allowedOrigins.some(allowed => {
    if (allowed instanceof RegExp) {
      return allowed.test(origin);
    }
    return allowed === origin;
  })) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    next();
  } else {
    console.log('Blocked request from origin:', origin);
    res.status(403).json({ error: 'Not allowed by CORS' });
  }
});

// Add error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
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

// Create Socket.io server
const io = new Server(httpServer, {
  cors: {
    origin: [
      'http://localhost:3000',
      'https://card-deck-simulator.vercel.app',
      /\.vercel\.app$/
    ],
    methods: ['GET', 'POST'],
    credentials: true
  },
  path: '/socket.io/'
});

// Track connected clients
const clients = new Map();

// Broadcast game state to all connected clients
function broadcastState() {
  io.emit('stateUpdate', gameState);
}

// Broadcast connection count to all clients
function broadcastConnectionCount() {
  io.emit('connectionUpdate', { connections: io.engine.clientsCount });
}

io.on('connection', (socket) => {
  const clientId = socket.id;
  clients.set(socket, { id: clientId, timestamp: Date.now() });
  
  console.log('Client connected:', clientId);
  
  // Send current game state to new client
  socket.emit('stateUpdate', gameState);
  
  // Send connection count
  broadcastConnectionCount();
  
  socket.on('ping', () => {
    socket.emit('pong');
  });
  
  socket.on('getConnectionCount', () => {
    socket.emit('connectionUpdate', { connections: io.engine.clientsCount });
  });
  
  socket.on('message', (message) => {
    try {
      console.log('Received message:', message);
      
      // Update client timestamp
      if (clients.has(socket)) {
        clients.get(socket).timestamp = Date.now();
      }
      
      // Handle game actions
      switch (message.type) {
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
          const count = Math.min(message.data?.count || 1, gameState.cards.length);
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
          if (message.data?.cards && Array.isArray(message.data.cards)) {
            gameState.cards = message.data.cards;
            gameState.drawnCards = [];
            gameState.discardPile = [];
            gameState.peekedCards = [];
            gameState.lastAction = { type: 'reset' };
            broadcastState();
          }
          break;
          
        case 'updatePeekedCards':
          if (message.data?.peekedCards && Array.isArray(message.data.peekedCards)) {
            console.log(`Updating peeked cards order:`, message.data.peekedCards.map(card => card.id));
            gameState.peekedCards = message.data.peekedCards;
            gameState.lastAction = { type: 'updatePeekedCards' };
          }
          break;
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', clientId);
    clients.delete(socket);
    broadcastConnectionCount();
  });
  
  socket.on('error', (error) => {
    console.error('Socket error:', error);
    clients.delete(socket);
    broadcastConnectionCount();
  });
});

// Clean up stale connections every minute
setInterval(() => {
  const now = Date.now();
  let cleanedCount = 0;
  
  io.sockets.sockets.forEach(socket => {
    if (clients.has(socket)) {
      const clientData = clients.get(socket);
      if (now - clientData.timestamp > 60000) {
        console.log('Cleaning up stale connection:', clientData.id);
        socket.disconnect(true);
        clients.delete(socket);
        cleanedCount++;
      }
    }
  });
  
  if (cleanedCount > 0) {
    console.log(`Cleaned up ${cleanedCount} stale connections`);
    broadcastConnectionCount();
  }
}, 60000);

// Handle React routing - serve index.html for all routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// Start the server
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 