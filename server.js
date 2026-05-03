const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const Database = require('better-sqlite3');

// Initialize SQLite
const db = new Database('chat.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    password TEXT NOT NULL,
    creatorId TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS join_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    roomId TEXT NOT NULL,
    userId TEXT NOT NULL,
    joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(roomId) REFERENCES rooms(id)
  );
`);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const activeRooms = {};

io.on('connection', (socket) => {
    console.log(`[CONNECT] ${socket.id}`);

    // 1. Create Room
    socket.on('createRoom', ({ roomName, password }) => {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        db.prepare('INSERT INTO rooms (id, name, password, creatorId) VALUES (?, ?, ?, ?)')
          .run(roomId, roomName, password, socket.id);

        activeRooms[roomId] = {
            creatorId: socket.id,
            guestId: null,
            password: password,
            roomName: roomName
        };

        socket.join(roomId);
        socket.emit('roomCreated', { roomId, roomName });
        console.log(`[CREATE] Room ${roomId} created by ${socket.id}`);
    });

    // 2. Join Room
    socket.on('joinRoom', ({ roomId, password }) => {
        const room = activeRooms[roomId.toUpperCase()];
        
        if (!room) return socket.emit('error', 'Room not found.');
        
        // Strict 2-User Limit Check
        if (room.guestId !== null) {
            // Notify existing users that someone tried to join
            io.to(roomId).emit('systemMessage', `⚠️ SECURITY ALERT: Unauthorized access attempt by ${socket.id.substring(0,5)}...`);
            return socket.emit('error', 'ACCESS DENIED: Room Capacity Reached (2/2).');
        }

        if (room.password !== password) return socket.emit('error', 'INVALID ACCESS KEY.');

        room.guestId = socket.id;
        socket.join(roomId);
        db.prepare('INSERT INTO join_logs (roomId, userId) VALUES (?, ?)').run(roomId, socket.id);

        io.to(roomId).emit('userJoined', { userId: socket.id });
        socket.emit('joinSuccess', { roomId, roomName: room.roomName });
        console.log(`[JOIN] ${socket.id} joined ${roomId}`);
    });

    // 3. Send Message
    socket.on('sendMessage', ({ roomId, message }) => {
        const payload = {
            senderId: socket.id,
            message: message,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        socket.to(roomId).emit('receiveMessage', payload);
    });

    // 4. Typing
    socket.on('typing', ({ roomId, isTyping }) => {
        socket.to(roomId).emit('userTyping', { userId: socket.id, isTyping });
    });

    // 5. LEAVE CHAT (TERMINATE SESSION)
    socket.on('leaveChat', ({ roomId }) => {
        console.log(`[TERMINATE] Session ended in ${roomId} by ${socket.id}`);
        
        // Notify EVERYONE in the room immediately
        io.to(roomId).emit('sessionTerminated', 'SESSION TERMINATED BY USER.');
        
        // Force disconnect all clients in this room
        const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
        if (socketsInRoom) {
            for (const clientId of socketsInRoom) {
                io.sockets.sockets.get(clientId)?.disconnect(true);
            }
        }

        // Destroy Room Data
        delete activeRooms[roomId];
    });

    // 6. Disconnect
    socket.on('disconnect', () => {
        console.log(`[DISCONNECT] ${socket.id}`);
        for (const [roomId, room] of Object.entries(activeRooms)) {
            if (room.creatorId === socket.id || room.guestId === socket.id) {
                // If anyone disconnects, kill the room to ensure security
                io.to(roomId).emit('sessionTerminated', 'PEER DISCONNECTED. SESSION ENDED.');
                delete activeRooms[roomId];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`IPChat Hacker Edition running on port ${PORT}`);
});